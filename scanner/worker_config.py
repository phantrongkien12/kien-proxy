import argparse
import json
import os
import re
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_CONFIG = Path('/etc/kien-proxy/worker.json')
OPTION_NAMES = {
    'SCANNER_AUTO', 'SCANNER_MODE', 'SCANNER_COUNTRY', 'SCANNER_FOLLOW_RANDOM',
    'SCANNER_PORTS', 'SCANNER_THREADS', 'ZMAP_RATE', 'ZMAP_MAX_TARGETS',
    'PATCH_MIN_SECONDS', 'PROXY_VERIFY_TIMEOUT',
}


class ConfigError(ValueError):
    pass


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise ConfigError('Không đọc được file cấu hình JSON. Kiểm tra đường dẫn và quyền truy cập.') from None


def normalize_config(data, generate_node=False):
    if not isinstance(data, dict) or data.get('version', 1) != 1:
        raise ConfigError('Định dạng cấu hình không được hỗ trợ.')
    url = data.get('url')
    if not isinstance(url, str):
        raise ConfigError('Cấu hình thiếu URL dashboard.')
    url = url.strip().rstrip('/')
    try:
        parsed = urlsplit(url)
        parsed.port
        local_http = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')
        if (not parsed.hostname or not (parsed.scheme == 'https' or local_http)
                or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError()
    except ValueError:
        raise ConfigError('URL phải là origin HTTPS, không có tài khoản, đường dẫn, query hoặc fragment.') from None

    fleet = data.get('fleet_token')
    token = data.get('token')
    if bool(fleet) == bool(token):
        raise ConfigError('Cần đúng một token riêng hoặc fleet_token; không dùng User ID làm token.')
    secret = fleet or token
    if not isinstance(secret, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', secret):
        raise ConfigError('Token phải dài 32–256 ký tự chữ, số, gạch ngang hoặc gạch dưới.')
    if re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', secret, re.IGNORECASE):
        raise ConfigError('Không dùng User ID công khai làm token. Tải cấu hình token riêng từ trang VPS.')
    node = data.get('node')
    if not node and fleet and generate_node:
        node = 'wrk_' + uuid.uuid4().hex
    if not isinstance(node, str) or not re.fullmatch(r'[A-Za-z0-9._-]{3,64}', node):
        raise ConfigError('Mã VPS phải có 3–64 ký tự chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.')
    if fleet and not re.fullmatch(r'wrk_[A-Za-z0-9_-]{1,60}', node):
        raise ConfigError('Mã worker fleet phải bắt đầu bằng wrk_.')

    raw_options = data.get('options', {})
    if not isinstance(raw_options, dict) or set(raw_options) - OPTION_NAMES:
        raise ConfigError('Tùy chọn scanner không hợp lệ hoặc có tên biến không được phép.')
    options = {}
    for key, value in raw_options.items():
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise ConfigError('Giá trị tùy chọn scanner phải là chuỗi hoặc số.')
        value = str(value)
        try:
            if key == 'SCANNER_MODE':
                valid = value in ('country', 'random')
            elif key == 'SCANNER_COUNTRY':
                value = value.upper()
                valid = bool(re.fullmatch(r'[A-Z]{2}', value))
            elif key in ('SCANNER_AUTO', 'SCANNER_FOLLOW_RANDOM'):
                valid = value in ('0', '1')
            elif key == 'SCANNER_PORTS':
                ports = value.split(',')
                valid = 0 < len(ports) <= 100 and all(1 <= int(port) <= 65535 for port in ports)
            elif key == 'SCANNER_THREADS':
                valid = 1 <= int(value) <= 2000
            elif key == 'PROXY_VERIFY_TIMEOUT':
                valid = 0 < float(value) <= 120
            else:
                valid = 1 <= int(value) <= 2147483647
        except ValueError:
            valid = False
        if not valid:
            raise ConfigError('Giá trị tùy chọn scanner nằm ngoài phạm vi cho phép.')
        options[key] = value

    result = {'version': 1, 'url': url, 'node': node, 'options': options}
    result['fleet_token' if fleet else 'token'] = secret
    return result


def read_config(path):
    return normalize_config(read_json(path))


def install_config(source, target):
    target = Path(target)
    incoming = read_json(source)
    config = normalize_config(incoming, generate_node=True)
    if incoming.get('fleet_token') and not incoming.get('node') and target.exists():
        existing = read_config(target)
        if config['url'] == existing['url'] and config.get('fleet_token') == existing.get('fleet_token'):
            config['node'] = existing['node']
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.worker-', suffix='.json', dir=str(target.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(config, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return config


def load_worker_environment(path=None):
    explicit = os.getenv('KIEN_PROXY_CONFIG', '').strip()
    chosen = Path(path) if path is not None else Path(explicit) if explicit else DEFAULT_CONFIG
    if not chosen.exists():
        if explicit or path is not None:
            raise ConfigError('Không tìm thấy file cấu hình worker đã chọn.')
        return False
    config = read_config(chosen)
    values = {
        'LEDGER_URL': config['url'],
        'VPS_ID': config['node'],
        'VPS_TOKEN': config.get('token') or config['fleet_token'],
        'SCANNER_AUTO': '1',
        **config['options'],
    }
    for key, value in values.items():
        if not os.environ.get(key):
            os.environ[key] = value
    if not os.environ.get('LEDGER_INGEST_URL'):
        os.environ['LEDGER_INGEST_URL'] = os.environ['LEDGER_URL'].rstrip('/') + '/api/ingest'
    return True


def main():
    parser = argparse.ArgumentParser(description='Kiểm tra/lưu cấu hình riêng của Kien Proxy; không in token.')
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--check', metavar='FILE')
    actions.add_argument('--install-config', metavar='FILE')
    parser.add_argument('--target', default=str(DEFAULT_CONFIG))
    args = parser.parse_args()
    try:
        config = read_config(args.check) if args.check else install_config(args.install_config, args.target)
    except ConfigError as error:
        print(str(error), file=sys.stderr)
        return 1
    print('Cấu hình hợp lệ cho VPS ' + config['node'] + '; token không được hiển thị.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

import contextlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
import shutil
from pathlib import Path
from unittest.mock import patch

from worker_config import (
    ConfigError, install_config, install_credentials, load_worker_environment, normalize_config, read_config,
)


class WorkerConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.source = self.root / 'download.json'
        self.target = self.root / 'etc' / 'worker.json'
        self.secret = 'test-only-not-a-live-token-' + 'a' * 40
        self.config = {
            'version': 1, 'url': 'https://ledger.example.org',
            'node': 'VPS-TEST-01', 'token': self.secret,
            'options': {'SCANNER_MODE': 'random', 'SCANNER_THREADS': '40'},
        }

    def tearDown(self):
        self.directory.cleanup()

    def save_source(self, data=None):
        self.source.write_text(json.dumps(self.config if data is None else data), encoding='utf-8')

    def test_normalizes_origin_without_changing_credentials(self):
        result = normalize_config({**self.config, 'url': self.config['url'] + '/'})
        self.assertEqual(result['url'], self.config['url'])
        self.assertEqual(result['token'], self.secret)
        self.assertEqual(result['node'], self.config['node'])

    def test_config_survives_restart_without_environment_input(self):
        self.save_source()
        install_config(self.source, self.target)
        for _ in range(2):
            with patch.dict(os.environ, {}, clear=True):
                self.assertTrue(load_worker_environment(self.target))
                self.assertEqual(os.environ['VPS_ID'], self.config['node'])
                self.assertEqual(os.environ['VPS_TOKEN'], self.secret)
                self.assertEqual(os.environ['LEDGER_INGEST_URL'], self.config['url'] + '/api/ingest')
                self.assertEqual(os.environ['SCANNER_AUTO'], '1')
                self.assertEqual(os.environ['SCANNER_THREADS'], '40')
        self.assertEqual(read_config(self.target)['node'], self.config['node'])

    def test_private_permissions_and_no_token_output(self):
        self.save_source()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            install_config(self.source, self.target)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.target.parent.stat().st_mode), 0o700)
        self.assertNotIn(self.secret, output.getvalue())

    def test_reinstall_keeps_per_node_identity(self):
        self.save_source()
        first = install_config(self.source, self.target)
        second = install_config(self.source, self.target)
        self.assertEqual(first, second)

    def test_fleet_id_is_generated_once_and_reused(self):
        fleet = {'url': self.config['url'], 'fleet_token': self.secret}
        self.save_source(fleet)
        first = install_config(self.source, self.target)
        second = install_config(self.source, self.target)
        self.assertTrue(first['node'].startswith('wrk_'))
        self.assertEqual(first['node'], second['node'])
        with patch.dict(os.environ, {}, clear=True):
            load_worker_environment(self.target)
            self.assertEqual(os.environ['VPS_ID'], first['node'])
            self.assertEqual(os.environ['VPS_TOKEN'], self.secret)

    def test_two_fresh_fleet_installations_get_different_ids(self):
        self.save_source({'url': self.config['url'], 'fleet_token': self.secret})
        first = install_config(self.source, self.target)
        second = install_config(self.source, self.root / 'second' / 'worker.json')
        self.assertNotEqual(first['node'], second['node'])

    def test_invalid_import_does_not_replace_working_config(self):
        self.save_source()
        install_config(self.source, self.target)
        previous = self.target.read_bytes()
        self.save_source({**self.config, 'url': 'http://remote.example.org'})
        with self.assertRaises(ConfigError):
            install_config(self.source, self.target)
        self.assertEqual(self.target.read_bytes(), previous)

    def test_rejects_unsafe_urls(self):
        for url in ('http://remote.example.org', 'http://localhost.evil.org',
                    'https://user:password@ledger.example.org', 'https://ledger.example.org/extra',
                    'https://ledger.example.org?key=value', 'https://ledger.example.org#fragment',
                    'https://ledger.example.org:bad'):
            with self.subTest(url=url), self.assertRaises(ConfigError):
                normalize_config({**self.config, 'url': url})

    def test_rejects_user_id_as_secret_and_hides_bad_secret(self):
        bad_secret = 'bad!secret-value-that-must-not-be-logged'
        for secret in ('a-user-id', '00000000-0000-4000-8000-000000000000', bad_secret):
            with self.subTest(secret=secret), self.assertRaises(ConfigError) as error:
                normalize_config({**self.config, 'token': secret})
            self.assertNotIn(secret, str(error.exception))

    def test_rejects_arbitrary_environment_options(self):
        with self.assertRaises(ConfigError):
            normalize_config({**self.config, 'options': {'LD_PRELOAD': '/tmp/untrusted.so'}})

    def test_rejects_invalid_scanner_parameters(self):
        invalid = ({'SCANNER_THREADS': 0}, {'SCANNER_THREADS': 2001},
                   {'SCANNER_PORTS': '0,65536'}, {'SCANNER_MODE': 'unknown'},
                   {'PROXY_VERIFY_TIMEOUT': 'nan'}, {'SCANNER_AUTO': True})
        for options in invalid:
            with self.subTest(options=options), self.assertRaises(ConfigError):
                normalize_config({**self.config, 'options': options})

    def test_explicit_options_can_override_saved_values(self):
        self.save_source()
        install_config(self.source, self.target)
        with patch.dict(os.environ, {'SCANNER_THREADS': '20'}, clear=True):
            load_worker_environment(self.target)
            self.assertEqual(os.environ['SCANNER_THREADS'], '20')

    def test_missing_explicit_config_is_actionable(self):
        with patch.dict(os.environ, {'KIEN_PROXY_CONFIG': str(self.root / 'missing.json')}, clear=True):
            with self.assertRaises(ConfigError):
                load_worker_environment()

    def test_scanner_import_reuses_saved_identity_without_scanning(self):
        scanner_dir = Path(__file__).resolve().parent
        code = '''
import json, os
from pathlib import Path
import geo_proxy_scanner as scanner
config = json.loads(Path(os.environ['KIEN_PROXY_CONFIG']).read_text())
scanner.check_ledger_setup()
assert scanner.SAVED_WORKER_CONFIG
assert scanner.VPS_ID == config['node']
assert scanner.VPS_TOKEN == (config.get('token') or config['fleet_token'])
assert scanner.INGEST_URL == config['url'] + '/api/ingest'
'''
        env = {
            'PATH': os.defpath,
            'PYTHONPATH': str(scanner_dir) + os.pathsep + os.environ.get('PYTHONPATH', ''),
            'KIEN_PROXY_CONFIG': str(self.target),
            'FLEET_TOKEN': 'test-only-legacy-token-that-must-not-override-config',
            'WORKER_ID': 'wrk_must_not_replace_saved_id',
        }
        for data in (self.config, {'url': self.config['url'], 'fleet_token': self.secret}):
            self.save_source(data)
            install_config(self.source, self.target)
            for _ in range(2):
                result = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn(self.secret, result.stdout + result.stderr)

    def test_credentials_flags_install_without_any_file(self):
        config = install_credentials(self.config['url'], self.config['node'], self.secret, self.target)
        self.assertEqual(config['node'], self.config['node'])
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(load_worker_environment(self.target))
            self.assertEqual(os.environ['VPS_ID'], self.config['node'])
            self.assertEqual(os.environ['VPS_TOKEN'], self.secret)

    def test_credentials_flags_reject_incomplete_or_unsafe_input(self):
        for url, node, token in (
            (self.config['url'], self.config['node'], ''),
            ('http://remote.example.org', self.config['node'], self.secret),
            (self.config['url'], 'bad node!', self.secret),
            (self.config['url'], self.config['node'], '00000000-0000-4000-8000-000000000000'),
        ):
            with self.subTest(node=node), self.assertRaises(ConfigError):
                install_credentials(url, node, token, self.target)
        self.assertFalse(self.target.exists())

    def test_installer_accepts_credential_flags_and_keeps_config_on_reinstall(self):
        script = (Path(__file__).resolve().parent / 'install_worker.sh').read_text(encoding='utf-8')
        for flag in ('--url', '--node', '--token', '--set-credentials'):
            self.assertIn(flag, script)
        self.assertIn('Chỉ dùng một trong --config hoặc --url/--node/--token.', script)

    def test_installer_supports_hosts_without_init_system(self):
        script = (Path(__file__).resolve().parent / 'install_worker.sh').read_text(encoding='utf-8')
        self.assertIn('INIT=none', script)
        self.assertIn('/usr/local/bin/kien-proxy', script)
        self.assertIn('@reboot root /usr/local/bin/kien-proxy start', script)
        self.assertIn('/etc/profile.d/kien-proxy.sh', script)
        self.assertNotIn('Container/no-init không được installer này hỗ trợ', script)

    def test_installer_does_not_trust_files_beside_downloaded_script(self):
        script = (Path(__file__).resolve().parent / 'install_worker.sh').read_text(encoding='utf-8')
        self.assertNotIn('SCRIPT_DIR', script)
        self.assertIn("--proto '=https'", script)
        self.assertIn('https://raw.githubusercontent.com/phantrongkien12/kien-proxy/', script)

    def test_fleet_bundle_includes_installer_and_config_loader(self):
        scanner_dir = Path(__file__).resolve().parent
        bundle_dir = self.root / 'bundle'
        bundle_dir.mkdir()
        names = ('setup_fleet.py', 'geo_proxy_scanner.py', 'worker_config.py',
                 'install_worker.sh', 'start_worker.sh', 'zmap_blocklist.conf')
        for name in names:
            shutil.copy2(scanner_dir / name, bundle_dir / name)
        result = subprocess.run(
            [sys.executable, str(bundle_dir / 'setup_fleet.py'), self.config['url']],
            env={'PATH': os.defpath}, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(bundle_dir / 'fleet_worker_bundle.zip') as archive:
            self.assertTrue({'worker_config.py', 'install_worker.sh', 'fleet_config.json'}.issubset(archive.namelist()))
            config = json.loads(archive.read('fleet_config.json'))
            self.assertEqual(config['url'], self.config['url'])
            self.assertNotIn('node', config)

    def test_legacy_environment_still_works_without_saved_file(self):
        with patch.dict(os.environ, {'VPS_ID': 'legacy-node'}, clear=True):
            with patch('worker_config.DEFAULT_CONFIG', self.root / 'missing.json'):
                self.assertFalse(load_worker_environment())
            self.assertEqual(os.environ['VPS_ID'], 'legacy-node')


if __name__ == '__main__':
    unittest.main()

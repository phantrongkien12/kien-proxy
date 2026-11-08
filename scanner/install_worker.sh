#!/bin/sh
set -eu
umask 077

CONFIG_SOURCE=
CONFIG=/etc/kien-proxy/worker.json
APP=/opt/kien-proxy
STATE=/var/lib/kien-proxy
BASE=https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner

usage() {
  printf '%s\n' 'Kien Proxy: cài một lần và giữ cấu hình sau reboot.' \
    'Lần đầu: sudo sh install_worker.sh --config /duong-dan/kien-proxy-worker.json' \
    'Lần sau: sudo sh install_worker.sh (giữ nguyên token và mã VPS)' \
    'Hỗ trợ systemd/OpenRC; cần root, Python 3, requests, ZMap và quyền raw socket.'
}
fail() { printf '%s\n' "$1" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      [ "$#" -ge 2 ] || fail 'Thiếu đường dẫn sau --config.'
      CONFIG_SOURCE=$2
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail 'Tham số không hợp lệ. Dùng --help để xem hướng dẫn.' ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail 'Chạy installer bằng sudo hoặc root.'
[ "$(uname -s)" = Linux ] || fail 'Installer này chỉ dành cho Linux.'
if [ -n "$CONFIG_SOURCE" ]; then
  [ -f "$CONFIG_SOURCE" ] || fail 'Không tìm thấy file cấu hình tải từ dashboard.'
elif [ ! -f "$CONFIG" ]; then
  fail 'Lần đầu cần --config FILE. Đăng nhập dashboard > VPS > Tạo token > Tải cấu hình VPS.'
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  INIT=systemd
elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then
  INIT=openrc
else
  fail 'VPS cần systemd hoặc OpenRC đang hoạt động. Container/no-init không được installer này hỗ trợ.'
fi

pick_python() {
  if [ -x /usr/bin/python3 ]; then PYTHON=/usr/bin/python3
  else PYTHON=$(command -v python3 2>/dev/null || true)
  fi
}
pick_python
if [ -z "$PYTHON" ] || ! "$PYTHON" -c 'import requests' >/dev/null 2>&1 \
  || ! command -v zmap >/dev/null 2>&1 \
  || { ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; }; then
  printf '%s\n' 'Đang cài các gói còn thiếu; không thay đổi token đã lưu.'
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-requests zmap curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-requests zmap curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-requests zmap curl ca-certificates
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 py3-requests zmap curl ca-certificates
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --needed --noconfirm python python-requests zmap curl ca-certificates
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install python3 python3-requests zmap curl ca-certificates
  else
    fail 'Không nhận diện được package manager. Cài Python 3, requests, ZMap và curl/wget rồi chạy lại; không cần tạo lại token.'
  fi
fi
pick_python
[ -n "$PYTHON" ] || fail 'Chưa có Python 3.'
"$PYTHON" -c 'import requests' || fail 'Thiếu requests trong Python hệ thống.'
command -v zmap >/dev/null 2>&1 || fail 'Thiếu ZMap. Kiểm tra kho gói của distro (ví dụ EPEL/community), cài zmap rồi chạy lại.'

STAGE=$(mktemp -d)
cleanup() { [ -z "${STAGE:-}" ] || rm -rf -- "$STAGE"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fetch_file() {
  file=$1
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --tlsv1.2 "$BASE/$file" -o "$STAGE/$file"
  else
    wget -q -O "$STAGE/$file" "$BASE/$file"
  fi
}
for file in geo_proxy_scanner.py worker_config.py zmap_blocklist.conf start_worker.sh; do
  fetch_file "$file"
done

if [ -n "$CONFIG_SOURCE" ]; then
  if [ -f "$CONFIG" ]; then
    cp "$CONFIG" "$STAGE/worker.json"
  fi
  "$PYTHON" "$STAGE/worker_config.py" --install-config "$CONFIG_SOURCE" --target "$STAGE/worker.json"
else
  "$PYTHON" "$STAGE/worker_config.py" --check "$CONFIG"
  printf '%s\n' 'Dùng lại cấu hình đã lưu; không hỏi token và không tạo mã VPS mới.'
fi

install -d -m 700 /etc/kien-proxy "$STATE" "$STATE/queue"
install -d -m 755 "$APP"
if [ -n "$CONFIG_SOURCE" ]; then
  install -m 600 "$STAGE/worker.json" /etc/kien-proxy/.worker.json.new
  mv /etc/kien-proxy/.worker.json.new "$CONFIG"
fi
for file in geo_proxy_scanner.py worker_config.py zmap_blocklist.conf start_worker.sh; do
  install -m 644 "$STAGE/$file" "$APP/$file"
done

if [ "$INIT" = systemd ]; then
  cat > /etc/systemd/system/kien-proxy.service <<EOF
[Unit]
Description=Kien Proxy worker
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP
Environment=KIEN_PROXY_CONFIG=$CONFIG
Environment=PROXY_QUEUE_DIR=$STATE/queue
Environment=SCANNER_AUTO=1
ExecStart=$PYTHON -u $APP/geo_proxy_scanner.py
KillSignal=SIGINT
TimeoutStopSec=30
Restart=on-failure
RestartSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  chmod 644 /etc/systemd/system/kien-proxy.service
  systemctl daemon-reload
  systemctl enable kien-proxy.service
  systemctl restart kien-proxy.service
  systemctl is-active --quiet kien-proxy.service
  printf '%s\n' 'Đã bật tự chạy sau reboot. Xem log: sudo journalctl -u kien-proxy -f' \
    'Lần sau: sudo systemctl restart kien-proxy (không cần nhập lại cấu hình).'
else
  touch /var/log/kien-proxy.log
  chmod 600 /var/log/kien-proxy.log
  cat > /etc/init.d/kien-proxy <<EOF
#!/sbin/openrc-run
name="Kien Proxy worker"
supervisor="supervise-daemon"
command="$PYTHON"
command_args="-u $APP/geo_proxy_scanner.py"
directory="$APP"
respawn_delay=15
respawn_max=0
output_log="/var/log/kien-proxy.log"
error_log="/var/log/kien-proxy.log"
umask=0077
export KIEN_PROXY_CONFIG="$CONFIG"
export PROXY_QUEUE_DIR="$STATE/queue"
export SCANNER_AUTO=1
depend() {
  need net
}
EOF
  chmod 755 /etc/init.d/kien-proxy
  rc-update add kien-proxy default
  rc-service kien-proxy restart
  printf '%s\n' 'Đã bật tự chạy sau reboot. Xem log: sudo tail -f /var/log/kien-proxy.log' \
    'Lần sau: sudo rc-service kien-proxy restart (không cần nhập lại cấu hình).'
fi
printf '%s\n' 'Cấu hình bí mật: /etc/kien-proxy/worker.json (root, mode 600).' \
  'Hàng đợi bền vững: /var/lib/kien-proxy/queue. Không xóa queue khi khởi động lại.'

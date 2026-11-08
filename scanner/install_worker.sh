#!/bin/sh
set -eu
umask 077

CONFIG_SOURCE=
URL=
NODE=
TOKEN=
CONFIG=/etc/kien-proxy/worker.json
APP=/opt/kien-proxy
STATE=/var/lib/kien-proxy
BASE=https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner

usage() {
  printf '%s\n' 'Kien Proxy: cài một lần và giữ cấu hình sau reboot.' \
    'Máy mới, một lệnh: sudo sh install_worker.sh --url URL --node MA_VPS --token TOKEN' \
    'Hoặc dùng file tải từ dashboard: sudo sh install_worker.sh --config FILE' \
    'Lần sau: sudo sh install_worker.sh (giữ nguyên token và mã VPS)' \
    'Hỗ trợ systemd, OpenRC và máy không có init (container/LXC/WSL).' \
    'Cần root, Python 3, requests, ZMap và quyền raw socket.'
}
fail() { printf '%s\n' "$1" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      [ "$#" -ge 2 ] || fail 'Thiếu đường dẫn sau --config.'
      CONFIG_SOURCE=$2
      shift 2
      ;;
    --url)
      [ "$#" -ge 2 ] || fail 'Thiếu giá trị sau --url.'
      URL=$2
      shift 2
      ;;
    --node)
      [ "$#" -ge 2 ] || fail 'Thiếu giá trị sau --node.'
      NODE=$2
      shift 2
      ;;
    --token)
      [ "$#" -ge 2 ] || fail 'Thiếu giá trị sau --token.'
      TOKEN=$2
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) fail 'Tham số không hợp lệ. Dùng --help để xem hướng dẫn.' ;;
  esac
done

if [ -n "$URL" ] || [ -n "$NODE" ] || [ -n "$TOKEN" ]; then
  [ -n "$URL" ] && [ -n "$NODE" ] && [ -n "$TOKEN" ] || fail 'Cần đủ --url, --node và --token.'
  [ -z "$CONFIG_SOURCE" ] || fail 'Chỉ dùng một trong --config hoặc --url/--node/--token.'
  CREDENTIALS=1
else
  CREDENTIALS=
fi

[ "$(id -u)" -eq 0 ] || fail 'Chạy installer bằng sudo hoặc root.'
[ "$(uname -s)" = Linux ] || fail 'Installer này chỉ dành cho Linux.'
if [ -n "$CONFIG_SOURCE" ]; then
  [ -f "$CONFIG_SOURCE" ] || fail 'Không tìm thấy file cấu hình tải từ dashboard.'
elif [ -z "$CREDENTIALS" ] && [ ! -f "$CONFIG" ]; then
  fail 'Lần đầu cần --url/--node/--token hoặc --config FILE. Đăng nhập dashboard > VPS > Tạo token.'
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  INIT=systemd
elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then
  INIT=openrc
else
  INIT=none
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
elif [ -n "$CREDENTIALS" ]; then
  "$PYTHON" "$STAGE/worker_config.py" --set-credentials --url "$URL" --node "$NODE" --token "$TOKEN" --target "$STAGE/worker.json"
else
  "$PYTHON" "$STAGE/worker_config.py" --check "$CONFIG"
  printf '%s\n' 'Dùng lại cấu hình đã lưu; không hỏi token và không tạo mã VPS mới.'
fi

install -d -m 700 /etc/kien-proxy "$STATE" "$STATE/queue"
install -d -m 755 "$APP"
if [ -n "$CONFIG_SOURCE" ] || [ -n "$CREDENTIALS" ]; then
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
elif [ "$INIT" = openrc ]; then
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
else
  touch /var/log/kien-proxy.log
  chmod 600 /var/log/kien-proxy.log
  cat > /usr/local/bin/kien-proxy <<EOF
#!/bin/sh
# Điều khiển worker trên máy không có systemd/OpenRC (container, LXC, WSL).
set -u
APP=$APP
CONFIG=$CONFIG
STATE=$STATE
PYTHON=$PYTHON
PIDFILE=/run/kien-proxy.pid
LOGFILE=/var/log/kien-proxy.log

running() {
  [ -f "\$PIDFILE" ] || return 1
  pid=\$(cat "\$PIDFILE" 2>/dev/null) || return 1
  [ -n "\$pid" ] || return 1
  kill -0 "\$pid" 2>/dev/null
}

run() {
  echo \$\$ > "\$PIDFILE"
  export KIEN_PROXY_CONFIG="\$CONFIG"
  export PROXY_QUEUE_DIR="\$STATE/queue"
  export SCANNER_AUTO=1
  cd "\$APP" || exit 1
  while :; do
    "\$PYTHON" -u "\$APP/geo_proxy_scanner.py" >>"\$LOGFILE" 2>&1
    printf '%s worker thoát, chạy lại sau 15s\n' "\$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"\$LOGFILE"
    sleep 15
  done
}

start() {
  if running; then
    printf '%s\n' "kien-proxy đang chạy (pid \$(cat "\$PIDFILE"))."
    return 0
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid "\$0" run </dev/null >>"\$LOGFILE" 2>&1 &
  else
    nohup "\$0" run </dev/null >>"\$LOGFILE" 2>&1 &
  fi
  sleep 1
  if running; then
    printf '%s\n' "Đã chạy kien-proxy (pid \$(cat "\$PIDFILE")). Log: \$LOGFILE"
  else
    printf '%s\n' "Không khởi động được. Xem \$LOGFILE" >&2
    return 1
  fi
}

stop() {
  pid=\$(cat "\$PIDFILE" 2>/dev/null || true)
  if [ -n "\$pid" ]; then
    kill -TERM "-\$pid" 2>/dev/null || kill -TERM "\$pid" 2>/dev/null || true
  fi
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "\$APP/geo_proxy_scanner.py" 2>/dev/null || true
  fi
  rm -f "\$PIDFILE"
  printf '%s\n' 'Đã dừng kien-proxy.'
}

case "\${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status)
    if running; then
      printf '%s\n' "kien-proxy đang chạy (pid \$(cat "\$PIDFILE"))."
    else
      printf '%s\n' 'kien-proxy không chạy.'
      exit 1
    fi
    ;;
  logs) tail -f "\$LOGFILE" ;;
  run) run ;;
  *) printf '%s\n' 'Dùng: kien-proxy {start|stop|restart|status|logs}' >&2; exit 2 ;;
esac
EOF
  chmod 755 /usr/local/bin/kien-proxy
  install -d -m 755 /etc/profile.d
  if [ -d /etc/cron.d ] && command -v crontab >/dev/null 2>&1; then
    printf '%s\n' '@reboot root /usr/local/bin/kien-proxy start >/dev/null 2>&1' > /etc/cron.d/kien-proxy
    chmod 644 /etc/cron.d/kien-proxy
    AUTOSTART='cron @reboot (/etc/cron.d/kien-proxy)'
  elif [ -f /etc/rc.local ]; then
    if ! grep -q 'kien-proxy start' /etc/rc.local 2>/dev/null; then
      printf '%s\n' '/usr/local/bin/kien-proxy start >/dev/null 2>&1' >> /etc/rc.local
    fi
    AUTOSTART='/etc/rc.local'
  else
    cat > /etc/profile.d/kien-proxy.sh <<'PROFILE'
[ -x /usr/local/bin/kien-proxy ] && /usr/local/bin/kien-proxy start >/dev/null 2>&1
PROFILE
    chmod 644 /etc/profile.d/kien-proxy.sh
    AUTOSTART='/etc/profile.d/kien-proxy.sh (chạy khi có người đăng nhập)'
  fi
  /usr/local/bin/kien-proxy start || true
  printf '%s\n' "Máy không có systemd/OpenRC nên dùng chế độ chạy nền. Tự chạy lại: $AUTOSTART" \
    'Xem log: sudo kien-proxy logs' \
    'Lần sau: sudo kien-proxy restart (không cần nhập lại cấu hình).'
fi
printf '%s\n' 'Cấu hình bí mật: /etc/kien-proxy/worker.json (root, mode 600).' \
  'Hàng đợi bền vững: /var/lib/kien-proxy/queue. Không xóa queue khi khởi động lại.'

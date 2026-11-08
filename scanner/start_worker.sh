#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The scanner itself accepts fleet_config.json, FLEET_TOKEN, or an existing
# ledger_config.json; do not reject a valid legacy setup here.
SYSTEM_PYTHON=/usr/bin/python3
test -x "$SYSTEM_PYTHON" || { echo "Thiếu Python hệ thống tại /usr/bin/python3" >&2; exit 1; }
if ! command -v zmap >/dev/null 2>&1 || ! "$SYSTEM_PYTHON" -c 'import requests' 2>/dev/null; then
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq zmap python3-requests
  else
    echo "Cần ZMap và python3-requests. Chạy startup này bằng root trên Debian/Ubuntu." >&2
    exit 1
  fi
fi
"$SYSTEM_PYTHON" -c 'import requests' || { echo "python3-requests chưa cài cho /usr/bin/python3" >&2; exit 1; }
if [ "$(id -u)" -ne 0 ]; then
  echo "ZMap cần quyền raw socket. Chạy startup bằng root hoặc cấp CAP_NET_RAW theo cấu hình hệ thống." >&2
  exit 1
fi
# An installed worker must not prompt again, even from an interactive terminal.
# Without saved config, preserve the legacy menu and explicit SCANNER_AUTO.
if [ -z "${SCANNER_AUTO+x}" ]; then
  if [ -f "${KIEN_PROXY_CONFIG:-/etc/kien-proxy/worker.json}" ]; then
    export SCANNER_AUTO=1
  elif [ -t 0 ]; then
    export SCANNER_AUTO=0
  else
    export SCANNER_AUTO=1
  fi
fi
exec "$SYSTEM_PYTHON" geo_proxy_scanner.py

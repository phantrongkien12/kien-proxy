#!/usr/bin/env python3
"""Run once on a persistent controller to provision a private fleet config."""
import json
import os
import secrets
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "fleet_config.json"

PROJECT = os.getenv("LEDGER_URL", "").strip().rstrip("/")
if not PROJECT and len(sys.argv) > 1:
    PROJECT = sys.argv[1].strip().rstrip("/")
if not PROJECT:
    PROJECT = input("Nhập URL app đã deploy (VD: https://proxy-ledger.vercel.app): ").strip().rstrip("/")
if not PROJECT.startswith("https://"):
    raise SystemExit("LEDGER_URL phải bắt đầu bằng https://")

if CONFIG.exists():
    existing = json.loads(CONFIG.read_text(encoding="utf-8"))
    token = existing.get("fleet_token", "")
    if not token or existing.get("url") != PROJECT:
        raise SystemExit("fleet_config.json không hợp lệ. Sửa file trước khi tiếp tục.")
    print("Đã có cấu hình fleet. Không tạo token mới.")
else:
    token = secrets.token_urlsafe(32)
    fd = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"url": PROJECT, "fleet_token": token}, f, indent=2)
    if os.name != "nt":
        CONFIG.chmod(0o600)
    print("Đã tạo một token chung. Giữ fleet_config.json trong bộ triển khai riêng tư.")

bundle = ROOT / "fleet_worker_bundle.zip"
with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in ("geo_proxy_scanner.py", "fleet_config.json", "start_worker.sh", "zmap_blocklist.conf"):
        archive.write(ROOT / name, name)
if os.name != "nt":
    bundle.chmod(0o600)
print(f"Đã đóng gói {bundle.name}. Mỗi VPS mới nhận đúng gói này từ template/startup của bạn.")
print("Thêm biến môi trường cho project trên Vercel (Settings → Vars):")
print("  Key: FLEET_TOKEN")
print(f"  Value: {token}")
print("  Key: LEDGER_URL")
print(f"  Value: {PROJECT}")
print("Sau đó redeploy. Mọi VPS dùng chung gói này sẽ tự đăng ký thành node wrk_*.")

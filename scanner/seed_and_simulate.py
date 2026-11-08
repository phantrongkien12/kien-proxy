import os
import sys
import json
import uuid
from datetime import datetime
import requests

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").strip()
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("[!] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
    sys.exit(1)

headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def main():
    print("[*] Bắt đầu đồng bộ và mô phỏng các node VPS và proxy...")

    nodes = [
        {"id": "wrk_us_east_1", "token_hash": "sim_hash_us", "total": 45, "last_seen": datetime.utcnow().isoformat() + "Z"},
        {"id": "wrk_sg_01", "token_hash": "sim_hash_sg", "total": 38, "last_seen": datetime.utcnow().isoformat() + "Z"},
        {"id": "wrk_vn_hanoi_01", "token_hash": "sim_hash_vn", "total": 62, "last_seen": datetime.utcnow().isoformat() + "Z"},
        {"id": "wrk_eu_frankfurt_01", "token_hash": "sim_hash_eu", "total": 31, "last_seen": datetime.utcnow().isoformat() + "Z"},
        {"id": "wrk_jp_tokyo_01", "token_hash": "sim_hash_jp", "total": 50, "last_seen": datetime.utcnow().isoformat() + "Z"},
    ]

    # 1. Upsert nodes
    res = requests.post(f"{SUPABASE_URL}/rest/v1/nodes", headers=headers, json=nodes)
    print(f"[-] Upsert nodes status: {res.status_code}, response: {res.text}")

    # 2. Ingest proxy batches via RPC or direct insert
    sample_proxies = [
        {"host": "103.145.3.12", "port": 8080, "protocol": "HTTP", "username": "user1", "password": "pass1", "country": "VN"},
        {"host": "178.62.204.15", "port": 3128, "protocol": "HTTP", "username": "", "password": "", "country": "DE"},
        {"host": "45.76.112.89", "port": 1080, "protocol": "SOCKS5", "username": "admin", "password": "secretpassword", "country": "US"},
        {"host": "198.51.100.42", "port": 9050, "protocol": "SOCKS4", "username": "", "password": "", "country": "SG"},
        {"host": "103.253.24.11", "port": 80, "protocol": "HTTP", "username": "", "password": "", "country": "JP"},
        {"host": "185.199.110.153", "port": 443, "protocol": "HTTPS", "username": "secureproxy", "password": "mypassword", "country": "DE"},
        {"host": "202.59.231.10", "port": 8080, "protocol": "HTTP", "username": "", "password": "", "country": "VN"},
        {"host": "139.162.33.19", "port": 3128, "protocol": "HTTP", "username": "proxyuser", "password": "proxy123", "country": "US"},
        {"host": "64.225.80.12", "port": 1080, "protocol": "SOCKS5", "username": "", "password": "", "country": "SG"},
        {"host": "159.65.132.44", "port": 9050, "protocol": "SOCKS4", "username": "", "password": "", "country": "JP"},
    ]

    for node in nodes:
        node_id = node["id"]
        batch_id = "batch_" + uuid.uuid4().hex[:8]
        rpc_payload = {
            "p_node": node_id,
            "p_batch": batch_id,
            "p_items": sample_proxies
        }
        rpc_res = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/ingest_proxy_batch", headers=headers, json=rpc_payload)
        print(f"[-] Ingest for {node_id} status: {rpc_res.status_code}, response: {rpc_res.text}")

    print("[*] Hoàn tất mô phỏng và nạp dữ liệu VPS & Proxy thành công!")

if __name__ == "__main__":
    main()

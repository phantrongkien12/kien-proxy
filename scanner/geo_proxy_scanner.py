# language: Python, file: geo_proxy_scanner.py, target: Linux/Windows, Python 3.8+
import os
import sys
import time
import json
import uuid
import queue
import socket
import ssl
import ipaddress
import requests
import threading
import hashlib
import re
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from worker_config import ConfigError, load_worker_environment
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text

    console = Console()
except ModuleNotFoundError:
    # rich only styles the output; fall back to plain text so a missing
    # cosmetic dependency can never crash-loop the worker.
    import re as _re

    _MARKUP = _re.compile(
        r"\[/?(?:bold|dim|italic|underline|red|green|yellow|blue|magenta|cyan|white|black|bright_[a-z]+)(?: [a-z_ ]+)?\]"
    )

    class _PlainConsole:
        @staticmethod
        def print(*args, **_kwargs):
            print(_MARKUP.sub("", " ".join(str(a) for a in args)))

    class _PlainText(str):
        def __new__(cls, value="", **_kwargs):
            return super().__new__(cls, value)

    def Panel(content, **_kwargs):
        return content

    console = _PlainConsole()
    Text = _PlainText

try:
    SAVED_WORKER_CONFIG = load_worker_environment()
except ConfigError as error:
    raise SystemExit(str(error)) from None

# --- MỘT POOL CHUNG, WORKER TỰ NHẬN DIỆN ---
LEDGER_URL = os.getenv("LEDGER_URL", "").strip().rstrip("/")
INGEST_URL = os.getenv("LEDGER_INGEST_URL", "").strip() or (f"{LEDGER_URL}/api/ingest" if LEDGER_URL else "")
VPS_ID = os.getenv("VPS_ID", "").strip()
VPS_TOKEN = os.getenv("VPS_TOKEN", "").strip()
FLEET_CONFIG_FILE = Path(__file__).resolve().parent / "fleet_config.json"
BATCH_SIZE = 200
ZMAP_BLOCKLIST = Path(__file__).resolve().parent / "zmap_blocklist.conf"
ZMAP_RATE = int(os.getenv("ZMAP_RATE", "1000"))
ZMAP_MAX_TARGETS = int(os.getenv("ZMAP_MAX_TARGETS", "100000"))
PATCH_MIN_SECONDS = int(os.getenv("PATCH_MIN_SECONDS", "60"))
PROXY_VERIFY_TIMEOUT = float(os.getenv("PROXY_VERIFY_TIMEOUT", "5"))
# ZMap chỉ có bản Linux. Khi máy không có ZMap (Windows, macOS), scanner tự chuyển
# sang quét cổng bằng connect() thuần Python: chậm hơn nhiều nhưng không cần raw
# socket, không cần quyền root và không phải cài thêm gì.
CONNECT_SCAN_WORKERS = int(os.getenv("CONNECT_SCAN_WORKERS", "400"))
CONNECT_SCAN_MAX_TARGETS = int(os.getenv("CONNECT_SCAN_MAX_TARGETS", "20000"))
CONNECT_SCAN_TIMEOUT = float(os.getenv("CONNECT_SCAN_TIMEOUT", "1.5"))
VERIFY_HOST = "example.com"
VERIFY_PORT = 443
ZONE_INDEX_URL = "https://www.ipdeny.com/ipblocks/data/aggregated/"
QUEUE_DIR = Path(os.getenv("PROXY_QUEUE_DIR", str(Path(__file__).resolve().parent / "proxy_queue")))
CONFIG_FILE = Path(__file__).resolve().parent / "ledger_config.json"


class ZoneDownloadError(RuntimeError):
    pass


def ingest_url_is_valid(url):
    if not url.endswith("/api/ingest"):
        return False
    if url.startswith("https://"):
        return True
    # Plain HTTP is only tolerated for a local dev server, never for a real host.
    return url.startswith("http://localhost") or url.startswith("http://127.0.0.1")


def automatic_worker_id():
    explicit = os.getenv("WORKER_ID", "").strip()
    if explicit:
        if not re.fullmatch(r"wrk_[A-Za-z0-9_-]{1,60}", explicit):
            raise SystemExit("WORKER_ID phải bắt đầu bằng wrk_ và chỉ dùng chữ/số/-/_")
        return explicit
    host = re.sub(r"[^A-Za-z0-9_-]", "-", socket.gethostname())[:24].strip("-_") or "host"
    try:
        boot = Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
    except OSError:
        boot = uuid.uuid4().hex  # fallback for platforms without a boot ID
    suffix = hashlib.sha256(boot.encode()).hexdigest()[:12]
    return f"wrk_{host}_{suffix}"


def load_fleet_config():
    global VPS_ID, VPS_TOKEN
    fleet_token = os.getenv("FLEET_TOKEN", "").strip()
    if not fleet_token:
        try:
            data = json.loads(FLEET_CONFIG_FILE.read_text(encoding="utf-8"))
            if data.get("url", "").rstrip("/") == LEDGER_URL:
                fleet_token = str(data.get("fleet_token", "")).strip()
        except (OSError, ValueError, AttributeError):
            pass
    if not fleet_token:
        return False
    if len(fleet_token) < 32 or len(fleet_token) > 256:
        raise SystemExit("Fleet token không hợp lệ.")
    VPS_TOKEN = fleet_token
    VPS_ID = automatic_worker_id()
    return True


def load_existing_ledger_config():
    global VPS_ID, VPS_TOKEN
    if VPS_TOKEN and VPS_TOKEN != "vps_sec_default_token":
        return
    tool_config = Path(os.getenv("APPDATA", str(Path.home() / ".config"))) / "ProxyToolkit" / "ledger.json"
    for path in (CONFIG_FILE, tool_config):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if (data.get("url", "").rstrip("/") == LEDGER_URL
                    and data.get("node") and data.get("token")):
                VPS_ID, VPS_TOKEN = data["node"], data["token"]
                console.print(f"[bold blue][*][/bold blue] Dùng cấu hình VPS [bold green]{VPS_ID}[/bold green] từ [bold yellow]{path.name}[/bold yellow].")
                return
        except (OSError, ValueError, AttributeError):
            continue


def check_ledger_setup():
    if not LEDGER_URL and not INGEST_URL:
        raise SystemExit("Thiếu LEDGER_URL (URL app đã deploy) hoặc LEDGER_INGEST_URL.")
    if not ingest_url_is_valid(INGEST_URL):
        raise SystemExit("LEDGER_URL phải là https://... và trỏ tới app có /api/ingest.")
    if not SAVED_WORKER_CONFIG and not load_fleet_config():
        load_existing_ledger_config()  # supports earlier per-VPS credentials
    if not VPS_TOKEN or VPS_TOKEN == "vps_sec_default_token":
        raise SystemExit("Thiếu token. Tải cấu hình từ trang VPS rồi chạy install_worker.sh --config FILE, hoặc dùng fleet_config.json riêng tư.")
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", VPS_ID or ""):
        raise SystemExit("Sai VPS_ID.")
    console.print(f"[bold blue][*][/bold blue] Worker tự nhận diện: [bold green]{VPS_ID}[/bold green]")
    console.print(f"[bold blue][*][/bold blue] Ingest: [bold cyan]{INGEST_URL}[/bold cyan]")


class GeoProxyScanner:
    def __init__(self, country_code, ports, max_threads=4400, timeout=2, auto_random=True, run_mode="country"):
        self.country_code = country_code.upper() if country_code else "VN"
        self.ports = ports
        self.max_threads = max_threads
        self.timeout = timeout
        self.auto_random = auto_random
        self.run_mode = run_mode  # "country" hoặc "random"

        self.ip_queue = queue.Queue(maxsize=2000)
        self.live_proxies = []
        self.lock = threading.Lock()
        self.sync_lock = threading.Lock()
        self.is_running = True
        self.phase_done = threading.Event()
        self.last_flush = time.monotonic()
        self.sent_count = 0
        self.checked_count = 0
        self.verified_count = 0
        self.next_sync_at = 0.0
        self.country_codes = []
        self.remaining_countries = []
        self.country_index_at = 0.0
        self.tls_context = ssl.create_default_context()

        QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        self.sync_thread = threading.Thread(target=self.background_sync_worker, daemon=True)
        self.sync_thread.start()

    def fetch_country_cidrs(self, cc, aggregated=False):
        console.print(f"[bold blue][*][/bold blue] Đang lấy danh sách dải CIDR cho quốc gia: [bold green]{cc}[/bold green]...")
        if not re.fullmatch(r"[A-Za-z]{2}", cc):
            raise ZoneDownloadError("Mã quốc gia không hợp lệ")
        url = (f"{ZONE_INDEX_URL}{cc.lower()}-aggregated.zone" if aggregated
               else f"https://www.ipdeny.com/ipblocks/data/countries/{cc.lower()}.zone")
        try:
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                cidrs = []
                for line in res.text.splitlines():
                    try:
                        net = ipaddress.ip_network(line.strip(), strict=False)
                        if isinstance(net, ipaddress.IPv4Network) and net.is_global:
                            cidrs.append(str(net))
                    except ValueError:
                        continue
                console.print(f"[bold green][+][/bold green] Tìm thấy [bold yellow]{len(cidrs)}[/bold yellow] dải CIDR cho [bold green]{cc}[/bold green].")
                if cidrs:
                    return cidrs
        except requests.RequestException as e:
            raise ZoneDownloadError(f"Không tải được {cc}: {e}") from e
        raise ZoneDownloadError(f"Nguồn CIDR {cc} trống hoặc trả HTTP {res.status_code}")

    def next_random_patch(self):
        # Refresh the current country catalog daily and shuffle without replacement.
        if not self.country_codes or time.monotonic() - self.country_index_at >= 86400:
            try:
                response = requests.get(ZONE_INDEX_URL, timeout=15)
                response.raise_for_status()
                codes = sorted(set(re.findall(r'\b([a-z]{2})-aggregated\.zone\b', response.text)))
                if len(codes) < 20:
                    raise ZoneDownloadError("Danh mục CIDR có quá ít quốc gia")
                self.country_codes = codes
                self.remaining_countries = []
                self.country_index_at = time.monotonic()
                console.print(f"[bold blue][*][/bold blue] Đã cập nhật danh mục [bold green]{len(codes)}[/bold green] quốc gia.")
            except requests.RequestException as e:
                if not self.country_codes:
                    raise ZoneDownloadError(f"Không tải được danh mục CIDR: {e}") from e
                console.print(f"[bold red][!][/bold red] Không cập nhật được danh mục; dùng danh mục hiện có: [yellow]{e}[/yellow]")
                self.country_index_at = time.monotonic()
        if not self.remaining_countries:
            self.remaining_countries = self.country_codes[:]
            secrets.SystemRandom().shuffle(self.remaining_countries)
        cc = self.remaining_countries[-1]
        cidrs = self.fetch_country_cidrs(cc, aggregated=True)
        self.remaining_countries.pop()
        return cc.upper(), cidrs

    def wait_between_patches(self, seconds):
        deadline = time.monotonic() + max(0, seconds)
        while self.is_running and time.monotonic() < deadline:
            time.sleep(min(1, deadline - time.monotonic()))

    def run_random_forever(self):
        while self.is_running:
            started = time.monotonic()
            try:
                cc, cidrs = self.next_random_patch()
            except ZoneDownloadError as e:
                console.print(f"[bold red][!][/bold red] [yellow]{e}[/yellow]; sẽ thử tải lại sau 60 giây.")
                self.wait_between_patches(60)
                continue
            self.run_phase(f"PATCH {cc}", cidrs)
            with self.lock:
                self.check_batch_flush(force=True)
            self.sync_ready_once()
            if not (0 <= PATCH_MIN_SECONDS <= 86400):
                raise RuntimeError("PATCH_MIN_SECONDS không hợp lệ")
            self.wait_between_patches(PATCH_MIN_SECONDS - (time.monotonic() - started))

    def _port_open(self, ip, port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(CONNECT_SCAN_TIMEOUT)
            try:
                return sock.connect_ex((ip, port)) == 0
            except OSError:
                return False

    def connect_scan_targets(self, cidrs):
        targets = []
        for cidr in cidrs:
            try:
                network = ipaddress.ip_network(cidr, strict=False)
            except ValueError:
                continue
            for ip in network:
                if not ip.is_global:
                    continue
                for port in self.ports:
                    targets.append((str(ip), port))
                    if len(targets) >= CONNECT_SCAN_MAX_TARGETS:
                        return targets
        return targets

    def enqueue_connect_scan(self, cidrs):
        if not (1 <= CONNECT_SCAN_WORKERS <= 5000 and 1 <= CONNECT_SCAN_MAX_TARGETS <= 1000000):
            raise RuntimeError("CONNECT_SCAN_WORKERS hoặc CONNECT_SCAN_MAX_TARGETS không hợp lệ")
        targets = self.connect_scan_targets(cidrs)
        if not targets:
            return 0
        console.print(f"[bold blue][*][/bold blue] Không có ZMap; quét cổng bằng connect() thuần Python: "
                      f"[bold yellow]{len(targets):,}[/bold yellow] mục tiêu, "
                      f"[bold yellow]{CONNECT_SCAN_WORKERS}[/bold yellow] luồng song song")
        candidates = 0
        counter_lock = threading.Lock()
        work = queue.Queue()
        for target in targets:
            work.put(target)
        for _ in range(CONNECT_SCAN_WORKERS):
            work.put(None)

        def probe():
            nonlocal candidates
            while self.is_running:
                item = work.get()
                if item is None:
                    return
                ip, port = item
                if not self._port_open(ip, port):
                    continue
                while self.is_running:
                    try:
                        self.ip_queue.put((ip, port), timeout=0.5)
                        with counter_lock:
                            candidates += 1
                        break
                    except queue.Full:
                        continue

        threads = [threading.Thread(target=probe, daemon=True) for _ in range(CONNECT_SCAN_WORKERS)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=CONNECT_SCAN_TIMEOUT + 5)
        return candidates

    def enqueue_zmap_results(self, cidrs):
        if not shutil.which("zmap"):
            raise RuntimeError("Chưa cài ZMap. Trên Debian/Ubuntu: sudo apt-get install zmap")
        if not ZMAP_BLOCKLIST.is_file():
            raise RuntimeError("Thiếu zmap_blocklist.conf trong gói worker")
        if not (1 <= ZMAP_RATE <= 100000 and 1 <= ZMAP_MAX_TARGETS <= 10000000):
            raise RuntimeError("ZMAP_RATE hoặc ZMAP_MAX_TARGETS không hợp lệ")
        candidates = 0
        with tempfile.TemporaryDirectory(prefix="proxy-zmap-") as tmpdir:
            allowlist = Path(tmpdir) / "allowlist.conf"
            allowlist.write_text("\n".join(cidrs) + "\n", encoding="ascii")
            for port in self.ports:
                if not self.is_running:
                    break
                log = Path(tmpdir) / f"zmap-{port}.log"
                command = ["stdbuf", "-oL", "zmap", "-p", str(port), "-w", str(allowlist),
                           "-b", str(ZMAP_BLOCKLIST), "-r", str(ZMAP_RATE),
                           "-n", str(ZMAP_MAX_TARGETS), "-e", str(secrets.randbits(32)),
                           "-o", "-", "-q"]
                console.print(f"[bold blue][*][/bold blue] ZMap port [bold cyan]{port}[/bold cyan]: tối đa [bold yellow]{ZMAP_MAX_TARGETS:,}[/bold yellow] IP, [bold yellow]{ZMAP_RATE:,}[/bold yellow] gói/giây")
                with log.open("w", encoding="utf-8") as errors:
                    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True)
                    try:
                        for line in process.stdout:
                            if not self.is_running:
                                break
                            try:
                                ip = ipaddress.IPv4Address(line.strip())
                            except ipaddress.AddressValueError:
                                continue
                            if not ip.is_global:
                                continue
                            while self.is_running:
                                try:
                                    self.ip_queue.put((str(ip), port), timeout=0.5)
                                    candidates += 1
                                    break
                                except queue.Full:
                                    continue
                    finally:
                        process.stdout.close()
                        if process.poll() is None and not self.is_running:
                            process.terminate()
                        try:
                            code = process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            code = process.wait()
                if code and self.is_running:
                    detail = log.read_text(encoding="utf-8", errors="replace")[-1000:]
                    raise RuntimeError(f"ZMap dừng với mã {code} (port {port}): {detail}")
        return candidates

    def enqueue_candidates(self, cidrs):
        # ZMap cần stdbuf và raw socket của Linux; trên Windows luôn dùng connect scan
        # kể cả khi PATH có sẵn một bản zmap nào đó.
        if os.name != "nt" and shutil.which("zmap"):
            return self.enqueue_zmap_results(cidrs)
        return self.enqueue_connect_scan(cidrs)

    def push_to_ledger(self, proxies_batch):
        if not proxies_batch:
            return False
        batch_id = str(uuid.uuid4())
        payload = {
            "vps_id": VPS_ID,
            "batch_id": batch_id,
            "proxies": proxies_batch
        }
        tmp_file = QUEUE_DIR / f"{batch_id}.tmp"
        ready_file = QUEUE_DIR / f"{batch_id}.ready"
        try:
            with open(tmp_file, "x", encoding="utf-8") as f:
                json.dump(payload, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_file, ready_file)
            return True
        except Exception as e:
            console.print(f"[bold red][!][/bold red] Lỗi ghi queue file: [yellow]{e}[/yellow]")
            return False

    def background_sync_worker(self):
        while True:
            with self.lock:
                if self.live_proxies and time.monotonic() - self.last_flush >= 15:
                    self.check_batch_flush(force=True)
            self.sync_ready_once()
            time.sleep(5)

    def sync_ready_once(self):
        if time.monotonic() < self.next_sync_at:
            return
        with self.sync_lock:
            self._sync_ready()

    def _sync_ready(self):
        for rf in sorted(QUEUE_DIR.glob("*.ready")):
            try:
                payload = json.loads(rf.read_text(encoding="utf-8"))
                if not isinstance(payload.get("proxies"), list) or not payload["proxies"]:
                    raise ValueError("Lô dữ liệu trống")
            except (OSError, ValueError, KeyError, TypeError) as e:
                console.print(f"[bold red][!][/bold red] Không đọc được [bold yellow]{rf.name}[/bold yellow]: [yellow]{e}[/yellow]. Giữ file để kiểm tra thủ công.")
                continue
            headers = {"Authorization": f"Bearer {VPS_TOKEN}", "Content-Type": "application/json"}
            try:
                res = requests.post(INGEST_URL, json=payload, headers=headers, timeout=30, allow_redirects=False)
                if 300 <= res.status_code < 400:
                    # A redirect means the deployed app still guards /api/ingest behind
                    # the login wall, so the POST lands on /login and comes back 405.
                    target = res.headers.get("location", "")
                    console.print(f"[bold red][!][/bold red] Ledger chuyển hướng [bold red]{res.status_code}[/bold red] → [yellow]{target}[/yellow]. App chưa deploy bản mới (thiếu /api/ingest trong PUBLIC_PATHS).")
                    self.next_sync_at = time.monotonic() + 60
                    break
                try:
                    answer = res.json()
                except ValueError:
                    answer = {}
                if res.status_code == 200 and isinstance(answer.get("accepted"), int):
                    self.sent_count += answer["accepted"]
                    rf.unlink()
                    console.print(f"[bold green][+][/bold green] Đã nhận lô [bold yellow]{rf.name}[/bold yellow]: accepted=[bold green]{answer['accepted']}[/bold green], duplicate=[bold red]{answer.get('duplicate', False)}[/bold red]")
                else:
                    reason = str(answer.get("error", ""))[:120] if isinstance(answer, dict) else ""
                    console.print(f"[bold red][!][/bold red] Ledger HTTP [bold red]{res.status_code}[/bold red] [yellow]{reason}[/yellow]. Giữ [bold yellow]{rf.name}[/bold yellow] để gửi lại.")
                    self.next_sync_at = time.monotonic() + (60 if res.status_code in (401, 403, 413, 429) else 10)
                    if res.status_code in (401, 403, 413, 429):
                        break
            except requests.RequestException as e:
                console.print(f"[bold red][!][/bold red] Gửi lỗi ([bold red]{type(e).__name__}[/bold red]); giữ [bold yellow]{rf.name}[/bold yellow] để thử lại.")
                self.next_sync_at = time.monotonic() + 10
                break

    def _read_exactly(self, sock, size):
        data = b""
        while len(data) < size:
            chunk = sock.recv(size - len(data))
            if not chunk:
                raise OSError("Kết nối bị đóng")
            data += chunk
        return data

    def _read_http_header(self, sock, limit=8192):
        # Phải đọc hết cả khối header tới \r\n\r\n, không chỉ dòng trạng thái:
        # CRLF cuối header còn sót lại sẽ bị wrap_socket đọc như byte đầu của
        # TLS record và làm hỏng bắt tay.
        data = b""
        while b"\r\n\r\n" not in data and len(data) < limit:
            chunk = sock.recv(1)
            if not chunk:
                break
            data += chunk
        return data.decode("latin1", "replace")

    def _open_tunnel(self, ip, port, protocol):
        # Cổng mở chưa chứng minh được gì: proxy phải thật sự chuyển tiếp
        # traffic ra ngoài. Vì vậy sau khi bắt tay phải gửi CONNECT tới một
        # đích thật và đọc mã trả lời, thay vì chỉ nghe câu chào.
        sock = socket.create_connection((ip, port), timeout=self.timeout)
        try:
            sock.settimeout(self.timeout)
            if protocol == "HTTP":
                sock.sendall(
                    f"CONNECT {VERIFY_HOST}:{VERIFY_PORT} HTTP/1.1\r\n"
                    f"Host: {VERIFY_HOST}:{VERIFY_PORT}\r\n\r\n".encode()
                )
                if not re.match(r"^HTTP/1\.[01] 200", self._read_http_header(sock)):
                    raise OSError("Proxy từ chối CONNECT")
            elif protocol == "SOCKS5":
                sock.sendall(b"\x05\x01\x00")
                version, method = self._read_exactly(sock, 2)
                if version != 0x05 or method != 0x00:
                    raise OSError("Không phải SOCKS5 không cần xác thực")
                host = VERIFY_HOST.encode()
                sock.sendall(
                    b"\x05\x01\x00\x03" + bytes([len(host)]) + host
                    + bytes([VERIFY_PORT >> 8, VERIFY_PORT & 0xFF])
                )
                reply = self._read_exactly(sock, 4)
                if reply[1] != 0x00:
                    raise OSError("Proxy từ chối kết nối")
                if reply[3] == 0x01:
                    address_length = 4
                elif reply[3] == 0x04:
                    address_length = 16
                else:
                    address_length = self._read_exactly(sock, 1)[0]
                self._read_exactly(sock, address_length + 2)
            elif protocol == "SOCKS4":
                host = VERIFY_HOST.encode()
                sock.sendall(
                    b"\x04\x01" + bytes([VERIFY_PORT >> 8, VERIFY_PORT & 0xFF])
                    + b"\x00\x00\x00\x01\x00" + host + b"\x00"
                )
                if self._read_exactly(sock, 8)[1] != 0x5A:
                    raise OSError("Proxy từ chối kết nối")
            else:
                raise OSError("Giao thức chưa hỗ trợ kiểm tra")
            return sock
        except Exception:
            sock.close()
            return None

    def _verify_tls(self, sock):
        # Bọc TLS thật qua tunnel. tls_context xác thực chứng chỉ, nên proxy
        # chèn giữa hoặc chuyển hướng sai đích sẽ bị loại ở bước này.
        sock.settimeout(PROXY_VERIFY_TIMEOUT)
        tls_sock = self.tls_context.wrap_socket(sock, server_hostname=VERIFY_HOST)
        try:
            tls_sock.sendall(
                f"HEAD / HTTP/1.1\r\nHost: {VERIFY_HOST}\r\nConnection: close\r\n\r\n".encode()
            )
            if not re.match(r"^HTTP/1\.[01] \d{3}", self._read_http_header(tls_sock)):
                raise OSError("Phản hồi không hợp lệ")
        finally:
            tls_sock.close()

    def test_proxy_handshake(self, ip, port):
        with self.lock:
            self.checked_count += 1
        for protocol in ("HTTP", "SOCKS5", "SOCKS4"):
            try:
                sock = self._open_tunnel(ip, port, protocol)
                if sock is None:
                    continue
                try:
                    self._verify_tls(sock)
                finally:
                    sock.close()
                with self.lock:
                    self.verified_count += 1
                    print(f"\r[LIVE - {protocol} - TLS VERIFIED] {ip}:{port}                                     ")
                    self.live_proxies.append({"host": ip, "port": port, "protocol": protocol, "username": "", "password": ""})
                    self.check_batch_flush()
                return
            except (OSError, ssl.SSLError, ValueError):
                continue

    def check_batch_flush(self, force=False):
        # Caller holds self.lock. Keep results in memory if disk write fails.
        while len(self.live_proxies) >= BATCH_SIZE or (force and self.live_proxies):
            batch = self.live_proxies[:BATCH_SIZE]
            if not self.push_to_ledger(batch):
                return
            del self.live_proxies[:len(batch)]
            self.last_flush = time.monotonic()

    def worker(self):
        while True:
            try:
                ip, port = self.ip_queue.get(timeout=0.5)
            except queue.Empty:
                if self.phase_done.is_set():
                    return
                continue
            try:
                self.test_proxy_handshake(ip, port)
                with self.lock:
                    if self.checked_count % 10 == 0:
                        sys.stdout.write(f"\r\033[1;34m[*]\033[0m Đang quét: Đã kiểm tra \033[1;33m{self.checked_count}\033[0m cổng mở | Live: \033[1;32m{self.verified_count}\033[0m")
                        sys.stdout.flush()
            finally:
                self.ip_queue.task_done()

    def run_phase(self, phase_name, cidrs):
        console.print(f"\n[bold magenta]=== BẮT ĐẦU PHA: {phase_name} ===[/bold magenta]")
        before_checked = self.checked_count
        before_verified = self.verified_count
        self.phase_done.clear()
        console.print(f"[bold blue][*][/bold blue] Quét với [bold yellow]{self.max_threads}[/bold yellow] threads và hàng đợi giới hạn [bold yellow]2.000[/bold yellow] mục tiêu...")
        with ThreadPoolExecutor(max_workers=self.max_threads) as executor:
            workers = [executor.submit(self.worker) for _ in range(self.max_threads)]
            try:
                total = self.enqueue_candidates(cidrs)
                console.print(f"[bold blue][*][/bold blue] Tìm thấy [bold green]{total}[/bold green] cổng mở; đợi kiểm tra proxy hoàn tất...")
            except KeyboardInterrupt:
                console.print("\n[bold red][!] Dừng quét theo yêu cầu...[/bold red]")
                self.is_running = False
            finally:
                self.phase_done.set()
            self.ip_queue.join()
            for future in workers:
                future.result()
        console.print(f"[bold blue][*][/bold blue] Patch xong: [bold green]{self.verified_count - before_verified}[/bold green]/[bold yellow]{self.checked_count - before_checked}[/bold yellow] cổng mở đã xác minh qua TLS.")

    def run_pipeline(self):
        try:
            if self.run_mode == "country":
                country_cidrs = self.fetch_country_cidrs(self.country_code)
                if country_cidrs:
                    self.run_phase(f"COUNTRY ({self.country_code})", country_cidrs)

                if self.auto_random and self.is_running:
                    console.print("\n[bold blue][*][/bold blue] Hoàn thành quốc gia; chuyển sang các patch ngẫu nhiên liên tục...")
                    self.run_random_forever()
            else:
                self.run_random_forever()
        except KeyboardInterrupt:
            self.is_running = False
            console.print("\n[bold blue][*][/bold blue] Đang dừng scanner và gửi lô cuối...")
        finally:
            with self.lock:
                self.check_batch_flush(force=True)
            self.next_sync_at = 0
            self.sync_ready_once()

        pending = len(list(QUEUE_DIR.glob("*.ready")))
        console.print(f"\n[bold blue][*][/bold blue] Đã được ledger xác nhận: [bold green]{self.sent_count}[/bold green] proxy. Lô đang chờ gửi lại: [bold yellow]{pending}[/bold yellow].")


if __name__ == "__main__":
    check_ledger_setup()
    console.print(Panel(
        Text("KIENCOMMUNITY — PROXY SCANNER CLI", style="bold green", justify="center"),
        subtitle="[bold blue]Massive IP Range Scanning & Verification[/bold blue]",
        border_style="green"
    ))
    automatic = os.getenv("SCANNER_AUTO", "").strip().lower() in ("1", "true", "yes")
    if automatic:
        run_mode = os.getenv("SCANNER_MODE", "random").strip().lower()
        if run_mode not in ("country", "random"):
            raise SystemExit("SCANNER_MODE phải là country hoặc random")
        country = os.getenv("SCANNER_COUNTRY", "").strip().upper()
        if not country and run_mode == "country":
            country = "VN"
        auto_random = os.getenv("SCANNER_FOLLOW_RANDOM", "1").strip().lower() in ("1", "true", "yes")
        ports_input = os.getenv("SCANNER_PORTS", "80,8080,3128,1080")
        threads_input = os.getenv("SCANNER_THREADS", "4400")
        if run_mode == "random":
            console.print(f"[bold blue][*][/bold blue] Tự chạy: [bold green]{run_mode}[/bold green], ports=[bold cyan]{ports_input}[/bold cyan], threads=[bold yellow]{threads_input}[/bold yellow]")
        else:
            console.print(f"[bold blue][*][/bold blue] Tự chạy: [bold green]{run_mode}[/bold green], [bold green]{country}[/bold green], ports=[bold cyan]{ports_input}[/bold cyan], threads=[bold yellow]{threads_input}[/bold yellow]")
    else:
        console.print("[bold yellow]CHỌN CHẾ ĐỘ QUÉT:[/bold yellow]")
        console.print("  [bold green]1.[/bold green] Quét theo Quốc gia (Nhập mã ISO, ví dụ: VN, US, JP)")
        console.print("  [bold green]2.[/bold green] Quét Random (Dải IP mạng toàn cầu)")
        choice = input("\nLựa chọn của G45 [1/2]: ").strip()
        country = "VN"
        run_mode = "country"
        auto_random = True
        if choice == "1":
            country = input("Nhập mã quốc gia (VD: VN, US): ").strip().upper() or "VN"
            auto_random = input("Tự động chuyển sang quét Random? (y/n, mặc định y): ").strip().lower() != 'n'
        elif choice == "2":
            run_mode = "random"
            auto_random = False
        else:
            console.print("[bold red][!] Lựa chọn không hợp lệ, mặc định quét Random.[/bold red]")
            run_mode = "random"
            auto_random = False
        ports_input = input("Nhập các port cần quét (cách nhau bởi dấu phẩy, mặc định 80,8080,3128,1080): ").strip() or "80,8080,3128,1080"
        threads_input = input("Nhập số threads (mặc định 4400): ").strip() or "4400"
    try:
        ports = [int(p.strip()) for p in ports_input.split(",")]
        threads = int(threads_input)
        if not ports or any(p < 1 or p > 65535 for p in ports) or not (1 <= threads <= 10000):
            raise ValueError()
    except ValueError:
        raise SystemExit("SCANNER_PORTS hoặc SCANNER_THREADS không hợp lệ")

    scanner = GeoProxyScanner(
        country_code=country,
        ports=ports,
        max_threads=threads,
        timeout=2,
        auto_random=auto_random,
        run_mode=run_mode
    )
    scanner.run_pipeline()

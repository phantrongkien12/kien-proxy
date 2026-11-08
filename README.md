# Kien Proxy

Dashboard quản lý VPS, thu thập và kiểm tra proxy, xây dựng bằng Next.js 16, React 19, TypeScript, Tailwind CSS 4 và Supabase. Scanner Python chạy trên VPS, xác minh proxy rồi gửi dữ liệu về dashboard qua HTTPS.

**Repository public không có nghĩa dashboard hay dữ liệu Supabase được public.** Dashboard vẫn cần đăng nhập; khóa dịch vụ và token worker phải được giữ riêng.

## Tính năng

- Tổng quan kho proxy, VPS và lịch sử nhận dữ liệu.
- Tìm kiếm, lọc theo giao thức/VPS, phân trang và xuất TXT/CSV.
- Tạo token riêng cho VPS hoặc dùng một fleet token cho nhiều worker.
- Kiểm tra từng proxy, kiểm tra theo lô và kiểm tra lại proxy chết.
- Sau mỗi phép kiểm tra: thành công ghi **Sống**, lỗi hoặc timeout ghi **Chết ngay**. Không có trạng thái “nghi ngờ” và không cần chờ lỗi lần thứ hai.
- Proxy mới hoặc vừa được gửi lại có thể ở trạng thái **Chưa kiểm tra**; đây không phải kết quả kiểm tra thất bại.
- Xóa proxy chết có bảo vệ dữ liệu vừa được gửi lại sau lần kiểm tra cuối.
- Scanner giữ lô chưa gửi thành công trên đĩa để thử lại, thay vì bỏ mất dữ liệu khi mất kết nối.

Kho không tự được điền bằng seed. Muốn thấy proxy thật, cần có worker gửi dữ liệu thật lên.

## 1. Yêu cầu

### Dashboard

- Node.js 22 LTS trở lên, Git và pnpm.
- Phiên bản pnpm được khai báo trong `package.json`: `pnpm@12.3.4`.
- Một project Supabase có Auth và schema/RPC tương thích với ứng dụng.
- Node.js runtime có thể mở kết nối TCP/TLS ra ngoài để kiểm tra proxy; không chạy phần kiểm tra trên Edge runtime.

### Scanner

- VPS Linux; script khởi động được thiết kế cho Debian/Ubuntu.
- `/usr/bin/python3`, thư viện `requests` cho Python hệ thống và ZMap.
- Quyền root khi dùng `start_worker.sh` vì ZMap cần raw socket.
- Kết nối đến app đã deploy, IPdeny và đích kiểm tra TLS.

Chỉ vận hành scanner trên phạm vi bạn được phép kiểm tra và theo chính sách của nhà cung cấp VPS. Scanner tải dải IP theo quốc gia từ IPdeny; lựa chọn một quốc gia không đồng nghĩa có quyền quét mọi IP trong quốc gia đó.

## 2. Cấu hình Supabase

### Các thành phần backend cần có

| Thành phần | Mục đích |
| --- | --- |
| `public.nodes` | VPS, hash token và thông tin lần nhận dữ liệu |
| `public.proxies` | Kho proxy và kết quả kiểm tra |
| `public.ingest_batches` | Lịch sử và chống nhận trùng lô dữ liệu |
| `ingest_proxy_batch` | Nhận và cập nhật lô proxy |
| `dashboard_snapshot` | Tổng hợp dữ liệu trang tổng quan |
| `search_proxies` | Tìm kiếm, lọc và phân trang |
| `record_proxy_check` | Ghi Sống/Chết, bỏ qua kết quả cho phiên bản dữ liệu đã cũ |
| `dead_proxy_count` | Đếm proxy đủ điều kiện dọn dẹp |
| `delete_dead_proxies` | Xóa proxy chết chưa được gửi lại sau lần kiểm tra cuối |

**Lưu ý về cài đặt mới:** repository hiện chưa chứa bộ SQL migrations/bootstrap. `pnpm install` hoặc kết nối một Supabase trống không tự tạo các bảng và RPC trên. Hướng dẫn chạy bên dưới giả định schema tương thích đã được provision; khi chuyển sang Supabase mới, cần khôi phục cả schema, RPC, ràng buộc và quyền từ bản migration/export của hệ thống. Chỉ tạo ba bảng trống là chưa đủ.

Ba bảng ledger phải bật RLS. Thiết kế hiện tại không cho `anon`/`authenticated` đọc trực tiếp các bảng; server xác thực phiên người dùng rồi sử dụng service-role client. Các RPC quản trị chỉ nên được cấp quyền thực thi cho `service_role`. Không tắt RLS để xử lý lỗi cấu hình.

### Biến môi trường

Ở máy phát triển, tạo `.env.local` tại thư mục gốc bằng thông tin của project Supabase của bạn:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-service-role-key
```

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Có | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Có, hoặc biến thay thế bên dưới | Khóa public dùng cho Auth |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Thay thế cho anon key | Được dùng nếu không có `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | Chỉ dành cho server; không thêm tiền tố `NEXT_PUBLIC_` |
| `FLEET_TOKEN` | Khi dùng fleet | Phải khớp token trên worker; có thể tạo bằng công cụ ở mục 6 |
| `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL` | Tùy môi trường | Redirect proxy của v0; ngoài v0 mặc định là `/auth/callback` trên origin hiện tại |

Ứng dụng hiện đọc trực tiếp `SUPABASE_SERVICE_ROLE_KEY`; chỉ đặt một biến tên `SUPABASE_SECRET_KEY` không thay thế được biến này.

Nếu đang dùng dự án đã kết nối Supabase trong v0, sử dụng các biến có sẵn trong **Vars**; không cần tạo lại hay đưa giá trị của chúng vào repository.

### Đăng nhập

- Bật email/password trong Supabase Auth.
- Cấu hình Site URL theo URL ứng dụng và cho phép callback tương ứng, ví dụ `http://localhost:3000/auth/callback` khi phát triển và `https://your-app.vercel.app/auth/callback` khi deploy.
- Truy cập `/login`, đăng ký tài khoản bằng email của bạn và xác nhận email nếu project yêu cầu, sau đó đăng nhập.
- Giữ cấu hình redirect proxy do v0 cung cấp khi dùng preview v0; không sao chép một URL preview cũ sang cấu hình production khác.

**Phạm vi quyền hiện tại:** đây là một kho quản trị dùng chung, chưa có phân quyền dữ liệu theo từng người dùng. Tài khoản đăng nhập được có thể quản lý kho chung. Với triển khai riêng, chỉ cấp tài khoản cho người tin cậy và tắt đăng ký công khai sau khi tạo tài khoản quản trị.

## 3. Chạy dashboard trên máy cá nhân

Clone từ GitHub:

```bash
git clone https://github.com/phantrongkien12/kien-proxy.git
cd kien-proxy
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Chuẩn bị `.env.local` và schema như mục 2 trước khi sử dụng dashboard. Mở <http://localhost:3000>, đăng nhập rồi truy cập các trang Tổng quan, Proxy, VPS, Hoạt động và Cài đặt.

Nếu hệ thống chưa có Corepack, cài/kích hoạt pnpm theo tài liệu chính thức: <https://pnpm.io/installation>. Dùng phiên bản được khai báo trong `package.json`.

Build và chạy production:

```bash
pnpm build
pnpm start
```

Kiểm tra TypeScript:

```bash
pnpm exec tsc --noEmit
```

## 4. Deploy lên Vercel

1. Import repository `phantrongkien12/kien-proxy` vào Vercel, chọn framework **Next.js** và thư mục gốc của repository.
2. Kết nối Supabase đã có schema tương thích và cấu hình các biến ở mục 2 cho đúng môi trường deploy.
3. Nếu dùng fleet, thêm `FLEET_TOKEN` trước khi khởi động worker.
4. Deploy, cấu hình URL/callback Auth theo tên miền thực tế và thử đăng nhập.
5. Khi thay đổi biến môi trường, redeploy để bản chạy mới nhận cấu hình.

Nếu tiếp tục làm việc trong v0, có thể dùng **Publish**. Worker phải trỏ đến URL HTTPS của bản đã deploy, không dùng URL preview tạm thời.

ZMap và scanner chạy trên VPS, **không chạy bên trong Vercel**. Vercel chỉ nhận dữ liệu, hiển thị dashboard và thực hiện các phép kiểm tra proxy theo yêu cầu.

## 5. Kết nối một VPS bằng token riêng

1. Đăng nhập dashboard, mở trang **VPS**.
2. Nhập mã máy, ví dụ `VPS-HN-01`, rồi chọn **Tạo token**.
3. Sao chép và giữ token ngay: giao diện chỉ hiển thị token mới một lần, database lưu hash.
4. Trên VPS đã clone repository, chạy từ thư mục gốc:

```bash
sudo env \
  LEDGER_URL='https://your-app.vercel.app' \
  VPS_ID='VPS-HN-01' \
  VPS_TOKEN='TOKEN_RIENG_VUA_TAO' \
  bash scanner/start_worker.sh
```

Thay URL, mã máy và token bằng thông tin thật. Script sẽ cài ZMap và `python3-requests` nếu thiếu, khi được chạy bằng root trên Debian/Ubuntu.

Trong terminal tương tác, scanner hiện menu chọn chế độ, mã quốc gia, cổng và số luồng. Nhấn `Ctrl+C` để dừng. Script không tự cài một dịch vụ systemd chạy nền.

Chọn **một** cách cấu hình: token riêng hoặc fleet. `FLEET_TOKEN`/`fleet_config.json` được scanner ưu tiên, nên không để cấu hình fleet cũ ghi đè cách dùng token riêng.

Nếu lộ token riêng, xóa VPS đó trên dashboard rồi tạo lại token. **Xóa VPS cũng xóa proxy và lịch sử lô liên quan**, nên cần cân nhắc trước thao tác này.

## 6. Chạy nhiều VPS bằng fleet

### Tạo bộ triển khai một lần

Trên máy quản lý, tại thư mục gốc repository:

```bash
python3 scanner/setup_fleet.py https://your-app.vercel.app
```

Công cụ tạo:

- `scanner/fleet_config.json`: URL và token chung, là file bí mật.
- `scanner/fleet_worker_bundle.zip`: scanner, script khởi động, blocklist và cấu hình bí mật.

Công cụ in giá trị token để bạn đặt vào biến **`FLEET_TOKEN` của app trên Vercel**, rồi redeploy. Không chụp/chia sẻ token hoặc commit hai file này. Nếu đã có cấu hình cho cùng URL, công cụ dùng lại token, không tự xoay token.

### Trên mỗi VPS

Chuyển gói ZIP bằng kênh riêng, giải nén vào thư mục worker, rồi chạy từ thư mục đó:

```bash
sudo env LEDGER_URL='https://your-app.vercel.app' bash start_worker.sh
```

`LEDGER_URL` vẫn cần được truyền trên worker và phải khớp URL trong `fleet_config.json`. Backend Next.js không cần biến này; worker mới là nơi đọc `LEDGER_URL`.

Worker tự sinh mã `wrk_<hostname>_<boot-id-hash>` và tự đăng ký khi gửi lô hợp lệ đầu tiên. Muốn mã ổn định qua các lần khởi động, đặt `WORKER_ID` riêng cho từng VPS, bắt đầu bằng `wrk_`. Không dùng cùng một `WORKER_ID` cho nhiều máy.

**Công cụ chỉ tạo cấu hình/gói worker, không mua hay tự tạo VPS.** Bạn tự phân phối gói bằng template hoặc quy trình triển khai của mình.

### Biến cấu hình scanner

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `LEDGER_URL` | Không có | URL app; scanner ghép thêm `/api/ingest` |
| `LEDGER_INGEST_URL` | Từ `LEDGER_URL` | Ghi đè endpoint đầy đủ, phải kết thúc bằng `/api/ingest` |
| `VPS_ID`, `VPS_TOKEN` | Không có | Cặp thông tin của chế độ token riêng |
| `FLEET_TOKEN` | Đọc từ file nếu có | Token chung; nếu tự đặt phải dài 32–256 ký tự |
| `WORKER_ID` | Tự sinh | Mã worker khi chạy fleet |
| `SCANNER_AUTO` | Theo terminal | `1` chạy không hỏi; script chọn `0` nếu có terminal tương tác, `1` nếu không |
| `SCANNER_MODE` | `random` khi auto | `country` hoặc `random` |
| `SCANNER_COUNTRY` | `VN` | Mã quốc gia khi dùng `country` |
| `SCANNER_FOLLOW_RANDOM` | `1` | Sau chế độ country, có chuyển sang random liên tục hay không |
| `SCANNER_PORTS` | `80,8080,3128,1080` | Các cổng cần kiểm tra |
| `SCANNER_THREADS` | `400` | Số luồng xác minh, từ 1 đến 2000 |
| `ZMAP_RATE` | `1000` | Giới hạn gói/giây cho ZMap |
| `ZMAP_MAX_TARGETS` | `100000` | Giới hạn mục tiêu mỗi lượt ZMap trên một cổng |
| `PATCH_MIN_SECONDS` | `60` | Khoảng thời gian tối thiểu cho một vòng patch random |
| `PROXY_VERIFY_TIMEOUT` | `5` | Timeout xác minh của scanner, tính bằng giây |
| `PROXY_QUEUE_DIR` | `proxy_queue/` cạnh file scanner | Nơi giữ lô đang chờ gửi |

Chế độ random lặp liên tục tới khi dừng. Khi dùng `SCANNER_AUTO=1`, muốn chỉ chạy country rồi kết thúc thì đặt `SCANNER_MODE=country` và `SCANNER_FOLLOW_RANDOM=0`.

Không chia sẻ thư mục queue giữa nhiều worker. Một lô chỉ được xóa khỏi queue khi API trả HTTP 200 với trường `accepted` hợp lệ; lỗi xác thực/kết nối sẽ giữ lô để thử lại.

## 7. API nhận dữ liệu

```text
POST https://your-app.vercel.app/api/ingest
Authorization: Bearer <node-token-hoặc-fleet-token>
Content-Type: application/json
```

| Trường JSON | Nội dung |
| --- | --- |
| `vps_id` | Mã VPS đã tạo; worker dùng fleet phải bắt đầu bằng `wrk_` |
| `batch_id` | ID duy nhất của lô, tối đa 128 ký tự; giữ nguyên khi retry |
| `proxies` | Mảng từ 1 đến 500 proxy |
| `proxies[].host` | Địa chỉ proxy thật; scanner gửi IPv4 |
| `proxies[].port` | Cổng proxy |
| `proxies[].protocol` | `HTTP`, `HTTPS`, `SOCKS4` hoặc `SOCKS5` theo dữ liệu được gửi |
| `proxies[].username`, `proxies[].password` | Thông tin xác thực proxy, hoặc chuỗi rỗng |

Gửi lại cùng `batch_id` cho cùng VPS không được tạo thêm một lô mới. Scanner mặc định gom 200 proxy/lô và giữ lại cùng payload khi retry. Không gửi IP minh họa hoặc dữ liệu tự sinh vào kho đang sử dụng thật.

API còn hỗ trợ cơ chế cũ nhận User ID làm bearer token. **Không khuyến nghị dùng:** User ID là định danh, không phải bí mật; ai biết ID có thể gửi dữ liệu và ID không thể xoay như token. Các bước ở README này chỉ hướng dẫn token riêng/fleet.

## 8. Cách đọc kết quả và dọn kho

- **Chưa kiểm tra**: proxy mới hoặc được gửi lại; chưa có kết quả cho bản dữ liệu hiện tại.
- **Sống**: phép kiểm tra gần nhất kết nối qua proxy tới `example.com:443` và hoàn tất TLS.
- **Chết**: phép kiểm tra gần nhất lỗi hoặc hết thời gian chờ; ghi ngay trong lần đó.
- Kết quả cũ không được ghi đè proxy đã thay đổi trong khi đang kiểm tra.
- Đây là kết quả tại thời điểm và từ mạng của máy kiểm tra; không đảm bảo proxy luôn hoạt động từ mọi nơi hay với mọi website.

Nút **Xóa proxy chết** chỉ xóa bản ghi chết chưa có dữ liệu gửi lại sau lần kiểm tra cuối; API xóa tối đa 2.000 bản ghi mỗi lần. Nếu còn nhiều hơn, cần thực hiện lại. Xuất TXT/CSV lấy tối đa 5.000 proxy theo bộ lọc mỗi yêu cầu và có thể chứa tài khoản/mật khẩu proxy: giữ file xuất riêng tư.

## 9. Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Dashboard trống | Có lô thật được API nhận chưa? Xem trang Hoạt động và log worker; kho không tự có dữ liệu mẫu. |
| HTTP 401 khi ingest | Token thiếu/sai; token bị thu hồi; `FLEET_TOKEN` phía app chưa khớp hoặc chưa redeploy. |
| HTTP 403 khi ingest | `vps_id` không khớp token, hoặc dùng fleet nhưng mã không có tiền tố `wrk_`. |
| HTTP 400 khi ingest | JSON sai, lô rỗng, quá 500 proxy hoặc mã VPS/batch không hợp lệ. |
| HTTP 500, thiếu bảng hoặc function | Đang dùng Supabase sai project hoặc chưa khôi phục đủ schema/RPC. Kiểm tra service-role key ở server. |
| Không đăng nhập được | Email/mật khẩu, xác nhận email, cấu hình callback hoặc giới hạn gửi email của Supabase. |
| Không tìm thấy ZMap/requests | Dùng Debian/Ubuntu và chạy startup bằng root để cài gói cho `/usr/bin/python3`. |
| ZMap báo quyền raw socket | `start_worker.sh` yêu cầu root; không chỉ cài ZMap vào một môi trường không có quyền mạng tương ứng. |
| Worker có lô `.ready` nhưng kho chưa tăng | Xem HTTP status/log gửi lại; giữ nguyên queue, không xóa để “reset”. |
| Không tải được dải IP | Kiểm tra kết nối tới IPdeny; scanner sẽ chờ và thử lại. |
| Proxy bị đánh dấu Chết | Đọc lý do kiểm tra, xem kết nối outbound/TLS và thông tin xác thực; thử lại khi mạng đã ổn định. |

## 10. Bảo mật và cấu trúc mã nguồn

- Không đưa `.env*`, service-role key, node token, fleet config, worker ZIP, queue hay file export chứa mật khẩu lên GitHub.
- `.gitignore` loại trừ cấu hình bí mật, queue và Python bytecode. Nếu bí mật đã từng được commit, chỉ thêm ignore là chưa đủ: cần thu hồi/xoay khóa và xử lý cả lịch sử Git.
- Không truyền service-role key cho scanner; scanner chỉ cần token ingest.
- Dùng HTTPS cho URL app trên VPS. HTTP chỉ được scanner chấp nhận với localhost để phát triển.
- Dùng tài khoản quản trị tin cậy; repository public không biến ứng dụng thành hệ thống phân quyền nhiều khách hàng.

```text
app/                         Dashboard, đăng nhập và API Next.js
app/api/dashboard/route.ts   API quản trị có kiểm tra phiên Supabase
app/api/ingest/route.ts      API VPS gửi lô proxy
lib/supabase/               Client Supabase server/browser và session proxy
lib/probe.ts                Phép kiểm tra TCP/TLS cho proxy
scanner/geo_proxy_scanner.py Scanner và queue gửi lại
scanner/start_worker.sh      Khởi động worker Debian/Ubuntu
scanner/setup_fleet.py       Tạo cấu hình và gói fleet riêng tư
scanner/zmap_blocklist.conf  Dải mạng bị loại trừ khi quét
```

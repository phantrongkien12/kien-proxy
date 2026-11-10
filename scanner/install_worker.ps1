# Kien Proxy: bộ cài worker cho Windows.
#
# Chạy một lệnh trong PowerShell (Administrator):
#   irm https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner/install_worker.ps1 | iex
#
# Scanner cần ZMap, mà ZMap chỉ có trên Linux vì phải mở raw socket. Không có bản
# Windows native, nên bộ cài này dựng WSL2 rồi chạy installer Linux bên trong đó.
# WSL2 là kernel Linux thật nên ZMap chạy được.

param(
  [string]$Url,
  [string]$Node,
  [string]$Token,
  [string]$Config,
  [string]$Distro = 'Ubuntu'
)

# Native command ghi ra stderr (wsl.exe, dism.exe) sẽ thành terminating error nếu
# đặt 'Stop', nên để 'Continue' và tự kiểm tra $LASTEXITCODE ở từng bước.
$ErrorActionPreference = 'Continue'
# wsl.exe in ra UTF-16 trên Windows PowerShell 5.1; ép UTF-8 để đọc tên distro sạch.
$env:WSL_UTF8 = '1'
$Base = 'https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner'
$TaskName = 'Kien Proxy'

function Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Fail($message) { Write-Host "LỖI: $message" -ForegroundColor Red }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Mở PowerShell bằng quyền Administrator (chuột phải > Run as administrator) rồi chạy lại.'
  return
}

if ([Environment]::OSVersion.Version.Build -lt 19041) {
  Fail 'Cần Windows 10 build 19041 trở lên, hoặc Windows 11, để chạy WSL2.'
  return
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  Step 'Chưa có WSL. Đang bật WSL2...'
  dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
  dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
  Fail 'Đã bật WSL2. KHỞI ĐỘNG LẠI máy rồi chạy lại đúng lệnh này.'
  return
}

# Bọc @() để một distro duy nhất không bị co thành chuỗi (khi đó $distros[0] là ký tự đầu).
$distros = @()
try {
  $distros = @(
    @(wsl.exe -l -q 2>$null) |
      ForEach-Object { ($_ -replace "`0", '').Trim() } |
      Where-Object { $_ -and $_ -notmatch '^docker-desktop' }
  )
} catch {
  $distros = @()
}

if ($distros.Count -eq 0) {
  Step "Chưa có bản phân phối Linux. Đang cài $Distro..."
  # --no-launch để WSL không mở phiên đăng nhập đầu tiên và chặn script.
  wsl.exe --install -d $Distro --no-launch
  Fail "Đã cài $Distro. Nếu Windows yêu cầu khởi động lại thì làm theo, rồi chạy lại đúng lệnh này."
  return
}

$target = $distros | Where-Object { $_ -eq $Distro } | Select-Object -First 1
if (-not $target) { $target = $distros[0] }

wsl.exe -d $target -u root -- test -f /etc/kien-proxy/worker.json 2>$null
$hasConfig = $LASTEXITCODE -eq 0

if (-not $Config -and -not ($Url -and $Node -and $Token) -and -not $hasConfig) {
  Step 'Lần đầu cài: cần URL dashboard, mã VPS và token (lấy ở trang VPS trên dashboard).'
  if (-not $Url) { $Url = (Read-Host 'URL dashboard (https://...)').Trim() }
  if (-not $Node) { $Node = (Read-Host 'Mã VPS (ví dụ github)').Trim() }
  if (-not $Token) {
    $secure = Read-Host 'Dán token (không hiện ra)' -AsSecureString
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
}

# Distro WSL tối giản có thể thiếu cả curl lẫn wget, nên bootstrap tải installer
# bằng cái nào có sẵn, cài curl qua apt nếu thiếu cả hai.
$inner = "command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq curl); " +
  "if command -v curl >/dev/null 2>&1; then curl -fsSL '$Base/install_worker.sh' -o /tmp/kien-proxy-install.sh; " +
  "else wget -qO /tmp/kien-proxy-install.sh '$Base/install_worker.sh'; fi; sh /tmp/kien-proxy-install.sh"
if ($Config) {
  if (-not (Test-Path -LiteralPath $Config)) {
    Fail "Không tìm thấy file cấu hình: $Config"
    return
  }
  $resolved = (Resolve-Path -LiteralPath $Config).Path
  $wslConfig = '/mnt/' + $resolved.Substring(0, 1).ToLower() + ($resolved.Substring(2) -replace '\\', '/')
  $inner += " --config '$wslConfig'"
} elseif ($Url -and $Node -and $Token) {
  $inner += " --url '$Url' --node '$Node' --token '$Token'"
}

Step "Đang cài worker trong WSL ($target)..."
wsl.exe -d $target -u root -- bash -lc $inner
if ($LASTEXITCODE -ne 0) {
  Fail 'Installer trong WSL thất bại. Đọc thông báo phía trên để biết chi tiết.'
  return
}

try {
  $action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $target -u root -- /usr/local/bin/kien-proxy start"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $trigger.Delay = 'PT30S'
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null
  Step "Đã tạo tác vụ '$TaskName': worker tự chạy khi bạn đăng nhập Windows."
} catch {
  Write-Host 'Cảnh báo: chưa tạo được tác vụ tự chạy. Dùng lệnh ở dưới để chạy thủ công.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Xong. Worker chạy trong WSL2.' -ForegroundColor Green
Write-Host "  Trạng thái:     wsl -d $target -u root -- kien-proxy status"
Write-Host "  Xem log:        wsl -d $target -u root -- kien-proxy logs"
Write-Host "  Khởi động lại:  wsl -d $target -u root -- kien-proxy restart"
Write-Host ''
Write-Host 'Lưu ý: WSL2 chỉ chạy khi Windows đang bật. Tắt máy hoặc để máy ngủ thì worker dừng.'

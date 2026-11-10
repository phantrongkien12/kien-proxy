# Kien Proxy: bộ cài worker cho Windows, chạy native — không cần WSL.
#
# Chạy một lệnh trong PowerShell (Administrator):
#   irm https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner/install_worker.ps1 | iex
#
# Scanner tự chọn cách tìm cổng mở: có ZMap thì dùng ZMap, không có thì quét bằng
# connect() thuần Python. ZMap chỉ có bản Linux (cần raw socket), nên trên Windows
# worker dùng connect scan: chậm hơn nhưng không cần cài thêm gì ngoài Python 3.

param(
  [string]$Url,
  [string]$Node,
  [string]$Token,
  [string]$Config,
  [string]$InstallDir = "$env:ProgramData\KienProxy"
)

# Lệnh native ghi ra stderr sẽ thành terminating error nếu đặt 'Stop', nên để
# 'Continue' và tự kiểm tra $LASTEXITCODE ở từng bước.
$ErrorActionPreference = 'Continue'
$Base = 'https://raw.githubusercontent.com/phantrongkien12/kien-proxy/master/scanner'
$TaskName = 'Kien Proxy'
$Files = @('geo_proxy_scanner.py', 'worker_config.py', 'zmap_blocklist.conf', 'run-worker.ps1', 'kien-proxy.cmd')

function Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Fail($message) { Write-Host "LỖI: $message" -ForegroundColor Red }

function Get-PythonPath {
  $pinned = Join-Path $InstallDir 'python.txt'
  if (Test-Path -LiteralPath $pinned) {
    $candidate = (Get-Content -LiteralPath $pinned -Raw).Trim()
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  foreach ($name in @('python.exe', 'python3.exe')) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
  }
  if (Get-Command py.exe -ErrorAction SilentlyContinue) {
    $resolved = & py -3 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved.Trim() }
  }
  return $null
}

function Test-PythonVersion($path) {
  & $path -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)" 2>$null
  return $LASTEXITCODE -eq 0
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'Mở PowerShell bằng quyền Administrator (chuột phải > Run as administrator) rồi chạy lại.'
  return
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$python = Get-PythonPath
if ($python -and -not (Test-PythonVersion $python)) { $python = $null }

if (-not $python) {
  Step 'Chưa có Python 3.8+. Đang cài Python 3.12...'
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    & winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements --scope machine 2>&1 | Out-Null
  }
  $python = Get-PythonPath
  if (-not $python) {
    # winget vừa cài xong nhưng PATH của phiên hiện tại chưa được cập nhật.
    foreach ($guess in @("$env:ProgramFiles\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")) {
      if (Test-Path -LiteralPath $guess) { $python = $guess; break }
    }
  }
  if (-not $python) {
    Step 'winget không cài được; tải bộ cài chính thức từ python.org...'
    $installer = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
    try {
      Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile $installer -UseBasicParsing
      Start-Process -FilePath $installer -ArgumentList '/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_pip=1' -Wait
    } catch {
      Fail 'Không tải được Python. Cài thủ công từ https://www.python.org/downloads/ rồi chạy lại lệnh này.'
      return
    }
    $python = Get-PythonPath
    if (-not $python) {
      foreach ($guess in @("$env:ProgramFiles\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")) {
        if (Test-Path -LiteralPath $guess) { $python = $guess; break }
      }
    }
  }
  if (-not $python) {
    Fail 'Đã cài Python nhưng chưa tìm thấy python.exe. Mở PowerShell mới rồi chạy lại lệnh này.'
    return
  }
}

Step "Dùng Python: $python"
Set-Content -LiteralPath (Join-Path $InstallDir 'python.txt') -Value $python

Step 'Đang tải mã nguồn worker...'
foreach ($file in $Files) {
  $target = Join-Path $InstallDir $file
  $downloaded = $false
  # GitHub raw có thể còn cache 404 trong lúc CDN cập nhật, nên thử lại vài lần.
  foreach ($attempt in 1..3) {
    try {
      Invoke-WebRequest -Uri "$Base/$file" -OutFile $target -UseBasicParsing
      $downloaded = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $downloaded) {
    Fail "Không tải được $file. Kiểm tra kết nối mạng rồi chạy lại."
    return
  }
}

Step 'Đang cài thư viện Python (requests)...'
& $python -m pip install --quiet --disable-pip-version-check --upgrade pip 2>&1 | Out-Null
& $python -m pip install --quiet --disable-pip-version-check requests 2>&1 | Out-Null
& $python -c "import requests" 2>$null
if ($LASTEXITCODE -ne 0) {
  Fail "Chưa cài được thư viện requests. Chạy: `"$python`" -m pip install requests"
  return
}

$configPath = Join-Path $InstallDir 'worker.json'
$hasConfig = Test-Path -LiteralPath $configPath

if (-not $Config -and -not ($Url -and $Node -and $Token) -and -not $hasConfig) {
  Step 'Lần đầu cài: cần URL dashboard, mã VPS và token (lấy ở trang VPS trên dashboard).'
  if (-not $Url) { $Url = (Read-Host 'URL dashboard (https://...)').Trim() }
  if (-not $Node) { $Node = (Read-Host 'Mã VPS (ví dụ github)').Trim() }
  if (-not $Token) {
    $secure = Read-Host 'Dán token (không hiện ra)' -AsSecureString
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
}

$configArgs = @()
if ($Config) {
  if (-not (Test-Path -LiteralPath $Config)) {
    Fail "Không tìm thấy file cấu hình: $Config"
    return
  }
  $configArgs = @('--install-config', (Resolve-Path -LiteralPath $Config).Path, '--target', $configPath)
} elseif ($Url -and $Node -and $Token) {
  $configArgs = @('--set-credentials', '--url', $Url, '--node', $Node, '--token', $Token, '--target', $configPath)
}

if ($configArgs.Count -gt 0) {
  Push-Location $InstallDir
  & $python 'worker_config.py' @configArgs
  $configOk = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $configOk) {
    Fail 'Cấu hình không hợp lệ; xem thông báo phía trên.'
    return
  }
} elseif (-not $hasConfig) {
  Fail 'Thiếu cấu hình. Chạy lại kèm -Url, -Node, -Token hoặc -Config.'
  return
}

$launcher = Join-Path $InstallDir 'run-worker.ps1'
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $trigger.Delay = 'PT30S'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -Force | Out-Null
  Step "Đã tạo tác vụ '$TaskName': worker tự chạy khi bạn đăng nhập Windows."
} catch {
  Write-Host 'Cảnh báo: chưa tạo được tác vụ tự chạy. Dùng kien-proxy.cmd start để chạy thủ công.' -ForegroundColor Yellow
}

Step 'Đang khởi động worker...'
try {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
} catch {
  Write-Host 'Cảnh báo: chưa khởi động được tác vụ. Chạy kien-proxy.cmd start sau.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Xong. Worker chạy native trên Windows, không cần WSL.' -ForegroundColor Green
Write-Host "  Thư mục cài:    $InstallDir"
Write-Host "  Trạng thái:     `"$InstallDir\kien-proxy.cmd`" status"
Write-Host "  Xem log:        `"$InstallDir\kien-proxy.cmd`" logs"
Write-Host "  Khởi động lại:  `"$InstallDir\kien-proxy.cmd`" restart"
Write-Host ''
Write-Host 'Lưu ý: Windows không có ZMap nên worker quét cổng bằng connect() thuần Python.'
Write-Host 'Cách này chậm hơn ZMap nhiều lần. Muốn nhanh hơn, giảm SCANNER_PORTS hoặc'
Write-Host 'tăng CONNECT_SCAN_WORKERS trong run-worker.ps1.'

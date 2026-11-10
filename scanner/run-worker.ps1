# Kien Proxy: chạy worker trên Windows. Tác vụ 'Kien Proxy' gọi file này khi đăng nhập.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:KIEN_PROXY_CONFIG = Join-Path $here 'worker.json'
$env:PROXY_QUEUE_DIR = Join-Path $here 'queue'
$env:SCANNER_AUTO = '1'
$env:PYTHONUNBUFFERED = '1'
# Bắt Python ghi log bằng UTF-8, nếu không tiếng Việt sẽ lỗi font hoặc làm worker thoát.
$env:PYTHONUTF8 = '1'
# Windows tạo luồng nặng hơn Linux; 800 luồng xác minh là mức chạy êm trên máy phổ thông.
if (-not $env:SCANNER_THREADS) { $env:SCANNER_THREADS = '800' }

$python = $null
$pinned = Join-Path $here 'python.txt'
if (Test-Path -LiteralPath $pinned) {
  $candidate = (Get-Content -LiteralPath $pinned -Raw).Trim()
  if ($candidate -and (Test-Path -LiteralPath $candidate)) { $python = $candidate }
}
if (-not $python) {
  foreach ($name in @('python.exe', 'python3.exe')) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if ($found) { $python = $found.Source; break }
  }
}
if (-not $python -and (Get-Command py.exe -ErrorAction SilentlyContinue)) {
  $resolved = & py -3 -c "import sys; print(sys.executable)" 2>$null
  if ($LASTEXITCODE -eq 0 -and $resolved) { $python = $resolved.Trim() }
}

$log = Join-Path $here 'worker.log'
$errlog = Join-Path $here 'worker.err.log'
$pidFile = Join-Path $here 'worker.pid'
$stopFile = Join-Path $here 'worker.stop'

# Add-Content mặc định ghi bằng codepage ANSI trên PowerShell 5.1, sẽ trộn hai bảng mã
# vào cùng một file với output UTF-8 của Python. Ghi thẳng UTF-8 không BOM.
function Write-ErrLog([string]$message) {
  [System.IO.File]::AppendAllText($errlog, "$message`r`n", [System.Text.UTF8Encoding]::new($false))
}

if (-not $python) {
  Write-ErrLog 'Không tìm thấy Python 3. Chạy lại install_worker.ps1.'
  exit 1
}

Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue

# Worker có thể thoát vì lỗi mạng hoặc lỗi tạm thời; chạy lại thay vì nằm im tới lần đăng nhập sau.
$delay = 10
while (-not (Test-Path -LiteralPath $stopFile)) {
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
  $started = Get-Date
  $process = Start-Process -FilePath $python -ArgumentList 'geo_proxy_scanner.py' `
    -WorkingDirectory $here -NoNewWindow -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError $errlog
  Set-Content -LiteralPath $pidFile -Value $process.Id
  $process.WaitForExit()
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stopFile) { break }

  # Thoát nhanh nghĩa là lỗi cấu hình hoặc Python, không phải sự cố mạng: giãn dần để log không phình.
  if (((Get-Date) - $started).TotalSeconds -lt 30) { $delay = [Math]::Min($delay * 2, 300) } else { $delay = 10 }
  Write-ErrLog "$(Get-Date -Format s) worker thoát (mã $($process.ExitCode)); chạy lại sau $delay giây."
  Start-Sleep -Seconds $delay
}
Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue

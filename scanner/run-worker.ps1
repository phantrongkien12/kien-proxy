# Kien Proxy: chạy worker trên Windows. Tác vụ 'Kien Proxy' gọi file này khi đăng nhập.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:KIEN_PROXY_CONFIG = Join-Path $here 'worker.json'
$env:PYTHONUNBUFFERED = '1'
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
if (-not $python) {
  Add-Content -LiteralPath (Join-Path $here 'worker.err.log') -Value 'Không tìm thấy Python 3. Chạy lại install_worker.ps1.'
  exit 1
}

$log = Join-Path $here 'worker.log'
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
  Move-Item -LiteralPath $log -Destination "$log.1" -Force
}

$process = Start-Process -FilePath $python -ArgumentList 'geo_proxy_scanner.py' `
  -WorkingDirectory $here -NoNewWindow -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError (Join-Path $here 'worker.err.log')
Set-Content -LiteralPath (Join-Path $here 'worker.pid') -Value $process.Id
$process.WaitForExit()
Remove-Item -LiteralPath (Join-Path $here 'worker.pid') -ErrorAction SilentlyContinue

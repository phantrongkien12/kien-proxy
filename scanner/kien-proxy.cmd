@echo off
setlocal enabledelayedexpansion
set "DIR=%~dp0"
set "TASK=Kien Proxy"
set "PIDFILE=%DIR%worker.pid"
set "STOPFILE=%DIR%worker.stop"

if /i "%~1"=="start" goto :start
if /i "%~1"=="stop" goto :stop
if /i "%~1"=="restart" goto :restart
if /i "%~1"=="status" goto :status
if /i "%~1"=="logs" goto :logs
goto :usage

:start
del "%STOPFILE%" >nul 2>&1
schtasks /run /tn "%TASK%" >nul 2>&1
if errorlevel 1 (
  echo Khong chay duoc tac vu "%TASK%". Chay lai install_worker.ps1.
  exit /b 1
)
echo Da khoi dong worker.
exit /b 0

:stop
rem Dat co truoc khi kill, neu khong vong lap trong run-worker.ps1 se dung worker day len lai.
echo stop >"%STOPFILE%"
if not exist "%PIDFILE%" (
  echo Worker khong chay ^(khong thay worker.pid^).
  exit /b 0
)
set /p PID=<"%PIDFILE%"
taskkill /f /pid !PID! >nul 2>&1
del "%PIDFILE%" >nul 2>&1
echo Da dung worker.
exit /b 0

:restart
call "%~f0" stop
timeout /t 2 /nobreak >nul
call "%~f0" start
exit /b 0

:status
chcp 65001 >nul
if not exist "%PIDFILE%" (
  echo Worker dang dung.
  if exist "%DIR%worker.err.log" (
    echo Dong cuoi trong worker.err.log:
    powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath '%DIR%worker.err.log' -Tail 3 -Encoding UTF8"
  )
  exit /b 0
)
set /p PID=<"%PIDFILE%"
tasklist /fi "PID eq !PID!" 2>nul | find /i "!PID!" >nul
if errorlevel 1 (
  echo Worker dang dung ^(pid !PID! khong con chay^).
) else (
  echo Worker dang chay ^(pid !PID!^).
)
exit /b 0

:logs
rem worker.log la UTF-8; console Windows mac dinh doc bang codepage ANSI nen phai ep UTF-8 ca khi doc lan khi hien thi.
chcp 65001 >nul
if exist "%DIR%worker.err.log" (
  echo --- worker.err.log ^(loi^) ---
  powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath '%DIR%worker.err.log' -Tail 20 -Encoding UTF8"
)
if not exist "%DIR%worker.log" (
  echo Chua co worker.log.
  exit /b 0
)
echo --- worker.log ^(hoat dong) ---
powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath '%DIR%worker.log' -Tail 60 -Encoding UTF8"
exit /b 0

:usage
echo Cach dung: kien-proxy {start^|stop^|restart^|status^|logs}
exit /b 1

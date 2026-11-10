@echo off
setlocal enabledelayedexpansion
set "DIR=%~dp0"
set "TASK=Kien Proxy"
set "PIDFILE=%DIR%worker.pid"

if /i "%~1"=="start" goto :start
if /i "%~1"=="stop" goto :stop
if /i "%~1"=="restart" goto :restart
if /i "%~1"=="status" goto :status
if /i "%~1"=="logs" goto :logs
goto :usage

:start
schtasks /run /tn "%TASK%" >nul 2>&1
if errorlevel 1 (
  echo Khong chay duoc tac vu "%TASK%". Chay lai install_worker.ps1.
  exit /b 1
)
echo Da khoi dong worker.
exit /b 0

:stop
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
if not exist "%PIDFILE%" (
  echo Worker dang dung.
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
if not exist "%DIR%worker.log" (
  echo Chua co worker.log.
  exit /b 0
)
powershell -NoProfile -Command "Get-Content -LiteralPath '%DIR%worker.log' -Tail 60 -Wait"
exit /b 0

:usage
echo Cach dung: kien-proxy {start^|stop^|restart^|status^|logs}
exit /b 1

@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 (
  py -3 setup_fleet.py
) else (
  python setup_fleet.py
)
echo.
pause
endlocal

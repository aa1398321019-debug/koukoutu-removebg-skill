@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===== koukoutu-removebg-skill 最小自测 =====
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] 未找到 Node.js。请先安装 Node.js 18+ LTS。
  echo.
  pause
  exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright-browsers"
node src\smoke_test.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%

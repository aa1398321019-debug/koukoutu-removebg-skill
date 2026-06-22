@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===== koukoutu-removebg-skill 环境诊断 =====
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] 未找到 Node.js。
  echo 修复建议：请安装 Node.js 18+ LTS，然后重新运行 setup.bat。
  echo.
  pause
  exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright-browsers"
node src\env_check.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%

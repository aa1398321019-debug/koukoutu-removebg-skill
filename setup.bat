@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===== koukoutu-removebg-skill 安装程序 =====
echo 当前目录：%CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] 未找到 Node.js。
  echo 修复建议：请安装 Node.js 18+ LTS，然后重新运行 setup.bat。
  echo 下载地址：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [FAIL] 未找到 npm。
  echo 修复建议：请重新安装 Node.js 18+ LTS。
  echo.
  pause
  exit /b 1
)

if not exist config.json (
  if exist config.example.json (
    copy /Y config.example.json config.json >nul
    echo [OK] 已从 config.example.json 创建 config.json。
  ) else (
    echo [FAIL] 缺少 config.example.json，无法创建 config.json。
    echo.
    pause
    exit /b 1
  )
)

for %%D in (input output failed logs temp browser_profile .npm-cache .playwright-browsers) do (
  if not exist "%%D" mkdir "%%D"
)

set "PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright-browsers"

echo.
echo [1/3] 安装 Node 依赖...
call npm.cmd install --cache ".npm-cache"
if errorlevel 1 (
  echo.
  echo [FAIL] 依赖安装失败。
  echo 修复建议：检查网络、npm 是否可用，或删除 node_modules 后重新运行 setup.bat。
  echo.
  pause
  exit /b 1
)

echo.
echo [2/3] 安装 Playwright Chromium 浏览器...
call npx.cmd --cache ".npm-cache" playwright install chromium
if errorlevel 1 (
  echo.
  echo [FAIL] Playwright 浏览器安装失败。
  echo 修复建议：检查网络，或手动运行 npx playwright install chromium。
  echo.
  pause
  exit /b 1
)

echo.
echo [3/3] 运行环境诊断...
node src\env_check.js
if errorlevel 1 (
  echo.
  echo [WARN] 诊断发现问题，请按上方提示修复后再运行 run.bat。
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] 安装完成。请把图片放入 input 文件夹，然后双击 run.bat。
echo.
pause

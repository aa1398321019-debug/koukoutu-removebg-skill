@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===== koukoutu-removebg-skill 运行程序 =====
echo 当前目录：%CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] 未找到 Node.js。请先安装 Node.js 18+ LTS，再运行 setup.bat。
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [FAIL] 未找到 node_modules，说明依赖还没有安装。
  echo 修复建议：请先运行 setup.bat。
  echo.
  pause
  exit /b 1
)

if not exist config.json (
  if exist config.example.json (
    copy /Y config.example.json config.json >nul
    echo [OK] 没有找到 config.json，已从 config.example.json 创建。
  ) else (
    echo [FAIL] 缺少 config.json 和 config.example.json。
    echo 修复建议：请重新下载完整项目，或运行 setup.bat。
    echo.
    pause
    exit /b 1
  )
)

for %%D in (input output failed logs temp browser_profile) do (
  if not exist "%%D" mkdir "%%D"
)

set "HAS_INPUT_IMAGES="
for %%E in (jpg jpeg png webp) do (
  if exist "input\*.%%E" set "HAS_INPUT_IMAGES=1"
)
if not defined HAS_INPUT_IMAGES (
  echo [INFO] input 文件夹为空，请放入 jpg/jpeg/png/webp 图片后重新运行。
  echo.
  pause
  exit /b 0
)

set "PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright-browsers"

node src\main.js
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [FAIL] 程序运行失败。
  echo 请查看 logs\run.log；如果有 logs\debug 或 temp\batch-*，也一起发给开发者。
)

echo.
echo Run finished. Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%

#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

echo ""
echo "===== koukoutu-removebg-skill 安装程序 ====="
echo "当前目录：$PWD"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] 未找到 Node.js。"
  echo "修复建议：请安装 Node.js 18+ LTS，然后重新运行 ./setup.sh。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[FAIL] 未找到 npm。"
  echo "修复建议：请重新安装 Node.js 18+ LTS。"
  exit 1
fi

if [ ! -f config.json ]; then
  if [ -f config.example.json ]; then
    cp config.example.json config.json
    echo "[OK] 已从 config.example.json 创建 config.json。"
  else
    echo "[FAIL] 缺少 config.example.json，无法创建 config.json。"
    exit 1
  fi
fi

mkdir -p input output failed logs temp browser_profile .npm-cache .playwright-browsers
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"

echo ""
echo "[1/3] 安装 Node 依赖..."
npm install --cache ./.npm-cache

echo ""
echo "[2/3] 安装 Playwright Chromium 浏览器..."
npx --cache ./.npm-cache playwright install chromium

echo ""
echo "[3/3] 运行环境诊断..."
node src/env_check.js

echo ""
echo "[OK] 安装完成。请把图片放入 input 文件夹，然后运行 ./run.sh。"

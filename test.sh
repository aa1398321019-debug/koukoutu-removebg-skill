#!/usr/bin/env sh
set -u
cd "$(dirname "$0")"

echo ""
echo "===== koukoutu-removebg-skill 最小自测 ====="
if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] 未找到 Node.js。请先安装 Node.js 18+ LTS。"
  exit 1
fi

export PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"
node src/smoke_test.js

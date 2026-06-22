#!/usr/bin/env sh
set -u
cd "$(dirname "$0")"

echo ""
echo "===== koukoutu-removebg-skill 环境诊断 ====="
if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] 未找到 Node.js。"
  echo "修复建议：请安装 Node.js 18+ LTS，然后重新运行 ./setup.sh。"
  exit 1
fi

export PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"
node src/env_check.js

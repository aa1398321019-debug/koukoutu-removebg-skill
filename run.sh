#!/usr/bin/env sh
set -u
cd "$(dirname "$0")"

echo ""
echo "===== koukoutu-removebg-skill 运行程序 ====="
echo "当前目录：$PWD"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] 未找到 Node.js。请先安装 Node.js 18+ LTS，再运行 ./setup.sh。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[FAIL] 未找到 node_modules，说明依赖还没有安装。"
  echo "修复建议：请先运行 ./setup.sh。"
  exit 1
fi

if [ ! -f config.json ]; then
  if [ -f config.example.json ]; then
    cp config.example.json config.json
    echo "[OK] 没有找到 config.json，已从 config.example.json 创建。"
  else
    echo "[FAIL] 缺少 config.json 和 config.example.json。"
    echo "修复建议：请重新下载完整项目，或运行 ./setup.sh。"
    exit 1
  fi
fi

mkdir -p input output failed logs temp browser_profile

if ! find input -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) | grep -q .; then
  echo "[INFO] input 文件夹为空，请放入 jpg/jpeg/png/webp 图片后重新运行。"
  exit 0
fi

export PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers"

node src/main.js
status=$?
if [ "$status" -ne 0 ]; then
  echo ""
  echo "[FAIL] 程序运行失败。"
  echo "请查看 logs/run.log；如果有 logs/debug 或 temp/batch-*，也一起发给开发者。"
fi

exit "$status"

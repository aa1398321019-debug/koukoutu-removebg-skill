const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { FileManager } = require("./file_manager");
const { Logger } = require("./logger");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(PROJECT_ROOT, "config.example.json");
const SMOKE_ROOT = path.join(PROJECT_ROOT, "temp", "smoke-test");

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(PROJECT_ROOT, ".playwright-browsers");

function ok(label, detail = "") {
  console.log(`[OK] ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.log(`[FAIL] ${label}${detail ? `: ${detail}` : ""}`);
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (!fs.existsSync(CONFIG_EXAMPLE_PATH)) {
      throw new Error("config.example.json 不存在，无法创建 config.json。");
    }
    fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
    ok("config.json", "已从 config.example.json 创建");
  } else {
    ok("config.json", "已存在");
  }
}

async function checkPlaywrightLaunch() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  ok("Playwright 浏览器启动", "成功");
}

function runEmptyInputMainCheck() {
  fs.rmSync(SMOKE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SMOKE_ROOT, { recursive: true });

  const smokeConfigPath = path.join(SMOKE_ROOT, "config.json");
  const smokeConfig = {
    ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")),
    input_dir: path.join(SMOKE_ROOT, "input"),
    output_dir: path.join(SMOKE_ROOT, "output"),
    failed_dir: path.join(SMOKE_ROOT, "failed"),
    logs_dir: path.join(SMOKE_ROOT, "logs"),
    temp_dir: path.join(SMOKE_ROOT, "temp"),
    browser_profile_dir: path.join(SMOKE_ROOT, "browser_profile")
  };
  fs.writeFileSync(smokeConfigPath, JSON.stringify(smokeConfig, null, 2), "utf8");

  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "src", "main.js")], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      KOUKOUTU_CONFIG_PATH: smokeConfigPath,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(PROJECT_ROOT, ".playwright-browsers")
    },
    encoding: "utf8",
    timeout: 30000
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`空 input 检测失败，退出码 ${result.status}\n${result.stdout}\n${result.stderr}`);
  }

  if (!result.stdout.includes("input 文件夹为空")) {
    throw new Error("主程序没有输出 input 为空提示。");
  }

  ok("主程序空 input 行为", "不会崩溃");
}

async function main() {
  let failed = false;
  console.log("========== 最小自测 ==========");

  try {
    ensureConfig();
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const fileManager = new FileManager(PROJECT_ROOT, config);
    fileManager.ensureDirs();
    ok("目录创建", "成功");

    const logger = new Logger(fileManager.logsDir);
    logger.info("Smoke test log write", { projectRoot: PROJECT_ROOT });
    ok("日志写入", logger.logFile);

    await checkPlaywrightLaunch();
    runEmptyInputMainCheck();
  } catch (error) {
    failed = true;
    fail("自测失败", error.message);
    console.log("修复建议: 先运行 check_env，再根据提示运行 setup。");
  }

  console.log("==============================");
  if (failed) {
    process.exitCode = 1;
  }
}

main();

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(PROJECT_ROOT, "config.example.json");
const REQUIRED_NODE_MAJOR = 18;

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(PROJECT_ROOT, ".playwright-browsers");

function statusLine(ok, label, detail) {
  const mark = ok ? "[OK]" : "[FAIL]";
  console.log(`${mark} ${label}${detail ? `: ${detail}` : ""}`);
}

function warnLine(label, detail) {
  console.log(`[WARN] ${label}${detail ? `: ${detail}` : ""}`);
}

function runVersion(command) {
  try {
    return execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    return "";
  }
}

function ensureConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return { created: false, ok: true };
  }

  if (!fs.existsSync(CONFIG_EXAMPLE_PATH)) {
    return { created: false, ok: false, message: "config.example.json 不存在，无法自动创建 config.json。" };
  }

  fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
  return { created: true, ok: true };
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function resolveProjectPath(configuredPath) {
  if (!configuredPath) return "";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(PROJECT_ROOT, configuredPath);
}

function ensureDirectories(config) {
  const keys = [
    "input_dir",
    "output_dir",
    "failed_dir",
    "logs_dir",
    "temp_dir",
    "browser_profile_dir"
  ];

  const dirs = {};
  for (const key of keys) {
    dirs[key] = resolveProjectPath(config[key]);
    fs.mkdirSync(dirs[key], { recursive: true });
  }
  return dirs;
}

function checkWritable(dir) {
  const testPath = path.join(dir, `.write-test-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(testPath, "ok", "utf8");
    fs.unlinkSync(testPath);
    return true;
  } catch {
    return false;
  }
}

function getPlaywrightInfo() {
  try {
    const playwrightPackage = require("playwright/package.json");
    const { chromium } = require("playwright");
    const executablePath = chromium.executablePath();
    return {
      installed: true,
      version: playwrightPackage.version,
      chromiumPath: executablePath,
      chromiumInstalled: fs.existsSync(executablePath)
    };
  } catch (error) {
    return {
      installed: false,
      version: "",
      chromiumPath: "",
      chromiumInstalled: false,
      error: error.message
    };
  }
}

function main() {
  let hasFailure = false;

  console.log("========== 环境诊断 ==========");
  console.log(`系统: ${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`);
  console.log(`项目目录: ${PROJECT_ROOT}`);
  console.log("");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeOk = nodeMajor >= REQUIRED_NODE_MAJOR;
  statusLine(nodeOk, "Node.js", process.version);
  if (!nodeOk) {
    hasFailure = true;
    console.log(`  修复建议: 请安装 Node.js ${REQUIRED_NODE_MAJOR}+ LTS 后重新运行 setup。`);
  }

  const npmVersion = runVersion("npm --version");
  statusLine(Boolean(npmVersion), "npm", npmVersion || "未找到");
  if (!npmVersion) {
    hasFailure = true;
    console.log("  修复建议: 请安装 Node.js LTS，npm 会随 Node 一起安装。");
  }

  const configResult = ensureConfig();
  statusLine(configResult.ok, "config.json", configResult.created ? "已从 config.example.json 创建" : "已存在");
  if (!configResult.ok) {
    hasFailure = true;
    console.log(`  修复建议: ${configResult.message}`);
  }

  let config = {};
  let dirs = {};
  if (configResult.ok) {
    try {
      config = readConfig();
      dirs = ensureDirectories(config);
      statusLine(true, "必要目录", "已检查/创建");
    } catch (error) {
      hasFailure = true;
      statusLine(false, "配置或目录", error.message);
      console.log("  修复建议: 检查 config.json 是否为合法 JSON，路径是否可写。");
    }
  }

  for (const [key, dir] of Object.entries(dirs)) {
    statusLine(fs.existsSync(dir), key, dir);
  }

  const rootWritable = checkWritable(PROJECT_ROOT);
  statusLine(rootWritable, "当前目录写入权限", rootWritable ? "可以写入" : "不可写");
  if (!rootWritable) {
    hasFailure = true;
    console.log("  修复建议: 请把项目移动到用户目录下的英文路径，或以管理员身份运行。");
  }

  if (dirs.logs_dir) {
    const logsWritable = checkWritable(dirs.logs_dir);
    statusLine(logsWritable, "logs 写入权限", logsWritable ? "可以写入" : "不可写");
    if (!logsWritable) hasFailure = true;
  }

  const playwrightInfo = getPlaywrightInfo();
  statusLine(playwrightInfo.installed, "Playwright 依赖", playwrightInfo.installed ? playwrightInfo.version : "未安装");
  if (!playwrightInfo.installed) {
    hasFailure = true;
    console.log("  修复建议: 请先运行 setup.bat 或 ./setup.sh 安装依赖。");
  }

  if (playwrightInfo.installed) {
    statusLine(playwrightInfo.chromiumInstalled, "Playwright Chromium 浏览器", playwrightInfo.chromiumPath);
    if (!playwrightInfo.chromiumInstalled) {
      hasFailure = true;
      console.log("  修复建议: 请运行 npx playwright install chromium，或重新运行 setup。");
    }
  }

  if (config.browser_executable_path) {
    warnLine("检测到 browser_executable_path", "这是本机专属路径，跨设备可能失效；建议留空。");
  }

  console.log("");
  if (hasFailure) {
    console.log("诊断结论: 存在需要修复的问题。请按上面的修复建议处理。");
    process.exitCode = 1;
  } else {
    console.log("诊断结论: 环境看起来可以运行。");
  }
  console.log("==============================");
}

main();

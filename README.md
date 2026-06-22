# koukoutu-removebg-skill

这是一个可复用的网页自动化小工具，用 Playwright 自动打开抠抠图网页，批量上传 `input` 文件夹中的图片，等待网页抠图完成，并把透明 PNG 下载到 `output`。

项目只自动化正常网页操作，不绕过登录、验证码、会员限制、付费限制、风控或网站限额。如果网页要求人工确认，程序会提示你在浏览器中处理。

## 支持系统

- Windows 10 / 11：主要支持，推荐使用 `setup.bat` 和 `run.bat`
- Mac / Linux：尽量兼容，推荐使用 `setup.sh` 和 `run.sh`

推荐把项目放在用户目录下的英文路径，例如桌面、文档或开发目录。中文路径和空格路径已尽量兼容，但部分第三方工具、终端编码或浏览器策略仍可能受影响。

## 第一次使用

### Windows

1. 从 GitHub 下载 ZIP 或 `git clone` 本项目。
2. 解压后进入项目目录。
3. 双击 `setup.bat`。
4. 把图片放入 `input` 文件夹。
5. 双击 `run.bat`。
6. 在 `output` 查看透明 PNG。

### Mac / Linux

首次运行前执行：

```bash
chmod +x setup.sh run.sh check_env.sh test.sh
./setup.sh
```

放入图片后运行：

```bash
./run.sh
```

## 环境诊断

如果朋友电脑上跑不起来，先运行诊断。

Windows：

```bat
check_env.bat
```

Mac / Linux：

```bash
./check_env.sh
```

诊断会检查：

- 当前系统类型
- Node.js 和 npm 是否安装
- Node.js 版本是否满足 18+
- 依赖是否安装
- Playwright 是否安装
- Playwright Chromium 浏览器是否安装
- `config.json` 是否存在，不存在会从 `config.example.json` 自动创建
- `input`、`output`、`failed`、`logs`、`temp`、`browser_profile` 目录是否存在
- 当前目录和日志目录是否可写

## 最小自测

安装后可以运行最小自测。

Windows：

```bat
test.bat
```

Mac / Linux：

```bash
./test.sh
```

自测会检查：

- 配置能否加载
- 目录能否创建
- 日志能否写入
- Playwright 能否启动 Chromium
- 主程序在 `input` 为空时是否能正常提示而不是崩溃

## 配置

项目提供 `config.example.json`。首次 setup 或 run 时，如果没有 `config.json`，会自动复制一份。

常用配置：

```json
{
  "url": "https://www.koukoutu.com/removebgtool/all",
  "input_dir": "./input",
  "output_dir": "./output",
  "failed_dir": "./failed",
  "logs_dir": "./logs",
  "temp_dir": "./temp",
  "browser_profile_dir": "./browser_profile",
  "batch_size": 5,
  "headless": false,
  "retry_times": 2,
  "download_timeout_seconds": 300,
  "process_timeout_seconds": 600
}
```

请优先使用相对路径，不要写死 Windows 盘符或某台电脑的绝对路径。`browser_executable_path` 默认留空，除非你明确知道朋友电脑上的浏览器路径。

## 目录说明

- `input`：放待处理图片，支持 `.jpg`、`.jpeg`、`.png`、`.webp`
- `output`：保存透明 PNG 结果
- `failed`：保存失败图片和失败原因
- `logs`：保存 `run.log`
- `temp`：保存临时下载、debug 截图和 HTML 快照
- `browser_profile`：保存本机浏览器状态

`browser_profile` 不建议跨设备复制。不同电脑、不同系统或网站风控策略变化时，登录状态可能失效，需要重新登录。

## 常见问题

### 没有安装 Node.js

运行 `setup.bat` 或 `check_env.bat` 会提示未找到 Node.js。请安装 Node.js 18+ LTS 后重新运行。

### Playwright 浏览器未安装

通常重新运行 `setup.bat` 或 `./setup.sh` 即可。也可以手动执行：

```bash
npx playwright install chromium
```

### config.json 缺失

程序会尝试从 `config.example.json` 自动创建。如果两个文件都缺失，说明项目下载不完整，请重新下载。

### input 文件夹为空

程序不会崩溃，会提示：

```text
input 文件夹为空，请放入图片后重新运行。
```

把图片放入 `input` 后重新运行即可。

### 当前目录没有写入权限

请把项目移动到用户目录下，例如桌面或文档目录；如果仍失败，再尝试以管理员身份运行。

### 中文路径或空格路径异常

项目内部使用 `path.resolve` 和相对路径，已尽量兼容。若第三方工具仍异常，建议把项目移动到英文路径。

### 下载失败

查看：

```text
logs/run.log
temp/batch-*/debug/
```

如果网页弹出登录、验证码、付费、会员、下载确认或广告页，需要按程序提示在浏览器中手动处理。

### 网页改版导致按钮识别失败

编辑 `config.json` 中的 `selectors`，优先检查：

- `fileInputs`
- `uploadTriggers`
- `startProcessing`
- `downloadSingle`
- `downloadAll`

## 朋友报错时需要发什么

请让朋友发这些信息：

1. 电脑系统版本，例如 Windows 10 / Windows 11 / macOS / Linux。
2. Node.js 版本：运行 `node -v`。
3. npm 版本：运行 `npm -v`。
4. `check_env.bat` 或 `check_env.sh` 的完整输出截图。
5. `logs/run.log`。
6. 如果有下载问题，发 `temp/batch-*/debug/` 里的截图和 HTML 快照。
7. 项目所在路径，注意不要包含隐私信息。
8. `config.json`，如果里面有私密路径或账号信息，先打码。

## 开发者命令

```bash
npm run check
npm run smoke
npm run start
```

## 注意

本工具依赖公开网页的 DOM 和按钮文案。网站改版、风控策略、下载策略、广告弹窗、登录状态、会员限制等都可能影响自动化稳定性，这些无法完全自动规避。

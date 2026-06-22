const fs = require("fs");
const path = require("path");
const os = require("os");
const { FileManager } = require("./file_manager");
const { Logger } = require("./logger");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(PROJECT_ROOT, "config.example.json");
const CONFIG_PATH = process.env.KOUKOUTU_CONFIG_PATH
  ? path.resolve(process.env.KOUKOUTU_CONFIG_PATH)
  : DEFAULT_CONFIG_PATH;

process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(PROJECT_ROOT, ".playwright-browsers");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (!fs.existsSync(CONFIG_EXAMPLE_PATH)) {
      throw new Error("\u7f3a\u5c11 config.json\uff0c\u5e76\u4e14\u6ca1\u6709\u627e\u5230 config.example.json\u3002\u8bf7\u91cd\u65b0\u4e0b\u8f7d\u5b8c\u6574\u9879\u76ee\u6216\u8fd0\u884c setup\u3002");
    }
    fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
    console.log("\u6ca1\u6709\u627e\u5230 config.json\uff0c\u5df2\u5c1d\u8bd5\u4ece config.example.json \u521b\u5efa\u3002");
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`config.json \u683c\u5f0f\u4e0d\u6b63\u786e\uff0c\u8bf7\u68c0\u67e5\u662f\u5426\u4e3a\u5408\u6cd5 JSON\u3002\u539f\u59cb\u9519\u8bef\uff1a${error.message}`);
  }
}

function getPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`).version;
  } catch {
    return "not installed";
  }
}

function checkWritable(dir) {
  const testPath = path.join(dir, `.write-test-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(testPath, "ok", "utf8");
    fs.unlinkSync(testPath);
    return true;
  } catch {
    return false;
  }
}

function safeConfigForLog(config) {
  return {
    ...config,
    selectors: {
      fileInputs: config.selectors?.fileInputs || [],
      uploadTriggers: config.selectors?.uploadTriggers || [],
      startProcessing: config.selectors?.startProcessing || [],
      downloadAll: config.selectors?.downloadAll || [],
      downloadSingle: config.selectors?.downloadSingle || [],
      notReadyTexts: config.selectors?.notReadyTexts || []
    }
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function run() {
  const config = loadConfig();
  const fileManager = new FileManager(PROJECT_ROOT, config);
  fileManager.ensureDirs();

  const logger = new Logger(fileManager.logsDir);
  const rootWritable = checkWritable(PROJECT_ROOT);
  const logsWritable = checkWritable(fileManager.logsDir);

  logger.info("Environment detected", {
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    nodeVersion: process.version,
    playwrightVersion: getPackageVersion("playwright"),
    projectRoot: PROJECT_ROOT,
    configPath: CONFIG_PATH,
    playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
    rootWritable,
    logsWritable
  });
  logger.info("Config loaded", safeConfigForLog(config));
  logger.info("Resolved directories", {
    inputDir: fileManager.inputDir,
    outputDir: fileManager.outputDir,
    failedDir: fileManager.failedDir,
    logsDir: fileManager.logsDir,
    tempDir: fileManager.tempDir,
    browserProfileDir: fileManager.browserProfileDir
  });

  if (!rootWritable || !logsWritable) {
    const message = "\u5f53\u524d\u76ee\u5f55\u6ca1\u6709\u5199\u5165\u6743\u9650\uff0c\u8bf7\u6362\u5230\u7528\u6237\u76ee\u5f55\u4e0b\u7684\u82f1\u6587\u8def\u5f84\uff0c\u6216\u4ee5\u7ba1\u7406\u5458\u8eab\u4efd\u8fd0\u884c\u3002";
    logger.error("Directory is not writable", { rootWritable, logsWritable });
    throw new Error(message);
  }

  const allImages = fileManager.listInputImages();
  logger.info("Input scan finished", {
    totalInputImages: allImages.length,
    files: allImages.map((image) => image.name)
  });

  if (allImages.length === 0) {
    const message = "input \u6587\u4ef6\u5939\u4e3a\u7a7a\uff0c\u8bf7\u653e\u5165\u56fe\u7247\u540e\u91cd\u65b0\u8fd0\u884c\u3002";
    logger.warn("Input folder is empty");
    console.log(message);
    printSummary(0, 0, [], fileManager.outputDir);
    return;
  }

  const skipped = [];
  const pending = [];

  for (const image of allImages) {
    if (fileManager.isCompleted(image)) {
      skipped.push(image);
      logger.imageStatus(image.name, "SKIPPED", { reason: "output already exists", output: image.outputPath });
    } else {
      pending.push(image);
    }
  }

  logger.info("Run started", {
    total: allImages.length,
    pending: pending.length,
    skipped: skipped.length,
    outputDir: fileManager.outputDir
  });

  if (pending.length === 0) {
    logger.info("No pending images. All inputs already have outputs.");
    printSummary(allImages.length, skipped.length, [], fileManager.outputDir);
    return;
  }

  const batchSize = Math.min(Math.max(Number(config.batch_size) || 5, 1), 100);
  const retryTimes = Number(config.retry_times) || 0;
  const { openBrowser } = require("./browser");
  const { processBatch } = require("./workflow");
  const { context, page } = await openBrowser(config, fileManager, logger);

  const successSet = new Set(skipped.map((image) => image.name));
  const failureMap = new Map();
  let current = pending;
  let batchId = 1;

  try {
    for (let attempt = 0; attempt <= retryTimes && current.length > 0; attempt += 1) {
      logger.info("Processing attempt", {
        attempt: attempt + 1,
        maxAttempts: retryTimes + 1,
        count: current.length
      });

      const nextRetry = [];
      const batches = chunk(current, batchSize);

      for (const batch of batches) {
        logger.info("Processing batch", {
          batchId,
          batchSize: batch.length,
          files: batch.map((image) => image.name)
        });
        try {
          const result = await processBatch(page, batch, batchId, config, fileManager, logger);

          for (const image of result.successes) {
            successSet.add(image.name);
            failureMap.delete(image.name);
            logger.imageStatus(image.name, "SUCCESS", { output: image.outputPath });
          }

          for (const failure of result.failures) {
            failureMap.set(failure.image.name, failure.reason);
            nextRetry.push(failure.image);
            logger.imageStatus(failure.image.name, "FAILED", { reason: failure.reason });
          }
        } catch (error) {
          logger.error("Batch failed", { batchId, error: error.message });
          for (const image of batch) {
            failureMap.set(image.name, error.message);
            nextRetry.push(image);
            logger.imageStatus(image.name, "FAILED", { reason: error.message });
          }
        }
        batchId += 1;
      }

      current = nextRetry.filter((image) => !fileManager.isCompleted(image));
    }
  } finally {
    await context.close().catch(() => {});
  }

  const finalFailures = [];
  for (const image of pending) {
    if (fileManager.isCompleted(image)) {
      successSet.add(image.name);
      continue;
    }

    const reason = failureMap.get(image.name) || "Processing failed";
    fileManager.copyToFailed(image, reason);
    finalFailures.push({ image, reason });
  }

  printSummary(allImages.length, successSet.size, finalFailures, fileManager.outputDir);
}

function printSummary(total, successCount, failures, outputDir) {
  console.log("");
  console.log("========== \u8fd0\u884c\u603b\u7ed3 ==========");
  console.log(`\u56fe\u7247\u603b\u6570: ${total}`);
  console.log(`\u6210\u529f: ${successCount}`);
  console.log(`\u5931\u8d25: ${failures.length}`);
  console.log(`\u8f93\u51fa\u76ee\u5f55: ${outputDir}`);
  if (failures.length > 0) {
    console.log("\u5931\u8d25\u5217\u8868:");
    for (const failure of failures) {
      console.log(`- ${failure.image.name}: ${failure.reason}`);
    }
  } else {
    console.log("\u5931\u8d25\u5217\u8868: \u65e0");
  }
  console.log("=============================");
}

function friendlyError(error) {
  const message = error && error.message ? error.message : String(error);

  if (/Executable doesn't exist|browserType.launch|playwright.*install/i.test(message)) {
    return "Playwright \u6d4f\u89c8\u5668\u672a\u5b89\u88c5\uff0c\u8bf7\u5148\u8fd0\u884c setup.bat\uff1bMac/Linux \u8bf7\u8fd0\u884c ./setup.sh\u3002";
  }

  if (/EACCES|EPERM|permission denied/i.test(message)) {
    return "\u5f53\u524d\u76ee\u5f55\u6ca1\u6709\u5199\u5165\u6743\u9650\uff0c\u8bf7\u6362\u5230\u7528\u6237\u76ee\u5f55\u4e0b\u7684\u82f1\u6587\u8def\u5f84\uff0c\u6216\u4ee5\u7ba1\u7406\u5458\u8eab\u4efd\u8fd0\u884c\u3002";
  }

  if (/Cannot find module 'playwright'|Cannot find module/i.test(message)) {
    return "\u9879\u76ee\u4f9d\u8d56\u672a\u5b89\u88c5\uff0c\u8bf7\u5148\u8fd0\u884c setup.bat\uff1bMac/Linux \u8bf7\u8fd0\u884c ./setup.sh\u3002";
  }

  if (/config\.json/i.test(message)) {
    return message;
  }

  if (/download/i.test(message)) {
    return `\u4e0b\u8f7d\u5931\u8d25\uff0c\u8bf7\u67e5\u770b logs/run.log \u548c temp/batch-*/debug \u622a\u56fe\u3002\u539f\u59cb\u9519\u8bef\uff1a${message}`;
  }

  return message;
}

if (require.main === module) {
  run().catch((error) => {
    const message = friendlyError(error);
    console.error(`[FAIL] ${message}`);
    try {
      const logsDir = path.resolve(PROJECT_ROOT, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(
        path.join(logsDir, "run.log"),
        `[${new Date().toISOString()}] [ERROR] ${message}\n`,
        "utf8"
      );
    } catch {
      // Nothing else to do if even logging is unavailable.
    }
    process.exitCode = 1;
  });
}

module.exports = { run, loadConfig, friendlyError };

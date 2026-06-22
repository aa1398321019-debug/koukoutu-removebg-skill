const { chromium } = require("playwright");

function getAllowedHost(config) {
  try {
    return new URL(config.url).hostname;
  } catch {
    return "www.koukoutu.com";
  }
}

function isAllowedPage(page, config) {
  const url = page.url();
  if (!url || url === "about:blank" || url.startsWith("chrome://")) {
    return true;
  }

  try {
    return new URL(url).hostname.endsWith(getAllowedHost(config).replace(/^www\./, ""));
  } catch {
    return false;
  }
}

async function closeAdPage(page, config, logger, reason) {
  if (isAllowedPage(page, config)) {
    return false;
  }

  const url = page.url();
  logger.warn("Closing popup/ad page", { reason, url });
  await page.close().catch(() => {});
  return true;
}

function installPopupCloser(context, config, logger) {
  if (config.close_ad_tabs === false) {
    return;
  }

  context.on("page", async (newPage) => {
    await newPage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    await closeAdPage(newPage, config, logger, "new page");
  });
}

async function openBrowser(config, fileManager, logger) {
  const launchOptions = {
    headless: Boolean(config.headless),
    acceptDownloads: true,
    downloadsPath: fileManager.tempDir,
    viewport: { width: 1440, height: 960 }
  };

  if (config.browser_executable_path) {
    launchOptions.executablePath = config.browser_executable_path;
  }

  if (config.browser_channel) {
    launchOptions.channel = config.browser_channel;
  }

  logger.info("Opening browser", {
    headless: launchOptions.headless,
    profile: fileManager.browserProfileDir
  });

  const context = await chromium.launchPersistentContext(
    fileManager.browserProfileDir,
    launchOptions
  );

  installPopupCloser(context, config, logger);

  for (const existingPage of context.pages()) {
    await closeAdPage(existingPage, config, logger, "existing page").catch(() => {});
  }

  const page = context.pages().find((candidate) => isAllowedPage(candidate, config))
    || await context.newPage();
  page.setDefaultTimeout(15000);
  return { context, page };
}

module.exports = { openBrowser };

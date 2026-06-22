const fs = require("fs");
const path = require("path");
const readline = require("readline");
const AdmZip = require("adm-zip");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function askEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\n`, () => {
      rl.close();
      resolve();
    });
  });
}

function sanitizeFilePart(value) {
  return String(value || "debug")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function debugEnabled(config) {
  return Boolean(config.debug_snapshots);
}

async function saveDebugSnapshot(page, batchTempDir, label, config, logger) {
  if (!debugEnabled(config)) {
    return;
  }

  const debugDir = path.join(batchTempDir, "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${sanitizeFilePart(label)}`;
  const screenshotPath = path.join(debugDir, `${stamp}.png`);
  const htmlPath = path.join(debugDir, `${stamp}.html`);
  const buttonsPath = path.join(debugDir, `${stamp}.buttons.json`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });
  } catch (error) {
    logger.warn("Debug screenshot failed", { label, error: error.message });
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf8");
  } catch (error) {
    logger.warn("Debug HTML snapshot failed", { label, error: error.message });
  }

  try {
    const controls = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("button, a, [role='button'], [aria-label], [download], div, span"));
      const interestingNodes = nodes.filter((node) => {
        const text = [
          node.innerText || node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.getAttribute("download") || ""
        ].join(" ").toUpperCase();
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        const clickable = ["BUTTON", "A"].includes(node.tagName)
          || node.getAttribute("role") === "button"
          || node.hasAttribute("download")
          || style.cursor === "pointer";
        return visible && (clickable || text.includes("\u4e0b\u8f7d") || text.includes("PNG") || text.includes("\u4fdd\u5b58"));
      });
      return interestingNodes.slice(0, 500).map((node) => ({
        tag: node.tagName,
        text: (node.innerText || node.textContent || "").trim().slice(0, 120),
        ariaLabel: node.getAttribute("aria-label") || "",
        title: node.getAttribute("title") || "",
        href: node.getAttribute("href") || "",
        download: node.getAttribute("download") || "",
        className: typeof node.className === "string" ? node.className.slice(0, 160) : "",
        rect: (() => {
          const rect = node.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        })(),
        backgroundColor: window.getComputedStyle(node).backgroundColor,
        cursor: window.getComputedStyle(node).cursor,
        visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true")
      }));
    });
    fs.writeFileSync(buttonsPath, JSON.stringify(controls, null, 2), "utf8");
  } catch (error) {
    logger.warn("Debug control snapshot failed", { label, error: error.message });
  }

  logger.info("Debug snapshot saved", { label, screenshotPath, htmlPath, buttonsPath });
}

async function firstVisible(page, selectors) {
  for (const selector of selectors || []) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count() > 0 && await locator.isVisible({ timeout: 1000 })) {
        return locator;
      }
    } catch {
      // Keep trying fallback selectors.
    }
  }
  return null;
}

async function pageShowsAnyText(page, texts) {
  for (const text of texts || []) {
    try {
      const locator = page.getByText(text, { exact: false }).first();
      if (await locator.count() > 0 && await locator.isVisible({ timeout: 500 })) {
        return text;
      }
    } catch {
      // Continue with the next text hint.
    }
  }
  return "";
}

async function countVisibleTexts(page, texts) {
  let total = 0;
  for (const text of texts || []) {
    try {
      const locators = page.getByText(text, { exact: false });
      const count = await locators.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        if (await locators.nth(i).isVisible({ timeout: 300 }).catch(() => false)) {
          total += 1;
        }
      }
    } catch {
      // Continue with the next text hint.
    }
  }
  return total;
}

async function locatorIsUsable(locator) {
  try {
    if (!(await locator.count()) || !(await locator.isVisible({ timeout: 500 }))) {
      return false;
    }

    return await locator.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const disabled = node.disabled || node.getAttribute("aria-disabled") === "true";
      return !disabled && style.visibility !== "hidden" && style.display !== "none";
    });
  } catch {
    return false;
  }
}

async function locatorIsDownloadControl(locator) {
  if (!(await locatorIsUsable(locator))) {
    return false;
  }

  try {
    return await locator.evaluate((node) => {
      const text = [
        node.innerText || node.textContent || "",
        node.getAttribute("aria-label") || "",
        node.getAttribute("title") || ""
      ].join(" ").toUpperCase();
      const rect = node.getBoundingClientRect();

      if (text.includes("\u8bbe\u7f6e") || text.includes("SETTING")) {
        return false;
      }

      if (text.includes("\u4e0b\u8f7d\u8bbe\u7f6e")) {
        return false;
      }

      const looksLikePngDownload = text.includes("PNG") && text.includes("\u4e0b\u8f7d");
      const looksLikeLargeImageDownload = text.includes("\u9ad8\u6e05") || text.includes("\u5927\u56fe");
      const hasDownloadAttr = node.tagName === "A" && node.hasAttribute("download");

      return rect.width > 40 && rect.height > 20 && (
        hasDownloadAttr || looksLikePngDownload || looksLikeLargeImageDownload
      );
    });
  } catch {
    return false;
  }
}

async function pauseForManualInterventionIfNeeded(page, config, logger) {
  const hit = await pageShowsAnyText(page, config.selectors.manualInterventionTexts);
  if (!hit) {
    return;
  }

  logger.warn("Manual intervention may be required", { matchedText: hit });
  await askEnter("\u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u5b8c\u6210\u767b\u5f55/\u9a8c\u8bc1\uff0c\u7136\u540e\u56de\u5230\u7ec8\u7aef\u6309 Enter \u7ee7\u7eed\u3002");
}

async function navigateToTool(page, config, logger) {
  logger.info("Opening target page", { url: config.url });
  await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await pauseForManualInterventionIfNeeded(page, config, logger);
}

async function uploadFiles(page, files, config, logger) {
  const filePaths = files.map((image) => image.inputPath);
  logger.info("Uploading batch", {
    count: files.length,
    files: files.map((image) => image.name)
  });

  for (const selector of config.selectors.fileInputs || []) {
    const inputs = page.locator(selector);
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      try {
        await inputs.nth(i).setInputFiles(filePaths);
        logger.info("Uploaded through file input", { selector, files: files.map((image) => image.name) });
        return;
      } catch (error) {
        logger.warn("File input upload attempt failed", { selector, index: i, error: error.message });
      }
    }
  }

  const trigger = await firstVisible(page, config.selectors.uploadTriggers);
  if (!trigger) {
    throw new Error("Upload entry was not found. Update selectors.fileInputs or selectors.uploadTriggers in config.json.");
  }

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await trigger.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(filePaths);
  logger.info("Uploaded through file chooser", { files: files.map((image) => image.name) });
}

async function clickStartProcessing(page, config, logger) {
  const startSelectors = config.selectors.startProcessing || [];

  for (const selector of startSelectors) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const locator = locators.nth(i);
      if (!(await locatorIsUsable(locator))) {
        continue;
      }

      logger.info("Clicking start processing button", { selector, index: i + 1 });
      await locator.click({ timeout: 15000 });
      await sleep(1500);
      return;
    }
  }

  const startText = await pageShowsAnyText(page, config.selectors.startProcessingTexts || []);
  if (startText) {
    throw new Error(`Start processing button text was found but not clickable: ${startText}`);
  }

  logger.warn("Start processing button was not found. Continuing in case the site auto-started processing.");
}

async function waitForProcessing(page, expectedCount, config, logger) {
  const timeoutAt = Date.now() + Number(config.process_timeout_seconds) * 1000;
  let tick = 0;
  let stableNoProcessingTicks = 0;
  logger.info("Waiting for processing to finish", { expectedCount });

  while (Date.now() < timeoutAt) {
    tick += 1;
    await pauseForManualInterventionIfNeeded(page, config, logger);

    const processingText = await pageShowsAnyText(page, config.selectors.processingTexts);
    const pendingTextCount = await countVisibleTexts(page, config.selectors.notReadyTexts);
    const downloadControls = await countUsableMatching(page, config.selectors.downloadSingle);
    const likelyPngDownloadButtons = await countLikelyPngDownloadButtons(page);
    const batchDownloadControls = await countUsableMatching(page, config.selectors.downloadAll);
    const cards = await countMatching(page, config.selectors.resultCards);
    const successfulResult = await pageHasSuccessfulResult(page);

    logger.info("Processing status check", {
      tick,
      processingText: processingText || "",
      pendingTextCount,
      downloadControls,
      likelyPngDownloadButtons,
      batchDownloadControls,
      resultCards: cards,
      successfulResult
    });

    if (!processingText && pendingTextCount === 0) {
      stableNoProcessingTicks += 1;
    } else {
      stableNoProcessingTicks = 0;
    }

    if (pendingTextCount === 0 && (successfulResult || likelyPngDownloadButtons > 0 || downloadControls >= Math.min(expectedCount, 1) || batchDownloadControls > 0 || stableNoProcessingTicks >= 8)) {
      logger.info("Processing appears finished", {
        downloadControls,
        likelyPngDownloadButtons,
        batchDownloadControls,
        cards,
        pendingTextCount,
        successfulResult,
        stableNoProcessingTicks
      });
      if (cards > 0 && cards !== expectedCount) {
        logger.warn("Result card count differs from uploaded count", { expectedCount, cards });
      }
      return;
    }

    await sleep(3000);
  }

  throw new Error(`Processing timed out after ${config.process_timeout_seconds} seconds.`);
}

async function countMatching(page, selectors) {
  let total = 0;
  for (const selector of selectors || []) {
    total += await page.locator(selector).count().catch(() => 0);
  }
  return total;
}

async function countUsableMatching(page, selectors) {
  let total = 0;
  for (const selector of selectors || []) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      if (await locatorIsUsable(locators.nth(i))) {
        total += 1;
      }
    }
  }
  return total;
}

async function countLikelyPngDownloadButtons(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 20
        && rect.height > 15
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.pointerEvents !== "none";
    };

    return Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
      .filter(visible)
      .filter((node) => {
        const text = [
          node.innerText || node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || ""
        ].join(" ").toUpperCase();
        const style = window.getComputedStyle(node);
        const clickable = ["BUTTON", "A"].includes(node.tagName)
          || node.getAttribute("role") === "button"
          || style.cursor === "pointer"
          || typeof node.onclick === "function";
        if (!clickable) return false;
        if (text.includes("\u8bbe\u7f6e") || text.includes("SETTING") || text.includes("\u590d\u5236")) return false;
        return text.includes("PNG") && (text.includes("\u4e0b\u8f7d") || text.includes("\u9ad8\u6e05") || text.includes("\u5927\u56fe"));
      }).length;
  }).catch(() => 0);
}

async function pageHasSuccessfulResult(page) {
  return page.evaluate(() => {
    const bodyText = (document.body.innerText || document.body.textContent || "").toUpperCase();
    if (bodyText.includes("\u62a0\u56fe\u6210\u529f")) {
      return true;
    }

    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 20 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
    };

    return Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
      .filter(visible)
      .some((node) => {
        const text = (node.innerText || node.textContent || "").toUpperCase();
        const style = window.getComputedStyle(node);
        const clickable = ["BUTTON", "A"].includes(node.tagName)
          || node.getAttribute("role") === "button"
          || style.cursor === "pointer"
          || typeof node.onclick === "function";
        return clickable && text.includes("PNG") && text.includes("\u4e0b\u8f7d");
      });
  }).catch(() => false);
}

function isAllowedTaskPage(page, config) {
  const url = page.url();
  if (!url || url === "about:blank" || url.startsWith("chrome://")) {
    return true;
  }

  try {
    const targetHost = new URL(config.url).hostname.replace(/^www\./, "");
    return new URL(url).hostname.endsWith(targetHost);
  } catch {
    return true;
  }
}

async function closeUnexpectedPages(page, config, logger, reason) {
  if (config.close_ad_tabs === false) {
    return;
  }

  for (const candidate of page.context().pages()) {
    if (candidate === page || candidate.isClosed()) {
      continue;
    }

    if (!isAllowedTaskPage(candidate, config)) {
      logger.warn("Closing popup/ad page", { reason, url: candidate.url() });
      await candidate.close().catch(() => {});
    }
  }

  await page.bringToFront().catch(() => {});
}

async function waitForPopupOrTimeout(page, config, logger, timeoutMs) {
  if (config.close_ad_tabs === false) {
    await sleep(timeoutMs);
    return null;
  }

  try {
    const popup = await page.context().waitForEvent("page", { timeout: timeoutMs });
    await popup.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    if (!isAllowedTaskPage(popup, config)) {
      logger.warn("Popup/ad page opened during download click", { url: popup.url() });
      await popup.close().catch(() => {});
      await page.bringToFront().catch(() => {});
      return popup;
    }
    return popup;
  } catch {
    return null;
  }
}

async function handleDownloadSettingsModal(page, config, logger) {
  if (config.auto_confirm_download_settings === false) {
    return false;
  }

  const modalDetected = await page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    return Array.from(document.querySelectorAll("div, form, section")).some((node) => {
      if (!isVisible(node)) return false;
      const text = (node.innerText || node.textContent || "").toUpperCase();
      const hasFormatChoice = text.includes("JPG") && text.includes("PNG");
      const hasRadio = node.querySelectorAll("input[type='radio']").length >= 2;
      const hasSaveLikeButton = node.querySelectorAll("button").length > 0;
      return hasFormatChoice && hasRadio && hasSaveLikeButton;
    });
  }).catch(() => false);

  if (!modalDetected) {
    return false;
  }

  logger.info("Download settings modal detected. Selecting PNG and saving.");

  const downloadPromise = page.waitForEvent("download", {
    timeout: Number(config.settings_save_download_timeout_ms || 8000)
  }).catch((error) => {
    logger.warn("No download after saving download settings", { error: error.message });
    return null;
  });

  const clickTarget = await page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };

    const containers = Array.from(document.querySelectorAll("div, form, section")).filter((node) => {
      if (!isVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const text = (node.innerText || node.textContent || "").toUpperCase();
      const visibleButtons = Array.from(node.querySelectorAll("button")).filter(isVisible);
      return rect.width > 300
        && rect.height > 200
        && text.includes("JPG")
        && text.includes("PNG")
        && node.querySelectorAll("input[type='radio']").length >= 2
        && visibleButtons.length > 0;
    });

    const modal = containers
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
    if (!modal) return false;

    const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
    const pngRadio = radios.find((radio) => {
      const label = radio.closest("label");
      const nearbyText = [
        radio.value || "",
        label ? label.innerText || label.textContent || "" : "",
        radio.parentElement ? radio.parentElement.innerText || radio.parentElement.textContent || "" : ""
      ].join(" ").toUpperCase();
      return nearbyText.includes("PNG");
    }) || radios[1];

    if (pngRadio) {
      pngRadio.checked = true;
      pngRadio.click();
      pngRadio.dispatchEvent(new Event("input", { bubbles: true }));
      pngRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const checkbox = modal.querySelector("input[type='checkbox']");
    if (checkbox && !checkbox.checked) {
      checkbox.checked = true;
      checkbox.click();
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const buttons = Array.from(modal.querySelectorAll("button")).filter(isVisible);
    const saveButton = buttons.find((button) => (button.innerText || button.textContent || "").includes("\u4fdd\u5b58"))
      || buttons[buttons.length - 1];
    if (!saveButton) return false;

    const rect = saveButton.getBoundingClientRect();
    saveButton.scrollIntoView({ block: "center", inline: "center" });
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      text: (saveButton.innerText || saveButton.textContent || "").trim(),
      className: saveButton.className || ""
    };
  }).catch((error) => {
    logger.warn("Download settings modal target lookup failed", { error: error.message });
    return false;
  });

  if (!clickTarget) {
    logger.warn("Download settings modal was detected but save button was not clicked");
    return false;
  }

  logger.info("Clicking download settings save button by coordinates", clickTarget);
  await page.mouse.click(clickTarget.x, clickTarget.y).catch(async (error) => {
    logger.warn("Coordinate click on download settings save failed, trying DOM click", { error: error.message });
    await page.evaluate(() => {
      const isVisible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const containers = Array.from(document.querySelectorAll("div, form, section")).filter((node) => {
        if (!isVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.textContent || "").toUpperCase();
        return rect.width > 300 && rect.height > 200 && text.includes("JPG") && text.includes("PNG");
      });
      const modal = containers.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      })[0];
      const buttons = modal ? Array.from(modal.querySelectorAll("button")).filter(isVisible) : [];
      const saveButton = buttons.find((button) => (button.innerText || button.textContent || "").includes("\u4fdd\u5b58"))
        || buttons[buttons.length - 1];
      if (saveButton) saveButton.click();
    });
  });

  const download = await downloadPromise;
  if (download) {
    return download;
  }

  await page.waitForFunction(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return !Array.from(document.querySelectorAll("div, form, section")).some((node) => {
      if (!visible(node)) return false;
      const text = (node.innerText || node.textContent || "").toUpperCase();
      return text.includes("JPG") && text.includes("PNG") && node.querySelectorAll("input[type='radio']").length >= 2;
    });
  }, { timeout: 5000 }).catch(() => {});

  return true;
}

async function closeDownloadSettingsModal(page, logger) {
  const modalDetected = await page.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return Array.from(document.querySelectorAll("div, form, section")).some((node) => {
      if (!visible(node)) return false;
      const text = (node.innerText || node.textContent || "").toUpperCase();
      return text.includes("JPG") && text.includes("PNG") && node.querySelectorAll("input[type='radio']").length >= 2;
    });
  }).catch(() => false);

  if (!modalDetected) {
    return false;
  }

  logger.warn("Download settings modal is open. Closing it before clicking the real download button.");

  const closeTarget = await page.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], svg, span, div"))
      .filter(visible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim();
        return { node, rect, text };
      })
      .filter((item) => {
        const nearCenterTop = item.rect.left > window.innerWidth * 0.45
          && item.rect.left < window.innerWidth * 0.75
          && item.rect.top > window.innerHeight * 0.15
          && item.rect.top < window.innerHeight * 0.45;
        const looksClose = item.text === "X" || item.text === "\u00d7" || item.text.includes("\u5173\u95ed");
        return looksClose || (nearCenterTop && item.rect.width >= 20 && item.rect.width <= 60 && item.rect.height >= 20 && item.rect.height <= 60);
      });

    const target = candidates[0];
    if (!target) return null;
    return {
      x: target.rect.left + target.rect.width / 2,
      y: target.rect.top + target.rect.height / 2,
      text: target.text
    };
  }).catch(() => null);

  if (closeTarget) {
    await page.mouse.click(closeTarget.x, closeTarget.y).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }

  await page.waitForTimeout(500).catch(() => {});
  return true;
}

async function clickAndWaitForDownload(page, locator, timeoutMs, config, logger) {
  const attempts = Number(config.download_click_retries || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await closeUnexpectedPages(page, config, logger, "before download click");
    await closeDownloadSettingsModal(page, logger);

    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs })
      .then((download) => ({ type: "download", download }))
      .catch((error) => ({ type: "error", error }));
    const popupPromise = waitForPopupOrTimeout(page, config, logger, Number(config.popup_wait_ms || 2500))
      .then((popup) => ({ type: "popup", popup }));

    try {
      logger.info("Clicking download control", { attempt, attempts });
      await locator.click({ timeout: 10000 });
      const result = await Promise.race([downloadPromise, popupPromise]);

      if (result.type === "download") {
        return result.download;
      }

      if (await closeDownloadSettingsModal(page, logger)) {
        await sleep(500);
        continue;
      }

      if (result.type === "popup" && result.popup) {
        lastError = new Error("Download click opened an ad popup instead of a download");
        await sleep(Number(config.after_popup_retry_delay_ms || 1000));
        continue;
      }

      if (result.type === "error") {
        lastError = result.error;
        if (await closeDownloadSettingsModal(page, logger)) {
          await sleep(500);
          continue;
        }
      }
    } catch (error) {
      lastError = error;
      if (await closeDownloadSettingsModal(page, logger)) {
        await sleep(500);
        continue;
      }
    } finally {
      downloadPromise.catch(() => {});
      popupPromise.catch(() => {});
      await closeUnexpectedPages(page, config, logger, "after download click");
    }
  }

  throw lastError || new Error("Download click did not produce a download.");
}

async function clickLikelyPngDownloadByCoordinates(page, timeoutMs, config, logger) {
  const attempts = Number(config.download_click_retries || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await closeUnexpectedPages(page, config, logger, "before coordinate download click");
    await closeDownloadSettingsModal(page, logger);

    const target = await page.evaluate(() => {
      const visible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 20
          && rect.height > 15
          && style.display !== "none"
          && style.visibility !== "hidden"
          && style.pointerEvents !== "none";
      };

      const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"))
        .filter(visible)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const text = [
            node.innerText || node.textContent || "",
            node.getAttribute("aria-label") || "",
            node.getAttribute("title") || ""
          ].join(" ").trim();
          return {
            node,
            rect,
            text,
            upper: text.toUpperCase(),
            cursor: style.cursor,
            backgroundColor: style.backgroundColor
          };
        })
        .filter((item) => {
          const clickable = ["BUTTON", "A"].includes(item.node.tagName)
            || item.node.getAttribute("role") === "button"
            || item.cursor === "pointer"
            || typeof item.node.onclick === "function";
          if (!clickable) return false;
          if (item.upper.includes("\u8bbe\u7f6e") || item.upper.includes("SETTING") || item.upper.includes("\u590d\u5236")) return false;
          const hasPng = item.upper.includes("PNG");
          const hasDownload = item.upper.includes("\u4e0b\u8f7d");
          const hasLarge = item.upper.includes("\u9ad8\u6e05") || item.upper.includes("\u5927\u56fe");
          return hasPng && (hasDownload || hasLarge);
        })
        .sort((a, b) => {
          const score = (item) => {
            let value = 0;
            if (item.upper.includes("\u4e0b\u8f7d\u9ad8\u6e05")) value += 20;
            if (item.upper.includes("PNG")) value += 10;
            if (item.backgroundColor.includes("59, 130, 246") || item.backgroundColor.includes("37, 99, 235") || item.backgroundColor.includes("22, 119, 255")) value += 5;
            if (item.rect.top < window.innerHeight * 0.8) value += 3;
            if (item.rect.left > window.innerWidth * 0.45) value += 2;
            return value;
          };
          return score(b) - score(a);
        });

      const target = candidates[0];
      if (!target) return null;
      target.node.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.node.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: target.text,
        width: rect.width,
        height: rect.height
      };
    }).catch((error) => {
      logger.warn("Coordinate download target lookup failed", { error: error.message });
      return null;
    });

    if (!target) {
      lastError = new Error("No visible PNG download button found by coordinates");
      break;
    }

    logger.info("Clicking PNG download button by coordinates", { attempt, attempts, target });
    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs })
      .then((download) => ({ type: "download", download }))
      .catch((error) => ({ type: "error", error }));
    const popupPromise = waitForPopupOrTimeout(page, config, logger, Number(config.popup_wait_ms || 2500))
      .then((popup) => ({ type: "popup", popup }));

    await page.mouse.click(target.x, target.y).catch((error) => {
      lastError = error;
    });

    const result = await Promise.race([downloadPromise, popupPromise]);
    if (result.type === "download") {
      return result.download;
    }

    if (await closeDownloadSettingsModal(page, logger)) {
      await sleep(500);
      continue;
    }

    if (result.type === "popup" && result.popup) {
      lastError = new Error("Coordinate download click opened an ad popup instead of a download");
      await sleep(Number(config.after_popup_retry_delay_ms || 1000));
      continue;
    }

    if (result.type === "error") {
      lastError = result.error;
    }
  }

  throw lastError || new Error("Coordinate PNG download click did not produce a download.");
}

function uniquePath(dir, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(dir, filename);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function isSupportedDownloadedImage(filePath) {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(filePath).toLowerCase());
}

function extractZip(zipPath, destinationDir, logger) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destinationDir, true);

  const images = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (isSupportedDownloadedImage(entryPath)) {
        images.push(entryPath);
      }
    }
  };

  visit(destinationDir);
  const sorted = images.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
  logger.info("Zip extracted", { zipPath, extractedImages: sorted });
  return sorted;
}

function renameDownloadedPngs(downloadedPngs, batch, logger) {
  const successes = [];
  const failures = [];
  const usableCount = Math.min(downloadedPngs.length, batch.length);

  if (downloadedPngs.length !== batch.length) {
    logger.warn("Downloaded file count differs from uploaded count", {
      uploaded: batch.length,
      downloaded: downloadedPngs.length
    });
  }

  for (let i = 0; i < usableCount; i += 1) {
    const image = batch[i];
    fs.mkdirSync(path.dirname(image.outputPath), { recursive: true });
    fs.copyFileSync(downloadedPngs[i], image.outputPath);
    logger.info("Downloaded result renamed", {
      sourceDownload: downloadedPngs[i],
      output: image.outputPath,
      originalInput: image.name
    });
    successes.push(image);
  }

  for (let i = usableCount; i < batch.length; i += 1) {
    failures.push({ image: batch[i], reason: "No matching downloaded result" });
  }

  return { successes, failures };
}

async function saveDownload(download, batchTempDir, fallbackName, logger) {
  const suggested = download.suggestedFilename() || fallbackName;
  const downloadPath = uniquePath(batchTempDir, suggested);
  await download.saveAs(downloadPath);
  logger.info("Download saved", { suggestedFilename: suggested, downloadPath });
  return downloadPath;
}

function mapDownloadedFiles(downloadedFiles, batch, batchTempDir, logger) {
  const pngs = [];

  for (const downloadedFile of downloadedFiles) {
    if (downloadedFile.toLowerCase().endsWith(".zip")) {
      const extractedDir = uniquePath(batchTempDir, "unzipped");
      fs.mkdirSync(extractedDir, { recursive: true });
      pngs.push(...extractZip(downloadedFile, extractedDir, logger));
    } else if (isSupportedDownloadedImage(downloadedFile)) {
      pngs.push(downloadedFile);
    } else {
      logger.warn("Downloaded file is not a supported image or zip", { downloadedFile });
    }
  }

  return renameDownloadedPngs(pngs, batch, logger);
}

async function tryDownloadAll(page, batch, batchTempDir, config, logger) {
  const timeoutMs = Number(config.download_event_timeout_seconds || config.download_timeout_seconds) * 1000;

  for (const selector of config.selectors.downloadAll || []) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0) === 0) {
      continue;
    }

    try {
      logger.info("Trying batch download", { selector });
      if (!(await locatorIsDownloadControl(locator))) {
        logger.warn("Batch download control is not visible or enabled", { selector });
        continue;
      }
      const download = await clickAndWaitForDownload(page, locator, timeoutMs, config, logger);
      const downloadPath = await saveDownload(download, batchTempDir, "koukoutu-download.zip", logger);
      return mapDownloadedFiles([downloadPath], batch, batchTempDir, logger);
    } catch (error) {
      logger.warn("Batch download attempt failed", { selector, error: error.message });
    }
  }

  return null;
}

async function downloadSingles(page, batch, batchTempDir, config, logger) {
  const timeoutMs = Number(config.download_event_timeout_seconds || config.download_timeout_seconds) * 1000;
  const downloads = [];

  for (const selector of config.selectors.downloadSingle || []) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    if (count === 0) {
      continue;
    }

    logger.info("Trying single downloads", { selector, count });
    const usableCount = Math.min(count, batch.length);

    for (let i = 0; i < usableCount; i += 1) {
      try {
        if (!(await locatorIsDownloadControl(locators.nth(i)))) {
          logger.warn("Single download control is not a real PNG download button", { index: i + 1, selector });
          continue;
        }
        const download = await clickAndWaitForDownload(page, locators.nth(i), timeoutMs, config, logger);
        const downloadPath = await saveDownload(download, batchTempDir, `download-${i + 1}.png`, logger);
        downloads.push(downloadPath);
      } catch (error) {
        logger.warn("Single download failed", { index: i + 1, selector, error: error.message });
      }
    }

    if (downloads.length > 0) {
      break;
    }
  }

  if (downloads.length === 0) {
    try {
      logger.info("Trying coordinate-based PNG download button");
      const download = await clickLikelyPngDownloadByCoordinates(page, timeoutMs, config, logger);
      const downloadPath = await saveDownload(download, batchTempDir, "download-1.png", logger);
      downloads.push(downloadPath);
    } catch (error) {
      logger.warn("Coordinate-based PNG download failed", { error: error.message });
    }
  }

  return downloads;
}

async function manualDownloadFallback(page, batch, batchTempDir, config, logger, existingDownloads = []) {
  if (!config.manual_download_fallback) {
    return null;
  }

  const timeoutSeconds = Number(config.manual_download_timeout_seconds || config.download_timeout_seconds || 300);
  const timeoutMs = timeoutSeconds * 1000;
  const downloads = [...existingDownloads];

  logger.warn("Automatic download did not produce enough files. Switching to manual download listener.", {
    expectedCount: batch.length,
    existingDownloads: existingDownloads.length,
    timeoutSeconds
  });

  await saveDebugSnapshot(page, batchTempDir, "before-manual-download", config, logger);

  for (let i = existingDownloads.length; i < batch.length; i += 1) {
    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs }).catch((error) => {
      logger.warn("Manual download listener timed out", { index: i + 1, error: error.message });
      return null;
    });

    await askEnter(
      `\u8bf7\u5728\u6d4f\u89c8\u5668\u91cc\u624b\u52a8\u70b9\u51fb\u4e0b\u8f7d\u6309\u94ae\uff08\u7b2c ${i + 1}/${batch.length} \u4e2a\uff0c\u53ef\u4ee5\u662f\u6253\u5305\u4e0b\u8f7d\uff09\uff0c\u70b9\u5b8c\u540e\u56de\u5230\u8fd9\u91cc\u6309 Enter\u3002`
    );

    const download = await downloadPromise;
    if (!download) {
      break;
    }

    const downloadPath = await saveDownload(download, batchTempDir, `manual-download-${i + 1}.png`, logger);
    downloads.push(downloadPath);

    if (downloadPath.toLowerCase().endsWith(".zip")) {
      break;
    }
  }

  if (downloads.length === 0) {
    return null;
  }

  return mapDownloadedFiles(downloads, batch, batchTempDir, logger);
}

async function downloadResults(page, batch, batchTempDir, config, logger) {
  await pauseForManualInterventionIfNeeded(page, config, logger);
  await saveDebugSnapshot(page, batchTempDir, "before-download", config, logger);

  if (batch.length > 1) {
    const batchResult = await tryDownloadAll(page, batch, batchTempDir, config, logger);
    if (batchResult) {
      return batchResult;
    }
  }

  const singleDownloads = await downloadSingles(page, batch, batchTempDir, config, logger);
  const singlesResult = mapDownloadedFiles(singleDownloads, batch, batchTempDir, logger);
  if (singlesResult.successes.length === batch.length) {
    return singlesResult;
  }

  const manualResult = await manualDownloadFallback(page, batch, batchTempDir, config, logger, singleDownloads);
  if (manualResult) {
    return manualResult;
  }

  await saveDebugSnapshot(page, batchTempDir, "download-failed", config, logger);
  return singlesResult;
}

async function processBatch(page, batch, batchId, config, fileManager, logger) {
  const batchTempDir = fileManager.cleanBatchTemp(batchId);
  logger.info("Batch temp directory prepared", { batchId, batchTempDir });
  await navigateToTool(page, config, logger);
  await uploadFiles(page, batch, config, logger);
  await saveDebugSnapshot(page, batchTempDir, "after-upload", config, logger);
  await clickStartProcessing(page, config, logger);
  await saveDebugSnapshot(page, batchTempDir, "after-start-processing", config, logger);
  await waitForProcessing(page, batch.length, config, logger);
  return downloadResults(page, batch, batchTempDir, config, logger);
}

module.exports = { processBatch };

const fs = require("fs");
const path = require("path");

function resolveProjectPath(projectRoot, configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }
  return path.resolve(projectRoot, configuredPath);
}

class FileManager {
  constructor(projectRoot, config) {
    this.projectRoot = projectRoot;
    this.inputDir = resolveProjectPath(projectRoot, config.input_dir);
    this.outputDir = resolveProjectPath(projectRoot, config.output_dir);
    this.failedDir = resolveProjectPath(projectRoot, config.failed_dir);
    this.logsDir = resolveProjectPath(projectRoot, config.logs_dir);
    this.tempDir = resolveProjectPath(projectRoot, config.temp_dir);
    this.browserProfileDir = resolveProjectPath(projectRoot, config.browser_profile_dir);
    this.supportedExtensions = new Set(
      (config.supported_extensions || [".jpg", ".jpeg", ".png", ".webp"])
        .map((extension) => extension.toLowerCase())
    );
  }

  ensureDirs() {
    for (const dir of [
      this.inputDir,
      this.outputDir,
      this.failedDir,
      this.logsDir,
      this.tempDir,
      this.browserProfileDir
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  listInputImages() {
    if (!fs.existsSync(this.inputDir)) {
      return [];
    }

    return fs.readdirSync(this.inputDir)
      .filter((name) => this.supportedExtensions.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .map((name) => ({
        name,
        baseName: path.parse(name).name,
        inputPath: path.join(this.inputDir, name),
        outputPath: path.join(this.outputDir, `${path.parse(name).name}.png`),
        failedPath: path.join(this.failedDir, name)
      }));
  }

  isCompleted(image) {
    return fs.existsSync(image.outputPath) && fs.statSync(image.outputPath).size > 0;
  }

  copyToFailed(image, reason) {
    const reasonFile = path.join(this.failedDir, `${image.baseName}.txt`);
    if (fs.existsSync(image.inputPath)) {
      fs.copyFileSync(image.inputPath, image.failedPath);
    }
    fs.writeFileSync(reasonFile, reason, "utf8");
  }

  cleanBatchTemp(batchId) {
    const dir = path.join(this.tempDir, `batch-${batchId}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = { FileManager, resolveProjectPath };

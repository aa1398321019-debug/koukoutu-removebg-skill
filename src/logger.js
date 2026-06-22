const fs = require("fs");
const path = require("path");

class Logger {
  constructor(logsDir) {
    this.logsDir = logsDir;
    this.logFile = path.join(logsDir, "run.log");
    fs.mkdirSync(logsDir, { recursive: true });
  }

  line(level, message, data = {}) {
    const payload = Object.keys(data).length ? ` ${JSON.stringify(data)}` : "";
    const text = `[${new Date().toISOString()}] [${level}] ${message}${payload}`;
    console.log(text);
    fs.appendFileSync(this.logFile, `${text}\n`, "utf8");
  }

  info(message, data) {
    this.line("INFO", message, data);
  }

  warn(message, data) {
    this.line("WARN", message, data);
  }

  error(message, data) {
    this.line("ERROR", message, data);
  }

  imageStatus(file, status, data = {}) {
    this.info(`IMAGE ${status}: ${file}`, data);
  }
}

module.exports = { Logger };


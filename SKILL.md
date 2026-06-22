# 抠抠图网页版批量抠图 Skill

Use this skill when you need to batch-remove image backgrounds through the public web page:

https://www.koukoutu.com/removebgtool/all

Recommended portable directory: any user-writable project folder. Prefer an English path without special characters when possible.

This skill automates the normal browser workflow only:

1. Open the web page.
2. Upload images from `./input`.
3. Wait for the page to finish AI background removal.
4. Download transparent PNG results into `./output`.

It must not bypass captchas, login, paid limits, rate limits, or hidden/private APIs. If the page asks for login, verification, payment, or another manual confirmation, pause and ask the user to finish it in the browser, then continue after Enter is pressed in the terminal.

## Portable Project Rules

- Use only relative paths from `config.json`.
- Keep browser state in `./browser_profile`.
- Do not hard-code local absolute paths.
- Use Playwright browser automation, not screen coordinates.
- Prefer stable selectors: `input[type=file]`, visible text, aria labels, CSS selectors.
- If selectors break after a web page update, edit the `selectors` section in `config.json`.

## Run

Install once:

```bash
npm install
npx playwright install chromium
```

Then run:

```bash
npm run start
```

On Windows, use:

```bat
setup.bat
run.bat
```

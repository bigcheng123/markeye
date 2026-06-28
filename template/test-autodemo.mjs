/**
 * 无头浏览器运行 UI autodemo 验证
 * 用法: node template/test-autodemo.mjs
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9876;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = req.url.split("?")[0];
      if (path === "/") path = "/template/index.html";
      const filePath = join(ROOT, path.replace(/^\//, ""));
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const logs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[ui-demo]")) logs.push(text);
  });

  await page.goto(`http://127.0.0.1:${PORT}/template/index.html?autodemo=1`, {
    waitUntil: "networkidle",
  });

  await page.waitForFunction(
    () => document.body.innerText.includes("全部通过") || document.body.innerText.includes("项失败"),
    { timeout: 60000 },
  );

  const toastText = await page.locator("#toast-container").innerText();
  const failed = logs.filter((l) => l.includes("✗"));
  const passed = logs.filter((l) => l.includes("✓"));

  console.log("--- autodemo logs ---");
  logs.forEach((l) => console.log(l));
  console.log("--- toast ---");
  console.log(toastText);
  console.log(`--- result: ${passed.length} passed, ${failed.length} failed ---`);

  await browser.close();
  server.close();

  if (failed.length > 0 || !toastText.includes("通过")) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Run after npm run build. Uses installed Chrome or Playwright Chromium.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = "/drunk-drawing/";
let updated = false;
const types = { html: "text/html", js: "text/javascript", css: "text/css", webmanifest: "application/manifest+json", png: "image/png", mp3: "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<title>Activation observer</title>"); return; }
    if (!path.startsWith(base) || path.includes("..")) throw Error("Outside scope");
    const file = path.slice(base.length) || "index.html";
    let body = await readFile(new URL(`../dist/${file}`, import.meta.url));
    // A changed worker simulates a deployment without touching the build.
    if (updated && file === "index.html") body = Buffer.concat([body, Buffer.from("\n<!-- deployment two -->\n")]);
    if (updated && file === "sw.js") body = Buffer.from(body.toString().replace(
      /"revision":"[a-f0-9]+","url":"index.html"/,
      '"revision":"deployment-two","url":"index.html"',
    ));
    res.writeHead(200, { "Content-Type": types[file.split(".").at(-1)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${base}`;
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  let context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  context.setDefaultTimeout(15000);
  let page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  console.log("Checking initial installation…");
  await page.waitForFunction(() => document.querySelector("[data-pwa-status]").textContent === "Ready for offline play.");
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), url);
  const manifest = await page.evaluate(async () => (await fetch("manifest.webmanifest")).json());
  assert.equal(manifest.display, "standalone");
  assert.equal(new URL(manifest.start_url, url).href, url);
  assert.equal(new URL(manifest.scope, url).href, url);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
  const files = await readdir(new URL("../dist/assets/", import.meta.url));
  const checks = ["index.html", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", ...files.map(file => `assets/${file}`)];
  await context.setOffline(true);
  console.log("Checking offline assets and audio…");
  await page.reload();
  for (const file of checks) {
    assert.equal(await page.evaluate(async file => (await fetch(file)).ok, file), true, `${file} offline`);
  }
  const audio = `assets/${files.find(file => file.endsWith(".mp3"))}`;
  assert.deepEqual(await page.evaluate(async audio => {
    const res = await fetch(audio, { headers: { Range: "bytes=0-99" } });
    return [res.status, (await res.arrayBuffer()).byteLength];
  }, audio), [206, 100]);
  await page.locator("[data-next]").click();
  await page.locator("[data-peek]").dispatchEvent("pointerdown", { pointerId: 1 });
  await page.locator("[data-peek]").dispatchEvent("pointerup", { pointerId: 1 });
  await page.locator("[data-next]").click();
  await page.locator(".bad-draw-play:not([hidden])").waitFor();
  const canvas = page.locator(".bad-draw-sheet canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.setViewportSize({ width: 1180, height: 820 });
  assert.equal(await page.locator(".bad-draw-play").isVisible(), true);
  await context.setOffline(false);
  assert.equal(await page.evaluate(async () => (await fetch("manifest.webmanifest")).ok), true);
  await context.close();
  // Isolate update testing from Chromium's emulated offline network backoff.
  context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  context.setDefaultTimeout(15000);
  page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("[data-pwa-status]").textContent === "Ready for offline play.");
  await page.reload();
  await page.locator("[data-next]").click();
  await page.locator("[data-peek]").dispatchEvent("pointerdown", { pointerId: 1 });
  await page.locator("[data-peek]").dispatchEvent("pointerup", { pointerId: 1 });
  await page.locator("[data-next]").click();
  console.log("Checking waiting update during a round…");
  updated = true;
  let timeout;
  try {
    await Promise.race([
      page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("Update check timed out")), 15000); }),
    ]);
  } finally { clearTimeout(timeout); }
  console.log("Update check completed…");
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).waiting);
  console.log("Update is waiting; closing the game…");
  assert.equal(await page.locator(".bad-draw-play").isVisible(), true, "update preserves gameplay");
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), true);
  await page.close();
  // Wait for activation after the last controlled window closes.
  page = await context.newPage();
  // Outside the game scope, observe activation without creating an old client.
  await page.goto(new URL("../", url).href);
  await page.waitForFunction(async url => !(await navigator.serviceWorker.getRegistration(url))?.waiting, url);
  await page.goto(url);
  await page.waitForFunction(async () => !(await navigator.serviceWorker.ready).waiting);
  await context.setOffline(true);
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  await page.locator("[data-next]").waitFor();
  assert.match(await page.evaluate(async () => (await fetch("index.html")).text()), /deployment two/);
  assert.deepEqual(errors, []);
  console.log("PASS: subdirectory scope, all assets offline, audio ranges, offline round, waiting update, next-launch activation, offline reopen.");
} finally {
  await browser?.close();
  server.close();
}

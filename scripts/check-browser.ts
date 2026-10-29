import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserManager } from "../src/server/browser/browser-manager.js";
import type { AppStore } from "../src/server/store.js";

// Exercise the production browser manager with an isolated profile and no
// external website, account, or browser download.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-browser-smoke-"));
process.env.DOUYIN_DATA_DIR = directory;
let manager: BrowserManager | undefined;
let store: AppStore | undefined;
try {
  const { BrowserManager } = await import("../src/server/browser/browser-manager.js");
  const { appStore } = await import("../src/server/store.js");
  store = appStore;
  manager = new BrowserManager();
  const page = await manager.getPage();
  await page.goto("data:text/html,<title>Scraper browser check</title>");
  const features = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    languages: [...navigator.languages],
    plugins: navigator.plugins.length,
  }));
  assert.notEqual(features.webdriver, true);
  assert.ok(features.languages.length > 0);
  const browser = manager.getOpenBrowser()!;
  await browser.defaultBrowserContext().setCookie({
    name: "scraper_test", value: "persistent", domain: "scraper.invalid", path: "/",
    expires: Math.floor(Date.now() / 1000) + 3600,
  });
  const version = await browser.version();
  await manager.close();
  const reopened = await manager.getBrowser();
  assert.ok((await reopened.defaultBrowserContext().cookies())
    .some((cookie) => cookie.name === "scraper_test" && cookie.value === "persistent"));
  console.log(JSON.stringify({ version, dependency: manager.getBrowserDependencyState(), features, cookiePersisted: true }, null, 2));
} finally {
  await manager?.close();
  await store?.close();
  await fs.rm(directory, { recursive: true, force: true });
}

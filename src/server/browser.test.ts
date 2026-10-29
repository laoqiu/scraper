import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { browserExecutableCandidates, findBrowserExecutable } from "./browser/browser-executable.js";

test("explicit browser paths take precedence and invalid paths do not silently fall back", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-browser-"));
  const executable = path.join(directory, "browser with spaces.exe");
  try {
    await fs.writeFile(executable, "test executable");
    await fs.chmod(executable, 0o755);
    assert.equal(await findBrowserExecutable({ DOUYIN_BROWSER_EXECUTABLE: ` ${executable} ` }), executable);
    await assert.rejects(findBrowserExecutable({ DOUYIN_BROWSER_EXECUTABLE: directory }), /DOUYIN_BROWSER_EXECUTABLE/);
    await assert.rejects(findBrowserExecutable({ DOUYIN_BROWSER_EXECUTABLE: path.join(directory, "missing.exe") }), /DOUYIN_BROWSER_EXECUTABLE/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("missing installed browsers return actionable guidance without downloading", async () => {
  await assert.rejects(findBrowserExecutable({}, "win32", "unused"), /DOUYIN_BROWSER_EXECUTABLE.*不会下载浏览器内核/);
});

test("Windows discovery finds a per-user Edge installation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-edge-"));
  const executable = path.join(directory, "Microsoft", "Edge", "Application", "msedge.exe");
  try {
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, "test executable");
    await fs.chmod(executable, 0o755);
    // Use the current platform's file paths for this filesystem test.
    if (process.platform === "win32") {
      assert.equal(await findBrowserExecutable({ LOCALAPPDATA: directory }, "win32"), executable);
    }
    assert.ok(browserExecutableCandidates("win32", { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" }, "")
      .includes("C:\\Users\\example\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("macOS and Linux discovery cover installed browsers and ignore relative PATH entries", () => {
  assert.ok(browserExecutableCandidates("darwin", {}, "/Users/example")
    .includes("/Users/example/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  const candidates = browserExecutableCandidates("linux", { PATH: "/opt/browser/bin:.:relative:/opt/browser/bin" }, "/home/example");
  assert.ok(candidates.includes("/opt/browser/bin/google-chrome"));
  assert.ok(candidates.includes("/snap/bin/chromium"));
  assert.ok(candidates.every((candidate) => path.posix.isAbsolute(candidate)));
  assert.equal(new Set(candidates).size, candidates.length);
});

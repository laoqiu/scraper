import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type BrowserEnvironment = Record<string, string | undefined>;

export function browserExecutableCandidates(
  platform: NodeJS.Platform,
  env: BrowserEnvironment,
  homeDirectory: string,
): string[] {
  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.ProgramW6432]
      .filter((value): value is string => Boolean(value));
    return [...new Set(roots.flatMap((directory) => [
      path.win32.join(directory, "Google", "Chrome", "Application", "chrome.exe"),
      path.win32.join(directory, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.win32.join(directory, "Chromium", "Application", "chrome.exe"),
    ]))];
  }
  if (platform === "darwin") {
    return ["/Applications", path.posix.join(homeDirectory, "Applications")].flatMap((directory) => [
      path.posix.join(directory, "Google Chrome.app/Contents/MacOS/Google Chrome"),
      path.posix.join(directory, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
      path.posix.join(directory, "Chromium.app/Contents/MacOS/Chromium"),
    ]);
  }
  const directories = [...new Set([...(env.PATH ?? "").split(":"), "/usr/bin", "/usr/local/bin", "/snap/bin"])]
    .filter((directory) => path.posix.isAbsolute(directory));
  return directories.flatMap((directory) => [
    "google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge-stable", "microsoft-edge",
  ].map((name) => path.posix.join(directory, name)));
}

async function isExecutableFile(filename: string): Promise<boolean> {
  try {
    if (!(await fs.stat(filename)).isFile()) return false;
    await fs.access(filename, constants.X_OK);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

/** Resolve an installed browser only. Never install or download a browser. */
export async function findBrowserExecutable(
  env: BrowserEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir(),
): Promise<string> {
  const configured = env.DOUYIN_BROWSER_EXECUTABLE?.trim();
  if (configured) {
    const executable = path.resolve(configured);
    if (await isExecutableFile(executable)) return executable;
    throw new Error(`DOUYIN_BROWSER_EXECUTABLE 指定的浏览器不可执行或不存在：${executable}。请填写本机 Chrome、Edge 或 Chromium 可执行文件的完整路径。`);
  }
  for (const candidate of browserExecutableCandidates(platform, env, homeDirectory)) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  throw new Error("未找到本机 Chrome、Edge 或 Chromium。请先安装其中一种浏览器，或通过 DOUYIN_BROWSER_EXECUTABLE 指定可执行文件的完整路径；插件不会下载浏览器内核。");
}

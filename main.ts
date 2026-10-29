import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { browserManager, videoProxy } from "./src/server/browser/index.js";
import { exportJobs } from "./src/server/video-export.js";
import { HttpAppServer } from "./src/server/http-app.js";
import { configureRuntimeMode } from "./src/server/runtime-mode.js";

// MCP stdio reserves stdout for protocol frames.
console.log = console.error;
console.info = console.error;

async function main(): Promise<void> {
  // Discover an installed browser without launching it or downloading a binary.
  void browserManager.prepareBrowser();
  const uiEnabled = process.argv.includes("--ui");
  const server = createServer({ ui: uiEnabled });
  // The two App modes are mutually exclusive. The default mode exposes the
  // standalone HTTP App; --ui exposes MCP Apps resources and only the video
  // proxy remains available as a local HTTP service.
  const httpApp = uiEnabled ? undefined : new HttpAppServer(() => createServer({ ui: false }));
  const baseUrl = httpApp ? await httpApp.start() : undefined;
  configureRuntimeMode({ mode: uiEnabled ? "ui" : "http", httpBaseUrl: baseUrl });
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    exportJobs.abort();
    await browserManager.close().catch((error) => console.error("[scraper] browser close failed", error));
    await exportJobs.close().catch((error) => console.error("[scraper] export close failed", error));
    await videoProxy.close().catch((error) => console.error("[scraper] video proxy close failed", error));
    await server.close().catch((error) => console.error("[scraper] server close failed", error));
    await httpApp?.close().catch((error) => console.error("[scraper] HTTP App close failed", error));
  };
  const stopAndExit = (): void => {
    void stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", stopAndExit);
  process.once("SIGTERM", stopAndExit);
  process.stdin.once("end", stopAndExit);
  process.stdin.once("close", stopAndExit);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[scraper] fatal", error);
  process.exitCode = 1;
});

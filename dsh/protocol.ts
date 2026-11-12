import { z } from "zod";

export const CHANNEL = "/api";
export const RESOURCE = "scraper/resource";
export const CALL_TOOL = "scraper/call-tool";

export const appPath = z.enum([
  "/search_videos", "/search_users", "/login",
  "/xiaohongshu/search_videos", "/xiaohongshu/search_users", "/xiaohongshu/login",
]);

export const toolCall = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

// Only CSP origins declared by the bundled scraper resource are forwarded.
const source = z.string().regex(/^https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::[0-9]+)?$/i);
export const resourceCsp = z.object({
  connectDomains: z.array(source).default([]),
  resourceDomains: z.array(source).default([]),
});

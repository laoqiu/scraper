import os from "node:os";
import path from "node:path";
import type { PersistedState } from "./types.js";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_ROW_ID = 1;
const DATA_DIRECTORY_NAME = "douyin";

export function initialState(): PersistedState {
  return {
    login: {
      status: "idle",
      message: "尚未检查登录状态",
      updatedAt: new Date().toISOString(),
    },
    browser: {
      captchaDetected: false,
    },
    videoProgress: {
      status: "idle",
      pages: 0,
      maxPages: 10,
      itemCount: 0,
    },
    userProgress: {
      status: "idle",
      pages: 0,
      maxPages: 10,
      itemCount: 0,
    },
  };
}

export function defaultDataDirectory(): string {
  const configured = process.env.DOUYIN_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), DATA_DIRECTORY_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", DATA_DIRECTORY_NAME);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), DATA_DIRECTORY_NAME);
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function boolFromSqlite(value: number | null | undefined): boolean | undefined {
  return value === null || value === undefined ? undefined : value === 1;
}

export function queryKey(value: unknown): string {
  return JSON.stringify(value);
}

export function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

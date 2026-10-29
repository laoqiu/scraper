import type { PlatformId } from "../types.js";

export interface PlatformMediaRequest {
  referer: string;
  origin: string;
  allowedHosts: readonly string[];
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly displayName: string;
  readonly media: PlatformMediaRequest;
  readonly homepage: string;
  videoSearchUrl(keyword: string): string;
  userSearchUrl(keyword: string): string;
  isMediaUrlSupported(url: string): boolean;
}

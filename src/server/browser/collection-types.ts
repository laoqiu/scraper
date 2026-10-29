import type { HTTPResponse, Page } from "puppeteer-core";
import type {
  DouyinUser,
  DouyinVideo,
  UserDetailInput,
  UserSearchInput,
  VideoSearchInput,
} from "../types.js";

export interface ActiveVideoSearch {
  jobId: string;
  key: string;
  page: Page;
  input: VideoSearchInput;
  items: Map<string, DouyinVideo>;
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  captureEnabled: boolean;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  loadedPages: number;
  hasMore: boolean;
  terminal: boolean;
}

export interface ActiveUserSearch {
  jobId: string;
  key: string;
  page: Page;
  input: UserSearchInput;
  items: Map<string, DouyinUser>;
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  captureEnabled: boolean;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  loadedPages: number;
  hasMore: boolean;
  running: boolean;
  terminal: boolean;
}

export interface ActiveUserDetail {
  jobId: string;
  page: Page;
  input: UserDetailInput;
  items: Map<string, DouyinVideo>;
  user?: DouyinUser;
  author?: Record<string, unknown>;
  awemeList: unknown[];
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  loadedPages: number;
  hasMore: boolean;
  terminal: boolean;
}

export function videoSearchKey(input: VideoSearchInput): string {
  return JSON.stringify({ keyword: input.keyword, filters: input.filters });
}

export function userSearchKey(input: UserSearchInput): string {
  return JSON.stringify({ keyword: input.keyword, filters: input.filters });
}

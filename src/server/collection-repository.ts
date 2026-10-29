import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { schema, type AppDatabase } from "./db/index.js";
import type {
  DouyinUser,
  UserCollectionResult,
  UserDetailCache,
  UserDetailCollectionResult,
  VideoCollectionResult,
} from "./types.js";
import { boolFromSqlite, CACHE_TTL_MS, jsonParse, queryKey } from "./store-helpers.js";

type CollectionSession = typeof schema.collectionSessions.$inferSelect;
type PutStateValue = (key: string, value: unknown) => void;

/**
 * Stores only operation metadata in SQLite. Collection payloads are written
 * to JSON files and referenced by collection_sessions.result_path.
 */
export class CollectionRepository {
  private readonly resultRoot: string;

  constructor(
    private readonly db: AppDatabase,
    private readonly rawDb: Database.Database,
    private readonly putStateValue: PutStateValue,
    dataRoot: string,
  ) {
    this.resultRoot = path.join(dataRoot, "results");
  }

  persistVideoResult(result: VideoCollectionResult, status: string, maxPages: number): void {
    const key = queryKey({ keyword: result.keyword, filters: result.filters });
    const sessionId = result.jobId || this.findOrCreateSession("videos", key);
    const storedResult = result.jobId ? result : { ...result, jobId: sessionId };
    const resultPath = this.writeResultFile("videos", sessionId, storedResult);
    this.persistSession(sessionId, "videos", key, {
      keyword: result.keyword,
      filtersJson: JSON.stringify(result.filters),
      pages: result.pages ?? 0,
      maxPages,
      hasMore: result.hasMore,
      status,
      collectedAt: result.collectedAt,
      resultPath,
    });
    this.putStateValue("activeVideoSession", sessionId);
  }

  persistUserResult(result: UserCollectionResult, status: string, maxPages: number): void {
    const key = queryKey({ keyword: result.keyword, filters: result.filters });
    const sessionId = result.jobId || this.findOrCreateSession("users", key);
    const storedResult = result.jobId ? result : { ...result, jobId: sessionId };
    const resultPath = this.writeResultFile("users", sessionId, storedResult);
    this.persistSession(sessionId, "users", key, {
      keyword: result.keyword,
      filtersJson: JSON.stringify(result.filters),
      pages: result.pages ?? 0,
      maxPages,
      hasMore: result.hasMore,
      status,
      collectedAt: result.collectedAt,
      resultPath,
    });
    this.putStateValue("activeUserSession", sessionId);
  }

  persistUserDetailResult(result: UserDetailCollectionResult, status: string, maxPages: number): void {
    const key = queryKey({ secUid: result.secUid });
    const sessionId = result.jobId || this.findOrCreateSession("user-detail", key);
    const storedResult = result.jobId ? result : { ...result, jobId: sessionId };
    const resultPath = this.writeResultFile("user-detail", sessionId, storedResult);
    this.persistSession(sessionId, "user-detail", key, {
      secUid: result.secUid,
      pages: result.pages ?? 0,
      maxPages,
      hasMore: result.hasMore,
      status,
      collectedAt: result.collectedAt,
      resultPath,
    });
    this.putStateValue("activeUserDetailSession", sessionId);
  }

  readSession(id: string): CollectionSession | undefined {
    return this.db.select().from(schema.collectionSessions).where(eq(schema.collectionSessions.id, id)).get();
  }

  readVideoResult(session: CollectionSession): VideoCollectionResult {
    const stored = session.resultPath ? this.readJson<VideoCollectionResult>(session.resultPath) : undefined;
    if (stored) return { ...stored, jobId: stored.jobId || session.id };
    return stored ?? {
      kind: "videos",
      jobId: session.id,
      keyword: session.keyword ?? "",
      filters: jsonParse<VideoCollectionResult["filters"]>(session.filtersJson, {
        sort: "general",
        publishTime: "all",
        duration: "all",
        searchScope: "all",
        contentType: "all",
      }),
      items: [],
      collectedAt: session.collectedAt ?? new Date(session.updatedAt).toISOString(),
      pages: session.pages,
      hasMore: boolFromSqlite(session.hasMore),
    };
  }

  readUserResult(session: CollectionSession): UserCollectionResult {
    const stored = session.resultPath ? this.readJson<UserCollectionResult>(session.resultPath) : undefined;
    if (stored) return { ...stored, jobId: stored.jobId || session.id };
    return {
      kind: "users",
      jobId: session.id,
      keyword: session.keyword ?? "",
      filters: jsonParse<UserCollectionResult["filters"]>(session.filtersJson, { followerCount: "all", userType: "all" }),
      items: [],
      collectedAt: session.collectedAt ?? new Date(session.updatedAt).toISOString(),
      pages: session.pages,
      hasMore: boolFromSqlite(session.hasMore),
    };
  }

  readUserDetailResult(session: CollectionSession, currentUser?: DouyinUser): UserDetailCollectionResult {
    const stored = session.resultPath ? this.readJson<UserDetailCollectionResult>(session.resultPath) : undefined;
    if (stored) return { ...stored, jobId: stored.jobId || session.id };
    return {
      kind: "user-detail",
      jobId: session.id,
      secUid: session.secUid ?? "",
      user: currentUser,
      items: [],
      collectedAt: session.collectedAt ?? new Date(session.updatedAt).toISOString(),
      pages: session.pages,
      hasMore: boolFromSqlite(session.hasMore),
    };
  }

  async loadUserDetailCache(secUid: string): Promise<UserDetailCache | undefined> {
    const payload = this.readJson<UserDetailCache>(this.userDetailCachePath(secUid));
    return payload?.sec_uid === secUid ? payload : undefined;
  }

  async saveUserDetailCache(secUid: string, cache: UserDetailCache): Promise<string> {
    const target = this.userDetailCachePath(secUid);
    this.writeJson(target, cache);
    return target;
  }

  cleanupExpiredCaches(): void {
    const now = Date.now();
    const expired = this.rawDb.prepare(
      "SELECT id, result_path FROM collection_sessions WHERE expires_at < ?",
    ).all(now) as Array<{ id: string; result_path?: string | null }>;
    for (const session of expired) {
      if (session.result_path) this.removeFile(session.result_path);
    }
    this.rawDb.prepare("DELETE FROM collection_sessions WHERE expires_at < ?").run(now);
  }

  private findOrCreateSession(kind: string, key: string): string {
    const activeKey = kind === "videos"
      ? "activeVideoSession"
      : kind === "users"
        ? "activeUserSession"
        : kind === "user-detail"
          ? "activeUserDetailSession"
          : "activeTranscriptSession";
    const activeId = this.activeSessionId(activeKey);
    if (activeId) {
      const active = this.readSession(activeId);
      if (active?.kind === kind && active.queryKey === key) return activeId;
    }
    const existing = this.db.select().from(schema.collectionSessions)
      .where(and(eq(schema.collectionSessions.kind, kind), eq(schema.collectionSessions.queryKey, key)))
      .all().sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (existing) return existing.id;
    const id = randomUUID();
    this.persistSession(id, kind, key, { pages: 0, maxPages: 10, status: "idle" });
    return id;
  }

  private activeSessionId(key: string): string | undefined {
    const value = this.db.select().from(schema.stateValues).where(eq(schema.stateValues.key, key)).get()?.value;
    return jsonParse<string | undefined>(value, undefined);
  }

  private persistSession(id: string, kind: string, key: string, values: {
    keyword?: string;
    filtersJson?: string | null;
    secUid?: string;
    pages: number;
    maxPages: number;
    hasMore?: boolean;
    status: string;
    collectedAt?: string;
    resultPath?: string;
  }): void {
    const now = Date.now();
    const valuesToWrite = {
      id,
      kind,
      queryKey: key,
      keyword: values.keyword ?? null,
      filtersJson: values.filtersJson ?? null,
      secUid: values.secUid ?? null,
      pages: values.pages,
      maxPages: values.maxPages,
      hasMore: values.hasMore === undefined ? null : values.hasMore ? 1 : 0,
      status: values.status,
      collectedAt: values.collectedAt ?? null,
      resultPath: values.resultPath ?? null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + CACHE_TTL_MS,
    };
    this.db.insert(schema.collectionSessions).values(valuesToWrite).onConflictDoUpdate({
      target: schema.collectionSessions.id,
      set: {
        keyword: valuesToWrite.keyword,
        filtersJson: valuesToWrite.filtersJson,
        secUid: valuesToWrite.secUid,
        pages: valuesToWrite.pages,
        maxPages: valuesToWrite.maxPages,
        hasMore: valuesToWrite.hasMore,
        status: valuesToWrite.status,
        collectedAt: valuesToWrite.collectedAt,
        resultPath: valuesToWrite.resultPath,
        updatedAt: now,
        expiresAt: now + CACHE_TTL_MS,
      },
    }).run();
  }

  private writeResultFile(kind: string, id: string, value: unknown): string {
    const directory = path.join(this.resultRoot, kind);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${id}.json`);
    this.writeJson(target, value);
    return target;
  }

  private userDetailCachePath(secUid: string): string {
    return path.join(this.resultRoot, "user-detail", `${encodeURIComponent(secUid)}.json`);
  }

  private writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value), "utf8");
  }

  private readJson<T>(target: string): T | undefined {
    try {
      return JSON.parse(fs.readFileSync(target, "utf8")) as T;
    } catch {
      return undefined;
    }
  }

  private removeFile(target: string): void {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Cache cleanup must never prevent the MCP server from starting.
    }
  }
}

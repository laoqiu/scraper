import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { openAppDatabase, schema, type AppDatabase } from "./db/index.js";
import { CollectionRepository } from "./collection-repository.js";
import { exportUsers, exportVideoManifest, exportVideos } from "./store-export.js";
import {
  ACCOUNT_ROW_ID,
  defaultDataDirectory,
  initialState,
  jsonParse,
} from "./store-helpers.js";
import type {
  BrowserState,
  DouyinAccount,
  DouyinUser,
  DouyinVideo,
  LoginState,
  PersistedDouyinAccount,
  PersistedState,
  VideoFileRecord,
  UserCollectionProgress,
  UserDetailCache,
  UserDetailCollectionProgress,
  UserSearchInput,
  UserCollectionResult,
  UserDetailCollectionResult,
  VideoCollectionProgress,
  VideoCollectionResult,
  VideoSearchInput,
  PlatformId,
  PersistedPlatformAccount,
} from "./types.js";

export class AppStore {
  readonly root = defaultDataDirectory();
  readonly browserProfile = path.join(this.root, "browser-profile");
  readonly videoDirectory = path.join(this.root, "videos");
  readonly diagnostics = path.join(this.root, "diagnostics");
  readonly databasePath = path.join(this.root, "douyin.db");

  private state: PersistedState = initialState();
  private loaded = false;
  private database?: AppDatabase;
  private rawDatabase?: Database.Database;
  private collections?: CollectionRepository;
  private initializePromise?: Promise<void>;
  private writeQueue: Promise<unknown> = Promise.resolve();

  async initialize(): Promise<void> {
    if (this.loaded) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      await fs.mkdir(this.browserProfile, { recursive: true });
      await fs.mkdir(this.videoDirectory, { recursive: true });
      await fs.mkdir(this.diagnostics, { recursive: true });
      const opened = openAppDatabase(this.databasePath);
      this.rawDatabase = opened.raw;
      this.database = opened.db;
      this.collections = new CollectionRepository(
        opened.db,
        opened.raw,
        (key, value) => this.putStateValue(key, value),
        this.root,
      );
      this.collectionRepository().cleanupExpiredCaches();
      this.loadStateFromDatabase();
      this.loaded = true;

      if (this.state.videoProgress.status === "collecting") {
        this.state.videoProgress = { ...this.state.videoProgress, status: "idle", message: "上次采集未完成" };
        this.persistStateFields({ videoProgress: this.state.videoProgress });
      }
      if (this.state.userProgress.status === "collecting") {
        this.state.userProgress = { ...this.state.userProgress, status: "idle", message: "上次采集未完成" };
        this.persistStateFields({ userProgress: this.state.userProgress });
      }
      if (this.state.userDetailProgress?.status === "collecting") {
        this.state.userDetailProgress = { ...this.state.userDetailProgress, status: "idle", message: "上次用户详情采集未完成" };
        this.persistStateFields({ userDetailProgress: this.state.userDetailProgress });
      }
    })();
    try {
      await this.initializePromise;
    } catch (error) {
      this.initializePromise = undefined;
      this.rawDatabase?.close();
      this.rawDatabase = undefined;
      this.database = undefined;
      this.collections = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
    this.rawDatabase?.close();
    this.rawDatabase = undefined;
    this.database = undefined;
    this.collections = undefined;
    this.loaded = false;
    this.initializePromise = undefined;
  }

  snapshot(): PersistedState {
    return structuredClone(this.state);
  }

  async update(patch: Partial<PersistedState>): Promise<PersistedState> {
    await this.initialize();
    return this.enqueue(async () => {
      this.state = { ...this.state, ...patch };
      this.persistStateFields(patch);
      return this.snapshot();
    });
  }

  async setCaptchaDetected(detected: boolean): Promise<PersistedState> {
    if (!this.loaded) await this.initialize();
    const current = this.state.browser;
    if (current.captchaDetected === detected) return this.snapshot();
    return this.update({ browser: { ...current, captchaDetected: detected, captchaDetectedAt: detected ? new Date().toISOString() : undefined } });
  }

  async snapshotForUserDetail(secUid: string): Promise<PersistedState> {
    if (!this.loaded) await this.initialize();
    const state = this.snapshot();
    const sessions = this.db().select()
      .from(schema.collectionSessions)
      .where(and(eq(schema.collectionSessions.kind, "user-detail"), eq(schema.collectionSessions.secUid, secUid)))
      .all()
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const session = sessions[0];
    state.lastUserDetail = session ? this.collectionRepository().readUserDetailResult(session, state.currentUser) : undefined;
    if (state.userDetailProgress?.secUid !== secUid) state.userDetailProgress = undefined;
    if (state.currentUser && state.currentUser.secUid !== secUid && state.currentUser.sec_uid !== secUid) state.currentUser = undefined;
    return state;
  }

  async loadVideoResult(jobId?: string): Promise<VideoCollectionResult | undefined> {
    await this.initialize();
    if (!jobId) return this.state.lastVideos;
    const session = this.collectionRepository().readSession(jobId);
    return session?.kind === "videos" ? this.collectionRepository().readVideoResult(session) : undefined;
  }

  async loadUserResult(jobId?: string): Promise<UserCollectionResult | undefined> {
    await this.initialize();
    if (!jobId) return this.state.lastUsers;
    const session = this.collectionRepository().readSession(jobId);
    return session?.kind === "users" ? this.collectionRepository().readUserResult(session) : undefined;
  }

  async loadUserDetailResult(jobId?: string): Promise<UserDetailCollectionResult | undefined> {
    await this.initialize();
    if (!jobId) return this.state.lastUserDetail;
    const session = this.collectionRepository().readSession(jobId);
    return session?.kind === "user-detail"
      ? this.collectionRepository().readUserDetailResult(session, this.state.currentUser)
      : undefined;
  }

  async saveLoginAccount(account: DouyinAccount, cookie = "", userAgent = ""): Promise<void> {
    if (!this.loaded) await this.initialize();
    await this.enqueue(async () => {
      const now = Date.now();
      const values = {
        id: ACCOUNT_ROW_ID,
        status: 1,
        cookie: cookie || null,
        userAgent: userAgent || null,
        avatar: account.avatarUrl ?? null,
        followerCount: account.followerCount,
        followingCount: account.followingCount,
        nickname: account.nickname,
        uid: account.uid,
        city: account.city,
        bindPhone: account.bindPhone,
        signature: account.signature,
        gender: account.gender,
        uniqueId: account.uniqueId,
        updatedAt: now,
      };
      this.db().insert(schema.accounts).values(values).onConflictDoUpdate({ target: schema.accounts.id, set: values }).run();
    });
  }

  async loadLoginAccount(): Promise<PersistedDouyinAccount | null> {
    if (!this.loaded) await this.initialize();
    const row = this.db().select().from(schema.accounts).where(eq(schema.accounts.id, ACCOUNT_ROW_ID)).get();
    if (!row || (row.status !== 1 && row.status !== 2)) return null;
    return {
      status: row.status as 1 | 2,
      ...(row.cookie === null ? {} : { cookie: row.cookie }),
      ...(row.userAgent === null ? {} : { user_agent: row.userAgent }),
      ...(row.avatar === null ? {} : { avatar: row.avatar }),
      ...(row.followerCount === null ? {} : { follower_count: row.followerCount }),
      ...(row.followingCount === null ? {} : { following_count: row.followingCount }),
      ...(row.nickname === null ? {} : { nickname: row.nickname }),
      ...(row.uid === null ? {} : { uid: row.uid }),
      ...(row.city === null ? {} : { city: row.city }),
      ...(row.bindPhone === null ? {} : { bind_phone: row.bindPhone }),
      ...(row.signature === null ? {} : { signature: row.signature }),
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.uniqueId === null ? {} : { unique_id: row.uniqueId }),
    };
  }

  async markLoginAccountInvalid(): Promise<void> {
    if (!this.loaded) await this.initialize();
    await this.enqueue(async () => {
      const now = Date.now();
      this.db().insert(schema.accounts).values({ id: ACCOUNT_ROW_ID, status: 2, updatedAt: now })
        .onConflictDoUpdate({ target: schema.accounts.id, set: { status: 2, updatedAt: now } }).run();
    });
  }

  async savePlatformAccount(platform: PlatformId, profile: Record<string, unknown>, cookie = "", userAgent = ""): Promise<void> {
    if (!this.loaded) await this.initialize();
    await this.enqueue(async () => {
      const now = Date.now();
      const values = {
        platform,
        status: 1,
        cookie: cookie || null,
        userAgent: userAgent || null,
        profileJson: JSON.stringify(profile),
        updatedAt: now,
      };
      this.db().insert(schema.platformAccounts).values(values).onConflictDoUpdate({ target: schema.platformAccounts.platform, set: values }).run();
    });
  }

  async loadPlatformAccount(platform: PlatformId): Promise<PersistedPlatformAccount | null> {
    if (!this.loaded) await this.initialize();
    if (platform === "douyin") {
      const account = await this.loadLoginAccount();
      return account ? { platform, status: account.status, cookie: account.cookie, user_agent: account.user_agent, profile: account as unknown as Record<string, unknown> } : null;
    }
    const row = this.db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.platform, platform)).get();
    if (!row) return null;
    return {
      platform,
      status: row.status as 1 | 2,
      ...(row.cookie === null ? {} : { cookie: row.cookie }),
      ...(row.userAgent === null ? {} : { user_agent: row.userAgent }),
      profile: jsonParse<Record<string, unknown>>(row.profileJson, {}),
    };
  }

  async markPlatformAccountInvalid(platform: PlatformId): Promise<void> {
    if (!this.loaded) await this.initialize();
    if (platform === "douyin") {
      await this.markLoginAccountInvalid();
      return;
    }
    await this.enqueue(async () => {
      const now = Date.now();
      this.db().insert(schema.platformAccounts).values({ platform, status: 2, profileJson: "{}", updatedAt: now })
        .onConflictDoUpdate({ target: schema.platformAccounts.platform, set: { status: 2, updatedAt: now } }).run();
    });
  }

  async exportUsers(users: DouyinUser[]): Promise<string> {
    if (!this.loaded) await this.initialize();
    return exportUsers(this.root, users);
  }

  async exportVideos(videos: DouyinVideo[]): Promise<string> {
    if (!this.loaded) await this.initialize();
    return exportVideos(this.root, videos);
  }

  async exportVideoManifest(input: {
    batchId: string;
    platform: "douyin" | "kuaishou" | "xiaohongshu";
    videos: DouyinVideo[];
    files: VideoFileRecord[];
  }): Promise<string> {
    if (!this.loaded) await this.initialize();
    return exportVideoManifest(this.root, input);
  }

  videoFilePath(platform: PlatformId, videoId: string): string {
    const safeId = videoId.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    return path.join(this.videoDirectory, platform, `${safeId}.mp4`);
  }

  async loadUserDetailCache(secUid: string): Promise<UserDetailCache | undefined> {
    if (!this.loaded) await this.initialize();
    return this.collectionRepository().loadUserDetailCache(secUid);
  }

  async saveUserDetailCache(secUid: string, cache: UserDetailCache): Promise<string> {
    if (!this.loaded) await this.initialize();
    return this.collectionRepository().saveUserDetailCache(secUid, cache);
  }

  async diagnosticPath(prefix: string): Promise<string> {
    await fs.mkdir(this.diagnostics, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    return path.join(this.diagnostics, `${prefix}-${stamp}.png`);
  }

  private collectionRepository(): CollectionRepository {
    if (!this.collections) throw new Error("douyin collection repository is not initialized");
    return this.collections;
  }

  private db(): AppDatabase {
    if (!this.database) throw new Error("douyin database is not initialized");
    return this.database;
  }

  private rawDb(): Database.Database {
    if (!this.rawDatabase) throw new Error("douyin database is not initialized");
    return this.rawDatabase;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.writeQueue.catch(() => undefined).then(action);
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private loadStateFromDatabase(): void {
    const defaults = initialState();
    const values = new Map(this.db().select().from(schema.stateValues).all().map((row) => [row.key, row.value]));
    this.state = {
      ...defaults,
      login: jsonParse<LoginState>(values.get("login"), defaults.login),
      browser: jsonParse<BrowserState>(values.get("browser"), defaults.browser),
      videoProgress: jsonParse<VideoCollectionProgress>(values.get("videoProgress"), defaults.videoProgress),
      userProgress: jsonParse<UserCollectionProgress>(values.get("userProgress"), defaults.userProgress),
      lastVideoSearch: jsonParse<VideoSearchInput | undefined>(values.get("lastVideoSearch"), undefined),
      lastUserSearch: jsonParse<UserSearchInput | undefined>(values.get("lastUserSearch"), undefined),
      userDetailProgress: jsonParse<UserDetailCollectionProgress | undefined>(values.get("userDetailProgress"), undefined),
      currentUser: undefined,
    };
    const videoSessionId = jsonParse<string | undefined>(values.get("activeVideoSession"), undefined);
    if (videoSessionId) {
      const session = this.collectionRepository().readSession(videoSessionId);
      if (session?.kind === "videos") this.state.lastVideos = this.collectionRepository().readVideoResult(session);
    }
    const userSessionId = jsonParse<string | undefined>(values.get("activeUserSession"), undefined);
    if (userSessionId) {
      const session = this.collectionRepository().readSession(userSessionId);
      if (session?.kind === "users") this.state.lastUsers = this.collectionRepository().readUserResult(session);
    }
    const detailSessionId = jsonParse<string | undefined>(values.get("activeUserDetailSession"), undefined);
    if (detailSessionId) {
      const session = this.collectionRepository().readSession(detailSessionId);
      if (session?.kind === "user-detail") this.state.lastUserDetail = this.collectionRepository().readUserDetailResult(session, this.state.currentUser);
    }
    this.state.currentUser = this.state.lastUserDetail?.user;
  }

  private persistStateFields(patch: Partial<PersistedState>): void {
    const has = (key: keyof PersistedState): boolean => Object.prototype.hasOwnProperty.call(patch, key);
    this.rawDb().transaction(() => {
      if (has("login")) this.putStateValue("login", this.state.login);
      if (has("browser")) this.putStateValue("browser", this.state.browser);
      if (has("videoProgress")) this.putStateValue("videoProgress", this.state.videoProgress);
      if (has("userProgress")) this.putStateValue("userProgress", this.state.userProgress);
      if (has("lastVideoSearch")) this.putStateValue("lastVideoSearch", this.state.lastVideoSearch);
      if (has("lastUserSearch")) this.putStateValue("lastUserSearch", this.state.lastUserSearch);
      if (has("userDetailProgress")) this.putStateValue("userDetailProgress", this.state.userDetailProgress);
      if (has("currentUser")) {
        // Current user data is part of the user-detail JSON result. Keep only
        // the in-memory pointer here; SQLite stores operation metadata only.
      }
      if (has("lastVideos")) {
        if (this.state.lastVideos) this.collectionRepository().persistVideoResult(this.state.lastVideos, this.state.videoProgress.status, this.state.lastVideoSearch?.maxPages ?? 10);
        else this.deleteStateValue("activeVideoSession");
      }
      if (has("lastUsers")) {
        if (this.state.lastUsers) this.collectionRepository().persistUserResult(this.state.lastUsers, this.state.userProgress.status, this.state.lastUserSearch?.maxPages ?? 10);
        else this.deleteStateValue("activeUserSession");
      }
      if (has("lastUserDetail")) {
        if (this.state.lastUserDetail) this.collectionRepository().persistUserDetailResult(this.state.lastUserDetail, this.state.userDetailProgress?.status ?? "idle", this.state.userDetailProgress?.maxPages ?? 10);
        else this.deleteStateValue("activeUserDetailSession");
      }
    })();
  }

  private putStateValue(key: string, value: unknown): void {
    if (value === undefined) {
      this.deleteStateValue(key);
      return;
    }
    const serialized = JSON.stringify(value);
    this.db().insert(schema.stateValues).values({ key, value: serialized, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: schema.stateValues.key, set: { value: serialized, updatedAt: Date.now() } }).run();
  }

  private deleteStateValue(key: string): void {
    this.db().delete(schema.stateValues).where(eq(schema.stateValues.key, key)).run();
  }
}

export const appStore = new AppStore();

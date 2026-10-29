import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const stateValues = sqliteTable("state_values", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey(),
  status: integer("status").notNull(),
  cookie: text("cookie"),
  userAgent: text("user_agent"),
  avatar: text("avatar"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  nickname: text("nickname"),
  uid: text("uid"),
  city: text("city"),
  bindPhone: text("bind_phone"),
  signature: text("signature"),
  gender: integer("gender"),
  uniqueId: text("unique_id"),
  updatedAt: integer("updated_at").notNull(),
});

export const platformAccounts = sqliteTable("platform_accounts", {
  platform: text("platform").primaryKey(),
  status: integer("status").notNull(),
  cookie: text("cookie"),
  userAgent: text("user_agent"),
  profileJson: text("profile_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Operation metadata only. Large collection results live in JSON files. */
export const collectionSessions = sqliteTable("collection_sessions", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  queryKey: text("query_key").notNull(),
  keyword: text("keyword"),
  filtersJson: text("filters_json"),
  secUid: text("sec_uid"),
  pages: integer("pages").notNull().default(0),
  maxPages: integer("max_pages").notNull().default(10),
  hasMore: integer("has_more"),
  status: text("status").notNull().default("idle"),
  collectedAt: text("collected_at"),
  resultPath: text("result_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => ({
  kindQueryKeyIndex: index("collection_sessions_kind_query_key_idx").on(table.kind, table.queryKey),
  expiresAtIndex: index("collection_sessions_expires_at_idx").on(table.expiresAt),
}));

CREATE TABLE IF NOT EXISTS state_values (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY NOT NULL,
  status INTEGER NOT NULL,
  cookie TEXT,
  user_agent TEXT,
  avatar TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  nickname TEXT,
  uid TEXT,
  city TEXT,
  bind_phone TEXT,
  signature TEXT,
  gender INTEGER,
  unique_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_accounts (
  platform TEXT PRIMARY KEY NOT NULL,
  status INTEGER NOT NULL,
  cookie TEXT,
  user_agent TEXT,
  profile_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  query_key TEXT NOT NULL,
  keyword TEXT,
  filters_json TEXT,
  sec_uid TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  max_pages INTEGER NOT NULL DEFAULT 10,
  has_more INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  collected_at TEXT,
  result_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS collection_sessions_kind_query_key_idx ON collection_sessions(kind, query_key);
CREATE INDEX IF NOT EXISTS collection_sessions_expires_at_idx ON collection_sessions(expires_at);

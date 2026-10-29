import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const CREATE_SCHEMA = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
  "utf8",
);

export function openAppDatabase(databasePath: string): { raw: Database.Database; db: AppDatabase } {
  const raw = new Database(databasePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  raw.exec(CREATE_SCHEMA);
  ensureCollectionResultPath(raw);
  const db = drizzle(raw, { schema });
  // Keep the schema module referenced at runtime and make an accidental schema
  // mismatch fail during initialization instead of on the first tool call.
  db.run(sql`PRAGMA user_version = 1`);
  return { raw, db };
}

function ensureCollectionResultPath(raw: Database.Database): void {
  const columns = raw.prepare("PRAGMA table_info(collection_sessions)").all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === "result_path")) {
    raw.exec("ALTER TABLE collection_sessions ADD COLUMN result_path TEXT");
  }
}

export { schema };

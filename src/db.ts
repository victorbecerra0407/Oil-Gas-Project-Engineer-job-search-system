
import Database from "better-sqlite3";
import fs from "node:fs";

fs.mkdirSync("data", { recursive: true });

export const db = new Database(
  process.env.DB_PATH || "data/jobs.sqlite"
);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  website TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  fact TEXT DEFAULT 'none',
  fact_url TEXT DEFAULT 'none',
  contact_email TEXT DEFAULT 'none',
  contact_url TEXT DEFAULT 'none',
  last_checked TEXT,
  UNIQUE(name, country)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  foreigner_eligibility TEXT DEFAULT 'unknown',
  FOREIGN KEY(company_id) REFERENCES companies(id)
);
`);

export function getOrCreateCompany(
  name: string,
  country: string,
  sourceUrl: string
): number {
  const existing = db.prepare(`
    SELECT id FROM companies
    WHERE name = ? AND country = ?
  `).get(name, country) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO companies (
      name,
      country,
      website,
      careers_url,
      status
    )
    VALUES (?, ?, ?, ?, 'discovered')
  `).run(
    name,
    country,
    sourceUrl,
    sourceUrl
  );

  return Number(result.lastInsertRowid);
}


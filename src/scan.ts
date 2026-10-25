
import fs from "node:fs";
import * as cheerio from "cheerio";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (url: string, content: string) => { isAllowed: (url: string, agent: string) => boolean | undefined };
import { db } from "./db.js";

const profile = JSON.parse(
  fs.readFileSync("config/profile.json", "utf8")
);

const agent = "VictorJobResearchBot/1.0";
const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol)
      && !["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname)
      && !u.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") ===
      new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  if (!validUrl(url)) return null;

  try {
    const origin = new URL(url).origin;
    const robotsUrl = origin + "/robots.txt";

    try {
      const r = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": agent }
      });

      if (r.ok) {
        const rules = robotsParser(robotsUrl, await r.text());
        if (rules.isAllowed(url, agent) === false) return null;
      }
    } catch {
      return null;
    }

    const r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": agent,
        "Accept": "text/html"
      }
    });

    if (!r.ok) return null;
    if (!(r.headers.get("content-type") || "")
      .includes("text/html")) return null;

    return (await r.text()).slice(0, 2000000);
  } catch {
    return null;
  }
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];

    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const csv = parseCsv(
  fs.readFileSync("data/companies.csv", "utf8")
);

const header = csv.shift()?.map(x => x.trim()) || [];

const upsert = db.prepare(`
  INSERT INTO companies(name,country,website,careers_url)
  VALUES(?,?,?,?)
  ON CONFLICT(name,country)
  DO UPDATE SET
    website=excluded.website,
    careers_url=excluded.careers_url
`);

for (const row of csv) {
  const r = Object.fromEntries(
    header.map((h, i) => [h, row[i]?.trim() || ""])
  );

  if (
    !r.name ||
    !profile.countries.includes(r.country) ||
    !validUrl(r.website) ||
    !validUrl(r.careers_url) ||
    !sameHost(r.website, r.careers_url)
  ) continue;

  upsert.run(r.name, r.country, r.website, r.careers_url);
}

type Company = {
  id: number;
  name: string;
  country: string;
  website: string;
  careers_url: string;
};

const companies = db.prepare(
  "SELECT * FROM companies ORDER BY last_checked ASC"
).all() as Company[];

const update = db.prepare(`
  UPDATE companies SET
    status=?,fact=?,fact_url=?,
    contact_email=?,contact_url=?,last_checked=?
  WHERE id=?
`);

const saveJob = db.prepare(`
  INSERT INTO jobs(
    company_id,title,url,first_seen,last_seen
  ) VALUES(?,?,?,?,?)
  ON CONFLICT(url) DO UPDATE SET
    title=excluded.title,
    last_seen=excluded.last_seen
`);

const max = Number(process.env.MAX_COMPANIES || "100");

for (const c of companies.slice(0, max)) {
  let fact = "none";
  let factUrl = "none";
  let email = "none";
  let emailUrl = "none";
  let count = 0;

  const homepage = await fetchHtml(c.website);

  if (homepage) {
    const $ = cheerio.load(homepage);
    $("script,style,noscript,nav,footer,header").remove();

    const blocks = $("h1,h2,h3,p,li")
      .toArray()
      .map(el => $(el).text().replace(/\s+/g, " ").trim())
      .filter(t => t.length >= 35 && t.length <= 300);

    const match = blocks.find(t =>
      /\b(our values|our mission|we specialize|we specialise|we provide|employees|our team|offshore|fabrication|engineering services)\b/i.test(t)
    );

    if (match) {
      fact = match;
      factUrl = c.website;
    }
  }

  const careers = await fetchHtml(c.careers_url);

  if (careers) {
    const $ = cheerio.load(careers);

    for (const a of $("a[href]").toArray()) {
      const title = $(a).text().replace(/\s+/g, " ").trim();
      let url = "";

      try {
        url = new URL($(a).attr("href") || "", c.careers_url).href;
      } catch {
        continue;
      }

      if (!validUrl(url) || !sameHost(url, c.website)) continue;

      if (!profile.keywords.some((k: string) =>
        title.toLowerCase().includes(k))) continue;

      const now = new Date().toISOString();
      saveJob.run(c.id, title.slice(0, 250), url, now, now);
      count++;
    }

    const mail = $('a[href^="mailto:"]').first().attr("href");

    if (mail) {
      const candidate = decodeURIComponent(
        mail.replace(/^mailto:/i, "").split("?")[0]
      ).trim();

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
        email = candidate;
        emailUrl = c.careers_url;
      }
    }
  }

  update.run(
    homepage || careers ? "checked" : "unreachable",
    fact,
    factUrl,
    email,
    emailUrl,
    new Date().toISOString(),
    c.id
  );

  console.log(`${c.name}: ${count} matching links`);
  await sleep(1200);
}

db.close();

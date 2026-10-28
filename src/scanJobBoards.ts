
import fs from "node:fs";
import { db, getOrCreateCompany } from "./db.js";

type AdzunaJob = {
  title?: string;
  description?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
};

const profile = JSON.parse(
  fs.readFileSync("config/profile.json", "utf8")
);

const appId = process.env.ADZUNA_APP_ID;
const appKey = process.env.ADZUNA_APP_KEY;

if (!appId || !appKey) {
  console.error(
    "Missing ADZUNA_APP_ID or ADZUNA_APP_KEY."
  );
  process.exit(1);
}

const countries = [
  { code: "sg", name: "Singapore" },
  { code: "au", name: "Australia" },
  { code: "nz", name: "New Zealand" }
];

const saveJob = db.prepare(`
  INSERT INTO jobs (
    company_id, title, url, first_seen, last_seen
  )
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(url) DO UPDATE SET
    title = excluded.title,
    last_seen = excluded.last_seen
`);

let total = 0;

for (const country of countries) {
  for (const keyword of profile.keywords as string[]) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      what: keyword,
      results_per_page: "50",
      "content-type": "application/json"
    });

    const url =
      `https://api.adzuna.com/v1/api/jobs/${country.code}/search/1?${params}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        console.log(
          `[API ERROR] ${country.name}: ${response.status}`
        );
        continue;
      }

      const data = await response.json() as {
        results?: AdzunaJob[];
      };

      let count = 0;

      for (const job of data.results || []) {
        const title = job.title || "";
        const description = job.description || "";
        const searchable =
          `${title} ${description}`.toLowerCase();

        const matches = (profile.keywords as string[])
          .filter(keyword =>
            searchable.includes(keyword.toLowerCase())
          );

        if (matches.length === 0) continue;
        if (!job.redirect_url) continue;

        const companyName =
          job.company?.display_name || "Unknown employer";

        const companyId = getOrCreateCompany(
          companyName,
          country.name,
          job.redirect_url
        );

        const now = new Date().toISOString();

        saveJob.run(
          companyId,
          title,
          job.redirect_url,
          now,
          now
        );

        count++;
        total++;

        console.log(
          `[JOB FOUND] ${country.name} | ${companyName} | ${title}`
        );
      }

      console.log(
        `[SEARCH] ${country.name} | ${keyword}: ${count} matches`
      );
    } catch (error) {
      console.error(
        `[ERROR] ${country.name} | ${keyword}`,
        error
      );
    }
  }
}

console.log(`Total matching results processed: ${total}`);
db.close();

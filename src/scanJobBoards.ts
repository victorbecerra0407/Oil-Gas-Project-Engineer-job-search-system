
import fs from "node:fs";
import * as cheerio from "cheerio";
import { db, getOrCreateCompany } from "./db.js";

const profile = JSON.parse(
  fs.readFileSync("config/profile.json", "utf8")
);

const keywords: string[] = profile.keywords;

type Job = {
  title: string;
  description: string;
  company: string;
  location: string;
  url: string;
  source: string;
};

const saveJob = db.prepare(`
  INSERT INTO jobs (
    company_id, title, url, first_seen, last_seen
  )
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(url) DO UPDATE SET
    title = excluded.title,
    last_seen = excluded.last_seen
`);

function cleanText(html: string): string {
  return cheerio.load(html).text()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesKeywords(job: Job): string[] {
  const text = (
    job.title + " " + cleanText(job.description)
  ).toLowerCase();

  return keywords.filter(keyword =>
    text.includes(keyword.toLowerCase())
  );
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchRemotive(): Promise<Job[]> {
  const data = await getJson(
    "https://remotive.com/api/remote-jobs"
  );

  return (data.jobs || []).map((job: any) => ({
    title: job.title || "",
    description: job.description || "",
    company: job.company_name || "Unknown employer",
    location: job.candidate_required_location || "Remote",
    url: job.url || "",
    source: "Remotive"
  }));
}

async function fetchArbeitnow(): Promise<Job[]> {
  const results: Job[] = [];

  for (let page = 1; page <= 3; page++) {
    const data = await getJson(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`
    );

    for (const job of data.data || []) {
      results.push({
        title: job.title || "",
        description: job.description || "",
        company: job.company_name || "Unknown employer",
        location: job.location || "Unknown",
        url: job.url || "",
        source: "Arbeitnow"
      });
    }

    if (!data.links?.next) break;
  }

  return results;
}

async function fetchGreenhouse(): Promise<Job[]> {
  const boards = [
    {
      company: "Anduril Industries",
      token: "andurilindustries"
    }
  ];

  const results: Job[] = [];

  for (const board of boards) {
    try {
      const data = await getJson(
        `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`
      );

      for (const job of data.jobs || []) {
        results.push({
          title: job.title || "",
          description: job.content || "",
          company: board.company,
          location: job.location?.name || "Unknown",
          url: job.absolute_url || "",
          source: "Greenhouse"
        });
      }

      console.log(
        `[GREENHOUSE] ${board.company}: ${data.jobs?.length || 0} vacancies retrieved`
      );
    } catch (error) {
      console.error(
        `[GREENHOUSE ERROR] ${board.company}`,
        error
      );
    }
  }

  return results;
}

const sources = [
  { name: "Remotive", fetchJobs: fetchRemotive },
  { name: "Arbeitnow", fetchJobs: fetchArbeitnow }
];

let total = 0;
const seen = new Set<string>();

for (const source of sources) {
  try {
    const jobs = await source.fetchJobs();

    console.log(
      `[SOURCE] ${source.name}: ${jobs.length} offers retrieved`
    );

    for (const job of jobs) {
      if (!job.title || !job.url) continue;

      const matches = matchesKeywords(job);
      if (matches.length === 0) continue;
      if (seen.has(job.url)) continue;

      seen.add(job.url);

      // Only save jobs with a confirmed target country.
      const country = profile.countries.find(
        (c: string) =>
          job.location.toLowerCase().includes(c.toLowerCase())
      );

      if (!country) continue;

      const companyId = getOrCreateCompany(
        job.company,
        country,
        job.url
      );

      const now = new Date().toISOString();

      saveJob.run(
        companyId,
        job.title,
        job.url,
        now,
        now
      );

      total++;

      console.log(
        `[JOB FOUND] ${job.source} | ${country} | ` +
        `${job.company} | ${job.title} | ` +
        `Keywords: ${matches.join(", ")}`
      );
    }
  } catch (error) {
    console.error(`[SOURCE ERROR] ${source.name}`, error);
  }
}

console.log(`Total matching jobs saved: ${total}`);
db.close();

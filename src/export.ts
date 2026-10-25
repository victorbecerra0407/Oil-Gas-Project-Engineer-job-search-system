
import fs from "node:fs";
import { db } from "./db.js";

const profile = JSON.parse(
  fs.readFileSync("config/profile.json", "utf8")
);

type Company = {
  name: string;
  country: string;
  fact: string;
  fact_url: string;
  contact_email: string;
  contact_url: string;
};

const companies = db.prepare(
  "SELECT * FROM companies ORDER BY country,name"
).all() as Company[];

const sent = new Set<string>();

if (fs.existsSync("data/sent-log.jsonl")) {
  for (const line of fs.readFileSync(
    "data/sent-log.jsonl", "utf8"
  ).split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (entry.companyKey) sent.add(entry.companyKey);
    } catch {}
  }
}

const key = (c: Company) =>
  `${c.name.trim().toLowerCase()}|${c.country.trim().toLowerCase()}`;

function draft(c: Company): string {
  const hook = c.fact !== "none"
    ? `I was drawn to your company's own description: "${c.fact}" (Source: ${c.fact_url}). My experience in offshore project delivery and fabrication could support this work.`
    : "I would welcome the opportunity to learn more about your project engineering needs.";

  return `Dear Recruitment Team,

My name is ${profile.name}, and I am an ${profile.headline} currently based in ${profile.location}. I am interested in project engineering opportunities with ${c.name} in ${c.country}.

${hook}

What I bring:
${profile.strengths.map((x: string) => `• ${x}`).join("\n")}

I am available from ${profile.availableFrom}.

My LinkedIn: ${profile.linkedin}

Please find my CV attached.

Kind regards,
${profile.name}`;
}

const drafts = companies
  .filter(c => !sent.has(key(c)))
  .map(c => ({
    companyKey: key(c),
    company: c.name,
    country: c.country,
    email: c.contact_email,
    contactSource: c.contact_url,
    subject: `Project Engineer opportunities – ${profile.name}`,
    body: draft(c)
  }));

fs.mkdirSync("data/private", { recursive: true });

fs.writeFileSync(
  "data/private/drafts.json",
  JSON.stringify(drafts, null, 2)
);

console.log(`${drafts.length} private drafts generated.`);
console.log("No emails were sent.");

db.close();

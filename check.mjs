#!/usr/bin/env node
/**
 * pm-watch — personal Summer 2027 PM/DS internship alerter
 *
 * Design notes (read before editing):
 *  - We do NOT scrape career pages. Simplify/Pitt CSC already scrape hourly and
 *    publish the result. We ride their output, filter it hard for one person,
 *    and push. Our edge is precision + latency, not coverage.
 *  - Zero dependencies. Node 20+ (global fetch). Runs in ~10s on a GH runner.
 *  - Source paths are tried in order. The upstream repo has reorganized its
 *    JSON location before, so there's a README-table fallback that will keep
 *    working even if every JSON path 404s.
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEEN_PATH = path.join(HERE, "state", "seen.json");

const REPO = "SimplifyJobs/Summer2027-Internships";
const BRANCH = "dev"; // NOT main — upstream's default branch is dev

// Tried in order. First one that parses wins.
const JSON_CANDIDATES = [
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/.github/scripts/listings.json`,
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/listings.json`,
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/.github/scripts/listings.jsonl`,
];
const README_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/README.md`;

// ---------------------------------------------------------------- utilities

const log = (...a) => console.log("[pm-watch]", ...a);

async function getText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "pm-watch (personal internship alerter)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const stripEmoji = (s) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2934}\u{21B3}]/gu, "").trim();

const hashId = (...parts) =>
  crypto.createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex").slice(0, 12);

// ------------------------------------------------------------ source: JSON

function normalizeJsonRow(r) {
  const locations = Array.isArray(r.locations) ? r.locations : r.locations ? [r.locations] : [];
  const title = r.title || r.role || "";
  const company = r.company_name || r.company || "";
  return {
    id: r.id || hashId(company, title, locations.join(",")),
    company,
    title,
    locations,
    url: r.url || r.apply_url || "",
    active: r.active !== false && r.is_visible !== false,
    // Upstream marks advanced-degree roles in a `degrees` array on some schema
    // versions and only in the README emoji on others. Catch both.
    advancedDegree: /master|phd|mba|graduate student/i.test(
      [title, (r.degrees || []).join(" ")].join(" ")
    ),
    sponsorship: r.sponsorship || "",
    datePosted: r.date_posted ? new Date(r.date_posted * 1000).toISOString().slice(0, 10) : "",
    category: "", // JSON has no section; title regex does the work
    source: "simplify-json",
  };
}

async function fromJson() {
  for (const url of JSON_CANDIDATES) {
    try {
      const raw = await getText(url);
      let rows;
      if (url.endsWith(".jsonl")) {
        rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } else {
        rows = JSON.parse(raw);
      }
      if (!Array.isArray(rows) || rows.length === 0) continue;
      log(`json source ok: ${url} (${rows.length} rows)`);
      return rows.map(normalizeJsonRow);
    } catch (e) {
      log(`json source miss: ${url} — ${e.message}`);
    }
  }
  return null;
}

// -------------------------------------------------------- source: README md

const SECTION_MAP = [
  [/product management/i, "pm"],
  [/data science|machine learning|\bai\b/i, "ds"],
  [/software engineering/i, "swe"],
  [/quantitative/i, "quant"],
  [/hardware/i, "hw"],
];

/**
 * Parses the upstream README tables.
 *
 * Gotcha this handles: continuation rows use "↳" in the Company column to mean
 * "same company as the row above". Naive parsers silently produce a company of
 * "↳" for a third of the list.
 */
function parseReadme(md) {
  const lines = md.split("\n");
  const out = [];
  let section = "";
  let lastCompany = "";

  for (const line of lines) {
    if (line.startsWith("#")) {
      section = "";
      for (const [re, key] of SECTION_MAP) if (re.test(line)) section = key;
      lastCompany = "";
      continue;
    }
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-{2,}/.test(line)) continue; // separator row

    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const [companyCell, roleCell, locCell, appCell] = cells;
    if (/^company$/i.test(stripEmoji(companyCell))) continue; // header row

    let company;
    if (companyCell.includes("↳") || stripEmoji(companyCell) === "") {
      company = lastCompany;
    } else {
      const m = companyCell.match(/\[([^\]]+)\]/);
      company = stripEmoji(m ? m[1] : companyCell);
      lastCompany = company;
    }
    if (!company) continue;

    const flagBlob = companyCell + roleCell;
    const closed = flagBlob.includes("🔒");
    const advancedDegree = flagBlob.includes("🎓");
    const noSponsorship = flagBlob.includes("🛂");
    const citizenshipRequired = flagBlob.includes("🇺🇸");

    // Outer links look like [![Apply](camo…)](realUrl). Grab all, drop camo.
    const urls = [...appCell.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    const real = urls.filter((u) => !u.includes("camo.githubusercontent.com"));
    const applyUrl = real.find((u) => !u.includes("simplify.jobs/p/")) || real[0] || "";
    const simplifyId = (real.find((u) => u.includes("simplify.jobs/p/")) || "").match(
      /simplify\.jobs\/p\/([0-9a-f-]{36})/
    )?.[1];

    const locations = locCell
      .replace(/\*\*\d+ locations\*\*/i, "")
      .split(/\s{2,}|\u2003|<br\s*\/?>/)
      .map((s) => s.trim())
      .filter(Boolean);

    out.push({
      id: simplifyId || hashId(company, stripEmoji(roleCell), locations.join(",")),
      company,
      title: stripEmoji(roleCell),
      locations,
      url: applyUrl,
      active: !closed,
      advancedDegree,
      noSponsorship,
      citizenshipRequired,
      datePosted: "",
      category: section,
      source: "simplify-readme",
    });
  }
  return out;
}

// ------------------------------------------------------------------ filters

function buildMatcher(cfg) {
  const include = cfg.includeTitle.map((p) => new RegExp(p, "i"));
  const exclude = cfg.excludeTitle.map((p) => new RegExp(p, "i"));
  const locRe = cfg.locationAllow.length
    ? cfg.locationAllow.map((p) => new RegExp(p, "i"))
    : null;

  return function matches(r) {
    if (!r.active) return { ok: false, why: "closed" };

    // Eligibility. This is the whole point of the tool: a BA candidate should
    // never see an MBA-only req, and no public list filters that for you.
    if (cfg.excludeAdvancedDegree && r.advancedDegree)
      return { ok: false, why: "advanced degree" };
    if (cfg.excludeCitizenshipRequired && r.citizenshipRequired)
      return { ok: false, why: "citizenship" };

    const blob = `${r.title} ${r.company}`;
    if (exclude.some((re) => re.test(blob))) return { ok: false, why: "excluded term" };

    // Category from the README section counts as a match on its own — upstream's
    // human curation beats our regex when it's available.
    const sectionHit = cfg.categories.includes(r.category);
    const titleHit = include.some((re) => re.test(r.title));
    if (!sectionHit && !titleHit) return { ok: false, why: "no keyword" };

    if (locRe && r.locations.length && !r.locations.some((l) => locRe.some((re) => re.test(l))))
      return { ok: false, why: "location" };

    return { ok: true, tier: sectionHit && titleHit ? "high" : "normal" };
  };
}

// ------------------------------------------------------------------- notify

async function ntfy(cfg, { title, body, priority = "default", tags = [], click }) {
  if (!cfg.ntfyTopic) {
    log("DRY RUN (no NTFY_TOPIC):", title, "|", body.replace(/\n/g, " / "));
    return;
  }
  const headers = {
    Title: title,
    Priority: priority,
    Tags: tags.join(","),
  };
  if (click) headers.Click = click;
  const res = await fetch(`${cfg.ntfyServer}/${cfg.ntfyTopic}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) log("ntfy failed:", res.status, await res.text().catch(() => ""));
}

// ------------------------------------------------------- program calendar

async function checkPrograms(cfg, programs, seen) {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const alerts = [];

  for (const p of programs) {
    const open = new Date(`${p.watchFrom}T00:00:00Z`);
    const close = new Date(`${p.watchUntil}T00:00:00Z`);
    if (today < open || today > close) continue;

    const key = `program:${p.name}:${yyyy}`;
    if (seen[key]) continue; // one nudge per program per year

    seen[key] = today.toISOString().slice(0, 10);
    alerts.push(p);
  }

  for (const p of alerts) {
    await ntfy(cfg, {
      title: `Watch window open: ${p.name}`,
      body: `${p.note}\nCheck the careers page directly — this program historically opens around now and may not hit the aggregators for days.`,
      priority: "high",
      tags: ["calendar", "eyes"],
      click: p.url,
    });
  }
  return alerts.length;
}

// --------------------------------------------------------------------- main

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(HERE, "config.json"), "utf8"));
  cfg.ntfyTopic = process.env.NTFY_TOPIC || cfg.ntfyTopic || "";
  cfg.ntfyServer = (process.env.NTFY_SERVER || cfg.ntfyServer || "https://ntfy.sh").replace(/\/$/, "");

  let seen = {};
  try {
    seen = JSON.parse(await fs.readFile(SEEN_PATH, "utf8"));
  } catch {
    log("no prior state — first run will seed without notifying");
  }
  const firstRun = Object.keys(seen).length === 0;

  // --- roles
  let roles = await fromJson();
  if (!roles) {
    log("falling back to README parse");
    roles = parseReadme(await getText(README_URL));
  }
  log(`fetched ${roles.length} roles`);

  const matches = buildMatcher(cfg);
  const hits = [];
  for (const r of roles) {
    const m = matches(r);
    if (!m.ok) continue;
    if (seen[r.id]) continue;
    seen[r.id] = new Date().toISOString().slice(0, 10);
    hits.push({ ...r, tier: m.tier });
  }
  log(`${hits.length} new matching roles`);

  if (firstRun) {
    log("seeded state; suppressing the initial flood. Next run notifies for real.");
  } else if (hits.length) {
    // Batch politely: individual pushes up to a limit, then one roll-up.
    const individual = hits.slice(0, cfg.maxIndividualAlerts);
    for (const r of individual) {
      await ntfy(cfg, {
        title: `${r.company} — ${r.title}`,
        body: r.locations.length ? r.locations.join(" · ") : "Location not listed",
        priority: r.tier === "high" ? "high" : "default",
        tags: r.category === "pm" ? ["clipboard"] : ["bar_chart"],
        click: r.url,
      });
    }
    const rest = hits.slice(cfg.maxIndividualAlerts);
    if (rest.length) {
      await ntfy(cfg, {
        title: `+${rest.length} more new roles`,
        body: rest.map((r) => `${r.company} — ${r.title}`).join("\n").slice(0, 900),
        priority: "default",
        tags: ["package"],
      });
    }
  }

  // --- program calendar
  const programs = JSON.parse(await fs.readFile(path.join(HERE, "programs.json"), "utf8"));
  const nudges = firstRun ? 0 : await checkPrograms(cfg, programs, seen);
  if (nudges) log(`${nudges} program watch windows opened`);

  await fs.mkdir(path.dirname(SEEN_PATH), { recursive: true });
  await fs.writeFile(SEEN_PATH, JSON.stringify(seen, null, 0) + "\n");
  log("state saved");
}

// Exported for tests. main() only runs when this file is the entry point.
export { parseReadme, buildMatcher, normalizeJsonRow, checkPrograms };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[pm-watch] fatal:", e);
    process.exit(1);
  });
}

import fs from "node:fs/promises";
import { parseReadme, buildMatcher } from "../check.mjs";

const md = await fs.readFile(new URL("./fixture.md", import.meta.url), "utf8");
const rows = parseReadme(md);
console.log(`=== PARSED ${rows.length} ROWS ===`);
for (const r of rows) {
  console.log(`[${r.category.padEnd(4)}] ${r.company.padEnd(17)} | ${r.title.slice(0,55).padEnd(55)} | active=${String(r.active).padEnd(5)} grad=${String(r.advancedDegree).padEnd(5)} locs=${r.locations.length}`);
  console.log(`         id=${r.id}  url=${r.url.slice(0,62)}`);
}

const cfg = JSON.parse(await fs.readFile(new URL("../config.json", import.meta.url), "utf8"));
const matches = buildMatcher(cfg);
console.log(`\n=== FILTER (categories: ${JSON.stringify(cfg.categories)}) ===`);
for (const r of rows) {
  const m = matches(r);
  console.log(`${m.ok ? "KEEP" : "drop"}  ${r.company.padEnd(17)} ${r.title.slice(0,50).padEnd(50)} ${m.ok ? "tier=" + m.tier : "(" + m.why + ")"}`);
}

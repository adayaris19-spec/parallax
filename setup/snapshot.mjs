/* Rebuild the register snapshot embedded in frontier.html.
 *
 * The page embeds the claims table so it renders where it cannot reach the
 * database — a sandboxed frame blocks every host. Keeping that snapshot fresh
 * by hand is exactly how it goes stale, so this reads a `dump` reply and
 * rewrites the array in place.
 *
 *   node setup/snapshot.mjs dump.json
 *
 * where dump.json is the reply to {"mode":"dump"} from the sky worker, or a
 * bare array of claim rows. Prints what changed; writes nothing else.
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) {
  console.error("usage: node setup/snapshot.mjs <dump.json>");
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(src, "utf8"));
const claims = Array.isArray(parsed) ? parsed : parsed.claims;
if (!Array.isArray(claims) || !claims.length) {
  console.error("no claims in that file — a dump reply has {claims: [...]}");
  process.exit(1);
}

// Newest first, so the page's own ordering needs no second sort to be right.
claims.sort((a, b) => Date.parse(b.opened_at || 0) - Date.parse(a.opened_at || 0));

const page = "frontier.html";
const html = readFileSync(page, "utf8");
const open = html.indexOf("const SNAPSHOT = ");
if (open < 0) throw new Error("frontier.html has no SNAPSHOT to replace");
const start = html.indexOf("[", open);

// Walk the array rather than matching a bracket with a regex: claim text is
// full of brackets, and a greedy match would take the rest of the file.
let depth = 0, end = -1, inStr = false, esc = false;
for (let i = start; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') inStr = true;
  else if (c === "[") depth++;
  else if (c === "]" && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error("could not find the end of the SNAPSHOT array");

const before = (html.slice(start, end).match(/"claim_id"/g) || []).length;
writeFileSync(page, html.slice(0, start) + JSON.stringify(claims, null, 1) + html.slice(end));

const open_ = claims.filter(c => (c.status || "open") === "open").length;
const kinds = {};
for (const c of claims) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
console.log(`snapshot: ${before} -> ${claims.length} claims  (${open_} open)`);
console.log(`kinds:    ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join("  ")}`);
console.log(`newest:   ${claims[0].opened_at}  ${claims[0].title}`);

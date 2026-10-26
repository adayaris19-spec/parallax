// PARALLAX daily health check (run by .github/workflows/health.yml). Calls parallax_health() in the
// database and keeps one GitHub issue up to date: opened (tagging the owner, so GitHub emails them)
// when something needs attention, updated when the list changes, closed when everything is healthy.
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const SUPA_URL = /const SUPA_URL = '([^']+)'/.exec(html)[1];
const SUPA_KEY = /const SUPA_KEY = '([^']+)'/.exec(html)[1]; // the site's public key
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN, OWNER = REPO.split("/")[0];
const TITLE = "Parallax health check";

const rows = await fetch(`${SUPA_URL}/rest/v1/rpc/parallax_health`, { method: "POST", headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" }, body: "{}" })
  .then(async (r) => { if (!r.ok) throw new Error(`health check failed: ${r.status} ${await r.text()}`); return r.json(); })
  .catch((e) => [{ level: "error", area: "health check", message: String(e.message || e).slice(0, 300) }]);

const gh = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const open = (await gh(`/issues?state=open&labels=health&per_page=10`)).find((i) => i.title === TITLE);

const icon = { error: "🔴", warning: "🟡" };
const list = rows.map((r) => `- ${icon[r.level] ?? "•"} **${r.area}**: ${r.message}`).join("\n");
const body = `Parallax's daily check found ${rows.length} thing${rows.length === 1 ? "" : "s"} that need attention:\n\n${list}\n\nChecked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. This issue updates daily and closes itself when everything is healthy. Ask Claude to look into it, or see \`parallax_health()\` in setup/schema-health.sql.`;

if (!rows.length) {
  if (open) {
    await gh(`/issues/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body: "All healthy again. Closing." }) });
    await gh(`/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
  }
  console.log("All healthy.");
} else if (!open) {
  await gh(`/labels`, { method: "POST", body: JSON.stringify({ name: "health", color: "d73a4a", description: "Parallax daily health check" }) }).catch(() => {});
  await gh(`/issues`, { method: "POST", body: JSON.stringify({ title: TITLE, body: `@${OWNER} ${body}`, labels: ["health"] }) });
  console.log(`Opened an issue with ${rows.length} item(s).`);
} else {
  const before = new Set((open.body.match(/^- .*$/gm) || []).map((l) => l.replace(/\d+× in the last 6 hours \(last [^)]*\)/, "")));
  const fresh = rows.filter((r) => !before.has(`- ${icon[r.level] ?? "•"} **${r.area}**: ${r.message}`.replace(/\d+× in the last 6 hours \(last [^)]*\)/, "")));
  await gh(`/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ body: `@${OWNER} ${body}` }) });
  if (fresh.length) await gh(`/issues/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body: `@${OWNER} New since last check:\n\n${fresh.map((r) => `- ${icon[r.level] ?? "•"} **${r.area}**: ${r.message}`).join("\n")}` }) });
  console.log(`Updated the issue (${fresh.length} new).`);
}
console.log(list || "(nothing)");

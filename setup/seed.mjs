// Seeds Parallax with its starting goals by calling the map-goal function.
//
// Run from the repo root (Node 18 or newer):
//   ADMIN_TOKEN=<the token you set in Supabase> node setup/seed.mjs
// Optional: pass your own goals as arguments instead of the list below:
//   ADMIN_TOKEN=... node setup/seed.mjs "humans living on Mars" "fusion power on the grid"
//
// Each goal takes about a minute to be understood, then a few more minutes to
// finish mapping in the background. Goals that already exist are skipped.

const SUPA_URL = process.env.SUPA_URL ?? "https://zfmjjazkmolvywvayjzj.supabase.co";
const ANON =
  process.env.SUPA_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmbWpqYXprbW9sdnl3dmF5anpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzQ2NjEsImV4cCI6MjEwMTYxMDY2MX0.NA72AfuZ7axlxGBfKJwR4aNKyufjUz--fm3CG1_dCY8";
const ADMIN = process.env.ADMIN_TOKEN;
if (!ADMIN) {
  console.error("Set ADMIN_TOKEN to the same value as the ADMIN_TOKEN secret in Supabase.");
  process.exit(1);
}

const GOALS = [
  "Humans living on Mars",
  "A permanent human base on the Moon",
  "Fusion power on the grid",
  "Grid-scale storage for renewable energy",
  "Cheap, safe solid-state batteries",
  "Removing carbon dioxide from the air at gigaton scale",
  "Room-temperature superconductors",
  "Quantum computers that solve useful problems",
  "A cure for Alzheimer's",
  "Detecting cancer early with a blood test",
  "Slowing human aging",
  "Eradicating malaria",
  "Ending tuberculosis",
  "A cure for HIV",
  "A universal flu vaccine",
  "Beating antibiotic-resistant bacteria",
  "Stopping the next pandemic before it spreads",
  "Lab-grown organs for transplant",
  "Repairing spinal cord injuries",
  "Restoring sight to the blind",
  "Brain-computer interfaces that restore movement and speech",
  "Effective treatment for depression for everyone",
  "Curing type 1 diabetes",
  "Feeding 10 billion people sustainably",
  "Clean drinking water for everyone",
  "Cheap desalination of seawater",
  "Clean air in every city",
  "Restoring coral reefs",
  "Cleaning plastic out of the oceans",
  "Safely disposing of nuclear waste",
  "Predicting earthquakes",
  "Protecting Earth from asteroid impacts",
  "Cleaning up space debris in orbit",
  "Finding life beyond Earth",
  "Identifying what dark matter is",
  "Understanding how consciousness arises in the brain",
];

const goals = process.argv.length > 2 ? process.argv.slice(2) : GOALS;

async function mapOne(query) {
  const r = await fetch(`${SUPA_URL}/functions/v1/map-goal`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      "x-parallax-admin": ADMIN,
    },
    body: JSON.stringify({ query }),
  });
  const data = await r.json().catch(() => ({}));
  if (data.slug) return `${data.duplicate ? "already there" : "mapping"}  -> #/g/${data.slug}`;
  if (data.rejected) return `rejected: ${data.rejected}`;
  return `error ${r.status}: ${data.error ?? "no details"}`;
}

// Three at a time keeps the archive and the model busy without flooding either.
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < goals.length) {
    const q = goals[next++];
    const result = await mapOne(q).catch((e) => `error: ${e.message}`);
    console.log(`${q.padEnd(60)} ${result}`);
  }
}));
console.log("\nDone. Goals finish mapping in the background over the next few minutes.");

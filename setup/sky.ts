// PARALLAX sky worker v1 — paste into the Supabase Edge Function named `sky`.
//
// THE SECOND EYE.
//
// `ingest` reads what people have written. This reads what the sky actually
// did. Neither one alone can produce a claim: one vantage point gives you a
// picture, and depth needs two. What this function computes is the distance
// between them.
//
// The unit of comparison is a QUANTITY attached to a named OBJECT. This
// planet's density. This event's chirp mass. This asteroid's albedo. It arrives
// from two directions:
//
//   MEASURED — an observatory publishes a number and an error bar, machine
//     readable, with its own provenance string. Nobody had to read anything.
//   REPORTED — a paper states a value in its abstract. A model pulls it out,
//     and the sentence it came from is kept, so the number can be checked
//     against the text rather than believed.
//
// Hold them against each other and the disagreement is arithmetic:
//
//       sigma = |measured - reported| / sqrt(err_m^2 + err_r^2)
//
// That is the entire claim. No model is consulted about whether a tension is
// real, because a model's opinion is not checkable and this number is. A reader
// who distrusts Parallax entirely can recompute it by hand in thirty seconds,
// and that is the only form of trust that survives the machine being wrong once.
//
// Two rules are enforced in code rather than in prose, because both of them are
// the difference between an instrument and a generator of plausible sentences:
//
//   * NO ERROR BAR, NO CLAIM. A disagreement between two numbers that carry no
//     stated uncertainty is not a disagreement, it is two numbers. Those are
//     recorded and skipped, and the ledger says how many were skipped for it.
//   * NO KILL CONDITION, NO CLAIM. Every claim minted here carries the
//     measurement that would end it. There is no path through this file that
//     writes a claim without one; `mint` will not build the row.
//
// Deployment note: every source below is an open, key-free endpoint, but the
// adapters were written against documented response shapes and have NOT been
// run against the live services from the authoring environment. They are
// deliberately tolerant — an unexpected shape yields zero rows and a ledger
// line, never a thrown error — so the first deploy should be read off the
// ledger, not assumed. `mode: "probe"` exists to do exactly that.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANT = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "parallax-research@example.org";
const WORKER_VERSION = 1;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function sb(path: string, method = "GET", body?: unknown, prefer?: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok && r.status !== 409) console.log("supabase", path, r.status, await r.text());
  try { return await r.json(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const UA = { "User-Agent": `PARALLAX/1.0 (research monitor; ${MAIL})` };
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

async function getJSON(url: string, headers: Record<string, string> = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* Virtual Observatory services all speak TAP, and TAP replies in one of two
   JSON dialects depending on the server's mood: an array of objects, or a
   column list plus an array of positional rows. Normalising both here means an
   adapter never has to care which one it got, and a server that switches
   dialects between releases does not silently return nothing. */
function tapRows(j: any): Record<string, any>[] {
  if (!j) return [];
  if (Array.isArray(j)) return j.filter((r) => r && typeof r === "object");
  const cols: string[] = (j.metadata ?? j.fields ?? j.columns ?? [])
    .map((c: any) => String(c?.name ?? c?.colname ?? c ?? "").toLowerCase());
  const data: any[][] = j.data ?? [];
  if (!cols.length || !Array.isArray(data)) return [];
  return data.map((row) => {
    const o: Record<string, any> = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

// ---------------------------------------------------------------------------
// units
//
// Two archives that disagree about whether a radius is in Earth radii or
// Jupiter radii will disagree by a factor of eleven, and a machine that reports
// that as a discovery is worse than useless. So nothing is ever compared in the
// unit it arrived in. Anything with no known conversion is stored raw and is
// never eligible to produce a claim.
// ---------------------------------------------------------------------------
const UNITS: Record<string, [number, string]> = {
  // length -> metres
  m: [1, "m"], km: [1e3, "m"], cm: [1e-2, "m"],
  rearth: [6.3781e6, "m"], "r_earth": [6.3781e6, "m"], re: [6.3781e6, "m"],
  rjup: [7.1492e7, "m"], "r_jup": [7.1492e7, "m"], rj: [7.1492e7, "m"],
  rsun: [6.957e8, "m"], "r_sun": [6.957e8, "m"],
  au: [1.495978707e11, "m"], pc: [3.0856775814913673e16, "m"],
  kpc: [3.0856775814913673e19, "m"], mpc: [3.0856775814913673e22, "m"],
  ly: [9.4607304725808e15, "m"],
  // mass -> kilograms
  kg: [1, "kg"], g: [1e-3, "kg"],
  mearth: [5.97217e24, "kg"], "m_earth": [5.97217e24, "kg"], me: [5.97217e24, "kg"],
  mjup: [1.898125e27, "kg"], "m_jup": [1.898125e27, "kg"], mj: [1.898125e27, "kg"],
  msun: [1.988409e30, "kg"], "m_sun": [1.988409e30, "kg"],
  // density -> kg/m^3
  "kg/m3": [1, "kg/m3"], "g/cm3": [1e3, "kg/m3"], "g/cm^3": [1e3, "kg/m3"],
  // time -> seconds
  s: [1, "s"], sec: [1, "s"], min: [60, "s"], hr: [3600, "s"], h: [3600, "s"],
  d: [86400, "s"], day: [86400, "s"], days: [86400, "s"],
  yr: [3.15576e7, "s"], year: [3.15576e7, "s"], years: [3.15576e7, "s"],
  // velocity -> m/s
  "m/s": [1, "m/s"], "km/s": [1e3, "m/s"],
  // dimensionless / already canonical
  k: [1, "K"], deg: [1, "deg"], mag: [1, "mag"], "": [1, ""],
};

function normalise(value: number | null, err: number | null, unit: string) {
  const key = String(unit ?? "").toLowerCase().replace(/\s+/g, "").replace(/[⊕]/g, "earth");
  const hit = UNITS[key];
  if (!hit || value === null) return { value_si: null, err_si: null, unit_si: null };
  return {
    value_si: value * hit[0],
    err_si: err === null ? null : Math.abs(err) * hit[0],
    unit_si: hit[1],
  };
}

/* Archives name the same physical thing differently and a comparison keyed on
   the archive's column name would never match anything. This is the only place
   a quantity gets its canonical name. */
const QMAP: Record<string, string> = {
  pl_rade: "radius", pl_radj: "radius", radius: "radius", r: "radius",
  pl_bmasse: "mass", pl_bmassj: "mass", mass: "mass",
  mass_1_source: "mass", mass_2_source: "mass", chirp_mass: "chirp-mass",
  pl_dens: "density", density: "density",
  pl_orbper: "period", period: "period", per: "period",
  pl_eqt: "equilibrium-temperature", teq: "equilibrium-temperature",
  st_rad: "stellar-radius", st_mass: "stellar-mass", st_teff: "stellar-teff",
  sy_dist: "distance", luminosity_distance: "distance", distance: "distance",
  albedo: "albedo", diameter: "diameter", h: "absolute-magnitude",
};
const qname = (s: string) => QMAP[String(s ?? "").toLowerCase()] ?? String(s ?? "").toLowerCase();

// ---------------------------------------------------------------------------
// what the sky did
//
// Every source returns the same row shape and every one is allowed to fail on
// its own without taking the sweep with it — the same contract the archive
// perimeter runs on, for the same reason: a sweep that is only as reliable as
// its least reliable service is not a sweep.
// ---------------------------------------------------------------------------
type Obs = {
  source: string; source_id: string; object: string; quantity: string;
  value: number | null; err: number | null; unit: string;
  value_si: number | null; err_si: number | null; unit_si: string | null;
  epoch: string | null; ra: number | null; dec: number | null;
  reference: string; url: string; meta?: Record<string, unknown>;
};

function obs(o: Partial<Obs> & { source: string; source_id: string; object: string; quantity: string }): Obs {
  const n = normalise(o.value ?? null, o.err ?? null, o.unit ?? "");
  return {
    value: null, err: null, unit: "", epoch: null, ra: null, dec: null,
    reference: "", url: "", ...o, ...n,
  } as Obs;
}

/* The mean of the two asymmetric error bars an archive usually gives. A planet
   whose radius is +0.4/-0.3 is carried as 0.35, which is the honest thing to do
   when the comparison downstream assumes a symmetric sigma — and it is stated
   here rather than buried, because it is an approximation. */
const sym = (hi: unknown, lo: unknown): number | null => {
  const a = num(hi), b = num(lo);
  if (a === null && b === null) return null;
  return (Math.abs(a ?? b!) + Math.abs(b ?? a!)) / 2;
};

/* NASA Exoplanet Archive. The single richest machine-readable table of measured
   quantities with error bars and a provenance string per row, which is why it
   is the natural first source for the second eye: it is already shaped like
   what a claim needs. */
async function fromExoplanetArchive(target: string, rows: number): Promise<Obs[]> {
  const where = target
    ? `where upper(pl_name) like '%${target.toUpperCase().replace(/'/g, "")}%'`
    : `where pl_dens is not null and default_flag = 1`;
  const q = `select top ${rows} pl_name,hostname,pl_rade,pl_radeerr1,pl_radeerr2,` +
    `pl_bmasse,pl_bmasseerr1,pl_bmasseerr2,pl_dens,pl_denserr1,pl_denserr2,` +
    `pl_orbper,pl_orbpererr1,pl_orbpererr2,st_rad,st_raderr1,st_raderr2,` +
    `ra,dec,disc_year,pl_refname from ps ${where}`;
  const j = await getJSON(
    `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(q)}&format=json`,
    {}, 25000,
  );
  const out: Obs[] = [];
  for (const r of tapRows(j)) {
    const name = clean(r.pl_name);
    if (!name) continue;
    const base = {
      source: "exoplanet-archive",
      object: name,
      ra: num(r.ra), dec: num(r.dec),
      reference: clean(r.pl_refname).replace(/<[^>]+>/g, " ").trim(),
      url: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(name)}`,
      epoch: num(r.disc_year) ? `${num(r.disc_year)}-01-01` : null,
    };
    const cols: [string, string, unknown, unknown, unknown][] = [
      ["radius", "rearth", r.pl_rade, r.pl_radeerr1, r.pl_radeerr2],
      ["mass", "mearth", r.pl_bmasse, r.pl_bmasseerr1, r.pl_bmasseerr2],
      ["density", "g/cm3", r.pl_dens, r.pl_denserr1, r.pl_denserr2],
      ["period", "day", r.pl_orbper, r.pl_orbpererr1, r.pl_orbpererr2],
      ["stellar-radius", "rsun", r.st_rad, r.st_raderr1, r.st_raderr2],
    ];
    for (const [quantity, unit, v, e1, e2] of cols) {
      const value = num(v);
      if (value === null) continue;
      out.push(obs({ ...base, source_id: `exo:${name}`, quantity, value, err: sym(e1, e2), unit }));
    }
  }
  return out;
}

/* Gravitational wave events. Every one is a measured mass and distance with
   published uncertainties, and the catalogue is small enough to hold whole —
   which makes it the cheapest possible check that the reconcile path works. */
async function fromGWOSC(_target: string, rows: number): Promise<Obs[]> {
  const j = await getJSON("https://gwosc.org/eventapi/json/GWTC/", {}, 20000);
  const events = j?.events ?? {};
  const out: Obs[] = [];
  for (const key of Object.keys(events).slice(0, rows)) {
    const e = events[key] ?? {};
    const name = clean(e.commonName || key);
    const base = {
      source: "gwosc", source_id: `gwosc:${name}`, object: name,
      reference: clean(e.catalog?.shortName ?? e.catalog ?? "GWTC"),
      url: `https://gwosc.org/eventapi/html/event/${encodeURIComponent(name)}/`,
      epoch: null as string | null,
    };
    const cols: [string, string, unknown, unknown, unknown][] = [
      ["mass", "msun", e.mass_1_source, e.mass_1_source_upper, e.mass_1_source_lower],
      ["chirp-mass", "msun", e.chirp_mass_source ?? e.chirp_mass, e.chirp_mass_upper, e.chirp_mass_lower],
      ["distance", "mpc", e.luminosity_distance, e.luminosity_distance_upper, e.luminosity_distance_lower],
      ["final-mass", "msun", e.final_mass_source, e.final_mass_source_upper, e.final_mass_source_lower],
    ];
    for (const [quantity, unit, v, e1, e2] of cols) {
      const value = num(v);
      if (value === null) continue;
      out.push(obs({ ...base, quantity, value, err: sym(e1, e2), unit }));
    }
  }
  return out;
}

/* JPL's small-body database. Solar system objects carry measured diameters and
   albedos, and — unlike almost everything else — an orbit good enough that a
   disagreement about where something is has an unambiguous answer. */
async function fromSBDB(target: string, rows: number): Promise<Obs[]> {
  const fields = "full_name,diameter,diameter_sigma,albedo,H,e,a,per";
  const url = target
    ? `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(target)}&phys-par=1`
    : `https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=${fields}&sb-class=AMO&limit=${rows}`;
  const j = await getJSON(url, {}, 20000);
  const out: Obs[] = [];

  // single-object lookup replies with a different shape from the bulk query
  if (j?.object?.fullname) {
    const name = clean(j.object.fullname);
    for (const p of j.phys_par ?? []) {
      const quantity = qname(clean(p.name));
      const value = num(p.value);
      if (value === null) continue;
      out.push(obs({
        source: "sbdb", source_id: `sbdb:${name}`, object: name, quantity,
        value, err: num(p.sigma), unit: clean(p.units),
        reference: clean(p.ref), url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(name)}`,
      }));
    }
    return out;
  }

  const cols: string[] = (j?.fields ?? []).map((f: any) => String(f).toLowerCase());
  for (const row of (j?.data ?? []).slice(0, rows)) {
    const o: Record<string, any> = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    const name = clean(o.full_name);
    if (!name) continue;
    const base = {
      source: "sbdb", source_id: `sbdb:${name}`, object: name, reference: "JPL SBDB",
      url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(name)}`,
    };
    const d = num(o.diameter);
    if (d !== null) out.push(obs({ ...base, quantity: "diameter", value: d, err: num(o.diameter_sigma), unit: "km" }));
    const al = num(o.albedo);
    if (al !== null) out.push(obs({ ...base, quantity: "albedo", value: al, err: null, unit: "" }));
  }
  return out;
}

/* ALeRCE, the ZTF alert broker. This is the stream the frontier's orphans come
   out of: objects that were detected, catalogued, and then never written about
   by anybody. It carries no error bars, so nothing here can produce a tension
   claim — it feeds the other kind. */
async function fromALeRCE(target: string, rows: number): Promise<Obs[]> {
  const q = target
    ? `https://api.alerce.online/ztf/v1/objects?oid=${encodeURIComponent(target)}`
    : `https://api.alerce.online/ztf/v1/objects?page_size=${rows}&order_by=lastmjd&order_mode=DESC`;
  const j = await getJSON(q, {}, 20000);
  const items = j?.items ?? (Array.isArray(j) ? j : []);
  const out: Obs[] = [];
  for (const it of items.slice(0, rows)) {
    const name = clean(it.oid);
    if (!name) continue;
    const n = num(it.ndethist ?? it.ndet);
    out.push(obs({
      source: "alerce", source_id: `ztf:${name}`, object: name,
      quantity: "detections", value: n, err: null, unit: "",
      ra: num(it.meanra), dec: num(it.meandec),
      reference: clean(it.class_name ?? it.classifier ?? "ZTF alert stream"),
      url: `https://alerce.online/object/${encodeURIComponent(name)}`,
      meta: { first_mjd: num(it.firstmjd), last_mjd: num(it.lastmjd), probability: num(it.probability) },
    }));
  }
  return out;
}

/* SIMBAD, via TAP. Not a source of new measurements so much as the naming
   authority: it is how an object that four archives call four different things
   is recognised as one object. */
async function fromSimbad(target: string, rows: number): Promise<Obs[]> {
  if (!target) return [];
  const adql = `select top ${rows} main_id, ra, dec, plx_value, plx_err ` +
    `from basic where main_id = '${target.replace(/'/g, "''")}'`;
  const j = await getJSON(
    `https://simbad.cds.unistra.fr/simbad/sim-tap/sync?request=doQuery&lang=adql&format=json&query=${encodeURIComponent(adql)}`,
    {}, 20000,
  );
  const out: Obs[] = [];
  for (const r of tapRows(j)) {
    const name = clean(r.main_id);
    const p = num(r.plx_value);
    if (!name || p === null) continue;
    out.push(obs({
      source: "simbad", source_id: `simbad:${name}`, object: name,
      quantity: "parallax", value: p, err: num(r.plx_err), unit: "",
      ra: num(r.ra), dec: num(r.dec), reference: "SIMBAD basic",
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(name)}`,
    }));
  }
  return out;
}

const SOURCES: { name: string; run: (t: string, n: number) => Promise<Obs[]> }[] = [
  { name: "exoplanet-archive", run: fromExoplanetArchive },
  { name: "gwosc", run: fromGWOSC },
  { name: "sbdb", run: fromSBDB },
  { name: "alerce", run: fromALeRCE },
  { name: "simbad", run: fromSimbad },
];

/* One pass over every live source. A slow service is recorded as skipped rather
   than being allowed to hold the sweep hostage, because the caller is a browser
   and a browser that waits forever reports "failed to fetch" with nothing to
   debug — the failure mode this codebase has already been bitten by once. */
async function skyPerimeter(target: string, per: number, deadlineMs = 26000) {
  const ledger: any[] = [];
  const rows: Obs[] = [];
  const started = Date.now();
  await Promise.all(SOURCES.map(async (s) => {
    const t0 = Date.now();
    try {
      const got = await Promise.race([
        s.run(target, per),
        new Promise<Obs[]>((_, rej) =>
          setTimeout(() => rej(new Error("deadline")), Math.max(1000, deadlineMs - (Date.now() - started)))),
      ]);
      ledger.push({ name: s.name, got: got.length, ms: Date.now() - t0 });
      rows.push(...got);
    } catch (e) {
      ledger.push({ name: s.name, got: 0, ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 110) });
    }
  }));
  return { rows, ledger };
}

// ---------------------------------------------------------------------------
// what the papers said
// ---------------------------------------------------------------------------
async function ask(prompt: string, maxTokens: number) {
  if (!ANT) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) { console.log("ask", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/* The extraction is the one place a model touches the claim path, and it is
   confined to a job models are actually reliable at: reading a stated number
   off a sentence. It is not asked whether the number is right, or interesting,
   or in tension with anything. It is asked what the paper said, and to hand
   back the sentence it said it in, so the answer can be checked against the
   text without trusting the reader. */
async function extractFrom(records: any[]): Promise<any[]> {
  if (!records.length) return [];
  const digest = records.map((r, i) =>
    `[${i}] (${r.year ?? r.published_at?.slice(0, 4) ?? "n/a"}) ${clean(r.title)}\n${clean(r.abstract).slice(0, 900)}`
  ).join("\n\n");

  const out = await ask(
    `Extract every quantitative measurement stated in these abstracts.\n\n` +
    `Rules:\n` +
    `- Only values the text actually states. Never infer, never convert, never round.\n` +
    `- "object" is the named thing measured (e.g. "Kepler-10 b", "GW150914"). Skip if unnamed.\n` +
    `- "quantity" is one of: radius, mass, density, period, distance, chirp-mass,\n` +
    `  stellar-radius, stellar-mass, equilibrium-temperature, albedo, diameter, parallax.\n` +
    `  Skip anything that is not one of these.\n` +
    `- "err" is the stated uncertainty, symmetric, in the same unit. null if the text gives none.\n` +
    `- "quote" is the exact sentence the number came from, verbatim.\n` +
    `- "confidence" 0..1 is how sure you are you read it correctly.\n\n` +
    `Return JSON only: {"m":[{"i":<index>,"object":"","quantity":"","value":0,"err":null,` +
    `"unit":"","quote":"","confidence":0.0}]}\n\n${digest}`,
    3000,
  );

  const rows: any[] = [];
  for (const m of out?.m ?? []) {
    const src = records[Number(m.i)];
    const value = num(m.value);
    if (!src || value === null || !m.object || !m.quantity) continue;
    const unit = clean(m.unit);
    const n = normalise(value, num(m.err), unit);
    rows.push({
      record_id: src.id ?? null,
      object: clean(m.object),
      quantity: qname(clean(m.quantity)),
      value, err: num(m.err), unit,
      ...n,
      year: src.year ?? num(String(src.published_at ?? "").slice(0, 4)),
      quote: clean(m.quote).slice(0, 500),
      confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// the distance between the two eyes
//
// Everything below is arithmetic. No model runs past this line.
// ---------------------------------------------------------------------------

/* Deterministic, so the same disagreement re-derived tomorrow is the same claim
   rather than a second one. A claim whose identifier changed every sweep could
   never be cited, watched, or scored — and being citable is the whole road from
   website to infrastructure. */
function claimId(kind: string, object: string, quantity: string, year: number): string {
  let h = 0x811c9dc5;
  for (const ch of `${kind}|${object.toLowerCase()}|${quantity}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `PARALLAX-${year}-${String(h % 100000).padStart(5, "0")}`;
}

const key = (o: string, q: string) => `${o.toLowerCase().replace(/\s+/g, " ").trim()}|${q}`;

type Tension = {
  object: string; quantity: string; unit: string;
  measured: any; reported: any; sigma: number; ratio: number;
};

/* sigma = |a - b| / sqrt(sa^2 + sb^2).
   Both sides must carry an uncertainty and both must have normalised into the
   same canonical unit. Anything failing either test is counted and dropped —
   never guessed at, never compared in mixed units. */
function reconcile(observations: Obs[], reported: any[]) {
  const byKey = new Map<string, Obs[]>();
  for (const o of observations) {
    if (o.value_si === null) continue;
    const k = key(o.object, o.quantity);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(o);
  }

  const tensions: Tension[] = [];
  const skipped = { no_error_bar: 0, no_common_unit: 0, no_counterpart: 0, agreed: 0 };

  for (const r of reported) {
    const k = key(String(r.object ?? ""), String(r.quantity ?? ""));
    const matches = byKey.get(k);
    if (!matches?.length) { skipped.no_counterpart++; continue; }

    // the tightest measurement wins; an archive that states no error cannot be
    // the thing a published value is judged against
    const m = matches
      .filter((o) => o.err_si !== null && o.err_si > 0)
      .sort((a, b) => (a.err_si! - b.err_si!))[0];
    if (!m) { skipped.no_error_bar++; continue; }
    if (r.value_si === null || r.err_si === null || r.err_si <= 0) { skipped.no_error_bar++; continue; }
    if (r.unit_si !== m.unit_si) { skipped.no_common_unit++; continue; }

    const diff = Math.abs(m.value_si! - r.value_si);
    const joint = Math.sqrt(m.err_si! ** 2 + r.err_si ** 2);
    const sigma = joint > 0 ? diff / joint : 0;
    if (sigma < 3) { skipped.agreed++; continue; }

    tensions.push({
      object: m.object, quantity: m.quantity, unit: m.unit_si!,
      measured: {
        source: m.source, value: m.value, err: m.err, unit: m.unit,
        value_si: m.value_si, err_si: m.err_si,
        reference: m.reference, url: m.url,
      },
      reported: {
        record_id: r.record_id, year: r.year, value: r.value, err: r.err, unit: r.unit,
        value_si: r.value_si, err_si: r.err_si, quote: r.quote, confidence: r.confidence,
      },
      sigma: Number(sigma.toFixed(2)),
      ratio: m.value_si ? Number((r.value_si / m.value_si).toFixed(3)) : 0,
    });
  }
  tensions.sort((a, b) => b.sigma - a.sigma);
  return { tensions, skipped };
}

/* The other kind of claim, and the one that needs no literature value at all:
   something was observed, catalogued, and never written about. Forgotten is not
   the same as refuted, and neither is unexamined. */
function orphans(observations: Obs[], reported: any[]) {
  const written = new Set(reported.map((r) => key(String(r.object ?? ""), String(r.quantity ?? ""))));
  const objects = new Set(reported.map((r) => String(r.object ?? "").toLowerCase().trim()));
  const out: any[] = [];
  const seen = new Set<string>();
  for (const o of observations) {
    const obj = o.object.toLowerCase().trim();
    if (objects.has(obj) || written.has(key(o.object, o.quantity)) || seen.has(obj)) continue;
    seen.add(obj);
    out.push({
      object: o.object, quantity: o.quantity, source: o.source,
      value: o.value, unit: o.unit, url: o.url, reference: o.reference,
      ra: o.ra, dec: o.dec, meta: o.meta ?? {},
    });
  }
  return out;
}

/* There is no path through this function that produces a claim without a kill
   condition — `kill` is required, and a caller that omits it gets null rather
   than a claim with an empty field. The rule is enforced here, once, rather
   than trusted to every call site. */
function mint(o: {
  kind: string; object: string; quantity: string; title: string; statement: string;
  kill: string; cost?: string; sigma?: number; observed?: any; reported?: any; figure?: any;
}) {
  if (!o.kill || !clean(o.kill)) return null;
  if (!o.object || !o.quantity) return null;
  const year = new Date().getUTCFullYear();
  return {
    claim_id: claimId(o.kind, o.object, o.quantity, year),
    kind: o.kind,
    object: o.object,
    quantity: o.quantity,
    title: o.title,
    statement: o.statement,
    sigma: o.sigma ?? null,
    observed: o.observed ?? null,
    reported: o.reported ?? null,
    kill: clean(o.kill),
    cost: o.cost ?? null,
    figure: o.figure ?? null,
    status: "open",
  };
}

const fmt = (v: number | null, u: string) =>
  v === null ? "n/a" : `${Number(v.toPrecision(4))}${u ? " " + u : ""}`;

function claimsFrom(tensions: Tension[], orph: any[]) {
  const out: any[] = [];

  for (const t of tensions) {
    const m = t.measured, r = t.reported;
    out.push(mint({
      kind: "tension",
      object: t.object,
      quantity: t.quantity,
      title: `The published ${t.quantity} of ${t.object} disagrees with the archive`,
      statement:
        `${m.source} measures ${fmt(m.value, m.unit)} ± ${fmt(m.err, "")}. ` +
        `A ${r.year ?? "published"} paper states ${fmt(r.value, r.unit)} ± ${fmt(r.err, "")}. ` +
        `Those are ${t.sigma}σ apart. One of the two is wrong, and which one is not ` +
        `determined by anything in the record.`,
      sigma: t.sigma,
      observed: m,
      reported: r,
      kill:
        `One independent re-measurement of the ${t.quantity} of ${t.object} at or below ` +
        `${fmt(m.err, m.unit)} precision. If it lands on the published value, this claim is wrong ` +
        `and the archive carries an error; if it lands on the archive value, the paper does.`,
      cost: "One measurement at existing precision — no new instrument required.",
      figure: {
        type: "interval",
        unit: t.unit,
        series: [
          { label: m.source, value: m.value_si, err: m.err_si },
          { label: `published ${r.year ?? ""}`.trim(), value: r.value_si, err: r.err_si },
        ],
        sigma: t.sigma,
      },
    }));
  }

  for (const o of orph) {
    out.push(mint({
      kind: "orphan",
      object: o.object,
      quantity: o.quantity,
      title: `Nothing published explains ${o.object}`,
      statement:
        `${o.source} carries ${o.object} (${fmt(o.value, o.unit)}), catalogued and ` +
        `unremarked: no paper in the corpus this sweep returned states a measured ` +
        `quantity for it. Catalogued is not the same as understood.`,
      observed: o,
      kill:
        `A single paper that measures or models ${o.object}. If one exists and this sweep ` +
        `missed it, this claim is wrong and the perimeter has a gap worth knowing about.`,
      cost: "Archival — the data is already public.",
      figure: { type: "position", ra: o.ra, dec: o.dec, label: o.object, meta: o.meta },
    }));
  }

  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// the function
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await handle(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e), worker: WORKER_VERSION }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function handle(req: Request): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends nothing */ }
  const mode = String(body.mode ?? "tension");
  const target = String(body.target ?? "").slice(0, 120);
  const per = Math.min(Math.max(Number(body.limit) || 40, 5), 200);
  const t0 = Date.now();

  // ---------- probe: is every live source actually answering? ----------
  /* The first thing to run after a deploy. It reports the ledger and one sample
     row per source and writes nothing, so a source whose response shape has
     moved shows up as a zero here rather than as silence in a claim sweep. */
  if (mode === "probe") {
    const { rows, ledger } = await skyPerimeter(target, 5);
    const sample: Record<string, unknown> = {};
    for (const r of rows) if (!sample[r.source]) sample[r.source] = r;
    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0,
      ledger, total: rows.length, sample,
      healthy: ledger.filter((l: any) => l.got > 0).map((l: any) => l.name),
      silent: ledger.filter((l: any) => !l.got).map((l: any) => l.name),
    });
  }

  // ---------- sky: sweep the live sources and store what they said ----------
  if (mode === "sky") {
    const { rows, ledger } = await skyPerimeter(target, per);
    if (rows.length && body.store !== false) {
      await sb("observations?on_conflict=source,source_id,quantity", "POST", rows,
        "resolution=merge-duplicates,return=minimal");
    }
    return json({ worker: WORKER_VERSION, mode, ms: Date.now() - t0, ledger, observations: rows });
  }

  // ---------- tension: both eyes, and the distance between them ----------
  /* The whole mechanism in one request. The sky sweep and the literature read
     are independent, so they run at the same time; the reconcile that follows
     is pure arithmetic and costs nothing. */
  if (mode === "tension") {
    const since = String(body.since ?? "").slice(0, 10);
    const [{ rows: sky, ledger }, stored] = await Promise.all([
      skyPerimeter(target, per),
      sb(`records?select=id,title,abstract,published_at,relevance&order=published_at.desc&limit=${
        Math.min(per, 60)}${since ? `&published_at=gte.${since}` : ""}`) as Promise<any[]>,
    ]);

    const records = Array.isArray(stored) ? stored : [];
    const reported = await extractFrom(records);
    if (reported.length && body.store !== false) {
      await sb("measurements", "POST", reported, "return=minimal");
    }

    const { tensions, skipped } = reconcile(sky, reported);
    const orph = orphans(sky, reported);
    const claims = claimsFrom(tensions, orph.slice(0, 10));

    if (claims.length && body.store !== false) {
      await sb("claims?on_conflict=claim_id", "POST",
        claims.map((c) => ({ ...c, last_moved_at: new Date().toISOString() })),
        "resolution=merge-duplicates,return=minimal");
    }

    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0,
      ledger,
      read: { observations: sky.length, papers: records.length, measurements: reported.length },
      /* Published in the response for the same reason the scorecard publishes
         losses: a sweep that compared four things and claimed one tension is a
         different object from one that compared four thousand, and hiding the
         denominator is how a frontier starts looking more certain than it is. */
      skipped,
      tensions,
      orphans: orph.slice(0, 10),
      claims,
    });
  }

  // ---------- scorecard: what it has claimed, and how that went ----------
  if (mode === "scorecard") {
    const [board, open] = await Promise.all([
      sb("claim_scorecard?select=*"),
      sb("claims?select=claim_id,kind,object,quantity,title,sigma,status,opened_at&order=sigma.desc&limit=50"),
    ]);
    return json({ worker: WORKER_VERSION, mode, ms: Date.now() - t0, scorecard: board, claims: open });
  }

  return json({ error: `unknown mode '${mode}'`, modes: ["probe", "sky", "tension", "scorecard"] }, 400);
}

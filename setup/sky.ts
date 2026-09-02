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
/* Bumped on every change that alters what a sweep returns. The reply carries
   it, so "is the deployed function the code I just pasted" is answered by
   reading one number rather than by inferring it from which fields happen to be
   present — which is how a run that tested nothing got mistaken for a run that
   tested something. */
const WORKER_VERSION = 24;

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

/* WHAT EACH TABLE ACTUALLY HAS.
   The worker gained a quote_shows_value field on every measurement and went on
   POSTing it to a table that has no such column. PostgREST rejects the whole
   insert when one key is unknown, so measurements stopped being stored
   entirely — and the only sign of it was a line in a console log nobody reads.
   Several versions ran that way.

   So rows are reduced to the columns that exist before they are sent. A field
   the code wants to carry in its reply but not in the database now costs
   nothing instead of silently destroying the write. */
const COLUMNS: Record<string, string[]> = {
  observations: [
    "source", "source_id", "object", "quantity", "value", "err", "unit",
    "value_si", "err_si", "unit_si", "epoch", "ra", "dec", "reference", "url", "meta",
  ],
  measurements: [
    "record_id", "object", "quantity", "value", "err", "unit",
    "value_si", "err_si", "unit_si", "year", "quote", "confidence",
  ],
  claims: [
    "claim_id", "kind", "object", "quantity", "title", "statement", "sigma",
    "observed", "reported", "kill", "cost", "figure", "status", "last_moved_at",
  ],
};
const forTable = (table: string, rows: any[]) => {
  const cols = COLUMNS[table];
  if (!cols) return rows;
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of cols) if (c in r) o[c] = r[c];
    return o;
  });
};

/* A write says whether it worked. `sb` swallows failure into a log line, which
   is how an insert can fail on every sweep for days without anyone noticing —
   the same blindness this worker has now been fixed for in four other places,
   and the one place it mattered most, because a silent write failure loses
   data rather than merely hiding a diagnosis. */
async function write(table: string, path: string, rows: any[], prefer: string) {
  if (!rows.length) return { table, rows: 0 };
  const body = forTable(table, rows);
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SRK, Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json", Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (r.ok || r.status === 409) return { table, rows: rows.length };
  const detail = await r.text().catch(() => "");
  return { table, rows: 0, attempted: rows.length, status: r.status, error: detail.slice(0, 200) };
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

async function postJSON(url: string, payload: unknown, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
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
  /* Ages arrive in these. Teaching them is what turns the guard below from luck
     into a rule: an age is refused because 10^17 seconds is not an orbital
     period, not because nobody told this file what a gigayear is. */
  kyr: [3.15576e10, "s"], myr: [3.15576e13, "s"], gyr: [3.15576e16, "s"],
  ga: [3.15576e16, "s"], ma: [3.15576e13, "s"],
  // velocity -> m/s
  "m/s": [1, "m/s"], "km/s": [1e3, "m/s"],
  // angle on the sky -> milliarcseconds
  mas: [1, "mas"], arcsec: [1e3, "mas"], as: [1e3, "mas"],

  /* WRITTEN-OUT AND CGS FORMS.
     A catalogue column says "rearth". A paper says "Earth radii", or "R_⊕", or
     "g cm^-3", because it is prose written for people. Sixteen correctly-read
     measurements were discarded in one sweep for arriving in units an
     astronomer would consider completely ordinary, and a measurement thrown
     away for its spelling is indistinguishable downstream from one that was
     never made. */
  earthmass: [5.97217e24, "kg"], earthmasses: [5.97217e24, "kg"],
  jupitermass: [1.898125e27, "kg"], jupitermasses: [1.898125e27, "kg"],
  solarmass: [1.988409e30, "kg"], solarmasses: [1.988409e30, "kg"],
  earthradius: [6.3781e6, "m"], earthradii: [6.3781e6, "m"],
  jupiterradius: [7.1492e7, "m"], jupiterradii: [7.1492e7, "m"],
  solarradius: [6.957e8, "m"], solarradii: [6.957e8, "m"],
  "gcm-3": [1e3, "kg/m3"], gcm3: [1e3, "kg/m3"], "gcc": [1e3, "kg/m3"],
  "g/cc": [1e3, "kg/m3"], "g/cm-3": [1e3, "kg/m3"],
  "kgm-3": [1, "kg/m3"],
  "kms-1": [1e3, "m/s"], "ms-1": [1, "m/s"],
  earthday: [86400, "s"], earthdays: [86400, "s"],
  // dimensionless / already canonical
  k: [1, "K"], deg: [1, "deg"], mag: [1, "mag"], "": [1, ""],
};

/* Reduce a unit as a paper writes it to the one form the table is keyed on.
   Astronomical symbols first, because they carry the meaning: an Earth symbol
   is the difference between a rocky planet and a star. Then the typographic
   scaffolding that means nothing — underscores, braces, carets, dollar signs
   and dot separators left over from mathematics — and finally the plural. */
function unitKey(unit: string): string {
  return String(unit ?? "")
    .toLowerCase()
    .replace(/[⊕]/g, "earth")
    .replace(/[⊙☉]/g, "sun")
    .replace(/[♃]/g, "jupiter")
    /* Written mathematics, once the backslash and braces are gone: a paper
       typesets an Earth symbol as \oplus and a solar one as \odot, so R_\oplus
       arrives here as roplus and matched nothing. */
    .replace(/oplus/g, "earth")
    .replace(/odot/g, "sun")
    .replace(/[_{}$\\·⋅×]/g, "")
    .replace(/\^/g, "")
    .replace(/\s+/g, "");
}

function normalise(value: number | null, err: number | null, unit: string) {
  const key = unitKey(unit);
  const hit = UNITS[key];
  if (!hit || value === null) return { value_si: null, err_si: null, unit_si: null };
  /* Rounded for the same reason the symmetrised error bar is: converting
     0.029 Earth radii to metres yields 184964.90000000002, and that figure
     was on its way onto a published plot. Twelve significant figures is orders
     of magnitude beyond any measurement here, so no sigma can move. */
  const tidy = (n: number) => Number(n.toPrecision(12));
  return {
    value_si: tidy(value * hit[0]),
    err_si: err === null ? null : tidy(Math.abs(err) * hit[0]),
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
  "stellar-teff": "stellar-teff", teff: "stellar-teff",
  sy_dist: "distance", luminosity_distance: "distance", distance: "distance",
  albedo: "albedo", diameter: "diameter", h: "absolute-magnitude",
};
const qname = (s: string) => QMAP[String(s ?? "").toLowerCase()] ?? String(s ?? "").toLowerCase();

/* THE UNIT MUST AGREE WITH THE QUANTITY.
   A sweep of TRAPPIST-1 read ages in Gyr, transit epochs in BJD_TDB, X-ray
   luminosity ratios and transit depths in ppm — and labelled every one of them
   with a quantity this worker accepts. They were discarded only because those
   units happen to be absent from the table, which is luck, not a rule. An age
   quoted in DAYS would have been filed as an orbital period and compared
   against one, and a billion years against a few days is exactly the shape of a
   spectacular, confident, entirely false tension.

   So a quantity now declares its dimension, and a value whose unit does not
   resolve to that dimension is refused however plausibly it was labelled. This
   is the same guard as never comparing across units, applied one step earlier:
   there, two values had to agree with each other; here, a value has to agree
   with what it claims to be.

   It is not a complete guard, and should not be mistaken for one. An age and an
   orbital period are both times, so a 7.6 Gyr age labelled as a period is
   refused only because Gyr is absent from the unit table; quoted in years it
   would pass this check. Separating those needs a plausible range per quantity,
   which this worker does not have yet. */
/* What each quantity can plausibly be, in its canonical unit. Deliberately
   generous — these are not measurements, they are the edges past which a number
   cannot be the thing it says it is. A period of 10^17 seconds is not a long
   orbit, it is the age of a star wearing the wrong label, and that is the one
   confusion a dimension check alone can never catch because both are times.

   Applied to values read out of prose, not to catalogue rows: an archive that
   states a curated number with an error bar has already been checked by people,
   and silently dropping its values would hide a real disagreement rather than
   catch a false one. */
const QRANGE: Record<string, [number, number]> = {
  radius: [1e5, 2e12],            // a small moon to a red giant
  diameter: [1, 1e10],
  "stellar-radius": [1e7, 2e12],
  distance: [1e15, 1e27],         // inside a parsec, out to a gigaparsec
  mass: [1e18, 1e34],             // a large asteroid to a few hundred suns
  "stellar-mass": [1e28, 1e33],
  "chirp-mass": [1e29, 1e34],
  "final-mass": [1e29, 1e34],
  density: [10, 1e6],
  period: [1, 1e12],              // a second to ~30,000 years. An age is 10^16.
  "equilibrium-temperature": [1, 1e4],
  "stellar-teff": [500, 1e6],
  parallax: [1e-4, 1e4],
  albedo: [0, 1.5],
  "absolute-magnitude": [-30, 40],
};

/* Exported shape kept simple so the rule can be tested directly rather than
   only through a model call that needs a network. */
function plausible(quantity: string, valueSI: number | null): boolean {
  const r = QRANGE[quantity];
  if (!r || valueSI === null) return true;
  return Math.abs(valueSI) >= r[0] && Math.abs(valueSI) <= r[1];
}

const QDIM: Record<string, string> = {
  radius: "m", diameter: "m", "stellar-radius": "m", distance: "m",
  mass: "kg", "stellar-mass": "kg", "chirp-mass": "kg", "final-mass": "kg",
  density: "kg/m3",
  period: "s",
  "equilibrium-temperature": "K", "stellar-teff": "K",
  parallax: "mas",
  albedo: "", detections: "", "absolute-magnitude": "mag",
};

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
  const m = (Math.abs(a ?? b!) + Math.abs(b ?? a!)) / 2;
  /* Averaging +0.029/-0.029 in binary floating point yields
     0.028999999999999998, and that number goes on to be printed inside a
     published claim and drawn on its figure. Twelve significant figures is far
     beyond any real measurement precision, so this cannot change a comparison
     — it only stops the arithmetic's own noise from being displayed as though
     it were part of the measurement. */
  return Number(m.toPrecision(12));
};

/* NASA Exoplanet Archive. The single richest machine-readable table of measured
   quantities with error bars and a provenance string per row, which is why it
   is the natural first source for the second eye: it is already shaped like
   what a claim needs. */
async function fromExoplanetArchive(target: string, rows: number): Promise<Obs[]> {
  /* A leading wildcard cannot use an index, so '%KEPLER-10%' scans the whole
     Planetary Systems table and the request dies at its own deadline — which is
     what happened the first time a target was passed. Anchoring the pattern
     lets the match start from the front, and default_flag pins it to one row
     per planet instead of every published parameter set for it. */
  const t = target.toUpperCase().replace(/['%_]/g, "");
  const where = target
    ? `where default_flag = 1 and (upper(pl_name) like '${t}%' or upper(hostname) like '${t}%')`
    : `where pl_dens is not null and default_flag = 1`;
  /* Ask for every quantity a paper is likely to state, not only the ones a
     catalogue leads with. Ten measurements were read correctly out of Kepler-10
     abstracts and then had nothing to be compared against, because the papers
     talked about the star's mass, the planet's equilibrium temperature and the
     system's distance, and this query had never asked for any of them. A
     quantity the archive is not asked for is a comparison that cannot happen. */
  const q = `select top ${rows} pl_name,hostname,pl_rade,pl_radeerr1,pl_radeerr2,` +
    `pl_bmasse,pl_bmasseerr1,pl_bmasseerr2,pl_dens,pl_denserr1,pl_denserr2,` +
    `pl_orbper,pl_orbpererr1,pl_orbpererr2,st_rad,st_raderr1,st_raderr2,` +
    `st_mass,st_masserr1,st_masserr2,pl_eqt,pl_eqterr1,pl_eqterr2,` +
    `sy_dist,sy_disterr1,sy_disterr2,st_teff,st_tefferr1,st_tefferr2,` +
    `ra,dec,disc_year,pl_refname from ps ${where}`;
  const j = await getJSON(
    `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(q)}&format=json`,
    {}, 10000,
  );
  const out: Obs[] = [];
  const hostsSeen = new Set<string>();
  for (const r of tapRows(j)) {
    const name = clean(r.pl_name);
    if (!name) continue;
    /* ONE ROW PER PUBLICATION, KEPT AS ONE ROW PER PUBLICATION.
       The `ps` table returns every published parameter set for a planet, which
       is precisely the data this project exists to compare. Keying a row on the
       planet name alone collapsed all of them onto a single row, so the store
       held whichever paper the archive happened to return last and every other
       measurement was discarded on write. Nothing reported it, because an
       upsert that overwrites is not an error.

       The reference is part of the identity of a measurement. */
    const refSlug = clean(r.pl_refname).replace(/<[^>]+>/g, " ")
      .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();
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
      ["stellar-mass", "msun", r.st_mass, r.st_masserr1, r.st_masserr2],
      ["equilibrium-temperature", "k", r.pl_eqt, r.pl_eqterr1, r.pl_eqterr2],
      ["distance", "pc", r.sy_dist, r.sy_disterr1, r.sy_disterr2],
      ["stellar-teff", "k", r.st_teff, r.st_tefferr1, r.st_tefferr2],
    ];
    for (const [quantity, unit, v, e1, e2] of cols) {
      const value = num(v);
      if (value === null) continue;
      out.push(obs({ ...base, source_id: `exo:${name}:${refSlug || "unref"}`, quantity, value, err: sym(e1, e2), unit }));
    }

    /* THE STAR HAS TO BE AN OBJECT TOO.
       Every row above is filed under the planet's name, the star's own mass and
       radius included. So a paper stating "TRAPPIST-1 has a mass of 0.0898
       solar masses" produces object TRAPPIST-1, and there is no observation
       anywhere carrying that name — the host is measured constantly and was
       never comparable to anything.

       The same values are therefore emitted a second time under the host, and
       renamed as the host's own: what the catalogue calls the stellar radius is
       simply the radius of the star. Once per host rather than once per planet,
       since seven planets share one. */
    const host = clean(r.hostname);
    if (host && !hostsSeen.has(host)) {
      hostsSeen.add(host);
      const starCols: [string, string, unknown, unknown, unknown][] = [
        ["radius", "rsun", r.st_rad, r.st_raderr1, r.st_raderr2],
        ["mass", "msun", r.st_mass, r.st_masserr1, r.st_masserr2],
        ["stellar-teff", "k", r.st_teff, r.st_tefferr1, r.st_tefferr2],
        ["distance", "pc", r.sy_dist, r.sy_disterr1, r.sy_disterr2],
      ];
      for (const [quantity, unit, v, e1, e2] of starCols) {
        const value = num(v);
        if (value === null) continue;
        out.push(obs({
          source: "exoplanet-archive", source_id: `exo:star:${host}:${refSlug || "unref"}`, object: host,
          quantity, value, err: sym(e1, e2), unit,
          ra: num(r.ra), dec: num(r.dec),
          reference: clean(r.pl_refname).replace(/<[^>]+>/g, " ").trim(),
          url: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(host)}`,
        }));
      }
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
  /* `count=false` is not an optimisation, it is the difference between a reply
     and a timeout. Asked for a total, this API counts the whole object table
     before returning a page of twenty; the first deploy aborted at 20s on
     exactly that. Sorting the full table by date is the same trap, so the
     untargeted call takes the natural order and pages instead. */
  const q = target
    ? `https://api.alerce.online/ztf/v1/objects?oid=${encodeURIComponent(target)}&count=false`
    : `https://api.alerce.online/ztf/v1/objects?page_size=${Math.min(rows, 50)}&count=false`;
  /* Six seconds, not twelve. This source is one of five and the only one that
     has ever hung; a sweep that spends half its wall clock waiting on the
     member most likely to be down has its budget backwards. If ALeRCE is up it
     answers well inside this, and if it is not, Fink covers the same ground. */
  const j = await getJSON(q, {}, 6000);
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

/* Fink, the other public broker over the same ZTF stream. It is here because
   the alert stream is the only thing feeding orphan detection, and a frontier
   whose supply of unexplained objects depends on one service that has already
   gone down once is not a frontier. Two brokers reading the same telescope also
   cross-check each other: an object one carries and the other does not is worth
   a second look at the broker, not at the sky.

   The API moved hosts, and which one answers depends on when you ask, so both
   are tried in turn rather than picking one and being wrong later. */
async function fromFink(target: string, rows: number): Promise<Obs[]> {
  const payload = target
    ? { objectId: target, columns: "i:objectId,i:ra,i:dec,i:ndethist,i:jd,d:classification" }
    : { class: "allclasses", n: String(Math.min(rows, 50)), columns: "i:objectId,i:ra,i:dec,i:ndethist,i:jd,d:classification" };

  let j: any = null;
  let last = "";
  for (const host of ["https://api.fink-portal.org", "https://fink-portal.org"]) {
    try {
      j = await postJSON(`${host}/api/v1/${target ? "objects" : "latests"}`, payload, 8000);
      break;
    } catch (e) { last = String((e as Error)?.message ?? e); }
  }
  if (!j) throw new Error(last || "no host answered");

  const items = Array.isArray(j) ? j : (j.items ?? []);
  const out: Obs[] = [];
  for (const it of items.slice(0, rows)) {
    const name = clean(it["i:objectId"] ?? it.objectId);
    if (!name) continue;
    out.push(obs({
      source: "fink", source_id: `ztf:${name}`, object: name,
      quantity: "detections", value: num(it["i:ndethist"] ?? it.ndethist), err: null, unit: "",
      ra: num(it["i:ra"] ?? it.ra), dec: num(it["i:dec"] ?? it.dec),
      reference: clean(it["d:classification"] ?? "ZTF alert stream (Fink)"),
      url: `https://fink-portal.org/${encodeURIComponent(name)}`,
      meta: { jd: num(it["i:jd"] ?? it.jd) },
    }));
  }
  return out;
}

/* SIMBAD, via TAP. Not a source of new measurements so much as the naming
   authority: it is how an object that four archives call four different things
   is recognised as one object. */
async function fromSimbad(target: string, rows: number): Promise<Obs[]> {
  /* Thrown rather than returned empty, because those are different facts and a
     ledger that renders them identically is lying. A source that answered and
     had nothing is a source that works; this one was never asked. */
  if (!target) throw new Error("needs a target");
  /* Matched through `ident`, not on `main_id`. SIMBAD's main identifier for
     Vega is "* alf Lyr", so a query keyed on the name a person would actually
     type finds nothing — and resolving exactly that mismatch is the entire
     reason this source is in the perimeter. The alias table is the naming
     authority; `basic` is only where the numbers live. */
  const adql = `select top ${rows} b.main_id, b.ra, b.dec, b.plx_value, b.plx_err ` +
    `from basic b join ident i on b.oid = i.oidref ` +
    `where i.id = '${target.replace(/'/g, "''")}'`;
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
      /* Stated as mas rather than left blank. A parallax carried as
         dimensionless would share a canonical unit with every other unitless
         quantity in the table, and the only thing standing between it and a
         nonsense comparison would be the quantity name matching. */
      quantity: "parallax", value: p, err: num(r.plx_err), unit: "mas",
      ra: num(r.ra), dec: num(r.dec), reference: "SIMBAD basic",
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(name)}`,
    }));
  }
  return out;
}

/* `probe` is what a source needs to be asked in order to demonstrate that it
   works. Most answer a bulk request and need nothing; the ones that only speak
   about a named object need a name, and without one a health check reports them
   as broken when they are merely unasked.

   `optional` sources are not swept by default. Both ZTF brokers hang from this
   runtime — two independent services, different countries, different hosting,
   one GET and one POST, timing out identically while four other observatories
   answer in under two seconds. That pattern is the network path, not the
   adapters, and it is not worth a sweep's wall clock to keep discovering.

   Nothing is lost by holding them back. Neither broker publishes an error bar,
   so neither can ever produce a tension; they only ever fed orphan detection,
   and orphans come just as well from sources that work. Most numbered small
   bodies in SBDB have never had a paper written about them, which is precisely
   the definition. Pass {"all": true} to sweep them anyway. */
const SOURCES: {
  name: string;
  run: (t: string, n: number) => Promise<Obs[]>;
  probe?: string;
  optional?: boolean;
}[] = [
  { name: "exoplanet-archive", run: fromExoplanetArchive },
  { name: "gwosc", run: fromGWOSC },
  { name: "sbdb", run: fromSBDB },
  { name: "simbad", run: fromSimbad, probe: "Vega" },
  { name: "alerce", run: fromALeRCE, optional: true },
  { name: "fink", run: fromFink, optional: true },
];

/* One pass over every live source. A slow service is recorded as skipped rather
   than being allowed to hold the sweep hostage, because the caller is a browser
   and a browser that waits forever reports "failed to fetch" with nothing to
   debug — the failure mode this codebase has already been bitten by once. */
async function skyPerimeter(
  target: string, per: number, deadlineMs = 26000, useProbeTargets = false, all = false,
) {
  const ledger: any[] = [];
  const rows: Obs[] = [];
  const started = Date.now();
  const live = SOURCES.filter((s) => all || !s.optional);
  for (const s of SOURCES) {
    if (!live.includes(s)) ledger.push({ name: s.name, got: 0, ms: 0, skipped: "optional" });
  }
  await Promise.all(live.map(async (s) => {
    const t0 = Date.now();
    const ask = target || (useProbeTargets ? s.probe ?? "" : "");
    /* One retry before a source is believed dead. The exoplanet archive
       answered in two seconds on three consecutive sweeps and timed out on the
       fourth with an identical query — service latency, not a bad request. It
       is also the only source that can supply the planet side of a comparison,
       so when it drops out the entire sweep has one eye open and every
       measurement lands in no_counterpart. */
    const attempt = async (): Promise<Obs[]> => {
      try { return await s.run(ask, per); }
      catch (e) {
        const m = String((e as Error)?.message ?? e);
        if (m === "needs a target") throw e;
        await new Promise((r) => setTimeout(r, 500));
        return await s.run(ask, per);
      }
    };
    /* The deadline timer has to be cancelled when the source wins the race.
       Left running, it rejects a promise that nothing is listening to any more,
       and an unhandled rejection in this runtime is not a warning — it can take
       the isolate down. Sources normally do beat the deadline, so the leak
       would fire on essentially every sweep rather than in some rare corner. */
    let timer: number | undefined;
    try {
      const got = await Promise.race([
        attempt(),
        new Promise<Obs[]>((_, rej) => {
          timer = setTimeout(() => rej(new Error("deadline")),
            Math.max(1000, deadlineMs - (Date.now() - started)));
        }),
      ]);
      ledger.push({ name: s.name, got: got.length, ms: Date.now() - t0 });
      rows.push(...got);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 110);
      /* A source that only answers about a named object, asked about nothing,
         is not a fault — it is unasked. Logged as skipped so a real sweep's
         ledger is not carrying a permanent red line that means nothing. */
      if (msg === "needs a target") ledger.push({ name: s.name, got: 0, ms: 0, skipped: "needs a target" });
      else ledger.push({ name: s.name, got: 0, ms: Date.now() - t0, error: msg });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }));
  return { rows, ledger };
}

// ---------------------------------------------------------------------------
// what the papers said
// ---------------------------------------------------------------------------
/* Returns the reason it failed, not merely null. A sweep once read thirty-six
   papers, kept nothing, and reported every drop counter at zero — which says
   only that the model returned no items, and cannot distinguish an API error
   from an empty reply from output that would not parse. Three different faults,
   one silence. */
async function ask(prompt: string, maxTokens: number): Promise<{ data: any; error: string }> {
  if (!ANT) return { data: null, error: "no ANTHROPIC_API_KEY" };
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) { return { data: null, error: "fetch: " + String((e as Error)?.message ?? e).slice(0, 80) }; }

  if (!r.ok) return { data: null, error: `HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}` };
  const j = await r.json().catch(() => null);
  const text = j?.content?.[0]?.text ?? "";
  /* A truncated reply is the likely failure when the digest is large, and it
     looks identical to a refusal unless the stop reason is read. */
  const stop = j?.stop_reason ? ` stop_reason=${j.stop_reason}` : "";
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return { data: null, error: `no JSON in reply${stop} (${String(text).slice(0, 80)})` };
  try { return { data: JSON.parse(m[0]), error: "" }; }
  catch (e) { return { data: null, error: `unparseable JSON${stop}: ${String((e as Error)?.message ?? e).slice(0, 80)}` }; }
}

/* The extraction is the one place a model touches the claim path, and it is
   confined to a job models are actually reliable at: reading a stated number
   off a sentence. It is not asked whether the number is right, or interesting,
   or in tension with anything. It is asked what the paper said, and to hand
   back the sentence it said it in, so the answer can be checked against the
   text without trusting the reader. */
async function extractFrom(records: any[]) {
  /* Every reason a paper's numbers fail to become a comparison, counted. A bare
     "measurements: 0" is indistinguishable between no API key, a model that
     returned nothing, and values that were read and then dropped — three
     different faults with three different fixes, and a sweep that cannot tell
     them apart cannot be debugged from its own output. */
  const diag = {
    model_configured: !!ANT,
    papers_in: records.length,
    model_replied: false,
    model_error: "",
    items_returned: 0,
    kept: 0,
    dropped: {
      bad_index: 0, no_object: 0, no_value: 0,
      unknown_quantity: 0, no_unit_match: 0, value_not_in_text: 0,
      wrong_dimension: 0, implausible: 0,
    },
    /* When nothing at all survives, the first few items exactly as the model
       returned them. Twenty items discarded under one counter says something is
       wrong; it does not say what, and every round spent guessing at that is a
       redeploy nobody needed. */
    sample_items: [] as any[],
    /* The unit strings that could not be converted, verbatim. Nine of twenty
       readings were discarded for their spelling in one sweep and the counter
       could not say which spellings, so the fix was a guess. This is the fourth
       place in this file where naming a failure replaced guessing at it. */
    unconverted_units: [] as string[],
  };
  if (!records.length || !ANT) return { rows: [] as any[], diag };
  /* Capped. Thirty-six abstracts at nine hundred characters is a thirty
     thousand character prompt, and a reply that runs out of room produces no
     JSON at all rather than fewer measurements. The papers are already sorted
     with the ones actually about the target first, so the cap takes the useful
     end. */
  const forPrompt = records.slice(0, 20);
  diag.papers_in = forPrompt.length;
  const digest = forPrompt.map((r, i) =>
    `[${i}] (${r.year ?? r.published_at?.slice(0, 4) ?? "n/a"}) ${clean(r.title)}\n${clean(r.abstract).slice(0, 900)}`
  ).join("\n\n");

  const asked = await ask(
    `Extract every quantitative measurement stated in these abstracts.\n\n` +
    `Rules:\n` +
    `- Only values the text actually states. Never infer, never convert, never round.\n` +
    `- A value you cannot find written in the text is not a measurement. Omit it.\n` +
    `- "object" is the named thing measured (e.g. "Kepler-10 b", "GW150914"). Skip if unnamed.\n` +
    `- "quantity" is one of: radius, mass, density, period, distance, chirp-mass,\n` +
    `  stellar-radius, stellar-mass, stellar-teff, equilibrium-temperature, albedo,\n` +
    `  diameter, parallax.\n` +
    `  Skip anything that is not one of these.\n` +
    `- "err" is the stated uncertainty, symmetric, in the same unit. null if the text gives none.\n` +
    `- "quote" is the exact sentence the number came from, copied verbatim from the\n` +
    `  text above. It MUST contain the digits of the value. If you cannot produce a\n` +
    `  sentence containing the number, do not report the measurement at all.\n` +
    `- "i" is the bracketed index of the abstract it came from. Required.\n` +
    `- "confidence" 0..1 is how sure you are you read it correctly.\n\n` +
    `Return JSON only: {"m":[{"i":<index>,"object":"","quantity":"","value":0,"err":null,` +
    `"unit":"","quote":"","confidence":0.0}]}\n\n${digest}`,
    3000,
  );

  /* THE RECEIPT HAS TO CONTAIN THE NUMBER.
     The first real tension this worker produced came with the quote
     "For Kepler-10c ( ) we measure mass and density" — a sentence offering no
     evidence for the 19.2 it was cited in support of. The value may well have
     been read correctly, but nothing in the reply could establish that, and a
     published claim resting on a number nobody can trace is the exact failure
     this whole design is meant to rule out.

     So a stated value must appear, as digits, in the text the model was shown.
     This cannot catch a misread number that happens to occur elsewhere in the
     abstract, but it does catch a number that was never there at all, which is
     the failure that matters. Numbers absent from the source are dropped and
     counted, never quietly kept at lower confidence. */
  const inText = (hay: string, v: number): boolean => {
    const h = String(hay).replace(/[\s,]/g, "");
    const forms = new Set<string>([String(v), String(Number(v.toPrecision(6)))]);
    const dp = (String(v).split(".")[1] ?? "").length;
    if (dp) forms.add(v.toFixed(dp));
    if (Number.isInteger(v)) { forms.add(v.toFixed(1)); forms.add(String(Math.trunc(v))); }
    for (const f of forms) if (f.length > 1 && h.includes(f)) return true;
    return false;
  };

  const out = asked.data;
  diag.model_replied = !!out;
  diag.model_error = asked.error;
  diag.items_returned = (out?.m ?? []).length;

  const rows: any[] = [];
  const ALLOWED = new Set(Object.values(QMAP));
  for (const m of out?.m ?? []) {
    const src = forPrompt[Number(m.i)];
    const value = num(m.value);
    if (!src) { diag.dropped.bad_index++; continue; }
    if (!m.object) { diag.dropped.no_object++; continue; }
    if (value === null) { diag.dropped.no_value++; continue; }
    const quantity = qname(clean(m.quantity));
    if (!quantity || !ALLOWED.has(quantity)) { diag.dropped.unknown_quantity++; continue; }
    const unit = clean(m.unit);
    const n = normalise(value, num(m.err), unit);
    if (n.unit_si === null) {
      diag.dropped.no_unit_match++;
      if (!diag.unconverted_units.includes(unit) && diag.unconverted_units.length < 12) {
        diag.unconverted_units.push(unit);
      }
      continue;
    }
    /* An age is not a period, whatever it was labelled. */
    const want = QDIM[quantity];
    if (want !== undefined && n.unit_si !== want) {
      diag.dropped.wrong_dimension++;
      if (!diag.unconverted_units.includes(`${quantity}:${unit}`) && diag.unconverted_units.length < 12) {
        diag.unconverted_units.push(`${quantity}:${unit}`);
      }
      continue;
    }
    /* An age is a time and so is a period; only the magnitude separates them. */
    if (!plausible(quantity, n.value_si)) {
      diag.dropped.implausible++;
      if (!diag.unconverted_units.includes(`${quantity}=${value}${unit}`) && diag.unconverted_units.length < 12) {
        diag.unconverted_units.push(`${quantity}=${value}${unit}`);
      }
      continue;
    }
    const source_text = `${src.title ?? ""} ${src.abstract ?? ""}`;
    if (!inText(source_text, value)) { diag.dropped.value_not_in_text++; continue; }
    diag.kept++;
    rows.push({
      record_id: src.id ?? null,
      object: clean(m.object),
      quantity,
      value, err: num(m.err), unit,
      ...n,
      year: src.year ?? num(String(src.published_at ?? "").slice(0, 4)),
      quote: clean(m.quote).slice(0, 500),
      /* Whether the sentence handed back as evidence actually shows the number.
         False does not invalidate the value — it survived the check against the
         full text above — but it means the quote is not the receipt it looks
         like, and a reader deserves to be told which they are holding. */
      quote_shows_value: inText(clean(m.quote), value),
      confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0)),
    });
  }
  if (!rows.length) diag.sample_items = (out?.m ?? []).slice(0, 3);
  return { rows, diag };
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

/* Papers write "Kepler-10b"; the archive writes "Kepler-10 b". Whitespace is
   the single most common reason two records of one object fail to meet, so it
   is removed entirely rather than merely collapsed. Hyphens and digits stay —
   they are the parts that actually distinguish one designation from another. */
const key = (o: string, q: string) => `${o.toLowerCase().replace(/\s+/g, "")}|${q}`;

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
        quote_shows_value: r.quote_shows_value,
      },
      sigma: Number(sigma.toFixed(2)),
      ratio: m.value_si ? Number((r.value_si / m.value_si).toFixed(3)) : 0,
    });
  }
  tensions.sort((a, b) => b.sigma - a.sigma);
  return { tensions, skipped };
}

/* Catalogues name objects in a way papers never do. SBDB calls it
   "433 Eros (A898 PA)"; the literature calls it "433 Eros", or just "Eros". The
   provisional designation in brackets is an archival key, and searching the
   literature for it returns nothing no matter how famous the object is — which
   is a fast route to announcing that nothing has been written about the
   asteroid NASA landed a spacecraft on. */
function searchName(object: string): string {
  return clean(String(object).replace(/\([^)]*\)/g, " ")).slice(0, 80);
}

/* Absence has to be earned.
   ------------------------------------------------------------------
   The first version of this called an object an orphan when it was missing
   from the handful of papers a sweep happened to read. That is a statement
   about the sweep, not about the literature: run against a corpus of black
   hole papers, it concluded that nothing had ever been written about 433 Eros,
   which NEAR Shoemaker orbited for a year and then landed on.

   So before Parallax says nothing explains an object, it goes and looks. One
   query per candidate against an index that covers every field, and the count
   comes back with the claim as its receipt.

   It fails CLOSED. If the check itself errors, no claim is minted — the one
   thing worse than missing an orphan is announcing an absence you could not
   verify. */
async function litCount(object: string): Promise<number | null> {
  const q = searchName(object);
  if (q.length < 3) return null;
  const j = await oaGet(
    `https://api.openalex.org/works?filter=title_and_abstract.search:${
      encodeURIComponent(q)}&per-page=1&mailto=${encodeURIComponent(MAIL)}`, 8000);
  const n = num(j?.meta?.count);
  return n === null ? null : n;
}

/* OpenAlex stores abstracts as a word -> positions map for licensing reasons.
   Rebuilding the sentence is the price of reading them. */
function deInvert(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const w of Object.keys(inv)) for (const p of inv[w] ?? []) words[p] = w;
  return clean(words.join(" ")).slice(0, 1600);
}

/* The literature for an object Parallax is actually holding.
   ------------------------------------------------------------------
   tension used to read whatever happened to be in `records`, which made the
   whole mechanism depend on somebody having run the archive worker earlier,
   with the right question, in the right words. Two eyes that only meet when a
   human remembers to aim them are not an instrument.

   So the papers are fetched for the objects in hand. Stored records are still
   read and still preferred — they have been through the relevance gate — but
   the sweep no longer needs them to exist. */
/* One retry, and a pause before it. Every sweep asks OpenAlex once per orphan
   candidate and once per object it wants papers for, and firing all of those at
   once is what turned nineteen fetched papers into five between two otherwise
   identical runs. A single failed call is indistinguishable from a subject
   nobody has written about, which makes a transient refusal look like a
   finding. */
/* The message, not only the count. Fourteen index calls failed in one CI sweep
   and every orphan candidate came back unverifiable; the claim rule correctly
   published nothing, but a bare count cannot distinguish a rate limit from a
   timeout from a service that has moved, and those have three different fixes.
   This is the third place in this file where a failure was counted without
   being named, and the third time it cost a round to find out why. */
const OA_FAILURES = { count: 0, last_error: "", statuses: [] as string[] };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function oaGet(url: string, ms = 10000): Promise<any | null> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await getJSON(url, {}, ms); }
    catch (e) {
      last = String((e as Error)?.message ?? e).slice(0, 90);
      /* A rate limit is worth waiting longer for than a dropped connection,
         and this index answers 429 when a burst is too wide rather than when
         the question is wrong. */
      if (attempt === 0) await pause(last.includes("429") ? 2000 : 600);
    }
  }
  OA_FAILURES.count++;
  OA_FAILURES.last_error = last;
  if (OA_FAILURES.statuses.length < 5) OA_FAILURES.statuses.push(last);
  return null;
}

/* arXiv, for the text OpenAlex cannot give.
   ------------------------------------------------------------------
   OpenAlex does not store an abstract, it stores a word-position map, and
   rebuilding one drops whatever did not survive tokenisation — which is
   reliably the mathematics. That is where
   "For Kepler-10c ( ) we measure mass and density" came from: the parenthetical
   held the numbers and was gone by the time anything read it. A model handed
   that sentence and asked for a mass will supply one from context, and the
   result is a fabricated value wearing a citation.

   arXiv returns the abstract as written. For a quantitative claim that is not a
   preference, it is the difference between extraction and invention. */
function pickTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? clean(m[1].replace(/<[^>]+>/g, " ")) : "";
}

const ARXIV = { calls: 0, failures: 0, empty: 0, last_error: "" };

async function arxivPapersFor(object: string, rows = 6): Promise<any[]> {
  const q = searchName(object);
  if (q.length < 3) return [];
  ARXIV.calls++;
  try {
    const xml = await (async () => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      try {
        /* Unquoted. arXiv tokenises inside a quoted phrase and a designation
           like Kepler-10 comes apart on the hyphen, so the quotes buy nothing
           and cost matches. Eight seconds, because three sequential batches of
           a ten second timeout is most of an Edge Function's budget spent
           waiting for one index. */
        const r = await fetch(
          `https://export.arxiv.org/api/query?search_query=${
            encodeURIComponent(`all:${q}`)}&sortBy=relevance&max_results=${rows}`,
          { headers: UA, signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.text();
      } finally { clearTimeout(t); }
    })();

    const out: any[] = [];
    for (const entry of String(xml).split("<entry>").slice(1)) {
      const id = (pickTag(entry, "id").split("/abs/")[1] ?? "").trim();
      const title = pickTag(entry, "title");
      const abstract = pickTag(entry, "summary").slice(0, 1800);
      if (!id || !title || !abstract) continue;
      const pub = pickTag(entry, "published");
      out.push({
        id: null, source_id: `arxiv:${id}`, title, abstract,
        published_at: pub || null, year: num(String(pub).slice(0, 4)),
        url: `https://arxiv.org/abs/${id}`, about: object,
      });
    }
    if (!out.length) ARXIV.empty++;
    return out;
  } catch (e) {
    /* Counted and named. The previous version swallowed this and returned an
       empty list, which is indistinguishable from an index that answered and
       had nothing — the precise confusion this worker already fixed once for
       OpenAlex and then reintroduced here. */
    ARXIV.failures++;
    ARXIV.last_error = String((e as Error)?.message ?? e).slice(0, 120);
    return [];
  }
}

async function papersFor(object: string, rows = 6): Promise<any[]> {
  const q = searchName(object);
  if (q.length < 3) return [];
  {
    const j = await oaGet(
      `https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(q)}` +
      /* NOT sorted by citation count. Ranking by fame returns the most-cited
         papers that happen to mention the name — for Kepler-10 that is the TESS
         mission description, which is about 200,000 stars and none of them in
         particular. The model then extracts real numbers belonging to no
         object, which is what twenty discarded items looked like. Relevance is
         the default and is the thing actually wanted: papers about this object. */
      `&per-page=${rows}&mailto=${encodeURIComponent(MAIL)}`,
    );
    return (j?.results ?? []).map((w: any) => ({
      id: null,
      source_id: clean(w.id),
      title: clean(w.display_name),
      abstract: deInvert(w.abstract_inverted_index),
      published_at: clean(w.publication_date) || null,
      year: num(w.publication_year),
      url: clean(w.doi || w.id),
      about: object,
    })).filter((r: any) => r.title && r.abstract);
  }
}

async function verifiedOrphans(candidates: any[], max = 8, chunk = 6) {
  /* In chunks rather than all at once. Eight parallel index calls is fine and
     three hundred is a burst the index answers with 429s, which fail closed and
     turn a working sweep into an empty one. */
  const take = candidates.slice(0, max);
  const checked: any[] = [];
  for (let i = 0; i < take.length; i += chunk) {
    checked.push(...await Promise.all(take.slice(i, i + chunk).map(async (o) => {
      const count = await litCount(o.object);
      return { ...o, searched_as: searchName(o.object), lit_count: count };
    })));
  }
  return {
    orphans: checked.filter((o) => o.lit_count === 0),
    /* Everything the check rejected, kept in the reply. A sweep that proposed
       ten absences and could stand behind none of them is the single most
       useful thing it can report about itself.

       And the two rejections are not the same thing: an object with papers is
       simply not an orphan, while an object whose check errored is one this
       worker cannot speak about either way. Counting them together is the
       mistake this file has made six times. */
    rejected: checked.filter((o) => typeof o.lit_count === "number" && o.lit_count > 0)
      .map((o) => ({ object: o.object, searched_as: o.searched_as, lit_count: o.lit_count })),
    unverifiable: checked.filter((o) => o.lit_count === null)
      .map((o) => ({ object: o.object, searched_as: o.searched_as })),
  };
}

/* The candidate list. Something observed, catalogued, and — pending the check
   above — never written about. Forgotten is not the same as refuted, and
   neither is unexamined. */
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
    /* Only an object that survived an actual literature search reaches here, so
       the claim can say so and name the search it survived. An absence stated
       without its search is an assertion; stated with one, it is checkable in
       the eight seconds it takes to run the same query. */
    if (o.lit_count !== 0) continue;
    const shown = searchName(o.object) || o.object;
    /* The observation's own provenance is part of the claim, not a detail to
       leave out. A gravitational wave event arrives stamped with the catalogue
       that measured it, and "no paper measures this" printed beside
       reference: GWTC is a claim contradicted by the row it was minted from.

       What the search actually establishes is narrower and still worth saying:
       nothing NAMES it. The measurement was published in a catalogue of
       hundreds and then never taken up by anybody — which is the real shape of
       an orphan, and is invisible to everyone precisely because the catalogue
       entry makes it look attended to. */
    const via = clean(o.reference);
    out.push(mint({
      kind: "orphan",
      object: o.object,
      quantity: o.quantity,
      title: `Nothing has been written about ${shown}`,
      statement:
        `${o.source} carries ${shown} (${fmt(o.value, o.unit)})` +
        (via ? `, on the authority of ${via}` : "") +
        `. Beyond that, a title and abstract search across OpenAlex — every field, ` +
        `every year — returns nothing that names it. ` +
        (via
          ? `It was reported once and never taken up.`
          : `Catalogued is not the same as understood.`),
      observed: { ...o, searched_as: o.searched_as, lit_count: o.lit_count },
      kill:
        `A single paper that measures or models ${shown}. One hit refutes this claim ` +
        `outright, and says the search behind it was too narrow — which is worth knowing ` +
        `about the perimeter regardless.`,
      cost: "Archival — the data is already public.",
      figure: { type: "position", ra: o.ra, dec: o.dec, label: shown, meta: o.meta },
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
  /* PER REQUEST, NOT PER ISOLATE.
     These counters live at module scope and an Edge Function reuses its isolate
     between requests, so a warm one inherits the previous sweep's failures and
     reports them as its own. Every diagnostic in this file is only worth reading
     if it describes the run that produced it; a count that silently accumulates
     across callers is worse than no count, because it is believed. */
  OA_FAILURES.count = 0; OA_FAILURES.last_error = ""; OA_FAILURES.statuses = [];
  ARXIV.calls = 0; ARXIV.failures = 0; ARXIV.empty = 0; ARXIV.last_error = "";

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
    const { rows, ledger } = await skyPerimeter(target, 5, 26000, true, body.all === true);
    const sample: Record<string, unknown> = {};
    for (const r of rows) if (!sample[r.source]) sample[r.source] = r;
    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0,
      ledger, total: rows.length, sample,
      healthy: ledger.filter((l: any) => l.got > 0).map((l: any) => l.name),
      /* Answered, but had nothing to say. A real state, and not the same as
         being broken — reporting the two together is how a working source gets
         chased for a fault it does not have. */
      empty: ledger.filter((l: any) => !l.got && !l.error && !l.skipped).map((l: any) => l.name),
      broken: ledger.filter((l: any) => l.error).map((l: any) => ({ name: l.name, error: l.error })),
      not_swept: ledger.filter((l: any) => l.skipped).map((l: any) => l.name),
    });
  }

  // ---------- papers: can the indices be read at all, and what comes back ----------
  /* A full sweep costs half a minute and touches six services to answer a
     question about two of them. This asks only what the paper indices return
     for one name, writes nothing, and hands back the first abstract from each
     so the text a model would be reading can be seen rather than inferred. */
  if (mode === "papers") {
    const name = target || "Kepler-10";
    const [ax, oa] = await Promise.all([arxivPapersFor(name, 5), papersFor(name, 5)]);
    /* Titles for everything, not just a sample. Whether an index returned
       papers about the object or merely papers that mention it is visible in
       the titles alone, and that single distinction is what decides whether
       extraction has anything to find. */
    const key = searchName(name).toLowerCase().replace(/\s+/g, "");
    const listing = (rs: any[]) => rs.map((r) => ({
      title: r.title,
      year: r.year,
      about_this_object: String(r.title ?? "").toLowerCase().replace(/\s+/g, "").includes(key),
    }));
    const first = (rs: any[]) => rs[0]
      ? { title: rs[0].title, abstract: String(rs[0].abstract).slice(0, 600) }
      : null;
    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0, searched_as: searchName(name),
      arxiv: { got: ax.length, calls: ARXIV.calls, failures: ARXIV.failures, last_error: ARXIV.last_error,
               titles: listing(ax), sample: first(ax) },
      openalex: { got: oa.length, failures: OA_FAILURES.count, errors: OA_FAILURES.statuses, titles: listing(oa), sample: first(oa) },
    });
  }

  // ---------- sky: sweep the live sources and store what they said ----------
  if (mode === "sky") {
    const { rows, ledger } = await skyPerimeter(target, per, 26000, false, body.all === true);
    const stored = body.store === false ? [] : [await write(
      "observations", "observations?on_conflict=source,source_id,quantity", rows,
      "resolution=merge-duplicates,return=minimal")];
    return json({ worker: WORKER_VERSION, mode, ms: Date.now() - t0, ledger, stored, observations: rows });
  }

  // ---------- tension: both eyes, and the distance between them ----------
  /* The whole mechanism in one request. The sky sweep and the literature read
     are independent, so they run at the same time; the reconcile that follows
     is pure arithmetic and costs nothing. */
  if (mode === "tension") {
    const since = String(body.since ?? "").slice(0, 10);
    const { rows: swept, ledger } = await skyPerimeter(target, per, 26000, false, body.all === true);
    let sky = swept;

    /* Observations are written on every sweep, not only in sky mode, because
       an archive value is not news — it is the same number tomorrow — and
       having yesterday's copy is the difference between a comparison and a
       shrug when a service is slow. */
    const writes: any[] = [];
    if (body.store !== false) {
      writes.push(await write("observations", "observations?on_conflict=source,source_id,quantity",
        swept, "resolution=merge-duplicates,return=minimal"));
    }

    /* When a source drops out entirely, fall back to what it said last time.
       Marked as such: a sweep comparing against a stored value is making a
       weaker statement than one comparing against a value fetched a second ago,
       and the reply says which it did. */
    let from_store = 0;
    const lostSources = ledger.filter((l: any) => l.error).map((l: any) => l.name);
    if (lostSources.length && target) {
      const t = target.replace(/[%,*()]/g, " ").trim();
      const cached = await sb(
        `observations?select=source,source_id,object,quantity,value,err,unit,value_si,err_si,unit_si,reference,url,ra,dec` +
        `&object=ilike.*${encodeURIComponent(t)}*&limit=300`) as any[];
      if (Array.isArray(cached) && cached.length) {
        const have = new Set(sky.map((o) => `${o.source}|${o.source_id}|${o.quantity}`));
        const extra = cached.filter((c) => !have.has(`${c.source}|${c.source_id}|${c.quantity}`));
        sky = [...sky, ...extra];
        from_store = extra.length;
      }
    }

    /* The papers are fetched AFTER the sky sweep, and chosen by what the sky
       actually returned. Reading the most recent sixty records instead — which
       is what this did first — pairs an arbitrary slice of the literature
       against an arbitrary slice of the archives, and the intersection of two
       unrelated samples is reliably empty. A tension needs both eyes pointed at
       the same object.

       If nothing in the corpus names any observed object, it falls back to the
       recent slice: the sweep then reports a large no_counterpart count, which
       is the honest signal that the corpus and the sky are not yet looking at
       the same things. */
    /* ASKED FOR KEPLER-10, GIVEN KEPLER-1022.
       The archive query anchors on the front, so KEPLER-10% also matches
       Kepler-100, Kepler-1013 and Kepler-1022 — a hundred and thirty planets,
       among which the two actually named are a rounding error. Taking the first
       twelve then spends the entire paper budget on planets nobody has written
       about, which is why five of six literature searches came back empty and
       why measurements of Kepler-10 c had nothing to be compared against.

       So when a target is named, objects belonging to it are ranked first: the
       name itself, or the name followed by a planet letter. Everything the
       prefix dragged in stays available behind them rather than crowding them
       out. */
    const t = target.toLowerCase().replace(/\s+/g, "");
    const belongsToTarget = (n: string) => {
      if (!t) return 0;
      const o = n.toLowerCase().replace(/\s+/g, "");
      if (o === t) return 0;
      // "kepler-10" -> "kepler-10b", "kepler-10c": the family, not Kepler-1022
      if (o.startsWith(t) && /^[a-z]$/.test(o.slice(t.length))) return 0;
      return 1;
    };
    const names = [...new Set(sky.map((o) => o.object))]
      .filter((n) => n && n.length > 3)
      .sort((a, b) => belongsToTarget(a) - belongsToTarget(b))
      .slice(0, 12);
    const safe = (n: string) => n.replace(/["(),*\\]/g, " ").trim();
    const filter = names.length
      ? "&or=(" + names.flatMap((n) => [
          `title.ilike."*${safe(n)}*"`,
          `abstract.ilike."*${safe(n)}*"`,
        ]).join(",") + ")"
      : "";

    const cols = "select=id,title,abstract,published_at,relevance";
    const when = since ? `&published_at=gte.${since}` : "";
    const stored = await sb(`records?${cols}${filter}${when}&limit=${Math.min(per, 60)}`) as any[];
    const matched = Array.isArray(stored) ? stored.length : 0;

    /* Fetched for the objects in hand, rather than hoping the corpus already
       holds them. The stored records come first because they have been through
       the relevance gate; the fetched ones fill the gap so a sweep is never
       silent merely because nobody swept this subject before. */
    /* Two at a time, not six. The index is a free public service and a sweep
       that bursts a dozen requests at it gets refused, which reads downstream as
       a literature with nothing to say. */
    const fetched: any[] = [];
    const wanted = names.slice(0, 6);
    for (let i = 0; i < wanted.length; i += 2) {
      const batch = await Promise.all(wanted.slice(i, i + 2).flatMap((n) => [
        arxivPapersFor(n), papersFor(n),
      ]));
      fetched.push(...batch.flat());
    }
    /* Two orderings, and the first matters more than the second.
       A paper with the object's name in its TITLE is a paper about that object,
       and a paper about a planet states that planet's numbers in its abstract.
       A paper that merely mentions it in passing — a survey, a mission
       description, a review — states numbers about something else entirely, and
       feeding those to an extractor produces measurements attached to nothing.
       Then, among equals, arXiv first: both indices are read, but when the same
       work arrives from both, dedup keeps whichever it sees first, and it should
       keep the copy whose abstract still has its mathematics. */
    const titleNames = (r: any) => {
      const t = String(r.title ?? "").toLowerCase().replace(/\s+/g, "");
      const o = String(r.about ?? "").toLowerCase().replace(/\s+/g, "");
      return o.length > 2 && t.includes(o) ? 1 : 0;
    };
    const isArxiv = (r: any) => (String(r.source_id ?? "").startsWith("arxiv:") ? 1 : 0);
    fetched.sort((a, b) => (titleNames(b) - titleNames(a)) || (isArxiv(b) - isArxiv(a)));
    const seenPaper = new Set<string>();
    const records = [...(Array.isArray(stored) ? stored : []), ...fetched]
      .filter((r) => {
        const k = String(r.source_id ?? r.id ?? r.title);
        if (!k || seenPaper.has(k)) return false;
        seenPaper.add(k);
        return true;
      })
      .slice(0, 60);
    const { rows: reported, diag: extraction } = await extractFrom(records);
    if (body.store !== false) {
      writes.push(await write("measurements", "measurements", reported, "return=minimal"));
    }

    const { tensions: allTensions, skipped } = reconcile(sky, reported);

    /* A QUESTION ABOUT ONE SYSTEM MUST NOT BE ANSWERED WITH ANOTHER.
       Asked about TRAPPIST-1, this returned seven claims about gravitational
       wave events. Every one was true and properly verified, and not one of
       them was what anybody asked for: the perimeter sweeps every source
       whatever the target, and the orphan detector correctly noticed that
       recent GWTC events are unwritten-about. Correct claims on the wrong
       subject are still the wrong answer, and a frontier that answers a
       question about seven planets with black hole mergers is not one anybody
       would look at twice.

       So when a target is named, claims are scoped to it. Nothing is deleted -
       what was set aside is counted and reported - and an untargeted sweep is
       unaffected, because there the whole sky is the subject. */
    const onTarget = (o: any) => !target || belongsToTarget(String(o?.object ?? "")) === 0;
    const allOrphans = orphans(sky, reported);
    const tensions = allTensions.filter(onTarget);
    const candidates = allOrphans.filter(onTarget);
    const set_aside_off_target =
      (allTensions.length - tensions.length) + (allOrphans.length - candidates.length);

    const { orphans: orph, rejected } = await verifiedOrphans(candidates);
    const claims = claimsFrom(tensions, orph);

    if (body.store !== false) {
      writes.push(await write("claims", "claims?on_conflict=claim_id",
        claims.map((c) => ({ ...c, last_moved_at: new Date().toISOString() })),
        "resolution=merge-duplicates,return=minimal"));
    }

    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0,
      ledger,
      read: {
        observations: sky.length,
        /* Above zero means a source failed and its previous answer stood in for
           it. The comparison still happened; it happened against a stored
           value. */
        observations_from_store: from_store,
        sources_lost: lostSources,
        objects_seen: names.length,
        papers: records.length,
        papers_from_corpus: matched,
        papers_fetched: fetched.length,
        papers_with_full_abstract: fetched.filter((r: any) => String(r.source_id).startsWith("arxiv:")).length,
        arxiv: { ...ARXIV },
        /* Of the papers read, how many are actually ABOUT one of the objects
           rather than merely mentioning it. This is the number that predicts
           whether extraction finds anything. */
        /* How many of the objects worked on actually belong to what was asked
           for. Low here means the sweep wandered off the target and any silence
           downstream is about other planets entirely. */
        objects_on_target: names.filter((n) => belongsToTarget(n) === 0).length,
        papers_about_an_object: records.filter((r: any) => {
          const t = String(r.title ?? "").toLowerCase().replace(/\s+/g, "");
          return names.some((n) => {
            const o = n.toLowerCase().replace(/\s+/g, "");
            return o.length > 2 && t.includes(o);
          });
        }).length,
        /* Calls that failed twice. Any number above zero means part of this
           sweep's silence is the network, not the literature. */
        index_failures: OA_FAILURES.count,
        index_errors: OA_FAILURES.statuses,
        /* False here means the corpus contained nothing about anything observed
           this sweep, so what follows is a fallback comparison and a thin
           result is expected rather than a fault. */
        papers_matched_objects: matched > 0,
        measurements: reported.length,
      },
      /* Where the reading went, if it went nowhere. */
      extraction,
      /* Published in the response for the same reason the scorecard publishes
         losses: a sweep that compared four things and claimed one tension is a
         different object from one that compared four thousand, and hiding the
         denominator is how a frontier starts looking more certain than it is. */
      skipped,
      /* What actually reached the database, and what did not. */
      stored: writes,
      /* Claims that were real but about something other than what was asked. */
      set_aside_off_target,
      tensions,
      orphans: orph,
      /* Candidates the literature check threw out, with the hit count that
         threw them. This is the sweep grading its own first guess, and it
         belongs in the reply for the same reason the scorecard publishes
         losses. */
      rejected_orphans: rejected,
      claims,
    });
  }

  // ---------- resolve: close a claim, and say why ----------
  /* A claim that cannot close is not a claim, it is a notice. The scorecard has
     always been able to count confirmed and refuted; nothing could ever set
     them, so every claim this worker has ever made is still marked open —
     including one it can no longer defend. The Kepler-10 c tension was minted
     before values had to appear in the text they were read from; later sweeps
     correctly stopped producing it, and nothing withdrew the row.

     Closing requires a reason, for the same reason opening requires a kill
     condition. A status changed without one is a fact nobody can check. */
  if (mode === "resolve") {
    const id = String(body.claim_id ?? "").trim();
    const status = String(body.status ?? "").trim();
    const resolution = String(body.resolution ?? "").trim();
    const allowed = ["confirmed", "refuted", "withdrawn", "open"];

    if (!id) return json({ error: "resolve needs a claim_id" }, 400);
    if (!allowed.includes(status)) return json({ error: `status must be one of ${allowed.join(", ")}` }, 400);
    if (status !== "open" && resolution.length < 10) {
      return json({ error: "closing a claim requires a resolution saying why" }, 400);
    }

    const patch = {
      status,
      resolution: status === "open" ? null : resolution,
      resolved_at: status === "open" ? null : new Date().toISOString(),
      last_moved_at: new Date().toISOString(),
    };
    const r = await fetch(`${SB}/rest/v1/claims?claim_id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        apikey: SRK, Authorization: `Bearer ${SRK}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) return json({ error: `HTTP ${r.status} ${text.slice(0, 200)}` }, 502);
    let rows: any[] = [];
    try { rows = JSON.parse(text); } catch { /* representation not returned */ }
    if (!rows.length) return json({ error: `no claim with id ${id}` }, 404);
    return json({ worker: WORKER_VERSION, mode, ms: Date.now() - t0, resolved: rows[0] });
  }

  // ---------- scorecard: what it has claimed, and how that went ----------
  if (mode === "scorecard") {
    const [board, open] = await Promise.all([
      sb("claim_scorecard?select=*"),
      sb("claims?select=claim_id,kind,object,quantity,title,sigma,status,resolution,opened_at,resolved_at" +
         "&order=opened_at.desc&limit=100"),
    ]);
    return json({ worker: WORKER_VERSION, mode, ms: Date.now() - t0, scorecard: board, claims: open });
  }

  /* ---------- survey: absence, at the scale absence actually occurs ----------
     The tension path reads papers, so it is bounded by what a model can be
     handed in one prompt: twelve objects and eight absence checks per sweep.
     That ceiling is correct for a comparison and absurd for a census, and it
     is why the register stopped at eleven claims while the archives were
     returning fifteen hundred rows a call.

     A silence claim needs neither the papers nor the model. It needs an object
     with a value and a stated reference, and an index that returns nothing for
     its name. So this path skips extraction entirely and spends its whole
     budget on the one check that gates the claim — which is also the check
     that fails closed, so the denominator is reported three ways: written
     about, not written about, and could not be checked. */
  if (mode === "survey") {
    const want = Math.min(Math.max(Number(body.limit) || 80, 1), 400);
    const from = Math.max(Number(body.offset) || 0, 0);

    /* Read the candidates out of the store rather than sweeping for them.
       The first census swept and checked in one call and the wall clock ate
       it: the exoplanet archive aborted mid-fetch and two thirds of the
       absence checks never ran. An archive value is not news — it is the same
       number tomorrow — so the sweep and the census do not have to be the same
       call, and separating them lets this one spend its entire budget on the
       check that gates the claim. */
    const fromStore = body.from_store !== false;
    const writes: any[] = [];
    let sky: any[] = [], ledger: any[] = [];

    if (fromStore) {
      sky = await sb("observations?select=object,quantity,source,value,unit,url,reference,ra,dec" +
        `&order=object.asc&offset=${from}&limit=${Math.min(want * 3, 900)}`) as any[];
    } else {
      const swept = await skyPerimeter(target, Math.min(want * 2, 300), 26000, false, body.all === true);
      sky = swept.rows; ledger = swept.ledger;
      if (body.store !== false) {
        writes.push(await write("observations", "observations?on_conflict=source,source_id,quantity",
          sky, "resolution=merge-duplicates,return=minimal"));
      }
    }

    /* No papers were read, so every distinct object carrying a value is a
       candidate. That is the point: the question here is not whether the
       archive and the literature disagree, it is whether the literature
       mentions the object at all. */
    const already = new Set(((await sb("claims?select=object&limit=4000")) as any[])
      .map((c: any) => String(c.object).toLowerCase().trim()));
    const candidates = orphans(sky as Obs[], [])
      .filter((o: any) => !already.has(String(o.object).toLowerCase().trim()));
    const { orphans: orph, rejected, unverifiable } = await verifiedOrphans(candidates, want, 4);
    const claims = claimsFrom([], orph);

    if (body.store !== false) {
      writes.push(await write("claims", "claims?on_conflict=claim_id",
        claims.map((c) => ({ ...c, last_moved_at: new Date().toISOString() })),
        "resolution=merge-duplicates,return=minimal"));
    }

    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0, target: target || "(the whole sky)",
      ledger, from_store: fromStore, offset: from,
      read: {
        observations: sky.length,
        already_claimed: already.size,
        new_candidates: candidates.length,
        checked: Math.min(candidates.length, want),
      },
      /* The denominator, three ways. A survey that checked four objects and
         found one silence is a different object from one that checked four
         hundred, and a survey where the index was down found nothing at all
         however many it looked at. */
      unwritten: orph.length,
      has_literature: rejected.length,
      could_not_check: unverifiable.length,
      sample_rejected: rejected.slice(0, 8),
      stored: writes,
      claims,
    });
  }

  /* ---------- crosscheck: archives against each other ----------
     The census is bounded by an index that answers one name at a time, and
     the tension path is bounded by what a model can read. This one is bounded
     by nothing but the database.

     Every archive states a value with an uncertainty and a reference. When two
     of them hold the same quantity for the same object and their error bars do
     not overlap, one is wrong — and that is a finding of exactly the same kind
     as an archive disagreeing with a paper, reached without reading anything.
     No model, no literature search, no rate limit: it is arithmetic over rows
     that are already stored, so it runs over thousands per call.

     The floor is three sigma. Below that, two careful measurements of the same
     thing disagreeing is ordinary. */
  if (mode === "crosscheck") {
    const want = Math.min(Math.max(Number(body.limit) || 2000, 1), 5000);
    const from = Math.max(Number(body.offset) || 0, 0);
    const floor = Math.max(Number(body.sigma) || 3, 1);

    const rows = await sb("observations?select=object,quantity,source,value,err,unit," +
      "value_si,err_si,unit_si,reference,url,ra,dec" +
      `&order=object.asc&offset=${from}&limit=${want}`) as any[];

    /* Group on the object and quantity, not on the unit: the whole point is to
       catch an archive stating a radius in Earth radii against one stating it
       in Jupiter radii. Everything is compared in SI or not at all. */
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      if (!Number.isFinite(r.value_si) || !Number.isFinite(r.err_si) || !(r.err_si > 0)) continue;
      const k = `${String(r.object).toLowerCase().trim()}|${r.quantity}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    const disagreements: any[] = [];
    let comparable = 0, agreed = 0, one_value_only = 0;
    for (const [, g] of groups) {
      /* Two values are comparable when they came from different places, and a
         different paper is a different place even inside one archive. The
         exoplanet archive publishes every parameter set anyone has measured;
         requiring two archives threw all of that away and left nothing to
         compare, which is what the first crosscheck reported. */
      const origins = new Set(g.map((r) => `${r.source}|${r.reference}`));
      if (origins.size < 2) { one_value_only++; continue; }
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const a = g[i], b = g[j];
          if (a.source === b.source && a.reference === b.reference) continue;
          comparable++;
          const sigma = Math.abs(a.value_si - b.value_si) /
            Math.sqrt(a.err_si * a.err_si + b.err_si * b.err_si);
          if (!Number.isFinite(sigma)) continue;
          if (sigma < floor) { agreed++; continue; }
          disagreements.push({
            object: a.object, quantity: a.quantity, sigma: Number(sigma.toFixed(2)),
            a: { source: a.source, value: a.value, err: a.err, unit: a.unit, reference: a.reference, url: a.url, value_si: a.value_si, err_si: a.err_si },
            b: { source: b.source, value: b.value, err: b.err, unit: b.unit, reference: b.reference, url: b.url, value_si: b.value_si, err_si: b.err_si },
            ra: a.ra ?? b.ra, dec: a.dec ?? b.dec,
          });
        }
      }
    }
    disagreements.sort((x, y) => y.sigma - x.sigma);

    const claims = disagreements.map((d) => mint({
      kind: "crosscheck",
      object: d.object,
      quantity: d.quantity,
      title: `Two published values for the ${d.quantity} of ${d.object} disagree`,
      statement:
        `${d.a.reference || d.a.source} gives ${fmt(d.a.value, d.a.unit)} ± ${fmt(d.a.err, "")}. ` +
        `${d.b.reference || d.b.source} gives ${fmt(d.b.value, d.b.unit)} ± ${fmt(d.b.err, "")}. ` +
        `Compared in SI those are ${d.sigma}σ apart. Both are carried by ${d.a.source === d.b.source ? d.a.source : `${d.a.source} and ${d.b.source}`}, ` +
        `so a reader taking the catalogue value gets one of them and never learns the other exists.`,
      sigma: d.sigma,
      observed: d.a, reported: d.b,
      kill:
        `One re-measurement of the ${d.quantity} of ${d.object} at or below the smaller of the two ` +
        `stated uncertainties. Whichever archive it lands on, the other is carrying an error that ` +
        `every downstream user of that catalogue has inherited.`,
      cost: "Archival — both values are already public, and the disagreement is between them.",
      figure: { type: "interval", unit: "SI", sigma: d.sigma, series: [
        { label: String(d.a.reference || d.a.source).slice(0, 28), value: d.a.value_si, err: d.a.err_si },
        { label: String(d.b.reference || d.b.source).slice(0, 28), value: d.b.value_si, err: d.b.err_si }] },
    })).filter(Boolean);

    const writes: any[] = [];
    if (body.store !== false && claims.length) {
      writes.push(await write("claims", "claims?on_conflict=claim_id",
        claims.map((c: any) => ({ ...c, last_moved_at: new Date().toISOString() })),
        "resolution=merge-duplicates,return=minimal"));
    }

    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0, offset: from, sigma_floor: floor,
      /* The denominator matters more here than anywhere: a crosscheck that
         compared four pairs and found one disagreement is a different object
         from one that compared four thousand. */
      read: {
        rows: rows.length,
        object_quantities: groups.size,
        one_value_only,
        comparable_pairs: comparable,
        agreed,
      },
      disagreements: disagreements.length,
      worst: disagreements.slice(0, 12).map((d) => ({ object: d.object, quantity: d.quantity, sigma: d.sigma, a: d.a.source, b: d.b.source })),
      stored: writes,
      claims,
    });
  }

  /* ---------- dump: the register, in full, in one reply ----------
     The site embeds a snapshot of the claims table so it renders where it
     cannot reach the database — a sandboxed frame blocks every host. Rebuilding
     that snapshot by hand is how it goes stale, so the worker hands over the
     whole register in one call and the page is regenerated from the reply.
     Read-only; writes nothing. */
  if (mode === "dump") {
    const cap = Math.min(Math.max(Number(body.limit) || 500, 1), 2000);
    const from = Math.max(Number(body.offset) || 0, 0);
    const rows = await sb(`claims?select=*&order=opened_at.desc&limit=${cap}&offset=${from}`) as any[];
    return json({
      worker: WORKER_VERSION, mode, ms: Date.now() - t0,
      offset: from, returned: rows.length, claims: rows,
    });
  }

  return json({ error: `unknown mode '${mode}'`, modes: ["probe", "papers", "sky", "tension", "survey", "crosscheck", "resolve", "scorecard", "dump"] }, 400);
}

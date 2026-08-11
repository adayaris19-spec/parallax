// Tests for the arithmetic in sky.ts.
//
//   node --experimental-strip-types setup/sky.test.mjs
//
// The sky adapters need the network and a deploy; everything that turns two
// numbers into a claim does not, and that is the part where being wrong is
// expensive. A tension is the product's whole assertion — if sigma is wrong, or
// a claim can be minted that nothing could kill, or two values get compared in
// units that were never reconciled, Parallax publishes confident nonsense with
// receipts attached, which is worse than publishing nothing.
//
// sky.ts is a Deno Edge Function, so it is loaded here with a Deno shim and its
// internals re-exported into a temporary copy. That keeps this file honest: it
// tests the deployed source, not a transcription of it.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".sky.undertest.ts");
writeFileSync(tmp,
  readFileSync(join(here, "sky.ts"), "utf8") +
  "\nexport { normalise, reconcile, orphans, claimId, mint, claimsFrom, tapRows, sym, obs, searchName };\n");

globalThis.Deno = { env: { get: () => "test" }, serve: () => {} };
const S = await import("./.sky.undertest.ts");
unlinkSync(tmp);

let pass = 0;
const failures = [];
const t = (name, cond) => { if (cond) pass++; else failures.push(name); };

// fixtures --------------------------------------------------------------------
const O = (object, quantity, value, err, unit) =>
  S.obs({ source: "exo", source_id: "s:" + object, object, quantity, value, err, unit });
const R = (object, quantity, value, err, unit) => ({
  object, quantity, value, err, unit, ...S.normalise(value, err, unit),
  record_id: 1, year: 2023, quote: "q", confidence: 0.9,
});

// units -----------------------------------------------------------------------
const re = S.normalise(1, 0.1, "Rearth");
t("Earth radii convert to metres", Math.abs(re.value_si - 6.3781e6) < 1 && re.unit_si === "m");
t("the error bar converts with the value", Math.abs(re.err_si - 6.3781e5) < 1);
t("g/cm3 converts to kg/m3", S.normalise(5.4, 0.6, "g/cm3").value_si === 5400);
t("an unknown unit refuses to convert", S.normalise(3, 1, "furlongs").value_si === null);
t("a missing value refuses to convert", S.normalise(null, 1, "km").value_si === null);
t("a negative error bar is taken as a magnitude", S.normalise(1, -0.2, "km").err_si === 200);
// 0.029 Earth radii in metres is 184964.90000000002 before rounding, and that
// number was on its way onto a published figure
t("conversion noise is not published as precision", S.normalise(8.594, 0.029, "rearth").err_si === 184964.9);
t("milliarcseconds are a dimension, not a blank", S.normalise(130.23, 0.36, "mas").unit_si === "mas");

// TAP dialects ----------------------------------------------------------------
t("TAP row-of-objects is read", S.tapRows([{ a: 1 }]).length === 1);
const columnar = S.tapRows({ metadata: [{ name: "PL_NAME" }, { name: "pl_rade" }], data: [["Kepler-10 b", 1.47]] });
t("TAP columnar is read and column names lowercased", columnar[0].pl_name === "Kepler-10 b" && columnar[0].pl_rade === 1.47);
t("a junk TAP reply yields no rows rather than throwing", S.tapRows(null).length === 0 && S.tapRows({}).length === 0);

// asymmetric error bars -------------------------------------------------------
t("asymmetric error bars average", S.sym(0.4, -0.3) === 0.35);
t("a one-sided error bar is used as-is", S.sym(0.4, null) === 0.4);
t("no error bar stays absent", S.sym(null, null) === null);
// the archive states +0.029/-0.029; binary floating point averages that to
// 0.028999999999999998, and that number would be printed inside a claim
t("floating point noise is not published as precision", S.sym(0.029, -0.029) === 0.029);

// claim identity --------------------------------------------------------------
const idA = S.claimId("tension", "Kepler-10 b", "density", 2026);
t("claim ids are deterministic and case-insensitive",
  idA === S.claimId("tension", "KEPLER-10 B", "density", 2026) && /^PARALLAX-2026-\d{5}$/.test(idA));
t("a different quantity is a different claim", idA !== S.claimId("tension", "Kepler-10 b", "mass", 2026));

// nothing ships without a way to die -----------------------------------------
const stub = { kind: "tension", object: "X", quantity: "mass", title: "", statement: "" };
t("a claim with no kill condition is refused", S.mint({ ...stub, kill: "" }) === null);
t("a whitespace kill condition is refused", S.mint({ ...stub, kill: "   " }) === null);
t("a claim with no object is refused", S.mint({ ...stub, object: "", kill: "k" }) === null);
t("an otherwise complete claim is minted", S.mint({ ...stub, kill: "k" }) !== null);

// the mechanism ---------------------------------------------------------------
let out = S.reconcile([O("P1", "density", 5.4, 0.2, "g/cm3")], [R("P1", "density", 4.0, 0.2, "g/cm3")]);
t("a real disagreement becomes a tension", out.tensions.length === 1);
t("sigma is the difference over the joint error", Math.abs(out.tensions[0].sigma - 4.95) < 0.02);

out = S.reconcile([O("P2", "density", 5.4, 0.2, "g/cm3")], [R("P2", "density", 5.45, 0.2, "g/cm3")]);
t("agreement is not a claim", out.tensions.length === 0 && out.skipped.agreed === 1);

out = S.reconcile([O("P3", "density", 5.4, null, "g/cm3")], [R("P3", "density", 1.0, 0.1, "g/cm3")]);
t("an archive value with no error bar cannot be judged against", out.skipped.no_error_bar === 1 && !out.tensions.length);

out = S.reconcile([O("P4", "density", 5.4, 0.2, "g/cm3")], [R("P4", "density", 1.0, null, "g/cm3")]);
t("a published value with no error bar cannot be judged", out.skipped.no_error_bar === 1 && !out.tensions.length);

// the unit trap: Jupiter radii and Earth radii differ by 11x. Comparing them raw
// would report agreement; comparing them in SI reports the 90-sigma gulf it is.
out = S.reconcile([O("P5", "radius", 1, 0.01, "Rjup")], [R("P5", "radius", 1, 0.01, "Rearth")]);
t("mixed units are compared in SI, never raw", out.tensions.length === 1 && Math.abs(out.tensions[0].sigma - 90.71) < 0.1);

out = S.reconcile([O("P6", "radius", 1, 0.01, "Rearth")], [R("P6", "radius", 1, 0.01, "day")]);
t("incompatible dimensions never compare at all", out.skipped.no_common_unit === 1 && !out.tensions.length);

out = S.reconcile([O("P7", "density", 5, 0.1, "g/cm3")], [R("Other", "density", 5, 0.1, "g/cm3")]);
t("an unmatched object is counted, not claimed", out.skipped.no_counterpart === 1);

out = S.reconcile(
  [O("P8", "mass", 10, 5, "Mearth"), O("P8", "mass", 10, 0.1, "Mearth")],
  [R("P8", "mass", 12, 0.1, "Mearth")]);
t("the tightest measurement is the one judged against", out.tensions.length === 1 && Math.abs(out.tensions[0].sigma - 14.14) < 0.1);

out = S.reconcile([O("Kepler-10  b", "density", 5.4, 0.2, "g/cm3")], [R("kepler-10 b", "density", 4.0, 0.2, "g/cm3")]);
t("object names match across case and spacing", out.tensions.length === 1);

// orphans ---------------------------------------------------------------------
const orph = S.orphans(
  [O("ZTF18x", "detections", 12, null, ""), O("P9", "density", 5, 0.1, "g/cm3")],
  [R("P9", "density", 5, 0.1, "g/cm3")]);
t("an observed object nobody wrote about is an orphan", orph.length === 1 && orph[0].object === "ZTF18x");

// absence has to be earned ---------------------------------------------------
// SBDB calls it "433 Eros (A898 PA)"; no paper ever has. Searching the
// literature for the provisional designation is how a machine announces that
// nothing was written about the asteroid NEAR Shoemaker landed on.
t("catalogue designations are stripped before searching", S.searchName("433 Eros (A898 PA)") === "433 Eros");
t("a plain name is left alone", S.searchName("Kepler-1513 b") === "Kepler-1513 b");
t("a name that is only a designation is refused as too short", S.searchName("(1968 AA)").length < 3);

const unchecked = { object: "433 Eros (A898 PA)", quantity: "diameter", source: "sbdb", value: 16.84, unit: "km" };
t("an unverified candidate never becomes a claim",
  S.claimsFrom([], [unchecked]).length === 0);
t("a candidate the literature knows never becomes a claim",
  S.claimsFrom([], [{ ...unchecked, lit_count: 412 }]).length === 0);
t("a candidate that failed its check never becomes a claim",
  S.claimsFrom([], [{ ...unchecked, lit_count: null }]).length === 0);
const earned = S.claimsFrom([], [{ ...unchecked, lit_count: 0, searched_as: "433 Eros" }]);
t("a candidate with zero hits becomes a claim", earned.length === 1);
t("the claim states the name it searched, not the catalogue key",
  earned[0].title === "Nothing has been written about 433 Eros");
// A GWTC event arrives stamped with the catalogue that measured it. Printing
// "no paper measures this" beside reference: GWTC contradicts the row it came
// from; what the search establishes is that nothing NAMES it.
const viaCat = S.claimsFrom([], [{
  object: "GW250119_190238", quantity: "mass", source: "gwosc", value: 11.54,
  unit: "msun", reference: "GWTC", lit_count: 0, searched_as: "GW250119_190238",
}]);
t("a claim does not contradict its own provenance", viaCat[0].statement.includes("on the authority of GWTC"));
t("the claim says it was reported once and never taken up", viaCat[0].statement.includes("never taken up"));
t("the claim carries the search as its receipt", earned[0].observed.lit_count === 0);

// end to end ------------------------------------------------------------------
const claims = S.claimsFrom(
  S.reconcile([O("P1", "density", 5.4, 0.2, "g/cm3")], [R("P1", "density", 4.0, 0.2, "g/cm3")]).tensions,
  orph.map((o) => ({ ...o, lit_count: 0, searched_as: o.object })));
t("both kinds of claim are minted", claims.length === 2);
t("every claim states what would kill it", claims.every((c) => c.kill && c.kill.length > 10));
t("every claim carries a citable id", claims.every((c) => /^PARALLAX-\d{4}-\d{5}$/.test(c.claim_id)));
t("every claim carries the data its figure is drawn from", claims.every((c) => c.figure?.type));
t("the figure is computed from the normalised values", claims[0].figure.series[0].value === 5400);

// -----------------------------------------------------------------------------
for (const f of failures) console.log("FAIL  " + f);
console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

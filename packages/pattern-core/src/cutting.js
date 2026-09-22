/**
 * The cutting list.
 *
 * The important thing here is that triangle units are costed as the squares you
 * actually cut, not as individual triangles. Nobody cuts 14 half-square
 * triangles; they cut 7 squares of each fabric, draw a diagonal, and get 14
 * units with two seams each. A list that says "14 triangles" sends a quilter to
 * the cutting mat with the wrong number of squares and the wrong measurement.
 */

import { fmt, fmtSize, toInches } from './units.js';
import { seamMath } from './seams.js';

const pairKey = (a, b) => [a, b].sort().join('+');

/** Fabric needed for one entry, in square inches of cut fabric. */
function entryArea(entry) {
  return entry.qty * toInches(entry.cutW) * toInches(entry.cutH);
}

/**
 * @param {object} block  from `buildBlock`
 * @param {object} opts   `{ seam, trim, copies }` - copies is how many of this
 *                        block the quilt needs, which scales every quantity.
 */
export function cuttingList(block, { seam, trim, copies = 1 } = {}) {
  const math = seamMath(seam, trim);
  const groups = new Map(); // fabric key -> Map(entry key -> entry)

  const add = (fabric, key, entry) => {
    if (!groups.has(fabric)) groups.set(fabric, new Map());
    const m = groups.get(fabric);
    if (!m.has(key)) m.set(key, { ...entry, qty: 0, labels: [], units: 0 });
    return m.get(key);
  };

  // --- plain patches: one cut rectangle each -------------------------------
  for (const u of block.units) {
    if (u.kind !== 'patch') continue;
    const { w, h } = math.patch(u.w, u.h);
    const e = add(u.a, `patch:${w}x${h}`, {
      construction: 'patch',
      cutW: w,
      cutH: h,
      cut: w === h ? `${fmt(w)} square` : fmtSize(w, h),
      finished: w === h ? `${fmt(u.w)} square` : fmtSize(u.w, u.h),
      purpose: 'patches',
    });
    e.qty += copies;
    e.units += 1;
    e.labels.push(...u.pieces.map((p) => p.label));
  }

  // --- half-square triangles: squares per fabric, two units per pair -------
  const hst = new Map();
  for (const u of block.units) {
    if (u.kind !== 'hst') continue;
    const key = `${pairKey(u.a, u.b)}:${u.w}`;
    if (!hst.has(key)) hst.set(key, { a: u.a, b: u.b, leg: u.w, units: [] });
    hst.get(key).units.push(u);
  }
  for (const g of hst.values()) {
    const n = g.units.length * copies;
    const square = math.hstSquare(g.leg);
    const squares = Math.ceil(n / math.hstPerPair);
    const spare = squares * math.hstPerPair - n;
    for (const fabric of new Set([g.a, g.b])) {
      const other = fabric === g.a ? g.b : g.a;
      const e = add(fabric, `hst:${square}:${pairKey(g.a, g.b)}`, {
        construction: 'hst',
        cutW: square,
        cutH: square,
        cut: `${fmt(square)} square`,
        finished: `${fmt(g.leg)} finished unit`,
        purpose: `half-square triangles with ${block.fabrics[other]?.name ?? other}`,
        yields: `${squares} pair${squares === 1 ? '' : 's'} → ${squares * math.hstPerPair} units`,
        spare,
      });
      e.qty = squares;
      e.units = n;
      e.labels = g.units.flatMap((u) => u.pieces.filter((p) => p.fabric === fabric).map((p) => p.label));
    }
  }

  // --- hourglass / quarter-square triangles --------------------------------
  const qst = new Map();
  for (const u of block.units) {
    if (u.kind !== 'qst') continue;
    const key = `${pairKey(u.a, u.b)}:${u.w}`;
    if (!qst.has(key)) qst.set(key, { a: u.a, b: u.b, side: u.w, units: [] });
    qst.get(key).units.push(u);
  }
  for (const g of qst.values()) {
    const n = g.units.length * copies;
    const square = math.qstSquare(g.side);
    const squares = Math.ceil(n / math.qstPerPair);
    for (const fabric of new Set([g.a, g.b])) {
      const other = fabric === g.a ? g.b : g.a;
      const e = add(fabric, `qst:${square}:${pairKey(g.a, g.b)}`, {
        construction: 'qst',
        cutW: square,
        cutH: square,
        cut: `${fmt(square)} square`,
        finished: `${fmt(g.side)} finished unit`,
        purpose: `hourglass units with ${block.fabrics[other]?.name ?? other}`,
        yields: `${squares} pair${squares === 1 ? '' : 's'} → ${squares * math.qstPerPair} units`,
        spare: squares * math.qstPerPair - n,
      });
      e.qty = squares;
      e.units = n;
      e.labels = g.units.flatMap((u) => u.pieces.filter((p) => p.fabric === fabric).map((p) => p.label));
    }
  }

  // --- no-waste flying geese: 1 large + 4 small -> 4 units -----------------
  const geese = new Map();
  for (const u of block.units) {
    if (u.kind !== 'geese') continue;
    const long = Math.max(u.w, u.h);
    const short = Math.min(u.w, u.h);
    const key = `${u.a}:${u.b}:${long}x${short}`;
    if (!geese.has(key)) geese.set(key, { a: u.a, b: u.b, long, short, units: [] });
    geese.get(key).units.push(u);
  }
  for (const g of geese.values()) {
    const n = g.units.length * copies;
    const sets = Math.ceil(n / math.geesePerSet);
    const large = math.geeseLarge(g.long);
    const small = math.geeseSmall(g.short);
    const bg = block.fabrics[g.b]?.name ?? g.b;
    const goose = block.fabrics[g.a]?.name ?? g.a;

    const eLarge = add(g.a, `geese-l:${large}:${g.b}`, {
      construction: 'geese',
      cutW: large,
      cutH: large,
      cut: `${fmt(large)} square`,
      finished: `${fmtSize(g.long, g.short)} finished geese`,
      purpose: `flying geese (the goose) on ${bg}`,
      yields: `${sets} set${sets === 1 ? '' : 's'} → ${sets * math.geesePerSet} units`,
      spare: sets * math.geesePerSet - n,
    });
    eLarge.qty = sets;
    eLarge.units = n;
    eLarge.labels = g.units.flatMap((u) => u.pieces.filter((p) => p.role === 'goose').map((p) => p.label));

    const eSmall = add(g.b, `geese-s:${small}:${g.a}`, {
      construction: 'geese',
      cutW: small,
      cutH: small,
      cut: `${fmt(small)} square`,
      finished: `corners of the ${fmtSize(g.long, g.short)} geese`,
      purpose: `flying geese (the sky) around ${goose}`,
      yields: `4 per set × ${sets}`,
    });
    eSmall.qty = sets * 4;
    eSmall.units = n;
    eSmall.labels = g.units.flatMap((u) => u.pieces.filter((p) => p.role === 'sky').map((p) => p.label));
  }

  // --- assemble, sorted biggest cut first (how you'd cut from yardage) -----
  const out = [];
  for (const [fabric, m] of groups) {
    const entries = [...m.values()].sort((a, b) => b.cutW * b.cutH - a.cutW * a.cutH);
    entries.forEach((e) => (e.labels = [...new Set(e.labels)].sort()));
    const cutArea = entries.reduce((s, e) => s + entryArea(e), 0);
    out.push({
      fabric,
      name: block.fabrics[fabric]?.name ?? fabric,
      hex: block.fabrics[fabric]?.hex ?? '#888888',
      entries,
      pieceCount: block.pieces.filter((p) => p.fabric === fabric).length,
      cutArea,
      yardage: yardageFor(cutArea),
    });
  }
  out.sort((a, b) => b.cutArea - a.cutArea);

  return { math, fabrics: out, copies };
}

const FAT_QUARTER = 18 * 21; // square inches of usable fat quarter
const USABLE_WIDTH = 42; // inches of usable width off a bolt

/**
 * A shopping estimate, deliberately generous. Rotary cutting wastes fabric
 * between shapes and nobody wants to be 3" short, so this adds 45% and rounds
 * up to something a shop will actually cut.
 */
function yardageFor(cutArea) {
  const withWaste = cutArea * 1.45;
  if (withWaste <= FAT_QUARTER * 0.85) {
    return { label: 'fat quarter', inches: 0, note: 'a fat quarter covers this' };
  }
  const runningInches = withWaste / USABLE_WIDTH;
  const eighths = Math.ceil(runningInches / (36 / 8));
  const yards = eighths / 8;
  const names = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  const whole = Math.floor(yards);
  const rem = eighths % 8;
  const label = `${whole || ''}${names[rem] ?? ''}`.trim() || '⅛';
  return { label: `${label} yd`, inches: runningInches, note: 'includes cutting waste' };
}

/** Flat rows, which is what a table or a PDF wants. */
export function cuttingRows(list) {
  const rows = [];
  for (const f of list.fabrics) {
    f.entries.forEach((e, i) => {
      rows.push({
        fabricName: i === 0 ? f.name : '',
        hex: f.hex,
        first: i === 0,
        qty: e.qty,
        cut: e.cut,
        purpose: e.purpose,
        yields: e.yields,
        spare: e.spare,
        labels: e.labels.join(', '),
      });
    });
  }
  return rows;
}

export { yardageFor };

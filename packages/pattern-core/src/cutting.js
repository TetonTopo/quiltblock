/**
 * The cutting list.
 *
 * The important thing here is that triangle units are costed as the squares you
 * actually cut, not as individual triangles. Nobody cuts 14 half-square
 * triangles; they cut 7 squares of each fabric, draw a diagonal, and get 14
 * units with two seams each. A list that says "14 triangles" sends a quilter to
 * the cutting mat with the wrong number of squares and the wrong measurement.
 *
 * The second thing every commercial pattern does, and this now does too, is
 * turn the list into STRIPS: "(6) strips 3½" × WOF; subcut (32) rectangles
 * 3½" × 6½"". Fabric comes off a bolt 40-odd inches wide, you cut a strip the
 * width of the piece, then chop it up. Yardage falls straight out of the
 * number of strips, which is a far more honest number than area plus a fudge.
 */

import { fmt, fmtSize, toInches, inches } from './units.js';
import { seamMath } from './seams.js';

/** Usable width across the bolt once the selvedges are gone. */
export const USABLE_WOF = inches(40);
const FAT_QUARTER = { w: inches(21), h: inches(18) };

const pairKey = (a, b) => [a, b].sort().join('+');

const POS_NAME = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };

/** Fabric needed for one entry, in square inches of cut fabric. */
function entryArea(entry) {
  return entry.qty * toInches(entry.cutW) * toInches(entry.cutH);
}

export function newGroups() {
  return new Map(); // fabric key -> Map(entry key -> entry)
}

export function addEntry(groups, fabric, key, entry) {
  if (!groups.has(fabric)) groups.set(fabric, new Map());
  const m = groups.get(fabric);
  if (!m.has(key)) m.set(key, { ...entry, qty: 0, labels: [], units: 0 });
  return m.get(key);
}

/**
 * Add every cut one block needs, `copies` times over, into `groups`.
 * The quilt planner calls this once per block design in the quilt and then
 * adds sashing and borders on top.
 */
export function addBlockCuts(groups, block, math, copies = 1, { forLabel = '' } = {}) {
  const F = (k) => block.fabrics[k]?.name ?? k;
  const tag = forLabel ? ` (${forLabel})` : '';

  // --- plain patches: one cut rectangle each -------------------------------
  for (const u of block.units) {
    if (u.kind !== 'patch') continue;
    const { w, h } = math.patch(u.w, u.h);
    const hasCorners = u.corners?.length > 0;
    const e = addEntry(groups, u.a, `patch:${w}x${h}:${hasCorners ? 'flip' : ''}`, {
      construction: 'patch',
      cutW: w,
      cutH: h,
      cut: w === h ? `${fmt(w)} square` : fmtSize(w, h),
      finished: u.w === u.h ? `${fmt(u.w)} square` : fmtSize(u.w, u.h),
      purpose: (hasCorners ? 'patches with stitch-and-flip corners' : 'patches') + tag,
    });
    e.qty += copies;
    e.units += 1;
    e.labels.push(...u.pieces.filter((p) => p.role === 'patch').map((p) => p.label));

    // --- stitch-and-flip corners: one small square each ----------------------
    for (const k of u.corners ?? []) {
      const sq = math.flipSquare(k.size);
      const ke = addEntry(groups, k.fabric, `flip:${sq}`, {
        construction: 'flip',
        cutW: sq,
        cutH: sq,
        cut: `${fmt(sq)} square`,
        finished: `${fmt(k.size)} corner triangle`,
        purpose: 'stitch-and-flip corners' + tag,
      });
      ke.qty += copies;
      ke.units += 1;
      ke.labels.push(...u.pieces.filter((p) => p.role === 'corner' && p.pos === k.pos).map((p) => p.label));
    }
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
    for (const fabric of new Set([g.a, g.b])) {
      const other = fabric === g.a ? g.b : g.a;
      const e = addEntry(groups, fabric, `hst:${square}:${pairKey(g.a, g.b)}`, {
        construction: 'hst',
        per: math.hstPerPair,
        cutW: square,
        cutH: square,
        cut: `${fmt(square)} square`,
        finished: `${fmt(g.leg)} finished unit`,
        purpose: `half-square triangles with ${F(other)}` + tag,
      });
      e.qty += squares;
      e.units += n;
      e.labels.push(...g.units.flatMap((u) => u.pieces.filter((p) => p.fabric === fabric).map((p) => p.label)));
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
      const e = addEntry(groups, fabric, `qst:${square}:${pairKey(g.a, g.b)}`, {
        construction: 'qst',
        per: math.qstPerPair,
        cutW: square,
        cutH: square,
        cut: `${fmt(square)} square`,
        finished: `${fmt(g.side)} finished unit`,
        purpose: `hourglass units with ${F(other)}` + tag,
      });
      e.qty += squares;
      e.units += n;
      e.labels.push(...g.units.flatMap((u) => u.pieces.filter((p) => p.fabric === fabric).map((p) => p.label)));
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

    const eLarge = addEntry(groups, g.a, `geese-l:${large}:${g.b}`, {
      construction: 'geese',
      per: math.geesePerSet,
      cutW: large,
      cutH: large,
      cut: `${fmt(large)} square`,
      finished: `${fmtSize(g.long, g.short)} finished geese`,
      purpose: `flying geese (the goose) on ${F(g.b)}` + tag,
    });
    eLarge.qty += sets;
    eLarge.units += n;
    eLarge.labels.push(...g.units.flatMap((u) => u.pieces.filter((p) => p.role === 'goose').map((p) => p.label)));

    const eSmall = addEntry(groups, g.b, `geese-s:${small}:${g.a}`, {
      construction: 'geese-sky',
      per: 1,
      cutW: small,
      cutH: small,
      cut: `${fmt(small)} square`,
      finished: `corners of the ${fmtSize(g.long, g.short)} geese`,
      purpose: `flying geese (the sky) around ${F(g.a)}` + tag,
    });
    eSmall.qty += sets * 4;
    eSmall.units += n;
    eSmall.labels.push(...g.units.flatMap((u) => u.pieces.filter((p) => p.role === 'sky').map((p) => p.label)));
  }
}

/**
 * Add a plain cut - sashing, border, plain square - to the groups. `fabric`
 * is a key into the fabrics map the caller will pass to `finishGroups`.
 */
export function addPlainCut(groups, fabric, { w, h, qty, purpose, key }) {
  const e = addEntry(groups, fabric, key ?? `cut:${w}x${h}:${purpose}`, {
    construction: 'cut',
    cutW: w,
    cutH: h,
    cut: w === h ? `${fmt(w)} square` : fmtSize(w, h),
    finished: '',
    purpose,
  });
  e.qty += qty;
  e.units += qty;
  return e;
}

/**
 * Turn the entry maps into the list a table wants: sorted biggest cut first
 * (how you'd cut from yardage), with yields, a strip plan and yardage.
 */
export function finishGroups(groups, fabricsMap = {}) {
  const out = [];
  for (const [fabric, m] of groups) {
    const entries = [...m.values()].sort((a, b) => b.cutW * b.cutH - a.cutW * a.cutH);
    for (const e of entries) {
      e.labels = [...new Set(e.labels)].sort();
      if (e.per) {
        const made = e.qty * e.per;
        e.yields =
          e.construction === 'geese'
            ? `${e.qty} set${e.qty === 1 ? '' : 's'} → ${made} units`
            : e.construction === 'geese-sky'
              ? `4 per set × ${e.qty / 4}`
              : `${e.qty} pair${e.qty === 1 ? '' : 's'} → ${made} units`;
        e.spare = e.construction === 'geese-sky' ? 0 : made - e.units;
      }
    }
    const cutArea = entries.reduce((s, e) => s + entryArea(e), 0);
    const strips = stripPlan(entries);
    out.push({
      fabric,
      name: fabricsMap[fabric]?.name ?? fabric,
      hex: fabricsMap[fabric]?.hex ?? '#888888',
      entries,
      pieceCount: entries.reduce((s, e) => s + (e.construction === 'cut' ? 0 : e.labels.length), 0),
      cutArea,
      strips,
      yardage: fitsFatQuarter(entries) ? { label: 'fat quarter', inches: 0, note: 'a fat quarter covers this' } : strips.yardage,
    });
  }
  out.sort((a, b) => b.strips.totalInches - a.strips.totalInches || b.cutArea - a.cutArea);
  return out;
}

/**
 * @param {object} block  from `buildBlock`
 * @param {object} opts   `{ seam, trim, copies }` - copies is how many of this
 *                        block the quilt needs, which scales every quantity.
 */
export function cuttingList(block, { seam, trim, copies = 1 } = {}) {
  const math = seamMath(seam, trim);
  const groups = newGroups();
  addBlockCuts(groups, block, math, copies);
  const fabrics = finishGroups(groups, block.fabrics);
  fabrics.forEach((f) => {
    f.pieceCount = block.pieces.filter((p) => p.fabric === f.fabric).length;
  });
  return { math, fabrics, copies };
}

/* ------------------------------------------------------------ strips ----- */

/**
 * Plan the cuts as width-of-fabric strips. Each entry is cut as strips of its
 * smaller dimension, sub-cut to its larger one; strips of the same width share
 * leftovers (first-fit, biggest pieces first). Pieces longer than the usable
 * width - borders - get strips joined end to end.
 */
export function stripPlan(entries, { usable = USABLE_WOF } = {}) {
  const byWidth = new Map();
  for (const e of entries) {
    if (!e.qty) continue;
    const width = Math.min(e.cutW, e.cutH);
    const len = Math.max(e.cutW, e.cutH);
    if (!byWidth.has(width)) byWidth.set(width, []);
    byWidth.get(width).push({ len, qty: e.qty, entry: e });
  }

  const strips = [];
  for (const [width, pieces] of [...byWidth].sort((p, q) => q[0] - p[0])) {
    const short = pieces.filter((p) => p.len <= usable).sort((p, q) => q.len - p.len);
    const long = pieces.filter((p) => p.len > usable);
    const bins = [];
    for (const p of short) {
      for (let i = 0; i < p.qty; i++) {
        let bin = bins.find((b) => b.left >= p.len);
        if (!bin) {
          bin = { left: usable, items: 0 };
          bins.push(bin);
        }
        bin.left -= p.len;
        bin.items++;
      }
    }
    let count = bins.length;
    let pieced = null;
    if (long.length) {
      const total = long.reduce((s, p) => s + p.len * p.qty, 0);
      const joins = long.reduce((s, p) => s + p.qty, 0);
      const n = Math.ceil((total + joins * inches(1)) / usable);
      count += n;
      pieced = {
        strips: n,
        note: `join ${n} strips end to end with diagonal seams, then cut`,
      };
    }
    strips.push({
      width,
      widthLabel: fmt(width),
      count,
      pieced,
      subcuts: pieces.map((p) => ({
        qty: p.qty,
        len: p.len,
        cut: p.entry.cut,
        purpose: p.entry.purpose,
        labels: p.entry.labels ?? [],
        long: p.len > usable,
      })),
    });
  }

  const totalInches = strips.reduce((s, x) => s + x.width * x.count, 0);
  return { strips, totalInches, usable, yardage: yardsFor(totalInches) };
}

/** Could every piece come out of one 18" × 21" fat quarter? */
function fitsFatQuarter(entries) {
  if (!entries.length) return false;
  if (entries.some((e) => Math.max(e.cutW, e.cutH) > FAT_QUARTER.w)) return false;
  const plan = stripPlan(entries, { usable: FAT_QUARTER.w });
  return plan.totalInches <= FAT_QUARTER.h;
}

/**
 * Running length off the bolt -> a shop cut. Rounded up to the next eighth of
 * a yard, with an eighth in hand for straightening the first cut.
 */
export function yardsFor(runningSixteenths) {
  const runningInches = toInches(runningSixteenths);
  if (runningInches <= 0) return { label: '—', yards: 0, inches: 0 };
  const eighths = Math.ceil((runningInches + 2) / 4.5);
  const yards = eighths / 8;
  const names = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  const whole = Math.floor(yards);
  const rem = eighths % 8;
  const label = `${whole || ''}${names[rem] ?? ''}`.trim() || '⅛';
  return { label: `${label} yd`, yards, inches: runningInches, note: 'cut as width-of-fabric strips' };
}

/**
 * The older area-based estimate, kept for anyone who wants a sanity check
 * against the strip plan. Generous on purpose.
 */
export function yardageFor(cutArea) {
  const withWaste = cutArea * 1.45;
  if (withWaste <= 18 * 21 * 0.85) {
    return { label: 'fat quarter', inches: 0, note: 'a fat quarter covers this' };
  }
  const runningInches = withWaste / 42;
  return yardsFor(inches(Math.ceil(runningInches)));
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

export { POS_NAME };

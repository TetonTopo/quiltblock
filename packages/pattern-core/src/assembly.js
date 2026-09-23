/**
 * Sew order, seam types, and the pressing plan.
 *
 * A pieced block is sewn as a tree: units become rows, rows become bands, bands
 * become the block. Working out that tree is a guillotine decomposition - keep
 * slicing the block with cuts that run edge to edge without crossing any unit.
 *
 * The decomposition is also the honest test for whether a block can be sewn
 * with straight seams at all. A region with no edge-to-edge cut left in it
 * cannot be assembled by joining two flat halves; it needs a PARTIAL SEAM (sew
 * part of a seam, add the neighbours, come back and finish it) or, for shapes
 * off the grid, a genuine set-in Y-seam. Those are the hardest thing in
 * patchwork, so a pattern that needs one has to say so on the front page rather
 * than ambush a beginner in step 9.
 */

import { fmt, fmtSize, luminance } from './units.js';
import { decompose } from './partition.js';
import { seamMath } from './seams.js';

export const PRESS = {
  left: { id: 'left', arrow: '←', name: 'press left' },
  right: { id: 'right', arrow: '→', name: 'press right' },
  up: { id: 'up', arrow: '↑', name: 'press up' },
  down: { id: 'down', arrow: '↓', name: 'press down' },
  open: { id: 'open', arrow: '↔', name: 'press open' },
};

const POS_NAME = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };

/**
 * Interior points where four or more pieces meet. Every one of them stacks four
 * seam allowances under the needle, which is where blocks get lumpy and where
 * pressing a seam open earns its extra minute at the ironing board.
 */
function bulkPoints(block) {
  const counts = new Map();
  for (const p of block.pieces) {
    for (const v of p.polygon) {
      const key = `${v.x},${v.y}`;
      if (!counts.has(key)) counts.set(key, { x: v.x, y: v.y, pieces: new Set() });
      counts.get(key).pieces.add(p.label);
    }
  }
  const out = [];
  for (const v of counts.values()) {
    const interior = v.x > 0 && v.y > 0 && v.x < block.size && v.y < block.size;
    if (interior && v.pieces.size >= 4) {
      out.push({ x: v.x, y: v.y, count: v.pieces.size, pieces: [...v.pieces].sort() });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x);
}

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

/** Which side of a seam is darker, so a pressed seam hides rather than shadows. */
function darkerSide(block, seam) {
  const touching = (test) =>
    block.pieces.filter((p) =>
      seam.orientation === 'horizontal'
        ? test(p.bbox.minY, p.bbox.maxY) && p.bbox.minX < seam.x1 && p.bbox.maxX > seam.x0
        : test(p.bbox.minX, p.bbox.maxX) && p.bbox.minY < seam.y1 && p.bbox.maxY > seam.y0,
    );
  const at = seam.orientation === 'horizontal' ? seam.y0 : seam.x0;
  const before = touching((lo, hi) => near(hi, at));
  const after = touching((lo) => near(lo, at));
  const avg = (list) =>
    list.length ? list.reduce((s, p) => s + luminance(block.fabrics[p.fabric].hex), 0) / list.length : 128;
  const lightBefore = avg(before);
  const lightAfter = avg(after);
  if (Math.abs(lightBefore - lightAfter) < 18) return null; // too close to matter
  const towardAfter = lightAfter < lightBefore;
  return seam.orientation === 'horizontal'
    ? towardAfter ? 'down' : 'up'
    : towardAfter ? 'right' : 'left';
}

/**
 * Walk the decomposition and emit one seam record per join.
 *
 * Nesting beats darkness. Two seams that will be sewn across each other should
 * point in opposite directions so they lock together at the intersection, which
 * is the whole reason quilters care which way a seam goes. Alternating by row
 * index guarantees that; darkness only breaks the tie when nesting doesn't
 * apply, and bulk overrides both.
 */
function collectSeams(block, node, seams, parity = 0) {
  if (node.type === 'unit') return;

  if (node.type === 'partial') {
    seams.push({
      type: 'partial',
      orientation: 'mixed',
      region: node.region,
      units: node.units.map((u) => u.index),
      press: 'open',
      note: 'This area has no seam that runs edge to edge, so it is sewn as a partial seam.',
    });
    node.units.forEach((u) => (u.partial = true));
    return;
  }

  const horizontal = node.type === 'rows';
  node.cuts.forEach((line, i) => {
    const seam = horizontal
      ? { orientation: 'horizontal', x0: node.region.x0, x1: node.region.x1, y0: line, y1: line }
      : { orientation: 'vertical', x0: line, x1: line, y0: node.region.y0, y1: node.region.y1 };
    seam.type = 'straight';
    seam.length = horizontal ? seam.x1 - seam.x0 : seam.y1 - seam.y0;
    seam.depth = node.depth;

    // Nesting parity: alternate along the run, and offset odd rows so the
    // seams in neighbouring rows oppose each other.
    const alternate = (i + parity) % 2 === 0;
    seam.press = horizontal ? (alternate ? 'down' : 'up') : alternate ? 'right' : 'left';
    seam.reason = 'nesting';

    const dark = darkerSide(block, seam);
    if (dark && dark === seam.press) {
      seam.reason = 'nesting and toward the darker fabric';
    } else if (dark) {
      seam.towardLight = true;
      seam.note =
        'This one presses toward the lighter fabric so it still nests. If the ' +
        'darker seam allowance shadows through, trim it a hair narrower than the light one.';
    }
    seams.push(seam);
  });

  node.children.forEach((child, i) => collectSeams(block, child, seams, parity + i));
}

/**
 * Press open only the seams that RUN THROUGH a four-piece junction.
 *
 * A seam merely ending at one is ordinary - that is just where seams meet, and
 * those are exactly the seams that should nest. It is the seam running across a
 * junction that stacks its allowance on top of four others, and it is the one
 * worth the extra minute at the ironing board. Flagging both would mean pressing
 * every seam in a star block open, which throws away nesting for nothing.
 */
function applyBulk(seams, bulk) {
  const bulky = bulk.filter((b) => b.count >= 4);
  for (const seam of seams) {
    if (seam.type !== 'straight') continue;
    const crossed = bulky.filter((b) =>
      seam.orientation === 'horizontal'
        ? b.y === seam.y0 && b.x > seam.x0 && b.x < seam.x1
        : b.x === seam.x0 && b.y > seam.y0 && b.y < seam.y1,
    );
    if (crossed.length) {
      seam.pressOverride = seam.press;
      seam.press = 'open';
      seam.crossings = crossed.length;
      seam.reason =
        `it runs across ${crossed.length} intersection${crossed.length === 1 ? '' : 's'} ` +
        'where four or more pieces meet';
    }
  }
}

/** A list of corners as a quilter would say it: "the top-left and top-right corners". */
function cornersPhrase(corners, F) {
  const byFabric = new Map();
  for (const k of corners) {
    if (!byFabric.has(k.fabric)) byFabric.set(k.fabric, []);
    byFabric.get(k.fabric).push(POS_NAME[k.pos]);
  }
  return [...byFabric.entries()]
    .map(([fab, poss]) => `${F(fab)} on the ${poss.join(' and ')} corner${poss.length === 1 ? '' : 's'}`)
    .join(', and ');
}

const UNIT_STEP = {
  hst: (u, F, m) =>
    `Pair a ${fmt(m.hstSquare(u.w))} ${F(u.a)} square with a ${F(u.b)} square the same size, right sides ` +
    `together. Draw the diagonal, sew ¼" either side of it, cut on the line, press to the darker ` +
    `fabric and trim to ${fmt(u.w + 2 * m.allowance)}. Two half-square triangles per pair.`,
  qst: (u, F, m) =>
    `Make two half-square triangles from ${fmt(m.qstSquare(u.w))} squares of ${F(u.a)} and ${F(u.b)}, ` +
    `then cross them right sides together with the seams nested, sew ¼" either side of the opposite ` +
    `diagonal and cut apart. Trim to ${fmt(u.w + 2 * m.allowance)}. Two hourglass units per pair.`,
  geese: (u, F, m) => {
    const long = Math.max(u.w, u.h);
    const short = Math.min(u.w, u.h);
    return (
      `No-waste flying geese: one ${fmt(m.geeseLarge(long))} ${F(u.a)} square and four ` +
      `${fmt(m.geeseSmall(short))} ${F(u.b)} squares make four ${fmtSize(long, short)} finished geese. ` +
      `Sew two small squares to opposite corners of the large one, cut between the seams, press, ` +
      `add a small square to each remaining corner, cut again. Trim to ${fmtSize(long + 2 * m.allowance, short + 2 * m.allowance)}.`
    );
  },
  patch: (u, F, m) => {
    if (!u.corners?.length) return null;
    const cut = m.patch(u.w, u.h);
    const sq = fmt(m.flipSquare(u.corners[0].size));
    return (
      `Stitch-and-flip: take the ${fmtSize(cut.w, cut.h)} ${F(u.a)} rectangle and lay a ${sq} square of ` +
      `${cornersPhrase(u.corners, F)}, right sides together. Sew across each square corner to corner, ` +
      `trim the two outer layers ¼" from the seam, flip the corner out and press.`
    );
  },
};

/** The same unit shape, ignoring position, so identical units group together. */
function unitSignature(u) {
  const corners = (u.corners ?? []).map((k) => `${k.pos}${k.fabric}`).sort().join('');
  return `${u.kind}:${u.a}:${u.b}:${u.dir}:${u.w}x${u.h}:${corners}`;
}

/**
 * The full plan for one block: sew order, seams, pressing, and an honest
 * difficulty read.
 */
export function planAssembly(block, { seam, trim } = {}) {
  const region = { x0: 0, y0: 0, x1: block.size, y1: block.size };
  const tree = decompose(block.units, region);
  const seams = [];
  collectSeams(block, tree, seams);
  const bulk = bulkPoints(block);
  applyBulk(seams, bulk);
  const m = seamMath(seam, trim);

  const F = (key) => block.fabrics[key]?.name ?? key;

  // Sub-assembly steps first: every triangle unit is built before anything is
  // joined, because that is the order you actually sit down and sew in.
  const steps = [];
  const bySig = new Map();
  for (const u of block.units) {
    if (u.kind === 'patch' && !u.corners?.length) continue;
    const key = unitSignature(u);
    if (!bySig.has(key)) bySig.set(key, []);
    bySig.get(key).push(u);
  }
  const unitGroups = [];
  for (const [, group] of bySig) {
    const u = group[0];
    const text = UNIT_STEP[u.kind](u, F, m);
    const kind = u.kind === 'patch' ? 'flip' : u.kind;
    unitGroups.push({
      kind,
      count: group.length,
      sample: u,
      a: u.a,
      b: u.b,
      finished: u.w === u.h ? `${fmt(u.w)} square` : fmtSize(u.w, u.h),
      unfinished: u.w === u.h ? `${fmt(u.w + 2 * m.allowance)} square` : fmtSize(u.w + 2 * m.allowance, u.h + 2 * m.allowance),
      name: labelForKind(kind, group.length),
      labels: group.flatMap((g) => g.pieces.map((p) => p.label)).sort(),
    });
    if (!text) continue;
    steps.push({
      phase: 'units',
      count: group.length,
      kind,
      labels: group.flatMap((g) => g.pieces.map((p) => p.label)).sort(),
      text: `Make ${group.length} ${labelForKind(kind, group.length)}. ${text}`,
    });
  }

  const describe = (node, path = 'the block') => {
    if (node.type === 'unit' || node.type === 'partial') return;
    const kids = node.children.length;
    const dir = node.type === 'rows' ? 'rows' : 'columns';
    const seamDir = node.type === 'rows' ? 'horizontal' : 'vertical';
    steps.push({
      phase: 'assembly',
      depth: node.depth,
      text:
        `Sew ${path} as ${kids} ${dir}, then join the ${dir} with ` +
        `${kids - 1} ${seamDir} seam${kids - 1 === 1 ? '' : 's'}.`,
    });
    node.children.forEach((c, i) => describe(c, `${dir.slice(0, -1)} ${i + 1}`));
  };
  describe(tree);

  const partials = seams.filter((s) => s.type === 'partial');
  const pressOpen = seams.filter((s) => s.press === 'open');

  return {
    tree,
    seams,
    steps,
    unitGroups,
    bulk,
    partialSeams: partials,
    needsPartialSeam: partials.length > 0,
    needsSetIn: false, // grid geometry is always convex; nothing to set in
    pressOpenCount: pressOpen.length,
    summary:
      `${seams.length} seam${seams.length === 1 ? '' : 's'} joining the units` +
      (partials.length ? `, ${partials.length} of them partial` : ', all of them straight') +
      (pressOpen.length ? `. ${pressOpen.length} pressed open to spread bulk.` : '.'),
  };
}

export function labelForKind(kind, n) {
  const names = {
    hst: ['half-square triangle', 'half-square triangles'],
    qst: ['hourglass unit', 'hourglass units'],
    geese: ['flying goose', 'flying geese'],
    flip: ['stitch-and-flip unit', 'stitch-and-flip units'],
    patch: ['patch', 'patches'],
  };
  const pair = names[kind] ?? [kind, kind];
  return n === 1 ? pair[0] : pair[1];
}

/** Seam length totals, which is a decent proxy for how long a block takes. */
export function seamStats(plan, block) {
  const total = plan.seams.reduce((s, x) => s + (x.length ?? 0), 0);
  const diagonals = block.units.filter((u) => u.kind !== 'patch').length;
  return {
    joinSeams: plan.seams.length,
    joinLength: total,
    joinLengthLabel: fmt(total),
    diagonalUnits: diagonals,
  };
}

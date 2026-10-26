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
    const interior = v.x > 0 && v.y > 0 && v.x < block.width && v.y < block.height;
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

/**
 * Sub-blocks that are nothing but parallel strips in the same order - the
 * squares of a rail fence. Nobody cuts sixteen rectangles for those: you sew
 * one long strip of each fabric together and cut the strip set into squares,
 * turning them as the block needs. Returns the squares that share a strip
 * sequence with at least one other (turned or not), each with a `key` naming
 * its strip set.
 */
export function stripSquares(block) {
  const n = block.subgrid ?? 1;
  if (n < 2) return [];
  const W = block.width / n;
  const H = block.height / n;
  const squares = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x0 = c * W, y0 = r * H, x1 = x0 + W, y1 = y0 + H;
      const us = block.units.filter((u) => u.x >= x0 && u.x + u.w <= x1 && u.y >= y0 && u.y + u.h <= y1);
      if (us.length < 2 || us.some((u) => u.kind !== 'patch' || u.corners?.length)) continue;
      const across = us.every((u) => u.x === x0 && u.w === W);
      const upDown = us.every((u) => u.y === y0 && u.h === H);
      if (!across && !upDown) continue;
      const ordered = [...us].sort((p, q) => (across ? p.y - q.y : p.x - q.x));
      const seq = ordered.map((u) => `${u.a}:${across ? u.h : u.w}`);
      const fwd = seq.join(',');
      const rev = [...seq].reverse().join(',');
      squares.push({
        region: { x0, y0, x1, y1 },
        units: ordered,
        across,
        row: r,
        col: c,
        n,
        side: across ? W : H,
        key: `${W}x${H}|${fwd <= rev ? fwd : rev}`,
        // The strips in sewing order, as the canonical sequence reads them.
        strips: (fwd <= rev ? ordered : [...ordered].reverse()).map((u) => ({ fabric: u.a, width: across ? u.h : u.w })),
      });
    }
  }
  const count = new Map();
  for (const s of squares) count.set(s.key, (count.get(s.key) ?? 0) + 1);
  return squares.filter((s) => count.get(s.key) >= 2);
}

const ROW_NAME = (r, n) => (n === 2 ? ['top', 'bottom'][r] : n === 3 ? ['top', 'middle', 'bottom'][r] : `row ${r + 1}`);
const COL_NAME = (c, n) => (n === 2 ? ['left', 'right'][c] : n === 3 ? ['left', 'middle', 'right'][c] : `column ${c + 1}`);

/** "E, G and H" */
const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

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
  const region = { x0: 0, y0: 0, x1: block.width, y1: block.height };
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

  // Strip sets: one long strip of each fabric, sewn together, cut into squares.
  const squares = stripSquares(block);
  const sets = new Map();
  for (const s of squares) {
    if (!sets.has(s.key)) sets.set(s.key, []);
    sets.get(s.key).push(s);
  }
  for (const group of sets.values()) {
    const s = group[0];
    const seg = m.patch(s.side, s.side).w;
    const widths = new Set(s.strips.map((t) => t.width));
    const cutW = (t) => fmt(m.patch(t.width, t.width).w);
    const strips =
      widths.size === 1
        ? `a ${cutW(s.strips[0])} × ${fmt(group.length * seg)} strip of each of ${listOf(s.strips.map((t) => F(t.fabric)))}`
        : `one strip ${fmt(group.length * seg)} long of each: ${listOf(s.strips.map((t) => `${F(t.fabric)} ${cutW(t)} wide`))}`;
    const labels = group.flatMap((g) => g.units.flatMap((u) => u.pieces.map((p) => p.label))).sort();
    unitGroups.push({
      kind: 'strip',
      count: group.length,
      sample: { x: s.region.x0, y: s.region.y0, w: s.side, h: s.side, pieces: s.units.flatMap((u) => u.pieces) },
      finished: `${fmt(s.side)} square`,
      unfinished: `${fmt(seg)} square`,
      name: `strip-set square${group.length === 1 ? '' : 's'}, all cut from one strip set`,
      labels,
    });
    steps.push({
      phase: 'units',
      count: group.length,
      kind: 'strip',
      labels,
      region: s.region,
      added: s.units.flatMap((u) => u.pieces.map((p) => p.label)),
      text:
        `Make a strip set: cut ${strips}, and sew them together along their long edges in that order. ` +
        `Cut it across into ${group.length} ${fmt(seg)} squares. Pieces ${listOf(labels)} all come from this one strip set.`,
    });
  }

  // The sew order, inside out: the smallest sewn unit first, then whatever is
  // added to it, each step naming its pieces and drawn on its own. A strip-set
  // square counts as one piece here.
  const inSquare = new Map();
  for (const s of squares) for (const u of s.units) inSquare.set(u, s);
  const stepUnits = block.units.filter((u) => !inSquare.has(u));
  for (const s of squares) {
    stepUnits.push({
      kind: 'segment',
      square: s,
      x: s.region.x0,
      y: s.region.y0,
      w: s.region.x1 - s.region.x0,
      h: s.region.y1 - s.region.y0,
      pieces: s.units.flatMap((u) => u.pieces),
    });
  }
  const stepTree = squares.length ? decompose(stepUnits, region) : tree;
  const leafName = (u) => {
    if (u.kind === 'segment') {
      const s = u.square;
      const lead = F(s.units[0].a);
      return `the ${ROW_NAME(s.row, s.n)}-${COL_NAME(s.col, s.n)} strip square (strips running ${s.across ? `across, ${lead} at the top` : `up and down, ${lead} on the left`})`;
    }
    const own = u.pieces.filter((p) => p.role !== 'corner').map((p) => p.label);
    return u.kind === 'patch' ? own[0] ?? u.pieces[0].label : u.pieces.map((p) => p.label).join('/');
  };
  const labelsIn = (node) =>
    node.type === 'unit' ? node.unit.pieces.map((p) => p.label)
      : node.type === 'partial' ? node.units.flatMap((u) => u.pieces.map((p) => p.label))
        : node.children.flatMap(labelsIn);
  const stepOf = new Map();
  const build = (node) => {
    if (node.type === 'unit') return;
    const labels = labelsIn(node);
    if (node.type === 'partial') {
      steps.push({
        phase: 'assembly',
        region: node.region,
        labels,
        added: labels,
        text: `Sew ${listOf(node.units.map(leafName))} together with a partial seam: sew part of the first seam, add the pieces around it in turn, then come back and finish it.`,
      });
      stepOf.set(node, steps.length);
      return;
    }
    node.children.forEach(build);
    const down = node.type === 'rows';
    const kids = node.children;
    const name = (k) => (k.type === 'unit' ? leafName(k.unit) : `the step ${stepOf.get(k)} unit`);
    const builtAt = kids.map((k, i) => (k.type === 'unit' ? -1 : i)).filter((i) => i >= 0);
    let text;
    if (!builtAt.length) {
      text = `Sew ${listOf(kids.map(name))} together, ${down ? 'top to bottom' : 'left to right'}.`;
    } else if (builtAt.length === 1) {
      const k = builtAt[0];
      const before = kids.slice(0, k).map(name);
      const after = kids.slice(k + 1).map(name);
      const [first, last] = down ? ['top', 'bottom'] : ['left', 'right'];
      const parts = [];
      if (before.length) parts.push(`${listOf(before)} to the ${first}`);
      if (after.length) parts.push(`${listOf(after)} to the ${last}`);
      text = `Sew ${parts.join(' and ')} of ${name(kids[k])}.`;
    } else {
      text = `Join ${listOf(kids.map(name))}, ${down ? 'top to bottom' : 'left to right'}.`;
    }
    steps.push({
      phase: 'assembly',
      depth: node.depth,
      region: node.region,
      labels,
      added: kids.filter((k) => k.type === 'unit').flatMap(labelsIn),
      text,
    });
    stepOf.set(node, steps.length);
  };
  build(stepTree);

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

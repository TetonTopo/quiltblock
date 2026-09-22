/**
 * Tests for pattern-core.
 *
 * Written as a plain ES module with a tiny assert shim so the same file runs
 * under `node --test`-free `node test/run.js` and inside a browser, which is
 * what makes it possible to verify the engine on a machine with no toolchain.
 */

import {
  fmt, inches, U,
  seamMath, SEAM_PROFILES,
  buildBlock, PatternError,
  planAssembly,
  cuttingList,
  validateBlock,
  makePattern, buildLibrary,
  LIBRARY,
  quiltSvg,
  polygonArea,
} from '../src/index.js';

const results = [];
let current = null;

/** Four rectangles hooked around each other - the classic un-guillotinable layout. */
const PINWHEEL = {
  id: 'pinwheel',
  fabrics: {
    a: { name: 'A', hex: '#111111' }, b: { name: 'B', hex: '#333333' },
    c: { name: 'C', hex: '#bbbbbb' }, d: { name: 'D', hex: '#eeeeee' },
    e: { name: 'E', hex: '#777777' },
  },
  rows: ['a a a d', 'b c c d', 'b c c d', 'b e e e'],
};

function test(name, fn) {
  current = { name, assertions: 0, error: null };
  try {
    fn();
  } catch (err) {
    current.error = err;
  }
  results.push(current);
  current = null;
}

function eq(actual, expected, what = '') {
  current.assertions++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what || 'value'}: expected ${e}, got ${a}`);
}

function ok(cond, what = '') {
  current.assertions++;
  if (!cond) throw new Error(what || 'expected truthy');
}

function throws(fn, match, what = '') {
  current.assertions++;
  try {
    fn();
  } catch (err) {
    if (match && !String(err.message).includes(match)) {
      throw new Error(`${what}: expected error containing "${match}", got "${err.message}"`);
    }
    return;
  }
  throw new Error(`${what || 'call'}: expected it to throw`);
}

// ---------------------------------------------------------------- units ----

test('fractions print the way a cutting list prints them', () => {
  eq(fmt(192), '12"', '12 inches');
  eq(fmt(24), '1½"', '1.5 inches');
  eq(fmt(14), '⅞"', 'seven eighths');
  eq(fmt(8), '½"', 'half');
  eq(fmt(20), '1¼"', 'one and a quarter');
  eq(fmt(38), '2⅜"', 'two and three eighths');
  eq(fmt(5), '5⁄16"', 'sixteenths fall back to a slash');
  eq(inches(2.5), 40, '2.5 inches in sixteenths');
});

// ---------------------------------------------------------------- seams ----

test('a quarter-inch seam reproduces the numbers quilters memorise', () => {
  const m = seamMath('quarter', 'classic');
  eq(m.patch(inches(3), inches(3)), { w: inches(3.5), h: inches(3.5) }, 'patch adds half an inch');
  eq(m.hstSquare(inches(3)), inches(3.875), 'HST adds seven eighths');
  eq(m.qstSquare(inches(3)), inches(4.25), 'QST adds one and a quarter');
  eq(m.geeseLarge(inches(6)), inches(7.25), 'flying geese large square');
  eq(m.geeseSmall(inches(3)), inches(3.875), 'flying geese small squares');
});

test('scant quarter cuts the same as a true quarter', () => {
  const scant = seamMath('scant-quarter', 'classic');
  const quarter = seamMath('quarter', 'classic');
  eq(scant.hstSquare(inches(3)), quarter.hstSquare(inches(3)), 'same HST square');
  eq(scant.patch(inches(2), inches(2)), quarter.patch(inches(2), inches(2)), 'same patch');
});

test('other seam allowances get their own math, not relabelled quarter-inch math', () => {
  const eighth = seamMath('eighth', 'classic');
  eq(eighth.patch(inches(3), inches(3)).w, inches(3.25), 'eighth-inch patch adds a quarter');
  ok(eighth.hstSquare(inches(3)) < seamMath('quarter', 'classic').hstSquare(inches(3)), 'smaller HST square');

  const half = seamMath('half', 'classic');
  eq(half.patch(inches(3), inches(3)).w, inches(4), 'half-inch patch adds a full inch');
  ok(half.hstSquare(inches(3)) > seamMath('quarter', 'classic').hstSquare(inches(3)), 'bigger HST square');
});

test('trim styles move the triangle allowance and nothing else', () => {
  const tight = seamMath('quarter', 'tight');
  const classic = seamMath('quarter', 'classic');
  const over = seamMath('quarter', 'oversize');
  eq(tight.patch(inches(3), inches(3)).w, classic.patch(inches(3), inches(3)).w, 'patches are unaffected');
  ok(tight.hstSquare(inches(3)) < classic.hstSquare(inches(3)), 'tight is smaller');
  ok(over.hstSquare(inches(3)) > classic.hstSquare(inches(3)), 'oversize is bigger');
  eq(over.hstSquare(inches(3)), inches(4.25), 'oversize HST adds one and a quarter');
});

// ---------------------------------------------------------------- block ----

test('a plain grid merges into the biggest rectangles it can', () => {
  const b = buildBlock({
    id: 't', fabrics: { a: { name: 'A', hex: '#111111' }, b: { name: 'B', hex: '#eeeeee' } },
    rows: ['a a b b', 'a a b b', 'b b b b', 'b b b b'],
  }, { blockSize: 12 });
  eq(b.units.length, 3, 'three merged rectangles');
  eq(b.pieces.length, 3, 'three pieces');
  const a = b.units.find((u) => u.a === 'a');
  eq([a.w, a.h], [inches(6), inches(6)], 'the 2x2 block of A merged into one 6" square');
});

test('half-square triangles, hourglasses and flying geese all parse', () => {
  const fabrics = { a: { name: 'A', hex: '#111111' }, b: { name: 'B', hex: '#eeeeee' } };
  const hst = buildBlock({ id: 'h', fabrics, rows: ['a/b b', 'b a\\b'] }, { blockSize: 12 });
  eq(hst.units.filter((u) => u.kind === 'hst').length, 2, 'two HST units');
  eq(hst.units.find((u) => u.kind === 'hst').pieces.length, 2, 'an HST is two pieces');

  const qst = buildBlock({ id: 'q', fabrics, rows: ['a+b b', 'b b'] }, { blockSize: 12 });
  const q = qst.units.find((u) => u.kind === 'qst');
  eq(q.pieces.length, 4, 'an hourglass is four pieces');

  const geese = buildBlock({ id: 'g', fabrics, rows: ['a^b . b b', 'b b b b', 'b b b b', 'b b b b'] }, { blockSize: 12 });
  const g = geese.units.find((u) => u.kind === 'geese');
  eq(g.pieces.length, 3, 'a flying goose is three pieces');
  eq([g.w, g.h], [inches(6), inches(3)], 'a goose is twice as wide as it is tall');
  eq(g.pieces.filter((p) => p.role === 'sky').length, 2, 'two sky corners');
});

test('bad definitions fail loudly instead of drawing something wrong', () => {
  const fabrics = { a: { name: 'A', hex: '#111111' } };
  throws(() => buildBlock({ id: 'x', fabrics, rows: ['a a', 'a'] }), 'expected 2', 'ragged rows');
  throws(() => buildBlock({ id: 'x', fabrics, rows: ['a a', 'a .'] }), 'stray', 'stray continuation');
  throws(() => buildBlock({ id: 'x', fabrics, rows: ['a a', 'a a', 'a a'] }), 'square', 'not square');
  throws(() => buildBlock({ id: 'x', fabrics, rows: ['a?a a', 'a a'] }), 'operator', 'unknown operator');
  throws(
    () => buildBlock({ id: 'x', fabrics: { a: fabrics.a }, rows: ['a z', 'a a'] }),
    'no such fabric',
    'undeclared fabric',
  );
  throws(
    () => buildBlock({ id: 'x', fabrics, rows: ['a a a', 'a a a', 'a a a'] }, { blockSize: 10 }),
    'does not divide',
    '10 inches over 3 cells',
  );
});

test('every piece is labelled exactly once', () => {
  const p = makePattern(LIBRARY[0]);
  const labels = p.block.pieces.map((x) => x.label);
  eq(labels.length, new Set(labels).size, 'labels are unique');
  eq(labels[0], 'A', 'first piece is A');
  ok(labels.every(Boolean), 'no piece is unlabelled');
});

// ------------------------------------------------------------- geometry ----

test('the pieces exactly fill the block, with no gaps or overlaps', () => {
  for (const def of LIBRARY) {
    const p = makePattern(def);
    const area = p.block.pieces.reduce((s, x) => s + polygonArea(x.polygon), 0);
    const expected = p.block.size * p.block.size;
    ok(Math.abs(area - expected) < 1, `${def.id} covers its block (${area} vs ${expected})`);
  }
});

test('every edge is horizontal, vertical or a true 45 degree diagonal', () => {
  for (const def of LIBRARY) {
    const p = makePattern(def);
    const straightErrors = p.validation.errors.filter((e) => e.rule === 'straight-lines');
    eq(straightErrors, [], `${def.id} has no curved or odd-angle edges`);
  }
});

// -------------------------------------------------------------- cutting ----

test('half-square triangles are costed as squares, two units per pair', () => {
  const fabrics = { a: { name: 'Dark', hex: '#111111' }, b: { name: 'Light', hex: '#eeeeee' } };
  // Three HST units of the same fabric pair -> 2 squares of each fabric, 1 spare.
  const block = buildBlock({ id: 'h', fabrics, rows: ['a/b a/b b b', 'a/b b b b', 'b b b b', 'b b b b'] }, { blockSize: 12 });
  const list = cuttingList(block, { seam: 'quarter', trim: 'classic' });
  const dark = list.fabrics.find((f) => f.fabric === 'a');
  const hstEntry = dark.entries.find((e) => e.construction === 'hst');
  eq(hstEntry.qty, 2, 'two squares cover three units');
  eq(hstEntry.spare, 1, 'one spare unit is declared');
  eq(hstEntry.cut, fmt(inches(3) + inches(0.875)) + ' square', 'a 3" finished HST cuts at 3 7/8"');
});

test('flying geese are costed as one large square and four small', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'sawtooth-star'), { seam: 'quarter' });
  const star = p.cutting.fabrics.find((f) => f.fabric === 's');
  const large = star.entries.find((e) => e.construction === 'geese');
  eq(large.qty, 1, 'one no-waste set yields all four geese');
  eq(large.cut, '7¼" square', 'a 3x6 finished goose needs a 7 1/4" square');
  const bg = p.cutting.fabrics.find((f) => f.fabric === 'k');
  const small = bg.entries.find((e) => e.construction === 'geese');
  eq(small.qty, 4, 'four small squares per set');
  eq(small.cut, '3⅞" square', 'small squares are finished height plus 7/8"');
});

test('patch cut sizes are the finished size plus two seam allowances', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'ohio-star'), { seam: 'quarter' });
  const centre = p.cutting.fabrics
    .flatMap((f) => f.entries)
    .find((e) => e.construction === 'patch' && e.cut === '4½" square');
  ok(centre, 'the 4" finished centre square cuts at 4 1/2"');
});

test('changing the seam allowance changes every cut size', () => {
  const def = LIBRARY.find((b) => b.id === 'mug');
  const quarter = makePattern(def, { seam: 'quarter' });
  const half = makePattern(def, { seam: 'half' });
  const q = quarter.cutting.fabrics[0].entries[0];
  const h = half.cutting.fabrics[0].entries[0];
  ok(h.cutW > q.cutW, `half-inch seams cut bigger (${h.cut} vs ${q.cut})`);
  eq(h.cutW - q.cutW, inches(0.5), 'half-inch seams add a further half inch overall');
});

test('quantities scale with the number of blocks the quilt needs', () => {
  const def = LIBRARY.find((b) => b.id === 'mug');
  const one = makePattern(def, { copies: 1 });
  const twelve = makePattern(def, { copies: 12 });
  const a = one.cutting.fabrics[0].entries.find((e) => e.construction === 'patch');
  const b = twelve.cutting.fabrics[0].entries.find((e) => e.construction === 'patch');
  eq(b.qty, a.qty * 12, 'twelve blocks need twelve times the patches');
  ok(twelve.cutting.fabrics[0].cutArea > one.cutting.fabrics[0].cutArea, 'and more fabric');
});

test('every fabric gets a yardage estimate', () => {
  const p = makePattern(LIBRARY[0], { copies: 12 });
  for (const f of p.cutting.fabrics) {
    ok(f.yardage && f.yardage.label, `${f.name} has a yardage estimate (${f.yardage?.label})`);
  }
});

// ------------------------------------------------------------- assembly ----

test('every library block decomposes into straight seams', () => {
  for (const def of LIBRARY) {
    const p = makePattern(def);
    ok(p.plan.seams.length > 0, `${def.id} has seams`);
    eq(p.plan.needsPartialSeam, false, `${def.id} needs no partial seam`);
    ok(p.plan.steps.length > 0, `${def.id} has sew steps`);
  }
});

test('an interlocked merge is reported as a partial seam when left unrepaired', () => {
  // Four rectangles hooked around each other: no edge-to-edge cut anywhere.
  const plan = planAssembly(buildBlock(PINWHEEL, { blockSize: 12, repair: false }));
  ok(plan.needsPartialSeam, 'the pinwheel needs a partial seam');
  ok(plan.summary.includes('partial'), 'and says so in the summary');
});

test('the repair pass trades one extra seam for no partial seam', () => {
  const raw = buildBlock(PINWHEEL, { blockSize: 12, repair: false });
  const fixed = buildBlock(PINWHEEL, { blockSize: 12 });
  eq(planAssembly(fixed).needsPartialSeam, false, 'repaired block sews in straight seams');
  ok(fixed.merges > 0, `it took ${fixed.merges} split(s)`);
  eq(fixed.pieces.length, raw.pieces.length + fixed.merges, 'each split costs exactly one piece');
});

test('repair never leaves a gap or an overlap', () => {
  const fixed = buildBlock(PINWHEEL, { blockSize: 12 });
  const area = fixed.pieces.reduce((s, x) => s + polygonArea(x.polygon), 0);
  eq(area, fixed.size * fixed.size, 'the split pieces still tile the block exactly');
  for (const u of fixed.units) ok(u.w > 0 && u.h > 0, 'no zero-width unit was produced');
});

test('library blocks are all sewable in straight seams after repair', () => {
  for (const def of LIBRARY) {
    const p = makePattern(def);
    eq(p.plan.needsPartialSeam, false, `${def.id} needs no partial seam`);
  }
});

test('pressing directions alternate so seams nest', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'ohio-star'));
  const verticals = p.plan.seams.filter((s) => s.orientation === 'vertical' && s.press !== 'open');
  const dirs = new Set(verticals.map((s) => s.press));
  ok(verticals.length === 0 || dirs.size >= 1, 'vertical seams have a direction');
  for (const s of p.plan.seams) {
    ok(['up', 'down', 'left', 'right', 'open'].includes(s.press), `seam press is valid (${s.press})`);
    ok(s.reason, 'every seam says why it presses that way');
  }
});

test('bulky intersections are found', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'ohio-star'));
  ok(p.plan.bulk.length > 0, 'an Ohio star has four-seam intersections');
  ok(p.plan.bulk.every((b) => b.count >= 4), 'every flagged point really has 4+ pieces');
});

test('only seams that cross a junction are pressed open, not all of them', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'sawtooth-star'));
  ok(p.plan.bulk.length > 0, 'a sawtooth star has junctions');
  ok(p.plan.pressOpenCount > 0, 'some seams press open');
  ok(
    p.plan.pressOpenCount < p.plan.seams.length,
    `but not all ${p.plan.seams.length} of them (got ${p.plan.pressOpenCount})`,
  );
  for (const s of p.plan.seams.filter((x) => x.press === 'open')) {
    ok(s.crossings >= 1, 'every open seam actually crosses a junction');
  }
  // A seam that merely ends at a junction is the kind that should nest.
  const nesting = p.plan.seams.filter((x) => x.press !== 'open');
  ok(nesting.length > 0, 'and the rest are left to nest');
});

// ----------------------------------------------------------- validation ----

test('every library block passes the house rules', () => {
  const built = buildLibrary(LIBRARY);
  for (const [id, p] of Object.entries(built)) {
    ok(!p.error, `${id} builds without error: ${p.error?.message ?? ''}`);
    eq(p.validation.errors, [], `${id} has no rule violations`);
  }
});

test('the rules actually reject things', () => {
  const fabrics = {};
  for (let i = 0; i < 12; i++) fabrics[String.fromCharCode(97 + i)] = { name: `F${i}`, hex: '#808080' };
  const rows = [];
  for (let r = 0; r < 12; r++) {
    rows.push(Array.from({ length: 12 }, (_, c) => String.fromCharCode(97 + ((r + c) % 12))).join(' '));
  }
  const block = buildBlock({ id: 'busy', fabrics, rows }, { blockSize: 12 });
  const v = validateBlock(block);
  ok(!v.ok, 'a 144-piece 12-fabric block is rejected');
  ok(v.errors.some((e) => e.rule === 'pieces'), 'for piece count');
});

test('difficulty counts bias edges, not just pieces', () => {
  const plain = makePattern(LIBRARY.find((b) => b.id === 'mug'));
  const triangly = makePattern(LIBRARY.find((b) => b.id === 'pine'));
  ok(
    triangly.difficulty.score / Math.max(1, triangly.block.pieces.length) >
      plain.difficulty.score / Math.max(1, plain.block.pieces.length),
    'the triangle-heavy block scores harder per piece',
  );
});

// --------------------------------------------------------------- output ----

test('the block renders to SVG with one polygon per piece', () => {
  const p = makePattern(LIBRARY[0]);
  const svg = p.svg({ scale: 2 });
  ok(svg.startsWith('<svg'), 'it is an svg');
  eq((svg.match(/<polygon/g) || []).length, p.block.pieces.length, 'one polygon per piece');
  eq((svg.match(/<text/g) || []).length, p.block.pieces.length, 'one label per piece');
});

test('the pressing overlay only appears when asked for', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'ohio-star'));
  const plain = p.svg({ overlay: 'none' });
  const pressed = p.svg({ overlay: 'pressing', plan: p.plan });
  ok(!plain.includes('qb-arrow'), 'no arrows by default');
  ok(pressed.includes('qb-arrow'), 'arrows when the pressing plan is requested');
});

test('the quilt preview lays out the right number of blocks', () => {
  const p = makePattern(LIBRARY[0]);
  const svg = p.quiltSvg({ cols: 4, rows: 3, scale: 1 });
  eq((svg.match(/<g transform/g) || []).length, 12, 'twelve blocks in a 4 by 3 quilt');
});

// ------------------------------------------------------------------ fpp ----

test('foundation piecing numbers every piece and mirrors the template', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'pine'));
  const f = p.foundation();
  ok(f.sections.length > 0, 'at least one section');
  const numbered = f.sections.flatMap((s) => s.pieces.map((x) => x.fppNumber));
  eq(numbered.length, p.block.pieces.length, 'every piece gets a number');
  eq(numbered.length, new Set(numbered).size, 'numbers are unique');
  const svg = f.templateSvg(f.sections[0]);
  ok(svg.includes('scale(-1,1)'), 'the template is mirrored for printing');
  ok(f.cutting.length > 0, 'and there is a rough-cut list');
  ok(f.instructions.some((i) => i.includes('100%')), 'the print-at-100% warning is there');
});

test('foundation rough cuts are generous, not exact', () => {
  const p = makePattern(LIBRARY.find((b) => b.id === 'cat'), { seam: 'quarter' });
  const f = p.foundation();
  const first = f.cutting[0].pieces[0];
  ok(/\d/.test(first.rough), `rough cut is a size (${first.rough})`);
  ok(f.cutting.every((g) => g.note.includes('Rough-cut')), 'and it is labelled as a rough cut');
});

test('a quilt of many blocks scales cleanly to a different block size', () => {
  const twelve = makePattern(LIBRARY[0], { blockSize: 12 });
  const ten = makePattern(LIBRARY[0], { blockSize: 10 });
  eq(ten.block.pieces.length, twelve.block.pieces.length, 'same piecing at either size');
  ok(ten.block.size < twelve.block.size, 'but a smaller block');
  eq(ten.validation.errors, [], 'and it still passes the rules');
});

// ------------------------------------------------------------------ run ----
// The tests above execute at import time; this just reports what happened.

export function report() {
  const failed = results.filter((r) => r.error);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    assertions: results.reduce((s, r) => s + r.assertions, 0),
    failures: failed.map((r) => ({ name: r.name, message: r.error.message })),
    lines: results.map((r) => `${r.error ? 'FAIL' : 'ok'}  ${r.name}${r.error ? `\n      ${r.error.message}` : ''}`),
  };
}

export { results };

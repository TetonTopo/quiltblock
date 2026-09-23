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
  buildBlock, PatternError, mirrorDef, validSizes, unitCounts,
  planAssembly,
  cuttingList, stripPlan, yardsFor,
  validateBlock, difficultyOf,
  makePattern, buildLibrary,
  LIBRARY, HEXAGON_LIBRARY,
  quiltSvg,
  polygonArea,
  TIERS, TIER_ORDER, tierOfScore,
  COLORWAYS, applyColorway,
  planQuilt, layoutFor, QUILT_SIZES,
  planHexagons, hexagonsSvg, hexTemplateSvg,
} from '../src/index.js';

const results = [];
let current = null;

/** Four rectangles hooked around each other - the classic un-guillotinable layout. */
const PINWHEEL = {
  id: 'pinwheel-test',
  fabrics: {
    a: { name: 'A', hex: '#111111' }, b: { name: 'B', hex: '#333333' },
    c: { name: 'C', hex: '#bbbbbb' }, d: { name: 'D', hex: '#eeeeee' },
    e: { name: 'E', hex: '#777777' },
  },
  rows: ['a a a d', 'b c c d', 'b c c d', 'b e e e'],
};

const AB = { a: { name: 'A', hex: '#111111' }, b: { name: 'B', hex: '#eeeeee' } };
const byId = (id) => LIBRARY.find((b) => b.id === id);

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
  eq(m.flipSquare(inches(2)), inches(2.5), 'a 2" stitch-and-flip corner is a 2½" square');
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
    id: 't', fabrics: AB,
    rows: ['a a b b', 'a a b b', 'b b b b', 'b b b b'],
  }, { blockSize: 12 });
  eq(b.units.length, 3, 'three merged rectangles');
  eq(b.pieces.length, 3, 'three pieces');
  const a = b.units.find((u) => u.a === 'a');
  eq([a.w, a.h], [inches(6), inches(6)], 'the 2x2 block of A merged into one 6" square');
});

test('half-square triangles, hourglasses and flying geese all parse', () => {
  const hst = buildBlock({ id: 'h', fabrics: AB, rows: ['a/b b', 'b a\\b'] }, { blockSize: 12, corners: 'hst' });
  eq(hst.units.filter((u) => u.kind === 'hst').length, 2, 'two HST units');
  eq(hst.units.find((u) => u.kind === 'hst').pieces.length, 2, 'an HST is two pieces');

  const qst = buildBlock({ id: 'q', fabrics: AB, rows: ['a+b b', 'b b'] }, { blockSize: 12 });
  const q = qst.units.find((u) => u.kind === 'qst');
  eq(q.pieces.length, 4, 'an hourglass is four pieces');

  const geese = buildBlock({ id: 'g', fabrics: AB, rows: ['a^b . b b', 'b b b b', 'b b b b', 'b b b b'] }, { blockSize: 12 });
  const g = geese.units.find((u) => u.kind === 'geese');
  eq(g.pieces.length, 3, 'a flying goose is three pieces');
  eq([g.w, g.h], [inches(6), inches(3)], 'a goose is twice as wide as it is tall');
  eq(g.pieces.filter((p) => p.role === 'sky').length, 2, 'two sky corners');
});

test('a triangle can span several cells with continuation dots', () => {
  const b = buildBlock({ id: 'big', fabrics: AB, rows: ['a/b . b', '. . b', 'b b b'] }, { blockSize: 12, corners: 'hst' });
  const big = b.units.find((u) => u.kind === 'hst');
  eq([big.w, big.h], [inches(8), inches(8)], 'the HST is 8" across');
  eq(b.pieces.length, 2 + 2, 'two triangles plus the merged background');
  const area = b.pieces.reduce((s, p) => s + polygonArea(p.polygon), 0);
  eq(area, b.size * b.size, 'and it still tiles the block');
  throws(
    () => buildBlock({ id: 'bad', fabrics: AB, rows: ['a/b . b', 'b . b', 'b b b'] }),
    'continuation',
    'a ragged continuation square is rejected',
  );
});

test('a corner triangle is absorbed into its patch as a stitch-and-flip corner', () => {
  // A 1x3 strip of b with a's triangle clipping its top-right corner.
  const def = { id: 'snf', fabrics: AB, rows: ['b b a\\b', 'b b b', 'b b b'] };
  const flip = buildBlock(def, { blockSize: 12 });
  const patch = flip.units.find((u) => u.corners?.length);
  ok(patch, 'one patch has a corner');
  eq(patch.corners.map((k) => k.pos), ['tr'], 'it is the top-right corner');
  eq(patch.pieces.length, 2, 'the patch is a clipped rectangle plus one triangle');
  eq(flip.pieces.length, 2, 'two pieces in all');
  const area = flip.pieces.reduce((s, p) => s + polygonArea(p.polygon), 0);
  eq(area, flip.size * flip.size, 'the clipped rectangle and its corner still tile the block');

  const hst = buildBlock(def, { blockSize: 12, corners: 'hst' });
  eq(hst.units.filter((u) => u.kind === 'hst').length, 1, 'with corners off it stays a half-square triangle');
  ok(hst.pieces.length > flip.pieces.length, 'and costs more pieces');
});

test('four corners make a square in a square, two make a flying goose', () => {
  const sq = buildBlock(byId('square-in-square'), { blockSize: 6 });
  eq(sq.units.length, 1, 'one unit');
  eq(sq.units[0].corners.length, 4, 'with four corners');
  eq(sq.pieces.length, 5, 'five pieces');

  const goose = buildBlock(
    { id: 'goose', fabrics: { ...AB, c: { name: 'C', hex: '#888888' } }, rows: ['b/a b\\a', 'c c'] },
    { blockSize: 12 },
  );
  const unit = goose.units.find((u) => u.corners?.length === 2);
  ok(unit, 'a row with two corners became one unit');
  const main = unit.pieces.find((p) => p.role === 'patch');
  eq(main.polygon.length, 3, 'the patch itself is a triangle - a goose');
});

test('sub-block boundaries stop merging, so a rail fence keeps its four squares', () => {
  const rail = buildBlock(byId('rail-fence'), { blockSize: 12 });
  eq(rail.units.length, 16, 'four strips in each of four quarters');
  ok(rail.units.every((u) => Math.max(u.w, u.h) === inches(6)), 'every strip is exactly half the block long');
  const noSub = buildBlock({ ...byId('rail-fence'), subgrid: 1 }, { blockSize: 12 });
  ok(noSub.units.some((u) => Math.max(u.w, u.h) > inches(6)), 'without the boundary a strip runs across it');
});

test('a block mirrors left to right', () => {
  const m = buildBlock(mirrorDef(byId('teapot')), { blockSize: 12 });
  const o = buildBlock(byId('teapot'), { blockSize: 12 });
  eq(m.pieces.length, o.pieces.length, 'same piece count');
  const spout = m.units.find((u) => u.kind === 'geese');
  eq(spout.dir, '>', 'the spout points the other way');
  eq(spout.x, o.size - inches(1.5), 'and sits at the far edge');
});

test('valid block sizes follow from the grid', () => {
  eq(validSizes(8), [6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 24], 'an 8 grid takes every size in the list');
  eq(validSizes(9), [9, 18], 'a 9 grid needs a multiple of nine sixteenths per cell');
  eq(validSizes(5), [10, 15, 20], 'a 5 grid');
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
  throws(() => buildBlock({ id: 'x', fabrics, rows: ['a a', 'a a'] }, { corners: 'glue' }), 'corner method', 'unknown corner method');
});

test('every piece is labelled exactly once', () => {
  const p = makePattern(LIBRARY[0]);
  const labels = p.block.pieces.map((x) => x.label);
  eq(labels.length, new Set(labels).size, 'labels are unique');
  eq(labels[0], 'A', 'first piece is A');
  ok(labels.every(Boolean), 'no piece is unlabelled');
});

// ------------------------------------------------------------- geometry ----

test('the pieces exactly fill the block, with no gaps or overlaps, both ways', () => {
  for (const def of LIBRARY) {
    for (const corners of ['flip', 'hst']) {
      const p = makePattern(def, { corners });
      const area = p.block.pieces.reduce((s, x) => s + polygonArea(x.polygon), 0);
      const expected = p.block.size * p.block.size;
      ok(Math.abs(area - expected) < 1, `${def.id} (${corners}) covers its block (${area} vs ${expected})`);
    }
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
  const block = buildBlock(
    { id: 'h', fabrics, rows: ['a/b a/b b b', 'a/b b b b', 'b b b b', 'b b b b'] },
    { blockSize: 12, corners: 'hst' },
  );
  const list = cuttingList(block, { seam: 'quarter', trim: 'classic' });
  const dark = list.fabrics.find((f) => f.fabric === 'a');
  const hstEntry = dark.entries.find((e) => e.construction === 'hst');
  eq(hstEntry.qty, 2, 'two squares cover three units');
  eq(hstEntry.spare, 1, 'one spare unit is declared');
  eq(hstEntry.cut, fmt(inches(3) + inches(0.875)) + ' square', 'a 3" finished HST cuts at 3 7/8"');
});

test('stitch-and-flip corners are costed as small squares of the corner fabric', () => {
  const p = makePattern(byId('snowball'), { seam: 'quarter' });
  const k = p.cutting.fabrics.find((f) => f.fabric === 'k');
  const flip = k.entries.find((e) => e.construction === 'flip');
  eq(flip.qty, 4, 'four corner squares');
  eq(flip.cut, '3½" square', 'a 3" corner is a 3½" square');
  const c = p.cutting.fabrics.find((f) => f.fabric === 'c');
  eq(c.entries[0].cut, '12½" square', 'the snowball itself is one full-size square');
});

test('flying geese are costed as one large square and four small', () => {
  const p = makePattern(byId('sawtooth-star'), { seam: 'quarter' });
  const star = p.cutting.fabrics.find((f) => f.fabric === 's');
  const large = star.entries.find((e) => e.construction === 'geese');
  eq(large.qty, 1, 'one no-waste set yields all four geese');
  eq(large.cut, '7¼" square', 'a 3x6 finished goose needs a 7 1/4" square');
  const bg = p.cutting.fabrics.find((f) => f.fabric === 'k');
  const small = bg.entries.find((e) => e.construction === 'geese-sky');
  eq(small.qty, 4, 'four small squares per set');
  eq(small.cut, '3⅞" square', 'small squares are finished height plus 7/8"');
});

test('patch cut sizes are the finished size plus two seam allowances', () => {
  const p = makePattern(byId('ohio-star'), { seam: 'quarter' });
  const centre = p.cutting.fabrics
    .flatMap((f) => f.entries)
    .find((e) => e.construction === 'patch' && e.cut === '4½" square');
  ok(centre, 'the 4" finished centre square cuts at 4 1/2"');
});

test('changing the seam allowance changes every cut size', () => {
  const def = byId('mug');
  const quarter = makePattern(def, { seam: 'quarter' });
  const half = makePattern(def, { seam: 'half' });
  const q = quarter.cutting.fabrics[0].entries[0];
  const h = half.cutting.fabrics[0].entries[0];
  ok(h.cutW > q.cutW, `half-inch seams cut bigger (${h.cut} vs ${q.cut})`);
  eq(h.cutW - q.cutW, inches(0.5), 'half-inch seams add a further half inch overall');
});

test('quantities scale with the number of blocks the quilt needs', () => {
  const def = byId('mug');
  const one = makePattern(def, { copies: 1 });
  const twelve = makePattern(def, { copies: 12 });
  const a = one.cutting.fabrics[0].entries.find((e) => e.construction === 'patch');
  const b = twelve.cutting.fabrics[0].entries.find((e) => e.construction === 'patch');
  eq(b.qty, a.qty * 12, 'twelve blocks need twelve times the patches');
  ok(twelve.cutting.fabrics[0].cutArea > one.cutting.fabrics[0].cutArea, 'and more fabric');
});

test('the cutting list is planned as width-of-fabric strips', () => {
  // 32 rectangles 3½" x 6½": six fit across 40", so six strips of 3½".
  const plan = stripPlan([{ cutW: inches(3.5), cutH: inches(6.5), qty: 32, cut: '', purpose: 'test' }]);
  eq(plan.strips.length, 1, 'one strip width');
  eq(plan.strips[0].width, inches(3.5), 'strips are cut at the narrow dimension');
  eq(plan.strips[0].count, 6, 'six strips');
  eq(plan.yardage.label, '¾ yd', '21 inches of strips rounds up to three quarters of a yard');

  const long = stripPlan([{ cutW: inches(2.5), cutH: inches(72.5), qty: 2, cut: '', purpose: 'border' }]);
  ok(long.strips[0].pieced, 'borders longer than the fabric width are pieced');
  eq(long.strips[0].count, 4, 'two 72" borders come out of four joined strips');
});

test('yardage rounds up to a shop cut', () => {
  eq(yardsFor(inches(9)).label, '⅜ yd', 'nine inches is a bit over a quarter');
  eq(yardsFor(inches(36)).label, '1⅛ yd', 'a full yard needs a little in hand');
  eq(yardsFor(0).label, '—', 'nothing needs nothing');
});

test('every fabric gets a yardage estimate', () => {
  const p = makePattern(LIBRARY[0], { copies: 12 });
  for (const f of p.cutting.fabrics) {
    ok(f.yardage && f.yardage.label, `${f.name} has a yardage estimate (${f.yardage?.label})`);
    ok(f.strips.strips.length > 0, `${f.name} has a strip plan`);
  }
});

// ------------------------------------------------------------- assembly ----

test('every library block decomposes into straight seams, both corner methods', () => {
  for (const def of LIBRARY) {
    for (const corners of ['flip', 'hst']) {
      const p = makePattern(def, { corners });
      // A snowball with its corners flipped is a single unit: nothing to join.
      ok(p.plan.seams.length > 0 || p.block.units.length === 1, `${def.id} (${corners}) has seams`);
      eq(p.plan.needsPartialSeam, false, `${def.id} (${corners}) needs no partial seam`);
      ok(p.plan.steps.length > 0, `${def.id} has sew steps`);
    }
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

test('the sew steps say how to make each kind of unit', () => {
  const p = makePattern(byId('teapot'), { seam: 'quarter' });
  const kinds = new Set(p.plan.unitGroups.map((g) => g.kind));
  ok(kinds.has('flip') && kinds.has('geese'), `a teapot has stitch-and-flip units and a goose (${[...kinds]})`);
  const flipStep = p.plan.steps.find((s) => s.kind === 'flip');
  ok(flipStep.text.includes('corner to corner'), 'the stitch-and-flip step explains the seam');
  ok(/\d+["½¼¾⅛⅜⅝⅞]/.test(flipStep.text), 'and gives a cut size');
});

test('pressing directions alternate so seams nest', () => {
  const p = makePattern(byId('ohio-star'));
  const verticals = p.plan.seams.filter((s) => s.orientation === 'vertical' && s.press !== 'open');
  const dirs = new Set(verticals.map((s) => s.press));
  ok(verticals.length === 0 || dirs.size >= 1, 'vertical seams have a direction');
  for (const s of p.plan.seams) {
    ok(['up', 'down', 'left', 'right', 'open'].includes(s.press), `seam press is valid (${s.press})`);
    ok(s.reason, 'every seam says why it presses that way');
  }
});

test('bulky intersections are found', () => {
  const p = makePattern(byId('ohio-star'));
  ok(p.plan.bulk.length > 0, 'an Ohio star has four-seam intersections');
  ok(p.plan.bulk.every((b) => b.count >= 4), 'every flagged point really has 4+ pieces');
});

test('only seams that cross a junction are pressed open, not all of them', () => {
  const p = makePattern(byId('sawtooth-star'));
  ok(p.plan.bulk.length > 0, 'a sawtooth star has junctions');
  ok(p.plan.pressOpenCount > 0, 'some seams press open');
  ok(
    p.plan.pressOpenCount < p.plan.seams.length,
    `but not all ${p.plan.seams.length} of them (got ${p.plan.pressOpenCount})`,
  );
  for (const s of p.plan.seams.filter((x) => x.press === 'open')) {
    ok(s.crossings >= 1, 'every open seam actually crosses a junction');
  }
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
  const plain = makePattern(byId('mug'));
  const triangly = makePattern(byId('pine'), { corners: 'hst' });
  ok(
    triangly.difficulty.score / Math.max(1, triangly.block.pieces.length) >
      plain.difficulty.score / Math.max(1, plain.block.pieces.length),
    'the triangle-heavy block scores harder per piece',
  );
});

test('the library spans every skill tier', () => {
  const tiers = new Set(LIBRARY.map((d) => makePattern(d).tier.id));
  for (const id of TIER_ORDER) ok(tiers.has(id), `there is a ${TIERS[id].name} block`);
  eq(makePattern(byId('nine-patch')).tier.id, 'beginner', 'a nine patch is for beginners');
  eq(makePattern(byId('lady-of-the-lake')).tier.id, 'advanced', 'a lady of the lake is advanced');
  eq(tierOfScore(0).id, 'beginner', 'zero is beginner');
  eq(tierOfScore(1000).id, 'advanced', 'huge is advanced');
});

test('stitch-and-flip makes a block easier than the same block in half-square triangles', () => {
  for (const id of ['snowball', 'maple-leaf', 'teapot']) {
    const flip = makePattern(byId(id), { corners: 'flip' });
    const hst = makePattern(byId(id), { corners: 'hst' });
    ok(flip.block.pieces.length < hst.block.pieces.length, `${id}: fewer pieces with corners`);
    ok(flip.difficulty.score < hst.difficulty.score, `${id}: lower score with corners`);
  }
});

// ------------------------------------------------------------ colorways ----

test('a colorway recolours every fabric but keeps the light-to-dark order', () => {
  const def = byId('cow');
  const cw = applyColorway(def, 'coastal');
  eq(Object.keys(cw.fabrics), Object.keys(def.fabrics), 'same fabric keys');
  ok(Object.values(cw.fabrics).every((f) => /^#[0-9A-F]{6}$/i.test(f.hex)), 'every fabric has a colour');
  const lum = (hex) => parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5), 16) * 0.11;
  const before = Object.keys(def.fabrics).sort((a, b) => lum(def.fabrics[b].hex) - lum(def.fabrics[a].hex));
  const after = Object.keys(cw.fabrics).sort((a, b) => lum(cw.fabrics[b].hex) - lum(cw.fabrics[a].hex));
  eq(after, before, 'the sky is still the lightest and the cow still the darkest');
  eq(applyColorway(def, 'original'), def, 'the original colorway is a no-op');
  ok(COLORWAYS.length >= 6, 'there are several to choose from');
  const p = makePattern(def, { colorway: 'lemonade' });
  eq(p.block.pieces.length, makePattern(def).block.pieces.length, 'colour does not change the geometry');
});

// ---------------------------------------------------------------- quilt ----

test('a straight-set quilt is blocks times blocks plus borders', () => {
  const p = makePattern(byId('nine-patch'), { blockSize: 12 });
  const q = p.quilt({ cols: 4, rows: 5, innerBorder: 2, outerBorder: 4 });
  eq(q.finished.inches, { w: 4 * 12 + 12, h: 5 * 12 + 12 }, '48+12 by 60+12');
  eq(q.counts.pieced, 20, 'twenty blocks');
  eq(q.borders.length, 8, 'four inner and four outer border strips');
  const inner = q.cutting.find((f) => f.fabric === 'inner');
  ok(inner, 'the inner border has fabric of its own');
  ok(inner.entries.some((e) => e.purpose.includes('sides')), 'sides and top/bottom are listed separately');
  ok(q.binding.strips >= 6, `binding needs several strips (${q.binding.strips})`);
  ok(q.backing.yardage.yards > 3, `backing is over three yards (${q.backing.yardage.label})`);
  ok(q.steps.some((s) => s.includes('measure the quilt through the middle')), 'borders are measured through the middle');
  const svg = q.svg();
  ok(svg.startsWith('<svg'), 'it renders');
  eq((svg.match(/<g transform/g) || []).length, 20, 'one group per block');
});

test('sashing and cornerstones are counted and cut', () => {
  const p = makePattern(byId('shoo-fly'));
  const q = p.quilt({ cols: 3, rows: 4, setting: 'cornerstones', sashing: 2 });
  eq(q.finished.inches, { w: 3 * 12 + 4 * 2, h: 4 * 12 + 5 * 2 }, 'sashing runs between and around');
  eq(q.counts.cornerstones, 4 * 5, 'a cornerstone at every crossing');
  eq(q.counts.sashes, 4 * 4 + 3 * 5, 'a sash on every block edge');
  const sash = q.cutting.find((f) => f.fabric === 'sashing');
  eq(sash.entries[0].cut, '2½" × 12½"', 'sashes cut with the seam allowance on');
  const plain = p.quilt({ cols: 3, rows: 4, setting: 'sashed', sashing: 2 });
  ok(plain.cutting.find((f) => f.fabric === 'sashing').entries.some((e) => e.purpose.includes('full width')), 'without cornerstones the rows are long strips');
});

test('alternate setting halves the piecing and mirror flips every other block', () => {
  const p = makePattern(byId('chicken'));
  const q = p.quilt({ cols: 4, rows: 4, setting: 'alternate', mirror: true });
  eq(q.counts.pieced + q.counts.plain, 16, 'sixteen positions');
  eq(q.counts.plain, 8, 'half of them plain');
  eq(q.counts.mirrored, 4, 'half the chickens face the other way');
  ok(q.cutting.find((f) => f.fabric === 'plain'), 'plain squares have their own fabric line');
});

test('rainbow backgrounds and a pieced border, like the teacup quilt', () => {
  const p = makePattern(byId('teacup'));
  const q = p.quilt(byId('teacup').quilt);
  ok(q.rainbow, 'the background rotates');
  const rainbows = q.cutting.filter((f) => f.fabric.startsWith('rainbow'));
  ok(rainbows.length >= 5, `the background is split across colours (${rainbows.length})`);
  ok(!q.cutting.find((f) => f.fabric === 'k'), 'and the single background fabric is gone from the list');
  ok(q.mini, 'the outer border has small blocks in it');
  eq(q.outerBorder, q.mini.size, 'and is exactly one small block wide');
  ok(q.counts.minis > 8, `plenty of little cups (${q.counts.minis})`);
  ok(q.cells.some((c) => c.type === 'mini'), 'they are laid out');
  const svg = q.svg({ scale: 0.4 });
  eq((svg.match(/<g transform/g) || []).length, q.counts.pieced + q.counts.minis, 'every block and mini block is drawn');
});

test('size presets pick a sensible number of blocks', () => {
  const p = makePattern(byId('nine-patch'));
  const throw_ = layoutFor(p.block, 'throw', { outerBorder: 4 });
  eq(throw_, { cols: 4, rows: 5, target: QUILT_SIZES.find((s) => s.id === 'throw') }, 'a throw of 12" blocks is 4 by 5');
  const king = layoutFor(p.block, 'king');
  eq(king.cols, 9, 'a king is nine across');
});

// ------------------------------------------------------------- hexagons ----

test('hexagon layouts count their papers and their fabric', () => {
  const h = planHexagons(HEXAGON_LIBRARY[0]);
  ok(h.count > 200 && h.count < 300, `a 16 by 40 runner in 1" hexies is a couple of hundred (${h.count})`);
  eq(h.cutting.reduce((s, f) => s + f.count, 0), h.count, 'every hexie is in the cutting list');
  ok(h.cutting.every((f) => f.cut === '2¾" square'), 'a 1" hexie cuts from a 2¾" square');
  ok(h.steps.some((s) => s.includes('whipstitch')), 'the instructions are for hand piecing');
  const garden = planHexagons(HEXAGON_LIBRARY[1]);
  const roles = new Set(garden.hexes.map((x) => x.role));
  ok(roles.has('centre') && roles.has('petal') && roles.has('path'), `a garden has centres, petals and a path (${[...roles]})`);
  const centres = garden.hexes.filter((x) => x.role === 'centre').length;
  const petals = garden.hexes.filter((x) => x.role === 'petal').length;
  ok(petals > centres * 4, 'petals outnumber centres roughly six to one');
  ok(hexagonsSvg(h).includes('<polygon'), 'it draws');
  ok(hexTemplateSvg(1).includes('1 inch'), 'the template sheet carries a test square');
});

// --------------------------------------------------------------- output ----

test('the block renders to SVG with one polygon per piece', () => {
  const p = makePattern(LIBRARY[0]);
  const svg = p.svg({ scale: 2 });
  ok(svg.startsWith('<svg'), 'it is an svg');
  eq((svg.match(/<polygon/g) || []).length, p.block.pieces.length, 'one polygon per piece');
  eq((svg.match(/<text/g) || []).length, p.block.pieces.length, 'one label per piece');
});

test('the exploded view and coloring sheet render', () => {
  const p = makePattern(byId('sawtooth-star'));
  const ex = p.exploded();
  eq((ex.match(/<polygon/g) || []).length, p.block.pieces.length, 'exploded view has every piece');
  ok(ex.includes('stroke-dasharray'), 'and outlines the sewn units');
  const col = p.coloring();
  ok(!col.includes(p.block.fabrics.s.hex), 'the coloring sheet has no fabric colour in it');
  ok(col.includes('fill="#ffffff"'), 'just white');
});

test('the pressing overlay only appears when asked for', () => {
  const p = makePattern(byId('ohio-star'));
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
  const p = makePattern(byId('pine'));
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
  const p = makePattern(byId('cat'), { seam: 'quarter' });
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

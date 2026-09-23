/**
 * From a block to a quilt.
 *
 * Every pattern in the pile is a quilt, not a block: blocks in rows, sashing
 * between them or not, plain squares alternating with pieced ones, an inner
 * border and an outer one, binding, backing, batting, and a fabric list for
 * the whole thing in yards. The block is the interesting part; this is the
 * arithmetic that turns it into a pattern someone can shop for.
 *
 * Everything here is in sixteenths, like the rest of the engine.
 */

import { inches, fmt, fmtSize, toInches, luminance } from './units.js';
import { seamMath } from './seams.js';
import { newGroups, addBlockCuts, addPlainCut, finishGroups, yardsFor, USABLE_WOF } from './cutting.js';
import { buildBlock, mirrorDef, validSizes } from './block.js';

export const QUILT_SIZES = [
  { id: 'wall', name: 'Wall hanging', w: 36, h: 36 },
  { id: 'crib', name: 'Crib', w: 36, h: 52 },
  { id: 'throw', name: 'Throw', w: 56, h: 68 },
  { id: 'twin', name: 'Twin', w: 70, h: 90 },
  { id: 'queen', name: 'Queen', w: 90, h: 100 },
  { id: 'king', name: 'King', w: 108, h: 108 },
];

export const SETTINGS = {
  straight: {
    id: 'straight',
    name: 'Edge to edge',
    blurb: 'Blocks sewn straight together. The picture blocks touch, so the background runs on.',
  },
  sashed: {
    id: 'sashed',
    name: 'Sashing',
    blurb: 'A strip between every block and around the outside. Frames each block like a tile.',
  },
  cornerstones: {
    id: 'cornerstones',
    name: 'Sashing with cornerstones',
    blurb: 'Sashing, with a small square where the strips cross. Easier to keep straight than long strips.',
  },
  alternate: {
    id: 'alternate',
    name: 'Alternate with plain squares',
    blurb: 'Every other block is a plain square, like chickens spaced along a roost. Half the piecing, room to quilt.',
  },
};

/** Ten solids in spectrum order, for a rainbow of backgrounds. */
export const RAINBOW = [
  '#E63E7B', '#F26B4E', '#F2B233', '#F2D24B', '#CFE04A',
  '#4DB86B', '#2FB39B', '#2F8FD6', '#3B4DA8', '#8C4CB0',
];

export const DEFAULT_EXTRAS = {
  sashing: { name: 'Sashing - white text print', hex: '#F4F1EA' },
  cornerstone: { name: 'Cornerstones - madder red', hex: '#B8453A' },
  plain: { name: 'Plain squares - cream muslin', hex: '#F7F5EE' },
  inner: { name: 'Inner border - chartreuse', hex: '#CFE04A' },
  outer: { name: 'Outer border - low-volume print', hex: '#EFEAE0' },
  binding: { name: 'Binding - charcoal', hex: '#2B2622' },
};

/** The fabric that covers the most area in the block: the background. */
export function backgroundOf(block) {
  const area = new Map();
  for (const p of block.pieces) {
    const b = p.bbox;
    area.set(p.fabric, (area.get(p.fabric) ?? 0) + b.w * b.h);
  }
  if (block.background && area.has(block.background)) return block.background;
  return [...area.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
}

/**
 * Split `total` into `n` gaps that a quilter would actually cut: every gap a
 * multiple of a quarter inch, with whatever is left over going into the middle
 * one, which is the one nobody measures.
 */
function spread(total, n, unit = 4) {
  const base = Math.floor(total / n / unit) * unit;
  const gaps = Array.from({ length: n }, () => base);
  let rem = total - base * n;
  for (let i = 0; rem >= unit; i = (i + 1) % n) {
    gaps[i] += unit;
    rem -= unit;
  }
  gaps[Math.floor(n / 2)] += rem;
  return gaps;
}

/**
 * @param {object} block  a built block (from `buildBlock`)
 * @param {object} opts
 *   cols, rows        blocks across and down
 *   setting           one of SETTINGS
 *   sashing           strip width in inches (sashed settings)
 *   innerBorder       width in inches, 0 for none
 *   outerBorder       width in inches, 0 for none
 *   mirror            flip every other block left to right
 *   rainbow           rotate the background fabric through RAINBOW, block by block
 *   piecedBorder      set small copies of the block into the outer border
 *   fabrics           overrides for sashing/cornerstone/plain/inner/outer/binding
 *   seam, trim        seam profile ids
 */
export function planQuilt(block, opts = {}) {
  const {
    cols = 4,
    rows = 3,
    setting = 'straight',
    sashing = 2,
    innerBorder = 0,
    outerBorder = 0,
    mirror = false,
    rainbow = false,
    piecedBorder = false,
    fabrics = {},
    seam,
    trim,
  } = opts;
  if (!SETTINGS[setting]) throw new RangeError(`unknown setting: ${setting}`);
  const math = seamMath(seam, trim);
  const a = math.allowance;

  const B = block.size;
  const sashed = setting === 'sashed' || setting === 'cornerstones';
  const S = sashed ? inches(sashing) : 0;
  const IB = inches(innerBorder);
  const OB = inches(outerBorder);

  const extras = { ...DEFAULT_EXTRAS };
  for (const k of Object.keys(extras)) {
    const f = fabrics[k];
    if (!f) continue;
    extras[k] = typeof f === 'string' && block.fabrics[f] ? { ...block.fabrics[f], from: f } : { ...extras[k], ...f };
  }

  // --- the centre ----------------------------------------------------------
  const centreW = cols * B + (sashed ? (cols + 1) * S : 0);
  const centreH = rows * B + (sashed ? (rows + 1) * S : 0);
  const cells = [];
  const counts = { pieced: 0, mirrored: 0, plain: 0, cornerstones: 0, sashes: 0, minis: 0 };

  const mirrored = mirror ? buildBlock(mirrorDef(block), { blockSize: block.blockSize, corners: block.corners }) : null;
  const bg = backgroundOf(block);

  let index = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = sashed ? S + c * (B + S) : c * B;
      const y = sashed ? S + r * (B + S) : r * B;
      const plain = setting === 'alternate' && (r + c) % 2 === 1;
      if (plain) {
        cells.push({ type: 'plain', x, y, w: B, h: B, fabric: 'plain' });
        counts.plain++;
        continue;
      }
      const flip = mirror && index % 2 === 1;
      const palette = rainbow && bg ? { [bg]: { ...block.fabrics[bg], hex: RAINBOW[index % RAINBOW.length] } } : null;
      cells.push({ type: 'block', x, y, w: B, h: B, index, mirrored: flip, block: flip ? mirrored : block, palette });
      counts.pieced++;
      if (flip) counts.mirrored++;
      index++;
    }
  }

  if (sashed) {
    // Vertical sashes: one left of every block plus one at the row's end.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        cells.push({ type: 'sash', x: c * (B + S), y: S + r * (B + S), w: S, h: B, fabric: 'sashing' });
        counts.sashes++;
      }
    }
    // Horizontal sashes, split by cornerstones if asked for.
    for (let r = 0; r <= rows; r++) {
      if (setting === 'cornerstones') {
        for (let c = 0; c < cols; c++) {
          cells.push({ type: 'sash', x: S + c * (B + S), y: r * (B + S), w: B, h: S, fabric: 'sashing' });
          counts.sashes++;
        }
        for (let c = 0; c <= cols; c++) {
          cells.push({ type: 'stone', x: c * (B + S), y: r * (B + S), w: S, h: S, fabric: 'cornerstone' });
          counts.cornerstones++;
        }
      } else {
        cells.push({ type: 'sash', x: 0, y: r * (B + S), w: centreW, h: S, fabric: 'sashing', long: true });
      }
    }
  }

  // --- a pieced outer border sets small copies of the block into it, and is
  // exactly one small block wide so nothing needs padding ---------------------
  let OBw = OB;
  let mini = null;
  if (piecedBorder && OB) {
    const sizes = validSizes(block.gridSize, [2, 3, 4, 5, 6, 8, 9, 10, 12]).filter((s) => inches(s) <= OB);
    const miniInches = sizes.length ? sizes[sizes.length - 1] : null;
    if (miniInches) {
      const mb = buildBlock(block, { blockSize: miniInches, corners: block.corners });
      const mm = mirror ? buildBlock(mirrorDef(block), { blockSize: miniInches, corners: block.corners }) : null;
      mini = { block: mb, mirrored: mm, size: mb.size, inches: miniInches };
      OBw = mb.size;
    }
  }

  // --- borders ---------------------------------------------------------------
  const borders = [];
  let W = centreW;
  let H = centreH;
  let x0 = 0;
  let y0 = 0;
  const addBorder = (which, width) => {
    if (!width) return;
    // Sides first (full current height), then top and bottom across everything.
    borders.push({ which, side: 'left', x: x0 - width, y: y0, w: width, h: H });
    borders.push({ which, side: 'right', x: x0 + W, y: y0, w: width, h: H });
    borders.push({ which, side: 'top', x: x0 - width, y: y0 - width, w: W + 2 * width, h: width });
    borders.push({ which, side: 'bottom', x: x0 - width, y: y0 + H, w: W + 2 * width, h: width });
    x0 -= width;
    y0 -= width;
    W += 2 * width;
    H += 2 * width;
  };
  addBorder('inner', IB);
  const innerEdge = { w: W, h: H };
  addBorder('outer', OBw);

  // Shift everything so the top-left of the finished quilt is the origin.
  const ox = -x0;
  const oy = -y0;
  for (const c of cells) { c.x += ox; c.y += oy; }
  for (const b of borders) { b.x += ox; b.y += oy; }

  const miniCells = [];
  if (mini) {
    const mb = mini.block;
    const mm = mini.mirrored;
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const b = borders.find((x) => x.which === 'outer' && x.side === side);
      const horizontal = side === 'top' || side === 'bottom';
      // Blocks run along the centre's edge only; the four corners stay plain.
      const len = horizontal ? innerEdge.w : innerEdge.h;
      const n = Math.max(1, Math.floor(len / (2 * mb.size)));
      const gaps = spread(len - n * mb.size, n + 1);
      let cursor = horizontal ? b.x + OBw : b.y;
      for (let i = 0; i < n; i++) {
        cursor += gaps[i];
        const flip = mirror && i % 2 === 1;
        miniCells.push(
          horizontal
            ? { type: 'mini', x: cursor, y: b.y, w: mb.size, h: mb.size, block: flip ? mm : mb, mirrored: flip, side }
            : { type: 'mini', x: b.x, y: cursor, w: mb.size, h: mb.size, block: flip ? mm : mb, mirrored: flip, side },
        );
        cursor += mb.size;
      }
      b.minis = n;
      b.spacers = gaps;
      counts.minis += n;
    }
  }

  // --- cutting ---------------------------------------------------------------
  const groups = newGroups();
  const fabricsMap = { ...block.fabrics };
  for (const [k, f] of Object.entries(extras)) fabricsMap[k] = f;

  addBlockCuts(groups, block, math, counts.pieced);
  if (rainbow && bg) {
    // The background is not one fabric any more: it is up to ten, each cut for
    // the blocks that wear it. Replace its group with one per colour.
    groups.delete(bg);
    const per = new Map();
    cells.filter((c) => c.type === 'block').forEach((c) => {
      const i = c.index % RAINBOW.length;
      per.set(i, (per.get(i) ?? 0) + 1);
    });
    for (const [i, n] of per) {
      const tmp = newGroups();
      addBlockCuts(tmp, block, math, n);
      const key = `rainbow${i}`;
      groups.set(key, tmp.get(bg));
      fabricsMap[key] = { name: `Background ${i + 1} of ${per.size} (rainbow)`, hex: RAINBOW[i] };
    }
  }
  if (mini) {
    // Border blocks sit on the border fabric, not the block's own background,
    // so their background cuts are charged to the outer border.
    const tmp = newGroups();
    addBlockCuts(tmp, mini.block, math, counts.minis, { forLabel: 'border blocks' });
    for (const [key, entries] of tmp) {
      const target = key === bg ? 'outer' : key;
      if (!groups.has(target)) groups.set(target, new Map());
      const into = groups.get(target);
      for (const [ek, e] of entries) {
        if (into.has(ek)) {
          const cur = into.get(ek);
          cur.qty += e.qty;
          cur.units += e.units;
          cur.labels.push(...e.labels);
        } else into.set(ek, e);
      }
    }
    for (const c of miniCells) c.palette = bg ? { [bg]: { ...extras.outer } } : null;
  }

  const sashCut = (w, h) => ({ w: w + 2 * a, h: h + 2 * a });
  if (sashed) {
    const vert = cells.filter((c) => c.type === 'sash' && !c.long && c.h === B).length;
    const horiz = cells.filter((c) => c.type === 'sash' && !c.long && c.w === B).length;
    const long = cells.filter((c) => c.type === 'sash' && c.long).length;
    if (vert + horiz) addPlainCut(groups, 'sashing', { ...sashCut(S, B), qty: vert + horiz, purpose: 'sashing strips between blocks' });
    if (long) addPlainCut(groups, 'sashing', { ...sashCut(centreW, S), qty: long, purpose: 'sashing rows, full width' });
    if (counts.cornerstones) addPlainCut(groups, 'cornerstone', { ...sashCut(S, S), qty: counts.cornerstones, purpose: 'cornerstones' });
  }
  if (counts.plain) addPlainCut(groups, 'plain', { ...sashCut(B, B), qty: counts.plain, purpose: 'plain alternate squares' });
  for (const which of ['inner', 'outer']) {
    const bs = borders.filter((b) => b.which === which);
    if (!bs.length) continue;
    const sides = bs.filter((b) => b.side === 'left' || b.side === 'right');
    const tops = bs.filter((b) => b.side === 'top' || b.side === 'bottom');
    const width = sides[0].w;
    if (which === 'outer' && mini) {
      // Spacer rectangles between the set-in blocks, plus four plain corners.
      const spacers = new Map();
      for (const b of bs) for (const g of b.spacers) spacers.set(g, (spacers.get(g) ?? 0) + 1);
      for (const [g, n] of spacers) {
        if (g > 0) addPlainCut(groups, which, { ...sashCut(g, width), qty: n, purpose: 'outer border, between the set-in blocks' });
      }
      addPlainCut(groups, which, { ...sashCut(width, width), qty: 4, purpose: 'outer border corners' });
    } else {
      addPlainCut(groups, which, { ...sashCut(width, sides[0].h), qty: 2, purpose: `${which} border, sides` });
      addPlainCut(groups, which, { ...sashCut(tops[0].w, width), qty: 2, purpose: `${which} border, top and bottom` });
    }
  }

  // --- binding, backing, batting -------------------------------------------
  const perimeter = 2 * (W + H);
  const bindingLength = perimeter + inches(12);
  const bindingStrips = Math.ceil(bindingLength / USABLE_WOF);
  const bindingWidth = inches(2.5);
  addPlainCut(groups, 'binding', { w: bindingWidth, h: USABLE_WOF, qty: bindingStrips, purpose: 'binding strips, joined end to end', key: 'binding' });
  const binding = {
    stripWidth: bindingWidth,
    strips: bindingStrips,
    length: bindingLength,
    yardage: yardsFor(bindingStrips * bindingWidth),
  };

  const extra = W < inches(50) && H < inches(50) ? inches(4) : inches(8);
  const backW = W + extra;
  const backH = H + extra;
  const panelsAcross = Math.ceil(backW / inches(42));
  const panelsDown = Math.ceil(backH / inches(42));
  const lengthwise = panelsAcross * backH;
  const crosswise = panelsDown * backW;
  const backing = {
    w: backW,
    h: backH,
    label: fmtSize(backW, backH),
    panels: lengthwise <= crosswise ? panelsAcross : panelsDown,
    seamsRun: lengthwise <= crosswise ? 'lengthwise' : 'crosswise',
    yardage: yardsFor(Math.min(lengthwise, crosswise)),
    wideback: yardsFor(backW <= inches(108) ? backH : backW),
  };
  const batting = { w: backW, h: backH, label: fmtSize(backW, backH) };

  const cutting = finishGroups(groups, fabricsMap);

  // --- steps ---------------------------------------------------------------
  const steps = [];
  steps.push(
    `Make ${counts.pieced} ${block.name} block${counts.pieced === 1 ? '' : 's'}` +
      (counts.mirrored ? `, ${counts.mirrored} of them mirrored` : '') +
      (rainbow ? ', rotating the background fabric through the rainbow in reading order' : '') +
      '. Square each one up to ' + fmt(B + 2 * a) + ' before you lay anything out.',
  );
  if (setting === 'straight') {
    steps.push(`Lay the blocks out in ${rows} rows of ${cols}. Sew each row, pressing the seams of odd rows one way and even rows the other so they nest. Join the rows.`);
  } else if (setting === 'alternate') {
    steps.push(`Lay out ${rows} rows of ${cols}, alternating a pieced block and a plain ${fmt(B)} square, checkerboard fashion. Sew each row, pressing toward the plain squares. Join the rows; the seams nest.`);
  } else if (setting === 'sashed') {
    steps.push(`Sew a ${fmt(S)} × ${fmt(B)} sashing strip to the right of every block, and one to the left of the first block in each row. Press toward the sashing. Make ${rows} block rows.`);
    steps.push(`Sew a full-width sashing strip to the top of each row, and one to the bottom of the last row. Press toward the sashing. Join the rows, matching the vertical sashes.`);
  } else {
    steps.push(`Sew a ${fmt(S)} × ${fmt(B)} sashing strip to the right of every block, and one to the left of the first block in each row. Press toward the sashing. Make ${rows} block rows.`);
    steps.push(`Make ${rows + 1} sashing rows: a cornerstone, a sashing strip, a cornerstone, and so on, ${cols} strips and ${cols + 1} cornerstones each. Press toward the sashing. Join block rows and sashing rows alternately, matching the cornerstones to the vertical sashes.`);
  }
  for (const which of ['inner', 'outer']) {
    const bs = borders.filter((b) => b.which === which);
    if (!bs.length) continue;
    const width = bs[0].w;
    if (which === 'outer' && mini) {
      steps.push(
        `Make the pieced outer border: sew the ${fmt(mini.size)} border blocks and the spacer rectangles into four strips as shown in the layout, ` +
          `${bs.find((b) => b.side === 'top').minis} across the top and bottom and ${bs.find((b) => b.side === 'left').minis} down each side. Add a corner square to each end of the top and bottom strips.`,
      );
      steps.push(`Sew the side border strips on first, then the top and bottom. Press toward the border.`);
      continue;
    }
    steps.push(
      `${which === 'inner' ? 'Inner' : 'Outer'} border, ${fmt(width)} finished: measure the quilt through the middle top to bottom, cut the two side strips to that length, pin at the centre and ends, sew, press toward the border. ` +
        `Then measure across the middle and do the same for the top and bottom.`,
    );
  }
  steps.push(
    `Backing: piece it to at least ${backing.label} (${backing.panels} panel${backing.panels === 1 ? '' : 's'}, seams running ${backing.seamsRun}; press those seams open). Batting the same size.`,
  );
  steps.push(`Layer backing face down, batting, quilt top face up. Baste, quilt as you like, trim the edges even.`);
  steps.push(
    `Binding: join ${bindingStrips} strips ${fmt(bindingWidth)} × width of fabric end to end with diagonal seams, press in half lengthwise, and sew to the front with a ¼" seam, mitring the corners. Fold to the back and stitch down.`,
  );

  const finished = { w: W, h: H, label: fmtSize(W, H), inches: { w: toInches(W), h: toInches(H) } };

  return {
    cols,
    rows,
    setting: SETTINGS[setting],
    block,
    mirroredBlock: mirrored,
    mini,
    size: B,
    sashing: S,
    innerBorder: IB,
    outerBorder: OBw,
    centre: { w: centreW, h: centreH },
    width: W,
    height: H,
    finished,
    sizeName: nearestSize(W, H),
    counts,
    cells: [...cells, ...miniCells],
    borders,
    extras,
    fabricsMap,
    background: bg,
    rainbow: Boolean(rainbow && bg),
    cutting,
    binding,
    backing,
    batting,
    steps,
    yardsTotal: cutting.reduce((s, f) => s + (f.yardage.yards ?? 0.25), 0),
  };
}

/** The named size this quilt is closest to, for the label on the card. */
function nearestSize(W, H) {
  const w = toInches(W), h = toInches(H);
  let best = null;
  for (const s of QUILT_SIZES) {
    const d = Math.abs(s.w - w) + Math.abs(s.h - h);
    if (!best || d < best.d) best = { ...s, d };
  }
  return best;
}

/**
 * How many blocks fit a named quilt size, for the size presets. Returns the
 * cols/rows that land closest to the target without going over by much.
 */
export function layoutFor(block, sizeId, { setting = 'straight', sashing = 2, innerBorder = 0, outerBorder = 0 } = {}) {
  const target = QUILT_SIZES.find((s) => s.id === sizeId) ?? QUILT_SIZES[2];
  const B = toInches(block.size);
  const S = setting === 'sashed' || setting === 'cornerstones' ? sashing : 0;
  const frame = 2 * (innerBorder + outerBorder);
  const fit = (total) => Math.max(1, Math.round((total - frame - S) / (B + S)));
  return { cols: fit(target.w), rows: fit(target.h), target };
}

/** Which of a block's fabrics is lightest - a sensible default for sashing. */
export function lightestFabric(block) {
  const keys = Object.keys(block.fabrics ?? {});
  return keys.sort((p, q) => luminance(block.fabrics[q].hex) - luminance(block.fabrics[p].hex))[0];
}

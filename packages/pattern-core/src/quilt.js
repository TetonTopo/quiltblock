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
    name: 'Alternate blocks',
    blurb: 'Every other block is a plain square, like chickens spaced along a roost - or a second pieced block, checkerboard fashion. Half the piecing, room to quilt.',
  },
  panel: {
    id: 'panel',
    name: 'Panel centre',
    blurb: 'A printed panel in the middle, framed by borders, with the block set into the corners of the outer border.',
  },
};

/** A panel is whatever the fabric company printed; this is a common throw-size one. */
export const DEFAULT_PANEL = { w: 42, h: 36, name: 'Printed panel' };

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

/**
 * Colours for a stack of borders when nobody chose them: the pirate quilt in
 * the pile runs background, accent, print, background, then a wide outer one.
 */
const BORDER_HUES = ['#CFE04A', '#2F4A7A', '#D9A63A', '#F4F1EA', '#B8453A', '#EFEAE0'];

/**
 * The borders, innermost first, as `{ id, width, label }`. Either the old pair
 * (`innerBorder`, `outerBorder`, ids 'inner' and 'outer') or a `borders` list
 * of widths or `{ width, fabric }`, any length, ids 'border1', 'border2'...
 */
function borderList({ borders, innerBorder = 0, outerBorder = 0 }) {
  if (Array.isArray(borders)) {
    const list = borders
      .map((b) => (typeof b === 'number' ? { width: b } : b))
      .filter((b) => b && b.width > 0);
    return list.map((b, i) => ({
      id: `border${i + 1}`,
      width: inches(b.width),
      fabric: b.fabric,
      label: list.length === 1 ? 'Border' : i === list.length - 1 ? `Outer border (${i + 1} of ${list.length})` : `Border ${i + 1} of ${list.length}`,
      hue: BORDER_HUES[i % BORDER_HUES.length],
    }));
  }
  const out = [];
  if (innerBorder > 0) out.push({ id: 'inner', width: inches(innerBorder), label: 'Inner border' });
  if (outerBorder > 0) out.push({ id: 'outer', width: inches(outerBorder), label: 'Outer border' });
  return out;
}

/**
 * Fold one set of cut groups into another. `rename` maps a fabric key in
 * `from` to the key it is charged to in `into`.
 */
function mergeGroups(into, from, rename = (k) => k) {
  for (const [key, entries] of from) {
    const target = rename(key);
    if (!into.has(target)) into.set(target, new Map());
    const dest = into.get(target);
    for (const [ek, e] of entries) {
      if (dest.has(ek)) {
        const cur = dest.get(ek);
        cur.qty += e.qty;
        cur.units += e.units;
        cur.labels.push(...e.labels);
      } else dest.set(ek, e);
    }
  }
}

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
 *   borders           instead of inner/outer: a list of widths (or { width,
 *                     fabric }), innermost first, as many as the quilt has
 *   alternateWith     a second built block, the same size, for the
 *                     'alternate' setting to use instead of plain squares
 *   panel             { w, h, name } in inches, for the 'panel' setting
 *   cornerBlocks      set the block, made to the border's width, into the
 *                     four corners of the outer border (default on for panels)
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
    mirror = false,
    rainbow = false,
    piecedBorder = false,
    alternateWith = null,
    fabrics = {},
    seam,
    trim,
  } = opts;
  if (!SETTINGS[setting]) throw new RangeError(`unknown setting: ${setting}`);
  const math = seamMath(seam, trim);
  const a = math.allowance;

  // Blocks may be taller than they are wide; every cell of the layout is BW × BH.
  const BW = block.width ?? block.size;
  const BH = block.height ?? block.size;
  const alt = setting === 'alternate' ? alternateWith : null;
  if (alt && (alt.width !== BW || alt.height !== BH)) {
    throw new RangeError(`the alternate block is ${alt.sizeLabel}, but ${block.name} is ${block.sizeLabel}; they must match`);
  }
  const sashed = setting === 'sashed' || setting === 'cornerstones';
  const S = sashed ? inches(sashing) : 0;
  const blist = borderList(opts);

  const extras = { ...DEFAULT_EXTRAS };
  for (const b of blist) {
    if (!extras[b.id]) extras[b.id] = { name: `${b.label} - solid`, hex: b.hue };
    if (b.fabric && !fabrics[b.id]) fabrics[b.id] = b.fabric;
  }
  for (const k of Object.keys(extras)) {
    const f = fabrics[k];
    if (!f) continue;
    extras[k] = typeof f === 'string' && block.fabrics[f] ? { ...block.fabrics[f], from: f } : { ...extras[k], ...f };
  }

  // --- the centre ----------------------------------------------------------
  // A panel quilt has no grid of blocks in the middle, just the printed panel.
  const isPanel = setting === 'panel';
  const panel = isPanel ? { ...DEFAULT_PANEL, ...(opts.panel ?? {}) } : null;
  if (panel) {
    panel.W = inches(panel.w);
    panel.H = inches(panel.h);
    if (!extras.panel) extras.panel = { name: panel.name, hex: '#C9D8C5' };
  }
  const gridCols = isPanel ? 0 : cols;
  const gridRows = isPanel ? 0 : rows;
  const centreW = panel ? panel.W : cols * BW + (sashed ? (cols + 1) * S : 0);
  const centreH = panel ? panel.H : rows * BH + (sashed ? (rows + 1) * S : 0);
  const cells = [];
  const counts = { pieced: 0, mirrored: 0, plain: 0, alternate: 0, cornerstones: 0, sashes: 0, minis: 0, corners: 0 };
  if (panel) cells.push({ type: 'panel', x: 0, y: 0, w: panel.W, h: panel.H, fabric: 'panel' });

  const mirrored = mirror ? buildBlock(mirrorDef(block), { blockSize: block.blockSize, corners: block.corners }) : null;
  const bg = backgroundOf(block);

  let index = 0;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const x = sashed ? S + c * (BW + S) : c * BW;
      const y = sashed ? S + r * (BH + S) : r * BH;
      const plain = setting === 'alternate' && (r + c) % 2 === 1;
      if (plain && alt) {
        cells.push({ type: 'block', x, y, w: BW, h: BH, alternate: true, block: alt });
        counts.alternate++;
        continue;
      }
      if (plain) {
        cells.push({ type: 'plain', x, y, w: BW, h: BH, fabric: 'plain' });
        counts.plain++;
        continue;
      }
      const flip = mirror && index % 2 === 1;
      const palette = rainbow && bg ? { [bg]: { ...block.fabrics[bg], hex: RAINBOW[index % RAINBOW.length] } } : null;
      cells.push({ type: 'block', x, y, w: BW, h: BH, index, mirrored: flip, block: flip ? mirrored : block, palette });
      counts.pieced++;
      if (flip) counts.mirrored++;
      index++;
    }
  }

  if (sashed) {
    // Vertical sashes: one left of every block plus one at the row's end.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        cells.push({ type: 'sash', dir: 'v', x: c * (BW + S), y: S + r * (BH + S), w: S, h: BH, fabric: 'sashing' });
        counts.sashes++;
      }
    }
    // Horizontal sashes, split by cornerstones if asked for.
    for (let r = 0; r <= rows; r++) {
      if (setting === 'cornerstones') {
        for (let c = 0; c < cols; c++) {
          cells.push({ type: 'sash', dir: 'h', x: S + c * (BW + S), y: r * (BH + S), w: BW, h: S, fabric: 'sashing' });
          counts.sashes++;
        }
        for (let c = 0; c <= cols; c++) {
          cells.push({ type: 'stone', x: c * (BW + S), y: r * (BH + S), w: S, h: S, fabric: 'cornerstone' });
          counts.cornerstones++;
        }
      } else {
        cells.push({ type: 'sash', dir: 'h', x: 0, y: r * (BH + S), w: centreW, h: S, fabric: 'sashing', long: true });
      }
    }
  }

  // --- a pieced outer border sets small copies of the block into it, and is
  // exactly one small block wide so nothing needs padding ---------------------
  // The pieced border is always the outermost one, and only square blocks can
  // run along all four sides without turning on end.
  const outermost = blist[blist.length - 1];
  const OB = outermost?.width ?? 0;
  let OBw = OB;
  let mini = null;
  if (piecedBorder && OB && block.square !== false) {
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
  let innerEdge = { w: W, h: H };
  blist.forEach((b, i) => {
    if (i === blist.length - 1) {
      innerEdge = { w: W, h: H };
      addBorder(b.id, OBw);
    } else addBorder(b.id, b.width);
  });

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
      const b = borders.find((x) => x.which === outermost.id && x.side === side);
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

  // --- corner blocks: the block, made to the border's width, in the four
  // corners of the outer border - the star blocks on a panel quilt -----------
  let cornerBlock = null;
  const wantCorners = opts.cornerBlocks ?? isPanel;
  if (wantCorners && outermost && !mini && block.square !== false) {
    const sizeIn = toInches(OBw);
    if (validSizes(block.gridSize, [sizeIn]).length) {
      cornerBlock = buildBlock(block, { blockSize: sizeIn, corners: block.corners });
      for (const side of ['top', 'bottom']) {
        const b = borders.find((x) => x.which === outermost.id && x.side === side);
        b.cornerBlocks = true;
        for (const x of [b.x, b.x + b.w - OBw]) {
          cells.push({ type: 'block', corner: true, x, y: b.y, w: OBw, h: OBw, block: cornerBlock });
          counts.corners++;
        }
      }
    }
  }

  // --- cutting ---------------------------------------------------------------
  const groups = newGroups();
  const fabricsMap = { ...block.fabrics };
  for (const [k, f] of Object.entries(extras)) fabricsMap[k] = f;

  addBlockCuts(groups, block, math, counts.pieced);
  if (cornerBlock) {
    const tmp = newGroups();
    addBlockCuts(tmp, cornerBlock, math, counts.corners, { forLabel: 'corner blocks' });
    mergeGroups(groups, tmp);
  }
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
    mergeGroups(groups, tmp, (key) => (key === bg ? outermost.id : key));
    for (const c of miniCells) c.palette = bg ? { [bg]: { ...extras[outermost.id] } } : null;
  }
  if (alt && counts.alternate) {
    // The second block brings its own fabrics. A letter it shares with the
    // main block and the same colour is the same fabric; a letter that means
    // something else gets a line of its own.
    const tmp = newGroups();
    addBlockCuts(tmp, alt, math, counts.alternate, { forLabel: `${alt.name} blocks` });
    const same = (k) => block.fabrics[k] && block.fabrics[k].hex === alt.fabrics[k]?.hex;
    mergeGroups(groups, tmp, (k) => (same(k) || !block.fabrics[k] ? k : `alt-${k}`));
    for (const k of Object.keys(alt.fabrics)) {
      if (!same(k) && block.fabrics[k]) fabricsMap[`alt-${k}`] = alt.fabrics[k];
      else if (!block.fabrics[k]) fabricsMap[k] = alt.fabrics[k];
    }
  }

  const sashCut = (w, h) => ({ w: w + 2 * a, h: h + 2 * a });
  if (sashed) {
    const vert = cells.filter((c) => c.type === 'sash' && !c.long && c.dir === 'v').length;
    const horiz = cells.filter((c) => c.type === 'sash' && !c.long && c.dir === 'h').length;
    const long = cells.filter((c) => c.type === 'sash' && c.long).length;
    if (BW === BH) {
      if (vert + horiz) addPlainCut(groups, 'sashing', { ...sashCut(S, BH), qty: vert + horiz, purpose: 'sashing strips between blocks' });
    } else {
      if (vert) addPlainCut(groups, 'sashing', { ...sashCut(S, BH), qty: vert, purpose: 'sashing strips between blocks' });
      if (horiz) addPlainCut(groups, 'sashing', { ...sashCut(BW, S), qty: horiz, purpose: 'sashing strips above and below blocks' });
    }
    if (long) addPlainCut(groups, 'sashing', { ...sashCut(centreW, S), qty: long, purpose: 'sashing rows, full width' });
    if (counts.cornerstones) addPlainCut(groups, 'cornerstone', { ...sashCut(S, S), qty: counts.cornerstones, purpose: 'cornerstones' });
  }
  if (counts.plain) {
    addPlainCut(groups, 'plain', { ...sashCut(BW, BH), qty: counts.plain, purpose: BW === BH ? 'plain alternate squares' : 'plain alternate rectangles' });
  }
  for (const { id: which, label } of blist) {
    const bs = borders.filter((b) => b.which === which);
    if (!bs.length) continue;
    const sides = bs.filter((b) => b.side === 'left' || b.side === 'right');
    const tops = bs.filter((b) => b.side === 'top' || b.side === 'bottom');
    const width = sides[0].w;
    if (which === outermost.id && mini) {
      // Spacer rectangles between the set-in blocks, plus four plain corners.
      const spacers = new Map();
      for (const b of bs) for (const g of b.spacers) spacers.set(g, (spacers.get(g) ?? 0) + 1);
      for (const [g, n] of spacers) {
        if (g > 0) addPlainCut(groups, which, { ...sashCut(g, width), qty: n, purpose: 'outer border, between the set-in blocks' });
      }
      addPlainCut(groups, which, { ...sashCut(width, width), qty: 4, purpose: 'outer border corners' });
    } else {
      addPlainCut(groups, which, { ...sashCut(width, sides[0].h), qty: 2, purpose: `${label.toLowerCase()}, sides` });
      // With a block in each corner the top and bottom strips stop short of them.
      const topLen = which === outermost.id && cornerBlock ? tops[0].w - 2 * width : tops[0].w;
      addPlainCut(groups, which, { ...sashCut(topLen, width), qty: 2, purpose: `${label.toLowerCase()}, top and bottom` });
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
  if (panel) {
    steps.push(
      `Trim the panel to ${fmtSize(panel.W + 2 * a, panel.H + 2 * a)}, keeping at least ${fmt(a)} of background beyond the printed design on every side so nothing important ends up in a seam.`,
    );
  }
  if (counts.pieced) steps.push(
    `Make ${counts.pieced} ${block.name} block${counts.pieced === 1 ? '' : 's'}` +
      (counts.mirrored ? `, ${counts.mirrored} of them mirrored` : '') +
      (rainbow ? ', rotating the background fabric through the rainbow in reading order' : '') +
      '. Square each one up to ' + fmtSize(BW + 2 * a, BH + 2 * a).replace(/^(.+) × \1$/, '$1') + ' before you lay anything out.',
  );
  if (alt) {
    steps.push(
      `Make ${counts.alternate} ${alt.name} block${counts.alternate === 1 ? '' : 's'} for the alternate positions, squared up the same way.`,
    );
  }
  const blockDims = BW === BH ? fmt(BW) : fmtSize(BW, BH);
  if (panel) {
    // Nothing to lay out: the panel is the centre.
  } else if (setting === 'straight') {
    steps.push(`Lay the blocks out in ${rows} rows of ${cols}. Sew each row, pressing the seams of odd rows one way and even rows the other so they nest. Join the rows.`);
  } else if (setting === 'alternate' && alt) {
    steps.push(`Lay out ${rows} rows of ${cols}, alternating ${block.name} and ${alt.name} blocks, checkerboard fashion. Sew each row, pressing the row seams in alternate directions so they nest. Join the rows.`);
  } else if (setting === 'alternate') {
    steps.push(`Lay out ${rows} rows of ${cols}, alternating a pieced block and a plain ${blockDims} ${BW === BH ? 'square' : 'rectangle'}, checkerboard fashion. Sew each row, pressing toward the plain ${BW === BH ? 'squares' : 'rectangles'}. Join the rows; the seams nest.`);
  } else if (setting === 'sashed') {
    steps.push(`Sew a ${fmt(S)} × ${fmt(BH)} sashing strip to the right of every block, and one to the left of the first block in each row. Press toward the sashing. Make ${rows} block rows.`);
    steps.push(`Sew a full-width sashing strip to the top of each row, and one to the bottom of the last row. Press toward the sashing. Join the rows, matching the vertical sashes.`);
  } else {
    steps.push(`Sew a ${fmt(S)} × ${fmt(BH)} sashing strip to the right of every block, and one to the left of the first block in each row. Press toward the sashing. Make ${rows} block rows.`);
    steps.push(`Make ${rows + 1} sashing rows: a cornerstone, a ${fmt(BW)} sashing strip, a cornerstone, and so on, ${cols} strips and ${cols + 1} cornerstones each. Press toward the sashing. Join block rows and sashing rows alternately, matching the cornerstones to the vertical sashes.`);
  }
  for (const { id: which, label } of blist) {
    const bs = borders.filter((b) => b.which === which);
    if (!bs.length) continue;
    const width = bs[0].w;
    if (which === outermost.id && mini) {
      steps.push(
        `Make the pieced outer border: sew the ${fmt(mini.size)} border blocks and the spacer rectangles into four strips as shown in the layout, ` +
          `${bs.find((b) => b.side === 'top').minis} across the top and bottom and ${bs.find((b) => b.side === 'left').minis} down each side. Add a corner square to each end of the top and bottom strips.`,
      );
      steps.push(`Sew the side border strips on first, then the top and bottom. Press toward the border.`);
      continue;
    }
    if (which === outermost.id && cornerBlock) {
      steps.push(
        `Make ${counts.corners} ${block.name} blocks at ${fmt(width)} finished for the corners. ` +
          `${label}, ${fmt(width)} finished: sew the side strips on and press toward the border. Sew a corner block to each end of the top and bottom strips, pressing toward the strip, then sew them on, nesting the seams at the corners.`,
      );
      continue;
    }
    steps.push(
      `${label}, ${fmt(width)} finished: measure the quilt through the middle top to bottom, cut the two side strips to that length, pin at the centre and ends, sew, press toward the border. ` +
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
    alternateBlock: alt,
    panel,
    cornerBlock,
    size: BW,
    blockW: BW,
    blockH: BH,
    sashing: S,
    // The old pair, for callers that only know two borders.
    innerBorder: blist.length > 1 ? blist[0].width : 0,
    outerBorder: blist.length ? OBw : 0,
    borderList: blist.map((b, i) => ({ ...b, width: i === blist.length - 1 ? OBw : b.width })),
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
export function layoutFor(block, sizeId, { setting = 'straight', sashing = 2, innerBorder = 0, outerBorder = 0, borders } = {}) {
  const target = QUILT_SIZES.find((s) => s.id === sizeId) ?? QUILT_SIZES[2];
  const BW = toInches(block.width ?? block.size);
  const BH = toInches(block.height ?? block.size);
  const S = setting === 'sashed' || setting === 'cornerstones' ? sashing : 0;
  const frame = 2 * (Array.isArray(borders)
    ? borders.reduce((s, b) => s + (typeof b === 'number' ? b : b?.width ?? 0), 0)
    : innerBorder + outerBorder);
  const fit = (total, B) => Math.max(1, Math.round((total - frame - S) / (B + S)));
  return { cols: fit(target.w, BW), rows: fit(target.h, BH), target };
}

/** Which of a block's fabrics is lightest - a sensible default for sashing. */
export function lightestFabric(block) {
  const keys = Object.keys(block.fabrics ?? {});
  return keys.sort((p, q) => luminance(block.fabrics[q].hex) - luminance(block.fabrics[p].hex))[0];
}

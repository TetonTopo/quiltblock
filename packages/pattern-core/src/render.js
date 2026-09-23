/**
 * SVG rendering: the block diagram, the pressing plan overlay, the exploded
 * assembly view, the coloring sheet, and the quilt layout. Everything returns
 * a plain SVG string so it works the same in a browser, in a print stylesheet,
 * and piped into a PDF.
 */

import { isDark, fmt } from './units.js';

const INK = '#2B2622';
const PAPER = '#F6F1E8';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const centroid = (poly) => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

/** A pieced unit is anything with more than one piece in it. */
const isSewnUnit = (u) => u.kind !== 'patch' || (u.corners?.length ?? 0) > 0;

function piecePolygon(p, S, fill, stroke, strokeWidth, dx = 0, dy = 0, opacity = 0.5) {
  const pts = p.polygon.map((q) => `${S(q.x + dx)},${S(q.y + dy)}`).join(' ');
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}"/>`;
}

function pieceLabel(p, S, scale, fill, dx = 0, dy = 0) {
  const c = centroid(p.polygon);
  const small = p.polygon.length === 3 || p.bbox.w < 24 || p.bbox.h < 24;
  return (
    `<text x="${S(c.x + dx)}" y="${S(c.y + dy)}" font-family="Karla, Arial, sans-serif" ` +
    `font-size="${small ? 5 * scale : 7 * scale}" font-weight="700" text-anchor="middle" ` +
    `dominant-baseline="central" fill="${fill}">${p.label}</text>`
  );
}

/**
 * @param {object} block
 * @param {object} opts
 *   scale     px per sixteenth of an inch (2 gives 384px for a 12" block)
 *   labels    draw piece letters
 *   palette   override the block's fabric map (used by the quilt preview)
 *   plan      an assembly plan; draws pressing arrows and bulk markers
 *   overlay   'none' | 'pressing' | 'units'
 *   outline   true draws a coloring sheet: white fills, dark lines
 */
export function blockSvg(block, opts = {}) {
  const {
    scale = 2,
    labels = true,
    palette,
    plan = null,
    overlay = 'none',
    outline = false,
    title = block.name,
  } = opts;

  const pal = palette ? { ...block.fabrics, ...palette } : block.fabrics;
  const W = block.size * scale;
  const S = (n) => n * scale;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(title)}">`,
  ];

  for (const p of block.pieces) {
    const fill = outline ? '#ffffff' : pal[p.fabric]?.hex ?? '#cccccc';
    out.push(piecePolygon(p, S, fill, INK, outline ? 1.2 : labels ? 1 : 0.6, 0, 0, outline ? 1 : 0.5));
  }

  if (overlay === 'units' || overlay === 'pressing') {
    for (const u of block.units) {
      if (!isSewnUnit(u)) continue;
      out.push(
        `<rect x="${S(u.x)}" y="${S(u.y)}" width="${S(u.w)}" height="${S(u.h)}" fill="none" ` +
          `stroke="#B8453A" stroke-width="1.6" stroke-dasharray="5 3" opacity="0.85"/>`,
      );
    }
  }

  if (overlay === 'pressing' && plan) {
    out.push(pressingOverlay(plan, S));
  }

  if (labels) {
    for (const p of block.pieces) {
      const fill = outline ? INK : isDark(pal[p.fabric]?.hex ?? '#ccc') ? PAPER : INK;
      out.push(pieceLabel(p, S, scale, fill));
    }
  }

  out.push('</svg>');
  return out.join('');
}

/** Arrows showing which way each seam is pressed, plus dots on bulky joins. */
function pressingOverlay(plan, S) {
  const parts = [
    `<g stroke-linecap="round" stroke-linejoin="round">`,
    `<defs><marker id="qb-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">` +
      `<path d="M0,1 L9,5 L0,9 z" fill="#2F4A7A"/></marker></defs>`,
  ];

  for (const seam of plan.seams) {
    if (seam.type !== 'straight') continue;
    const mx = S((seam.x0 + seam.x1) / 2);
    const my = S((seam.y0 + seam.y1) / 2);
    const len = 11;
    const stroke = seam.press === 'open' ? '#B8453A' : '#2F4A7A';

    if (seam.press === 'open') {
      const [dx, dy] = seam.orientation === 'horizontal' ? [0, 1] : [1, 0];
      parts.push(
        `<line x1="${mx - dx * len}" y1="${my - dy * len}" x2="${mx + dx * len}" y2="${my + dy * len}" ` +
          `stroke="${stroke}" stroke-width="2.4" marker-end="url(#qb-arrow)"/>`,
        `<circle cx="${mx}" cy="${my}" r="2.6" fill="${stroke}"/>`,
      );
      continue;
    }

    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[seam.press] ?? [0, 1];
    parts.push(
      `<line x1="${mx}" y1="${my}" x2="${mx + dir[0] * len}" y2="${my + dir[1] * len}" ` +
        `stroke="${stroke}" stroke-width="2.4" marker-end="url(#qb-arrow)"/>`,
    );
  }

  for (const b of plan.bulk) {
    parts.push(
      `<circle cx="${S(b.x)}" cy="${S(b.y)}" r="4.5" fill="none" stroke="#B8453A" stroke-width="2"/>`,
    );
  }

  parts.push('</g>');
  return parts.join('');
}

/**
 * The exploded assembly view every commercial pattern prints: units pulled
 * apart along the seams they will be joined on, so the sew order is a picture.
 * The gaps follow the guillotine tree, so a row of units drifts apart
 * horizontally and rows drift apart vertically.
 */
export function explodedSvg(block, plan, opts = {}) {
  const { scale = 2, gap = 10, labels = false, palette } = opts;
  const pal = palette ? { ...block.fabrics, ...palette } : block.fabrics;
  const S = (n) => n * scale;
  const offsets = new Map();
  let maxX = 0, maxY = 0;

  const walk = (node, ox, oy) => {
    if (node.type === 'unit') {
      offsets.set(node.unit.index, { ox, oy });
      maxX = Math.max(maxX, ox);
      maxY = Math.max(maxY, oy);
      return;
    }
    if (node.type === 'partial') {
      node.units.forEach((u) => offsets.set(u.index, { ox, oy }));
      return;
    }
    node.children.forEach((child, i) =>
      node.type === 'rows' ? walk(child, ox, oy + i * gap) : walk(child, ox + i * gap, oy),
    );
  };
  walk(plan.tree, 0, 0);

  const W = S(block.size + maxX);
  const H = S(block.size + maxY);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(block.name)}, exploded">`,
  ];
  for (const u of block.units) {
    const { ox, oy } = offsets.get(u.index) ?? { ox: 0, oy: 0 };
    for (const p of u.pieces) {
      out.push(piecePolygon(p, S, pal[p.fabric]?.hex ?? "#ccc", INK, 0.8, ox, oy, 0.6));
    }
    if (isSewnUnit(u)) {
      out.push(
        `<rect x="${S(u.x + ox)}" y="${S(u.y + oy)}" width="${S(u.w)}" height="${S(u.h)}" fill="none" ` +
          `stroke="#B8453A" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.8"/>`,
      );
    }
    if (labels) {
      for (const p of u.pieces) out.push(pieceLabel(p, S, scale, isDark(pal[p.fabric]?.hex ?? '#ccc') ? PAPER : INK, ox, oy));
    }
  }
  out.push('</svg>');
  return out.join('');
}

/** A single unit drawn on its own - for the "make 8 of these" list. */
export function unitSvg(block, unit, { scale = 3, palette } = {}) {
  const pal = palette ? { ...block.fabrics, ...palette } : block.fabrics;
  const S = (n) => n * scale;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S(unit.w)} ${S(unit.h)}" role="img" aria-label="unit">`,
  ];
  for (const p of unit.pieces) {
    out.push(piecePolygon(p, S, pal[p.fabric]?.hex ?? "#ccc", INK, 1, -unit.x, -unit.y, 0.6));
  }
  out.push('</svg>');
  return out.join('');
}

/** The coloring sheet: just the lines, for trying colours with pencils. */
export function coloringSvg(block, opts = {}) {
  return blockSvg(block, { ...opts, outline: true, labels: opts.labels ?? true });
}

/**
 * The simple quilt preview. `rotate` cycles one fabric through a list of
 * colours so a sampler quilt - twelve coffee mugs in twelve fabrics - reads
 * correctly instead of showing the same block twelve times.
 */
export function quiltSvg(block, { cols = 4, rows = 3, scale = 1, sashing = '#F4F1EA' } = {}) {
  const W = block.size * scale;
  const gap = Math.max(4, Math.round(block.size * scale * 0.03));
  const totalW = cols * W + (cols + 1) * gap;
  const totalH = rows * W + (rows + 1) * gap;
  const rotate = block.rotate || [];

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" role="img" ` +
      `aria-label="${esc(block.name)} quilt, ${cols} by ${rows} blocks">`,
    `<rect width="100%" height="100%" fill="${block.sashing || sashing}"/>`,
  ];

  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, k++) {
      const pal = { ...block.fabrics };
      if (rotate.length && block.accent) {
        pal[block.accent] = { ...pal[block.accent], hex: rotate[k % rotate.length] };
      }
      const inner = blockSvg(block, { scale, labels: false, palette: pal })
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      out.push(`<g transform="translate(${gap + c * (W + gap)},${gap + r * (W + gap)})">${inner}</g>`);
    }
  }

  out.push('</svg>');
  return out.join('');
}

/**
 * The full quilt from a plan: blocks, plain squares, sashing, cornerstones,
 * borders, set-in border blocks. Sampler rotation and rainbow backgrounds are
 * carried on each cell's palette.
 */
export function quiltLayoutSvg(qp, { scale = 0.5, labels = false, rotate = true } = {}) {
  const S = (n) => n * scale;
  const W = S(qp.width);
  const H = S(qp.height);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" ` +
      `aria-label="${esc(qp.block.name)} quilt, ${qp.cols} by ${qp.rows} blocks, ${esc(qp.finished.label)}">`,
  ];
  const extra = (key) => qp.extras[key]?.hex ?? '#ddd';

  for (const b of qp.borders) {
    out.push(`<rect x="${S(b.x)}" y="${S(b.y)}" width="${S(b.w)}" height="${S(b.h)}" fill="${extra(b.which)}" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.8"/>`);
  }
  const rot = qp.block.rotate || [];
  let k = 0;
  for (const c of qp.cells) {
    if (c.type === 'block' || c.type === 'mini') {
      const pal = { ...(c.palette ?? {}) };
      if (rotate && rot.length && qp.block.accent && !pal[qp.block.accent]) {
        pal[qp.block.accent] = { ...qp.block.fabrics[qp.block.accent], hex: rot[k % rot.length] };
      }
      k++;
      const inner = blockSvg(c.block, { scale, labels: false, palette: pal })
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>$/, '');
      out.push(`<g transform="translate(${S(c.x)},${S(c.y)})">${inner}</g>`);
      continue;
    }
    const fill = c.type === 'plain' ? extra('plain') : c.type === 'stone' ? extra('cornerstone') : extra('sashing');
    out.push(`<rect x="${S(c.x)}" y="${S(c.y)}" width="${S(c.w)}" height="${S(c.h)}" fill="${fill}" stroke="${INK}" stroke-opacity="0.35" stroke-width="0.8"/>`);
  }
  if (labels) {
    out.push(
      `<text x="${W / 2}" y="${H - 4}" font-family="Karla, Arial, sans-serif" font-size="${Math.max(8, S(10))}" text-anchor="middle" fill="${INK}">${esc(qp.finished.label)}</text>`,
    );
  }
  out.push('</svg>');
  return out.join('');
}

/**
 * A fabric swatch strip - used in the key next to the cutting list.
 */
export function swatchSvg(hex, size = 22) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `role="presentation"><rect width="${size}" height="${size}" fill="${hex}" stroke="${INK}" stroke-opacity="0.35"/></svg>`
  );
}

/** A width-of-fabric strip diagram: one bar per strip, sub-cuts marked. */
export function stripSvg(plan, { scale = 4, hex = '#ccc', usable = plan.usable } = {}) {
  const rows = [];
  for (const s of plan.strips) for (let i = 0; i < s.count; i++) rows.push(s);
  const gap = 2;
  const H = rows.reduce((h, s) => h + s.width * scale / 4 + gap, 0);
  const W = usable * scale / 4;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W + 60} ${H + 4}" role="img" aria-label="strip cutting diagram">`];
  let y = 2;
  for (const s of rows) {
    const h = s.width * scale / 4;
    out.push(`<rect x="0" y="${y}" width="${W}" height="${h}" fill="${hex}" stroke="${INK}" stroke-opacity="0.5" stroke-width="0.8"/>`);
    out.push(`<text x="${W + 6}" y="${y + h / 2}" font-family="Karla, Arial, sans-serif" font-size="9" dominant-baseline="central" fill="${INK}">${esc(fmt(s.width))}</text>`);
    y += h + gap;
  }
  out.push('</svg>');
  return out.join('');
}

export { esc };

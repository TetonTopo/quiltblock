/**
 * SVG rendering: the block diagram, the pressing plan overlay, and the quilt
 * layout preview. Everything returns a plain SVG string so it works the same
 * in a browser, in a print stylesheet, and piped into a PDF.
 */

import { isDark } from './units.js';

const INK = '#2B2622';
const PAPER = '#F6F1E8';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const centroid = (poly) => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

/**
 * @param {object} block
 * @param {object} opts
 *   scale     px per sixteenth of an inch (2 gives 384px for a 12" block)
 *   labels    draw piece letters
 *   palette   override the block's fabric map (used by the quilt preview)
 *   units     outline each sewn sub-assembly
 *   plan      an assembly plan; draws pressing arrows and bulk markers
 *   overlay   'none' | 'pressing' | 'units'
 */
export function blockSvg(block, opts = {}) {
  const {
    scale = 2,
    labels = true,
    palette,
    plan = null,
    overlay = 'none',
    title = block.name,
  } = opts;

  const pal = palette || block.fabrics;
  const W = block.size * scale;
  const S = (n) => n * scale;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(title)}">`,
  ];

  for (const p of block.pieces) {
    const pts = p.polygon.map((q) => `${S(q.x)},${S(q.y)}`).join(' ');
    const fill = pal[p.fabric]?.hex ?? '#cccccc';
    out.push(
      `<polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-opacity="0.5" stroke-width="${labels ? 1 : 0.6}"/>`,
    );
  }

  if (overlay === 'units' || overlay === 'pressing') {
    for (const u of block.units) {
      if (u.kind === 'patch') continue;
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
      const c = centroid(p.polygon);
      const small = p.polygon.length === 3;
      out.push(
        `<text x="${S(c.x)}" y="${S(c.y)}" font-family="Karla, Arial, sans-serif" ` +
          `font-size="${small ? 5.5 * scale : 7 * scale}" font-weight="700" text-anchor="middle" ` +
          `dominant-baseline="central" fill="${isDark(pal[p.fabric]?.hex ?? '#ccc') ? PAPER : INK}">${p.label}</text>`,
      );
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
 * The quilt preview. `rotate` cycles one fabric through a list of colours so a
 * sampler quilt - twelve coffee mugs in twelve fabrics - reads correctly
 * instead of showing the same block twelve times.
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
 * A fabric swatch strip - used in the key next to the cutting list.
 */
export function swatchSvg(hex, size = 22) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `role="presentation"><rect width="${size}" height="${size}" fill="${hex}" stroke="${INK}" stroke-opacity="0.35"/></svg>`
  );
}

export { esc };

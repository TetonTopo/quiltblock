/**
 * Foundation paper piecing.
 *
 * The open question from the first phone call was "conventional patchwork or
 * foundation paper piecing?" - and the answer turned out to be that it is not a
 * property of the pattern, it is a property of the printout. The same block
 * geometry can go out either way, so the customer picks at download time.
 *
 * FPP swaps exact cutting for rough-cut pieces and a numbered paper foundation.
 * You sew through the paper along printed lines, trim to the line as you go,
 * and tear the paper off at the end. It is more accurate on sharp points and
 * skinny pieces; it uses more fabric and it is fiddlier.
 *
 * Two things make a printed foundation correct, and both are easy to get wrong:
 * the template is MIRRORED (you look at the printed side, the fabric is on the
 * back), and pieces must be added in an order where each new seam runs edge to
 * edge across everything sewn so far.
 */

import { fmt } from './units.js';
import { seamMath } from './seams.js';
import { esc } from './render.js';

/** Depth-first leaf order is a valid paper-piecing order for a guillotine tree. */
function leavesInSewOrder(node, out = []) {
  if (node.type === 'unit') {
    out.push(node.unit);
    return out;
  }
  if (node.type === 'partial') {
    node.units.forEach((u) => out.push(u));
    return out;
  }
  node.children.forEach((c) => leavesInSewOrder(c, out));
  return out;
}

/**
 * Break the block into printable foundation sections. Each section is sewn on
 * its own piece of paper, then the sections are joined with ordinary seams.
 */
export function fppSections(block, plan, { maxUnitsPerSection = 10 } = {}) {
  const sections = [];

  const walk = (node) => {
    const units = leavesInSewOrder(node);
    if (units.length <= maxUnitsPerSection || node.type === 'unit' || node.type === 'partial') {
      sections.push({ region: node.region, units, node });
      return;
    }
    node.children.forEach(walk);
  };
  walk(plan.tree);

  return sections.map((s, i) => {
    const letter = String.fromCharCode(65 + i);
    const pieces = [];
    let n = 0;
    for (const u of s.units) {
      for (const p of u.pieces) {
        pieces.push({ ...p, fppNumber: `${letter}${++n}` });
      }
    }
    return {
      id: letter,
      region: s.region,
      units: s.units,
      pieces,
      width: s.region.x1 - s.region.x0,
      height: s.region.y1 - s.region.y0,
    };
  });
}

/**
 * A printable foundation for one section: mirrored, numbered, with the seam
 * allowance drawn outside the finished outline so there is something to trim to.
 */
export function fppTemplateSvg(block, section, { scale = 3, seam, trim } = {}) {
  const math = seamMath(seam, trim);
  const margin = math.fppMargin;
  const w = section.width + 2 * margin;
  const h = section.height + 2 * margin;
  const S = (n) => n * scale;
  const ox = section.region.x0 - margin;
  const oy = section.region.y0 - margin;

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S(w)} ${S(h)}" ` +
      `role="img" aria-label="Foundation section ${section.id}, mirrored for paper piecing">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    // Mirror the whole drawing: printed side up, fabric underneath.
    `<g transform="translate(${S(w)},0) scale(-1,1)">`,
  ];

  for (const p of section.pieces) {
    const pts = p.polygon.map((q) => `${S(q.x - ox)},${S(q.y - oy)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="none" stroke="#2B2622" stroke-width="1.4"/>`);
  }

  // Cutting line: the finished outline plus the seam allowance.
  out.push(
    `<rect x="${S(margin - math.allowance)}" y="${S(margin - math.allowance)}" ` +
      `width="${S(section.width + 2 * math.allowance)}" height="${S(section.height + 2 * math.allowance)}" ` +
      `fill="none" stroke="#B8453A" stroke-width="1.2" stroke-dasharray="6 4"/>`,
    `<rect x="${S(margin)}" y="${S(margin)}" width="${S(section.width)}" height="${S(section.height)}" ` +
      `fill="none" stroke="#2B2622" stroke-width="2"/>`,
  );

  for (const p of section.pieces) {
    const cx = p.polygon.reduce((s, q) => s + q.x, 0) / p.polygon.length - ox;
    const cy = p.polygon.reduce((s, q) => s + q.y, 0) / p.polygon.length - oy;
    // Un-mirror the text so the numbers stay readable on the printed side.
    out.push(
      `<g transform="translate(${S(cx)},${S(cy)}) scale(-1,1)">` +
        `<text font-family="Karla, Arial, sans-serif" font-size="${5 * scale}" font-weight="700" ` +
        `text-anchor="middle" dominant-baseline="central" fill="#2B2622">${p.fppNumber}</text></g>`,
    );
  }

  out.push('</g>');
  out.push(
    `<text x="${S(margin)}" y="${S(h - margin / 3)}" ` +
      `font-family="Karla, Arial, sans-serif" font-size="${3.2 * scale}" fill="#6B625A">` +
      `Section ${esc(section.id)} · mirrored · ${fmt(section.width)} × ${fmt(section.height)} finished</text>`,
  );
  out.push('</svg>');
  return out.join('');
}

/** The rough-cut list: FPP does not cut to size, it cuts generously. */
export function fppCuttingList(block, sections, { seam, trim } = {}) {
  const math = seamMath(seam, trim);
  const margin = math.fppMargin;
  const byFabric = new Map();

  for (const s of sections) {
    for (const p of s.pieces) {
      const w = p.bbox.w + 2 * margin;
      const h = p.bbox.h + 2 * margin;
      if (!byFabric.has(p.fabric)) byFabric.set(p.fabric, []);
      byFabric.get(p.fabric).push({
        number: p.fppNumber,
        label: p.label,
        rough: `${fmt(roundUpQuarter(w))} × ${fmt(roundUpQuarter(h))}`,
      });
    }
  }

  return [...byFabric.entries()].map(([fabric, pieces]) => ({
    fabric,
    name: block.fabrics[fabric]?.name ?? fabric,
    hex: block.fabrics[fabric]?.hex ?? '#888',
    pieces: pieces.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    note:
      'Rough-cut rectangles - they only have to cover the numbered area plus ' +
      'the seam allowance on every side. Trim to the line after each seam.',
  }));
}

const roundUpQuarter = (s) => Math.ceil(s / 4) * 4;

export function fppInstructions(sections) {
  return [
    'Print the foundations at 100% - no "fit to page". Check the 1" test square with a ruler before you cut anything.',
    'Shorten your stitch length to about 1.5mm. The short stitches perforate the paper so it tears away cleanly.',
    `Work through the numbers in order within each section (${sections.map((s) => s.id).join(', ')}).`,
    'Place piece 1 right side up on the blank side of the paper. Place piece 2 on top of it, right sides together, and sew on the printed line from the printed side.',
    'Flip piece 2 open, press, and trim the seam allowance to a quarter inch before adding the next piece.',
    'Trim each finished section on the dashed cutting line, then join the sections with ordinary seams.',
    'Leave the paper in until the whole block is together - it is what keeps the bias edges from stretching.',
  ];
}

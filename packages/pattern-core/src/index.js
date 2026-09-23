/**
 * pattern-core - the quilt geometry engine.
 *
 * One entry point does the whole job:
 *
 *   import { makePattern, LIBRARY } from 'pattern-core';
 *   const p = makePattern(LIBRARY[0], { blockSize: 12, seam: 'scant-quarter' });
 *   p.svg();            // the labelled block diagram
 *   p.exploded();       // units pulled apart along their seams
 *   p.cutting.fabrics;  // the cutting list, grouped by fabric, as strips
 *   p.plan.steps;       // sew order
 *   p.validation.ok;    // does it obey the house rules
 *   p.quilt({ cols: 4, rows: 5, setting: 'sashed', outerBorder: 4 });
 */

export * from './units.js';
export * from './seams.js';
export * from './block.js';
export * from './partition.js';
export * from './assembly.js';
export * from './cutting.js';
export * from './render.js';
export * from './validate.js';
export * from './fpp.js';
export * from './blocks.js';
export * from './tiers.js';
export * from './colorways.js';
export * from './quilt.js';
export * from './hexagons.js';

import { buildBlock, mirrorDef, validSizes, DEFAULT_CORNERS } from './block.js';
import { planAssembly, seamStats } from './assembly.js';
import { cuttingList } from './cutting.js';
import { validateBlock, difficultyOf } from './validate.js';
import { blockSvg, quiltSvg, explodedSvg, coloringSvg, unitSvg, quiltLayoutSvg } from './render.js';
import { fppSections, fppTemplateSvg, fppCuttingList, fppInstructions } from './fpp.js';
import { DEFAULT_SEAM, DEFAULT_TRIM, seamMath } from './seams.js';
import { applyColorway } from './colorways.js';
import { planQuilt } from './quilt.js';
import { resolveTier } from './tiers.js';

/**
 * Build everything a pattern needs from one block definition.
 *
 * @param {object} def  a block definition (see `blocks.js`)
 * @param {object} opts
 *   blockSize  finished inches, default 12 (or the block's own default)
 *   seam       seam profile id, default 'scant-quarter'
 *   trim       trim style id, default 'classic'
 *   corners    'flip' (default) or 'hst'
 *   colorway   a colorway id from colorways.js, default 'original'
 *   copies     how many of this block the quilt needs
 */
export function makePattern(def, opts = {}) {
  const {
    blockSize = def.blockSize ?? 12,
    seam = DEFAULT_SEAM,
    trim = DEFAULT_TRIM,
    corners = DEFAULT_CORNERS,
    colorway = 'original',
    copies = 1,
  } = opts;

  const coloured = applyColorway(def, colorway);
  const block = buildBlock(coloured, { blockSize, corners });
  const plan = planAssembly(block, { seam, trim });
  const cutting = cuttingList(block, { seam, trim, copies });
  const validation = validateBlock(block, { seam, trim });
  const math = seamMath(seam, trim);
  const difficulty = difficultyOf(block);

  return {
    def: coloured,
    block,
    plan,
    cutting,
    validation,
    math,
    stats: { ...seamStats(plan, block), ...validation.stats },
    difficulty,
    tier: resolveTier(difficulty.tier),
    sizes: validSizes(block.gridSize),
    options: { blockSize, seam, trim, corners, colorway, copies },

    svg: (o = {}) => blockSvg(block, o),
    exploded: (o = {}) => explodedSvg(block, plan, o),
    coloring: (o = {}) => coloringSvg(block, o),
    unitSvg: (unit, o = {}) => unitSvg(block, unit, o),
    quiltSvg: (o = {}) => quiltSvg(block, o),

    /** The same block facing the other way. */
    mirror: () => makePattern(mirrorDef(def), opts),

    /** A whole quilt from this block: layout, borders, yardage, steps. */
    quilt(qopts = {}) {
      const qp = planQuilt(block, { seam, trim, ...qopts });
      return { ...qp, svg: (o = {}) => quiltLayoutSvg(qp, o) };
    },

    /** The foundation-paper-piecing version of the same block. */
    foundation(o = {}) {
      const sections = fppSections(block, plan, o);
      return {
        sections,
        instructions: fppInstructions(sections),
        cutting: fppCuttingList(block, sections, { seam, trim }),
        templateSvg: (section, so = {}) => fppTemplateSvg(block, section, { seam, trim, ...so }),
      };
    },
  };
}

/** Build the whole starter library at one size. Handy for a catalogue page. */
export function buildLibrary(library, opts = {}) {
  const out = {};
  for (const def of library) {
    if (def.kind === 'hexagon') continue;
    try {
      out[def.id] = makePattern(def, {
        ...opts,
        blockSize: def.blockSize ?? opts.blockSize ?? 12,
      });
    } catch (err) {
      out[def.id] = { def, error: err };
    }
  }
  return out;
}

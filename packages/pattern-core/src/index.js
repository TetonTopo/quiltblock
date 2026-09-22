/**
 * pattern-core - the quilt geometry engine.
 *
 * One entry point does the whole job:
 *
 *   import { makePattern, LIBRARY } from 'pattern-core';
 *   const p = makePattern(LIBRARY[0], { blockSize: 12, seam: 'scant-quarter' });
 *   p.svg();            // the labelled block diagram
 *   p.cutting.fabrics;  // the cutting list, grouped by fabric
 *   p.plan.steps;       // sew order
 *   p.validation.ok;    // does it obey the house rules
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

import { buildBlock } from './block.js';
import { planAssembly, seamStats } from './assembly.js';
import { cuttingList } from './cutting.js';
import { validateBlock, difficultyOf } from './validate.js';
import { blockSvg, quiltSvg } from './render.js';
import { fppSections, fppTemplateSvg, fppCuttingList, fppInstructions } from './fpp.js';
import { DEFAULT_SEAM, DEFAULT_TRIM, seamMath } from './seams.js';

/**
 * Build everything a pattern needs from one block definition.
 *
 * @param {object} def  a block definition (see `blocks.js`)
 * @param {object} opts
 *   blockSize  finished inches, default 12
 *   seam       seam profile id, default 'scant-quarter'
 *   trim       trim style id, default 'classic'
 *   copies     how many of this block the quilt needs
 */
export function makePattern(def, opts = {}) {
  const {
    blockSize = def.blockSize ?? 12,
    seam = DEFAULT_SEAM,
    trim = DEFAULT_TRIM,
    copies = 1,
  } = opts;

  const block = buildBlock(def, { blockSize });
  const plan = planAssembly(block);
  const cutting = cuttingList(block, { seam, trim, copies });
  const validation = validateBlock(block, { seam, trim });
  const math = seamMath(seam, trim);

  return {
    def,
    block,
    plan,
    cutting,
    validation,
    math,
    stats: { ...seamStats(plan, block), ...validation.stats },
    difficulty: difficultyOf(block),

    svg: (o = {}) => blockSvg(block, o),
    quiltSvg: (o = {}) => quiltSvg(block, o),

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

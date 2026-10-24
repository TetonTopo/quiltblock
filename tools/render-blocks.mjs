// Render labelled block diagrams to one HTML page for review.
// node tools/render-blocks.mjs out.html cow mug teacup ...
import { writeFileSync } from 'node:fs';
import { LIBRARY, buildBlock, blockSvg } from '../packages/pattern-core/src/index.js';

const [out, ...ids] = process.argv.slice(2);
const cards = ids.map((id) => {
  const def = LIBRARY.find((b) => b.id === id);
  if (!def) return `<p>no block ${id}</p>`;
  const block = buildBlock(def, { blockSize: def.blockSize ?? 12 });
  return `<figure><figcaption>${id} — ${block.pieces.length} pieces</figcaption>${blockSvg(block, { scale: 2.2 })}</figure>`;
});
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{font:14px sans-serif;display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;width:440px}svg{width:440px}</style>${cards.join('')}`);

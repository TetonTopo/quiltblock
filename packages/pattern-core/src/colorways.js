/**
 * Colorways.
 *
 * A sampler pattern in the pile shows the same quilt six times: Primrose
 * Garden, Coastal Cool, Tropical Getaway, Cookie Tin, Trading Post, Pink
 * Lemonade. Same geometry, ten solids swapped for ten others. It sells the
 * pattern to six different people.
 *
 * A colorway is a list of hexes ordered light to dark. Applying one to a block
 * ranks the block's fabrics by lightness and hands each the colorway swatch at
 * the same rank, so the picture keeps its value structure - a light sky stays
 * lighter than the cow in front of it - while every hue changes.
 */

import { luminance } from './units.js';

export const COLORWAYS = [
  { id: 'original', name: 'As designed', hexes: null },
  {
    id: 'primrose',
    name: 'Primrose garden',
    hexes: ['#FBFBF6', '#F9DDE4', '#CFE97A', '#F6C6D9', '#A8D98A', '#F2D24B', '#F7B8C4', '#5DAE3E', '#F26B4E', '#E64B9A'],
  },
  {
    id: 'coastal',
    name: 'Coastal cool',
    hexes: ['#F5F2EA', '#C9DEEF', '#D9C3A5', '#BFE3E0', '#B7A78F', '#7FA9D1', '#6FB2B3', '#1F6F7A', '#2F3F7C', '#1E2A55'],
  },
  {
    id: 'tropical',
    name: 'Tropical getaway',
    hexes: ['#F6E7C1', '#B98BC9', '#2FB39B', '#F28A2E', '#1C6FA8', '#E64B9A', '#7E4C9E', '#0F6F6C', '#B4256B', '#0E4F3A'],
  },
  {
    id: 'cookie-tin',
    name: 'Cookie tin',
    hexes: ['#FBFBF6', '#8FCB9A', '#F26B4E', '#2E9E8F', '#C93A3A', '#3E8E5E', '#B71C1C', '#1F6F5A', '#9E1B1B', '#0F5A3C'],
  },
  {
    id: 'trading-post',
    name: 'Trading post',
    hexes: ['#EFE7DA', '#D9C1A3', '#B79B7A', '#C8862E', '#8C7A5B', '#1F6F7A', '#A65A2E', '#8A7F76', '#6B3F2B', '#4A2E22'],
  },
  {
    id: 'lemonade',
    name: 'Pink lemonade',
    hexes: ['#FCEB9B', '#F7C6DF', '#F8D13F', '#F7A9C7', '#F2B233', '#F6A48C', '#F28A2E', '#F26B4E', '#D42A6F', '#B0471E'],
  },
  {
    id: 'indigo',
    name: 'Indigo & cream',
    hexes: ['#F4F1EA', '#E7DDCB', '#CFE3F2', '#9DBB7A', '#5C86B5', '#B8453A', '#6E4A32', '#3F5F4A', '#2F4A7A', '#1B2A4A'],
  },
  {
    id: 'lowvolume',
    name: 'Low volume',
    hexes: ['#FFFFFF', '#F7F4EE', '#EFEAE0', '#E6E1D6', '#DAD3C6', '#CFC7B8', '#BDB4A3', '#A79D8B', '#8E8474', '#6F665A'],
  },
];

export function resolveColorway(idOrObj = 'original') {
  if (typeof idOrObj === 'object' && idOrObj) return idOrObj;
  const c = COLORWAYS.find((x) => x.id === idOrObj);
  if (!c) throw new RangeError(`unknown colorway: ${idOrObj}`);
  return c;
}

/**
 * The block definition re-coloured. Fabrics keep their keys and roles; names
 * become "Coastal cool 3" so the cutting list still reads sensibly.
 */
export function applyColorway(def, colorway = 'original') {
  const cw = resolveColorway(colorway);
  if (!cw.hexes) return def;
  const keys = Object.keys(def.fabrics ?? {});
  const ranked = [...keys].sort((p, q) => luminance(def.fabrics[q].hex) - luminance(def.fabrics[p].hex));
  const swatches = [...cw.hexes].sort((p, q) => luminance(q) - luminance(p));
  const n = ranked.length;
  const m = swatches.length;
  const swatchFor = new Map();
  ranked.forEach((key, i) => {
    // Spread the block's fabrics across the whole colorway rather than using
    // only its lightest few, so a two-fabric block still gets real contrast.
    const j = n === 1 ? 0 : Math.round((i * (m - 1)) / (n - 1));
    swatchFor.set(key, j);
  });
  const fabrics = {};
  for (const key of keys) {
    const j = swatchFor.get(key);
    fabrics[key] = { ...def.fabrics[key], name: `${cw.name} ${j + 1}`, hex: swatches[j] };
  }
  // The sampler rotation was designed against the original hexes; drop it.
  return { ...def, fabrics, rotate: undefined, colorway: cw.id };
}

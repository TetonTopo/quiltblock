/**
 * Guillotine partitioning - the shared geometry behind both the sew order and
 * the merge repair.
 *
 * A region can be sewn by joining two flat halves only if some line crosses it
 * edge to edge without passing through a unit. Repeat that and you get the tree
 * a quilter actually works down: units into rows, rows into bands, bands into a
 * block. A region with no such line needs a partial seam, which is the one
 * genuinely hard technique in flat patchwork.
 *
 * The useful discovery is that most of those dead ends are self-inflicted.
 * Greedily merging same-fabric cells into the biggest rectangles it can find
 * will happily produce an L-shaped interlock - a tall patch down one side and a
 * wide patch along the bottom, hooked around each other. Splitting one of them
 * costs one extra piece and one extra straight seam, and removes the partial
 * seam entirely. Nobody has ever preferred the partial seam.
 */

/** Lines that cross the whole region without slicing through a unit. */
export function cutLines(units, axis, lo, hi) {
  const startKey = axis === 'y' ? 'y' : 'x';
  const sizeKey = axis === 'y' ? 'h' : 'w';
  const candidates = new Set();
  for (const u of units) {
    const s = u[startKey];
    const e = s + u[sizeKey];
    if (s > lo && s < hi) candidates.add(s);
    if (e > lo && e < hi) candidates.add(e);
  }
  return [...candidates]
    .sort((a, b) => a - b)
    .filter((line) => units.every((u) => u[startKey] >= line || u[startKey] + u[sizeKey] <= line));
}

/** Units the line passes through. */
function straddlers(units, axis, line) {
  const startKey = axis === 'y' ? 'y' : 'x';
  const sizeKey = axis === 'y' ? 'h' : 'w';
  return units.filter((u) => u[startKey] < line && u[startKey] + u[sizeKey] > line);
}

/** Every interior edge, as a place a seam could conceivably run. */
function candidateLines(units, axis, lo, hi) {
  const startKey = axis === 'y' ? 'y' : 'x';
  const sizeKey = axis === 'y' ? 'h' : 'w';
  const out = new Set();
  for (const u of units) {
    const s = u[startKey];
    const e = s + u[sizeKey];
    if (s > lo && s < hi) out.add(s);
    if (e > lo && e < hi) out.add(e);
  }
  return [...out].sort((a, b) => a - b);
}

export function decompose(units, region, depth = 0) {
  if (units.length === 1) return { type: 'unit', unit: units[0], region, depth };

  for (const [axis, type] of [['y', 'rows'], ['x', 'columns']]) {
    const lo = axis === 'y' ? region.y0 : region.x0;
    const hi = axis === 'y' ? region.y1 : region.x1;
    const cuts = cutLines(units, axis, lo, hi);
    if (!cuts.length) continue;

    const bounds = [lo, ...cuts, hi];
    const children = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const [a, b] = [bounds[i], bounds[i + 1]];
      const slice = units.filter((u) =>
        axis === 'y' ? u.y >= a && u.y + u.h <= b : u.x >= a && u.x + u.w <= b,
      );
      const sub = axis === 'y' ? { ...region, y0: a, y1: b } : { ...region, x0: a, x1: b };
      children.push(decompose(slice, sub, depth + 1));
    }
    return { type, children, region, depth, cuts };
  }

  return { type: 'partial', units, region, depth };
}

/**
 * The cheapest line that would unlock a stuck region: the one crossing the
 * fewest units, and only units we are allowed to cut. Triangle units cannot be
 * split - the diagonal is the whole point of them - so a region where every
 * candidate line crosses a triangle genuinely needs a partial seam.
 */
function bestRepairLine(units, region) {
  let best = null;
  for (const [axis, lo, hi] of [
    ['y', region.y0, region.y1],
    ['x', region.x0, region.x1],
  ]) {
    for (const line of candidateLines(units, axis, lo, hi)) {
      const crossed = straddlers(units, axis, line);
      if (!crossed.length) continue;
      if (crossed.some((u) => u.kind !== 'patch')) continue;
      const mid = (lo + hi) / 2;
      const score = crossed.length * 1000 + Math.abs(line - mid) / 1000;
      if (!best || score < best.score) best = { axis, line, crossed, score };
    }
  }
  return best;
}

/** Replace each straddling patch with the two patches the line divides it into. */
function splitAt(units, axis, line, crossed) {
  const set = new Set(crossed);
  const out = [];
  for (const u of units) {
    if (!set.has(u)) {
      out.push(u);
      continue;
    }
    if (axis === 'y') {
      out.push({ ...u, h: line - u.y, split: true });
      out.push({ ...u, y: line, h: u.y + u.h - line, split: true });
    } else {
      out.push({ ...u, w: line - u.x, split: true });
      out.push({ ...u, x: line, w: u.x + u.w - line, split: true });
    }
  }
  return out;
}

/**
 * Split merged patches until the whole block can be sewn with straight seams,
 * or until nothing is left that we are allowed to split.
 *
 * Returns the (possibly larger) unit list. Cell coordinates on a split unit are
 * no longer meaningful, so they are dropped - by this point only geometry
 * matters.
 */
export function repairForGuillotine(units, region, { maxSplits = 40 } = {}) {
  let current = units;
  let splits = 0;

  const walk = (list, reg) => {
    if (list.length <= 1) return true;
    for (const [axis, lo, hi] of [
      ['y', reg.y0, reg.y1],
      ['x', reg.x0, reg.x1],
    ]) {
      const cuts = cutLines(list, axis, lo, hi);
      if (!cuts.length) continue;
      const bounds = [lo, ...cuts, hi];
      for (let i = 0; i < bounds.length - 1; i++) {
        const [a, b] = [bounds[i], bounds[i + 1]];
        const slice = list.filter((u) =>
          axis === 'y' ? u.y >= a && u.y + u.h <= b : u.x >= a && u.x + u.w <= b,
        );
        const sub = axis === 'y' ? { ...reg, y0: a, y1: b } : { ...reg, x0: a, x1: b };
        if (!walk(slice, sub)) return false;
      }
      return true;
    }

    // Stuck. Repair this region if we are allowed to, then start over, because
    // splitting a patch can change how an ancestor region decomposes too.
    const fix = bestRepairLine(list, reg);
    if (!fix || splits >= maxSplits) return true; // genuinely needs a partial seam
    current = splitAt(current, fix.axis, fix.line, fix.crossed);
    splits++;
    return false;
  };

  for (let guard = 0; guard <= maxSplits; guard++) {
    if (walk(current, region)) break;
  }

  return { units: current, splits };
}

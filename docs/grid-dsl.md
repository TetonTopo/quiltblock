# The grid DSL

A block is a square grid of cells. Each row is a string of whitespace-separated
cell tokens, and there are as many tokens per row as there are rows. Fabrics are
single lowercase letters that index into the block's `fabrics` map.

```js
{
  id: 'ohio-star',
  name: 'Ohio star',
  subject: 'Stars',
  fabrics: {
    k: { name: 'Oatmeal linen', hex: '#E7DDCB' },
    c: { name: 'Madder red',    hex: '#B8453A' },
  },
  accent: 'c',              // the fabric that varies across a sampler quilt
  background: 'k',          // the fabric a rainbow quilt rotates (optional)
  blockSize: 12,            // the default finished size (optional)
  subgrid: 1,               // sub-blocks per side (optional, see below)
  quilt: { cols: 4, rows: 5, setting: 'sashed' },   // planner defaults (optional)
  rows: ['k   c+k k',
         'k+c c   k+c',
         'k   c+k k'],
}
```

## Cell tokens

| Token | Unit | Size | Pieces |
|---|---|---|---|
| `k` | plain patch | 1 cell, merges with neighbours | 1 |
| `a/b` | half-square triangle, diagonal like `/` | 1 cell, or n×n with `.` | 2 |
| `a\b` | half-square triangle, diagonal like `\` | 1 cell, or n×n with `.` | 2 |
| `a+b` | hourglass (quarter-square) | 1 cell, or n×n with `.` | 4 |
| `a^b` | flying goose pointing up | 2 cells wide | 3 |
| `avb` | flying goose pointing down | 2 cells wide | 3 |
| `a>b` | flying goose pointing right | 2 cells tall | 3 |
| `a<b` | flying goose pointing left | 2 cells tall | 3 |
| `.` | continuation of a multi-cell unit | — | — |

In a two-fabric token the **first letter is the figure** and the second is the
ground: in `a/b` fabric `a` is the upper-left triangle; in `a\b` fabric `a` is
the upper-right; in `a+b` fabric `a` is the top and bottom of the hourglass; in
`a^b` fabric `a` is the goose and `b` is the sky either side of it.

A `^` or `v` goose is two cells wide, so the cell to its right must be `.`. A `>`
or `<` goose is two cells tall, so the cell below it must be `.`.

A half-square triangle or hourglass can be bigger than one cell: follow it with
`.` cells to the right and fill the rows below with `.`.

```
k/d .   k k k\d .      a churn dash: 2×2 triangles in the corners,
.   .   d d .   .      split rectangles on the sides
k   d   c c d   k
```

## Merging

Adjacent plain cells of the same fabric are merged into the largest rectangles
they form — greedily, growing right first and then down. This is why a block
drawn cell by cell does not turn into sixty-four tiny squares: a flat sky is one
piece, not forty.

Merging runs before anything else, so piece labels, the cutting list and the sew
order all describe the merged rectangles.

## Stitch-and-flip corners

A one-cell triangle at the corner of a run of plain cells, with the run's fabric
on its inner side, is absorbed into the rectangle as a **stitch-and-flip
corner**: the rectangle grows over the cell and records the corner. It is cut as
one rectangle plus one small square per corner, and sewn by laying the square
on the corner and stitching across it.

```
k/p p p k\p      a strip of p with both top corners clipped by k
p\k p p p/k      ... and the bottom ones too: an octagon (a teapot body)
```

The four forms, for a rectangle of fabric `a` with corner fabric `k`:

| Corner | Token | Where it may sit |
|---|---|---|
| top-left | `k/a` | first cell of the top row |
| top-right | `k\a` | last cell of the top row |
| bottom-left | `a\k` | first cell of the bottom row |
| bottom-right | `a/k` | last cell of the bottom row |

Two corners on one end of a strip make a flying goose; four on a square make a
square on point. When a corner cell could belong to two different rectangles,
it goes to whichever makes the bigger patch. A triangle that cannot be a corner
of anything stays a half-square triangle, and a lone triangle is never absorbed.

Pass `corners: 'hst'` to `buildBlock` or `makePattern` to switch absorption off
and keep every triangle as its own two-piece unit.

## Sub-blocks

`subgrid: 2` says the block is really four quarter-blocks that are made
separately and then joined, and merging never crosses the boundary. Rail fence
and most big sampler blocks are sewn that way. The grid must divide evenly.

## Merge repair

Greedy merging can produce two rectangles hooked around each other — a tall one
down one side, a wide one along the bottom — with no line left that crosses the
block edge to edge. A block like that cannot be sewn by joining flat halves; it
needs a partial seam.

After merging, the engine checks whether the block decomposes into straight
seams. If it does not, it splits one merged patch to restore a straight seam and
tries again, preferring the line that crosses the fewest units. Each split costs
exactly one extra piece and one extra straight seam, which is a trade no quilter
has ever refused. `block.merges` reports how many splits it took. A patch with
stitch-and-flip corners can be split; each corner stays with the half that
still owns it.

Triangle units are never split — the diagonal is the point of them. A region
where every candidate line crosses a triangle genuinely needs a partial seam,
and the pattern says so on the front page instead of in step nine.

Pass `{ repair: false }` to `buildBlock` to see the unrepaired decomposition.

## Mirroring

`mirrorDef(def)` returns the same block facing the other way: the grid is
parsed, every unit's origin is moved to its mirrored column, `/` and `\` swap,
`<` and `>` swap. The quilt planner uses it to face every other block the
opposite way.

## Block size and grid size

The grid size comes from the definition; the finished size is passed in.

```js
buildBlock(def, { blockSize: 12 })
```

A block's size in sixteenths must divide evenly by the grid size. `validSizes(grid)`
lists the sizes that work: an 8 grid takes 6, 8, 9, 10, 12, 14, 15, 16, 18, 20
and 24; a 9 grid takes 9 and 18; a 5 grid 10, 15 and 20. Picture blocks are
drawn on 8×8 (the chicken on 12×12); traditional blocks use the coarse grids
they are actually drafted on.

## Errors

`buildBlock` throws `PatternError` rather than drawing something wrong:

- rows of unequal length, or a non-square grid
- a block size that does not divide by the grid
- a `.` with no multi-cell unit to belong to, or a multi-cell unit with no `.`
- a multi-cell unit that crosses a sub-block boundary
- overlapping units
- an unknown operator, or an unknown corner method
- a cell referencing a fabric the block does not define

## Adding a block

Add it to `packages/pattern-core/src/blocks.js` and the test suite will pick it
up automatically — the library-wide tests check that every block tiles its own
area exactly, uses only straight edges, passes the house rules, and sews in
straight seams with corners on and with corners off. Its tier is computed, not
declared, so if you meant it to be a beginner block and it comes out
Intermediate, simplify it.

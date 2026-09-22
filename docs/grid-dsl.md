# The grid DSL

A block is a square grid of cells. Each row is a string of whitespace-separated
cell tokens, and there are as many tokens per row as there are rows. Fabrics are
single lowercase letters that index into the block's `fabrics` map.

```js
{
  id: 'ohio-star',
  name: 'Ohio star',
  subject: 'Traditional',
  fabrics: {
    k: { name: 'Oatmeal linen', hex: '#E7DDCB' },
    c: { name: 'Madder red',    hex: '#B8453A' },
  },
  accent: 'c',              // the fabric that varies across a sampler quilt
  rows: ['k   c+k k',
         'k+c c   k+c',
         'k   c+k k'],
}
```

## Cell tokens

| Token | Unit | Size | Pieces |
|---|---|---|---|
| `k` | plain patch | 1 cell, merges with neighbours | 1 |
| `a/b` | half-square triangle, diagonal like `/` | 1 cell | 2 |
| `a\b` | half-square triangle, diagonal like `\` | 1 cell | 2 |
| `a+b` | hourglass (quarter-square) | 1 cell | 4 |
| `a^b` | flying goose pointing up | 2 cells wide | 3 |
| `avb` | flying goose pointing down | 2 cells wide | 3 |
| `a>b` | flying goose pointing right | 2 cells tall | 3 |
| `a<b` | flying goose pointing left | 2 cells tall | 3 |
| `.` | continuation of a multi-cell unit | — | — |

In a two-fabric token the **first letter is the figure** and the second is the
ground: in `a/b` fabric `a` is the upper-left triangle; in `a+b` fabric `a` is
the top and bottom of the hourglass; in `a^b` fabric `a` is the goose and `b` is
the sky either side of it.

A `^` or `v` goose is two cells wide, so the cell to its right must be `.`. A `>`
or `<` goose is two cells tall, so the cell below it must be `.`.

```
k   s^k .   k        the top edge of a sawtooth star:
s<k c   c   s>k      four geese pointing outward around a
.   c   c   .        centre square that merges from four cells
k   svk .   k
```

## Merging

Adjacent plain cells of the same fabric are merged into the largest rectangles
they form — greedily, growing right first and then down. This is why a block
drawn cell by cell does not turn into sixty-four tiny squares: a flat sky is one
piece, not forty.

Merging runs before anything else, so piece labels, the cutting list and the sew
order all describe the merged rectangles.

## Merge repair

Greedy merging can produce two rectangles hooked around each other — a tall one
down one side, a wide one along the bottom — with no line left that crosses the
block edge to edge. A block like that cannot be sewn by joining flat halves; it
needs a partial seam.

After merging, the engine checks whether the block decomposes into straight
seams. If it does not, it splits one merged patch to restore a straight seam and
tries again, preferring the line that crosses the fewest units. Each split costs
exactly one extra piece and one extra straight seam, which is a trade no quilter
has ever refused. `block.merges` reports how many splits it took.

Triangle units are never split — the diagonal is the point of them. A region
where every candidate line crosses a triangle genuinely needs a partial seam,
and the pattern says so on the front page instead of in step nine.

Pass `{ repair: false }` to `buildBlock` to see the unrepaired decomposition.

## Block size and grid size

The grid size comes from the definition; the finished size is passed in.

```js
buildBlock(def, { blockSize: 12 })
```

A block's size in sixteenths must divide evenly by the grid size, so a 12″ block
works on a 2, 3, 4, 6, 8, 12 or 16 grid, and a 10″ block does not work on a 3
grid. Picture blocks are drawn on 8×8; traditional star blocks use the coarse
grids they are actually drafted on.

## Errors

`buildBlock` throws `PatternError` rather than drawing something wrong:

- rows of unequal length, or a non-square grid
- a block size that does not divide by the grid
- a `.` with no multi-cell unit to belong to, or a multi-cell unit with no `.`
- overlapping units
- an unknown operator
- a cell referencing a fabric the block does not define

## Adding a block

Add it to `packages/pattern-core/src/blocks.js` and the test suite will pick it
up automatically — the library-wide tests check that every block tiles its own
area exactly, uses only straight edges, passes the house rules, and sews in
straight seams.

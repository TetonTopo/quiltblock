# From a block to a quilt

The engine started as a block engine. A stack of commercial patterns changed
that: every one of them is a *quilt* pattern, and the block is a page in the
middle. This document covers what was added to make the output look like those
patterns: the complexity dial, stitch-and-flip corners, the quilt planner, the
strip-based cutting list, colorways, and the hexagon patterns that live to one
side of all of it.

## The complexity dial

`packages/pattern-core/src/tiers.js` defines four tiers. The patterns in the
pile label themselves "Beginner", "Confident Beginner", "Advanced Beginner",
and side by side the label tracks three things: which constructions are in the
block, how many pieces there are, and how small they get.

| Tier | What it means | Library examples |
|---|---|---|
| Beginner | Squares, rectangles, strips, a stitch-and-flip corner or two | Nine patch, log cabin, snowball, teacup |
| Confident beginner | Half-square triangles, flying geese, corners | Sawtooth star, maple leaf, teapot, bear paw |
| Intermediate | Hourglasses, lots of triangles, finer grids | Dutchman's puzzle, chicken |
| Advanced | Many small triangles, sawtooth edges, one-inch pieces | Lady of the lake, ocean waves, delectable mountains |

The tier is never typed in. `difficultyOf` scores a block from its geometry:

    pieces + 1.5 × triangle units + 0.5 × stitch-and-flip corners + 0.5 × units under 1½"

and `tierOfScore` turns the score into a label. Turning stitch-and-flip off on
a maple leaf moves it from Intermediate to Advanced, because the same picture
is now fourteen half-square triangles instead of thirteen corners on rectangles,
and the score says so.

The generator takes a tier too. It goes into the system prompt as a paragraph
of instructions, into validation as piece-count and minimum-size limits, and
into a check that the finished block scores at the level asked for. A block
that comes back too hard or too easy is sent back to the model with the reason.

## Stitch-and-flip corners

Every commercial pattern in the pile builds diagonals the same way: lay a small
square on the corner of a rectangle, sew across it corner to corner, trim,
flip. Nobody cuts a triangle. So the merge in `block.js` now absorbs a
one-cell half-square triangle into the run of plain cells beside it when the
triangle sits at a corner of the rectangle and its inner half is the
rectangle's fabric.

    k/p p p k\p      a strip of p with both top corners clipped by k
    p\k p p p/k      ... and both bottom corners: an octagon

Two corners on one end of a strip make a flying goose; four corners on a
square make a square on point. The cutting list charges one square per corner
(finished leg plus two seam allowances - a 2" corner is a 2½" square) and the
sew order says where to lay it.

The workbench has a switch: *Stitch-and-flip* or *Half-square triangles*.
Stitch-and-flip is fewer pieces and easier; half-square triangles waste less
fabric. Both tile the block exactly, and the test suite checks every library
block both ways.

Two more parsing features came with it:

- **Multi-cell triangles.** `a/b . / . .` is a 2×2 half-square triangle. That
  is how a churn dash gets its big corners and a bear paw its pad.
- **Sub-blocks.** `subgrid: 2` on a definition says the block is four
  quarter-blocks made separately, and merging never crosses the boundary. A
  rail fence keeps its four squares; a delectable mountains keeps its four
  mountains.

## The quilt planner

`quilt.js` turns a built block into a quilt: `planQuilt(block, opts)`.

    p.quilt({ cols: 4, rows: 5, setting: 'sashed', sashing: 2, innerBorder: 1.5, outerBorder: 4 })

Settings: edge to edge, sashing, sashing with cornerstones, alternate with
plain squares. Plus three switches from the tea-party quilt:

- `mirror` flips every other block left to right (`mirrorDef` re-emits the
  grid with each unit's origin moved to its mirrored column).
- `rainbow` rotates the block's background fabric through ten solids in
  reading order. The background is whichever fabric covers the most area, or
  `background: 'k'` on the definition. Its cuts are split into one fabric line
  per colour, because that is what you shop for.
- `piecedBorder` sets small copies of the block into the outer border, on the
  border fabric, with plain corners. The border becomes exactly one small block
  wide so nothing needs padding.

The plan carries the finished size, every cell for the layout drawing, the
borders, the binding (2½" strips, perimeter plus 12"), the backing (pieced
lengthwise or crosswise, whichever is less fabric, and the wideback
alternative), the batting, the assembly steps, and the cutting list for the
whole quilt.

## Cutting as strips

`cutting.js` now plans every fabric as width-of-fabric strips, the way the
patterns in the pile print it:

    (6) strips 3½" × WOF; subcut (32) rectangles 3½" × 6½"

Each entry is cut as strips of its smaller dimension and sub-cut to its larger
one; strips of the same width share leftovers, biggest pieces first; anything
longer than the usable width (borders) is pieced from joined strips. Yardage is
the running length of strips rounded up to the next eighth, with a couple of
inches in hand for straightening. If everything fits in 18" × 21" the line
says "fat quarter" instead.

The old area-times-1.45 estimate is still exported as `yardageFor` for anyone
who wants a sanity check.

## Colorways

`colorways.js` holds nine palettes ordered light to dark. Applying one ranks
the block's fabrics by lightness and hands each the swatch at the same rank, so
the sky stays lighter than the cow while every hue changes. The sampler rotation
(`rotate` on a definition) is dropped under a colorway because it was designed
against the original hexes.

## The rest of the page

- **Exploded view.** `explodedSvg` pulls the units apart along the guillotine
  tree: rows drift vertically, columns horizontally. It is the picture every
  commercial pattern prints next to "assemble".
- **Units to make.** `plan.unitGroups` lists each kind of sewn unit with a
  count, finished and unfinished size, and the piece labels, with a drawing.
- **Coloring sheet.** `coloringSvg` is the block in white with dark lines.
- **Print view.** Cover with block and quilt layout, fabric requirements,
  strip cutting, exploded block, pressing plan, block cutting, sew order, quilt
  assembly, coloring sheet.

## Hexagons

`hexagons.js` is deliberately not part of the block engine. Hexagons meet at
120°, are cut with a template rather than a ruler, and are sewn by hand over
papers. So a hexagon pattern is a *layout* (scrappy field, flower garden,
double rosettes, diamonds), a count per fabric, the square to cut each hexie
from (twice the side plus ¾"), the strips and yardage, a printable template
sheet at 100%, and the English-paper-piecing steps.

A "1 inch hexagon" means a one-inch side, as every paper supplier means it.
Rosette centres sit on a scaled copy of the hex lattice: 3 apart for one ring
plus a path, 5 apart for two rings plus a path.

## What the tests cover

`node packages/pattern-core/test/run.js` - 53 tests. Beyond the original
geometry and seam tests: corner absorption and its cut sizes, multi-cell
triangles, sub-blocks, mirroring, valid sizes, strip planning and yardage
rounding, every library block tiling and sewing in straight seams under both
corner methods, tiers, colorways, four quilt settings including the rainbow and
pieced border, size presets, and hexagon counts and templates.

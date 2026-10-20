# Mom's pile

In September 2026 Mom scanned the commercial patterns she owns and likes into
eleven PDFs (`Patterns_Part1` to `Part11` in the shared Drive folder), on top
of the seven scans the engine was first rebuilt against. This is the catalogue
of the eleven: what each quilt is, whether the engine can make it, and what it
would take for the ones it cannot.

Nothing from the patterns is copied here or into the library except the block
geometry, which is traditional, redrawn on our own grid, and renamed. The
pattern a block was drafted from is kept in its `source` field, for us.

## Verdicts

- **A** - the blocks build in the grid DSL and the planner can set them.
- **B** - the blocks build; the quilt needs a planner feature still missing.
- **C** - needs a construction the engine does not have yet.
- **D** - out of scope on purpose: appliqué, curves, Dresden plates. Straight lines only.

About forty quilts. Several scans are incomplete (only some pages present), noted where it matters.

| Pattern | Level as printed | Verdict | In the library now |
|---|---|---|---|
| Wanderer's Wife (Jen Kingwell) | advanced | blocks A/C, quilt C (strip sections with partial seams) | hourglass star, pieced heart, Indian hatchet, old maid's puzzle, puss in the corner, sixteen triangles, bordered hourglass, bordered pinwheel |
| Heartland Heritage BOM (Inspiring Stitches) | mixed | 5 of 12 blocks A, 7 C (on point, offset strip sets); quilt a mixed-size sampler | willow tree, posy, sweet pea, wildflower, star bright |
| Layer Cake Pop (Fat Quarter Shop) | beginner | A | corner pop |
| Grandma Mary's Five Patch (Sweet Jane's) | beginner | block A, quilt B (pieced column sashing) | five patch frame |
| Take Four placemats | beginner | B (cut-and-shuffle, no block) | - |
| Hat and Boots row (Fiberworx) | confident | C (four corner sizes, ½" welts, row) | - |
| Tulip Pots (Lori Holt) | confident | C (tapered pots, specialty ruler) | - |
| Norm & Nanette (Elizabeth Hartman) | confident | C (non-45° hat, ½" pieces) | - |
| Urban Streets (Taren Studios) | beginner | B (columns of bricks, no block) | - |
| French Roses | - | D (appliqué) | - |
| American Pie BOM (QT Fabrics) | advanced | months 1, 4, 5, 6 A (79-88 pieces); 2, 3 C; quilt B (sampler) | medallion star, geese pinwheel medallion, triangle ring medallion, square in a square medallion |
| Gift Box runner (AccuQuilt) | beginner | A, incl. a 10 × 14 block | gift box, tall gift box |
| Bee Hive Jive (Grome's) | confident | hive A (10 × 12), bee C, row quilt B | bee skep |
| Flower Basket runner (Chris Malone) | - | 49-patch A, baskets D | forty-nine patch |
| Sunflowers (QuiltFox) | - | D (Dresden plates) | - |
| Hidden Agenda (Angela Pingel) | - | units A (duplicates), quilt B | - |
| Butterfly Patch (Lella Boutique) | beginner | A | six stripes (its sawtooth stars led to fixing the library one) |
| Bricks and Borders BOO!! II | beginner | A, incl. 10 × 12 | framed print, stacked strips |
| Sweet Spring row quilt (Flamingo Toes) | confident | flower, heart A; animals C; row quilt B | spring flower, little heart |
| Periwinkle Kaleidoscope (In The Beginning) | - | C (45° wedges) | - |
| The Still Room (FreeSpirit; partial scan) | - | B (rectangles, shelf rows, panels) | - |
| Farmer's Skinny Patriotic | - | C/D (half-rectangle triangles, columns) | - |
| Kimono Girls (Tilda) | - | D (appliqué, embroidery) | - |
| Mad Hatter's Tea Party (Tula Pink) | - | B (15 × 13 blocks, a border of a different block) | teapot and teacup were already in |
| Gentle Garden (Henry Glass) | confident | A; four blocks alternate | garden star, half log cabin - **set as the original: alternate, 2" and 5" borders** |
| Doodle-Doo (Annie's) | confident | A with approximations; plain squares at chosen spots, three borders | the library chicken (from the earlier scans) |
| Pollen in Love (Chris Malone) | - | D (appliqué runner) | - |
| Boots & Blooms quilt (P&B) | - | B (pieced sashing, nine-patch cornerstones, rectangle border) | - |
| Sachet (Northcott) | - | A; two blocks alternate | bear's paw four paws, sashed four patch - **set as the original** |
| Lanterns (Robert Kaufman) | beginner | block A, quilt B (offset columns) | lantern steps |
| Garden Lattice (Briar Hill) | - | C (angled strips, no blocks) | - |
| Dressing Gown quilt (Tilda) | - | C (non-45° lapels, staggered columns) | - |
| Me and my Dog (Tilda; partial) | - | C/D | - |
| Groovy Hexie runner (Moda) | - | hexies fit `hexagons.js`; finish is appliqué | - |
| Bake Off (Jillily Studio) | - | star A; quilt a panel medallion (B) | split-point star |
| Enchanted Seas Pirate Quilt (P&B) | confident | boat A (7 × 9, ½" strips - bends the ¾" rule, so rated Advanced); pieced sashing B | little boat - **set as the original's five borders and cornerstones** |
| Wild and Free (Riley Blake) | beginner | A - **set as the original: panel centre, 8" border, stars in the corners** | two-sky star |

36 blocks in all, in `packages/pattern-core/src/pile.js`, including the pirate quilt's little boat. None of them has been checked by Mom.

## What was added to the engine because of the pile

- **Rectangular blocks.** A grid with more rows than columns; cells stay square, `blockSize` is the width. Six patterns needed it.
- **Any number of borders**, each its own fabric: `borders: [1.5, 1, 2, 1, 3.5]`. The pirate quilt has five.
- **A second pieced block in the alternate setting** (`alternateWith`). Gentle Garden, Sachet.
- **Panel centre** with the block set into the corners of the outer border. Wild and Free, Bake Off, Boots & Blooms, Still Room.
- **The piece ceiling went from 80 to 100**: the American Pie medallions are 79-88 pieces as printed.
- **The library sawtooth star was wrong** (star-fabric geese, four points); it now has background geese and eight points, as every pattern in the pile draws it.

## Still missing, by how many patterns want it

1. **Row and column quilts** - rows of different blocks and heights with spacer strips, offset columns, strippy sections. About ten patterns. The biggest gap left.
2. **Samplers** - many different blocks in one quilt, sometimes at mixed sizes. American Pie, Heartland Heritage, Hidden Agenda.
3. **Stitch-and-flip corners bigger than one cell**, and several corner sizes in one block. Tulip Pots, Hat and Boots, Norm & Nanette, the boats' hulls.
4. **Pieced sashing and pieced cornerstones** (strip-set sashing, nine-patch cornerstones). Pirate, Boots & Blooms, Five Patch, Tulip Pots.
5. **Pieced borders made of units** - HST sawtooth, rectangles, a different block with spacers. Mad Hatter, Bake Off, Pollen in Love, Boots & Blooms.
6. **On point**: blocks set on point with setting triangles, and squares on point inside a block.
7. **Half-rectangle triangles** and other non-45° shapes. These break the straight-45° rule as it stands and need a decision.
8. Small things: sashing between blocks only, borders of different widths per side, plain squares at chosen positions, mitred border prints, flipping alternate blocks top to bottom.

## Questions for Mom

- **½" strips** - decided Oct 20: allowed down to ½" finished, flagged on the pattern as bending the ¾" rule, and always rated Advanced. Does that match how she would label them?
- **Pieces per block.** She likes big blocks; the medallion stars are 80-88 pieces. Is there a point where she would rather see it split into units on separate pages?
- Do the 35 drafted blocks look right next to the originals?

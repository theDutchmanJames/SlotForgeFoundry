# Making a road surface texture

A texture in `src/textures` is one repeatable tile of stones. These three
scripts made `cobbles.js` from a vector drawing of the joints (a PDF). They
need Python with pymupdf, shapely, scipy and numpy, and are not part of the app.

```
python 1-read-drawing.py drawing.pdf paths.json
python 2-make-repeatable.py paths.json tile.json
python 3-write-module.py tile.json ../../src/textures/name.js
```

1. Reads the filled outlines out of the drawing.
2. Keeps the stones that lie wholly inside the tile, drops the ones the edges
   cut, and fills the band they leave with new stones, so that the tile
   repeats in both directions. It reports the closest two stones and how
   densely the stones cover the seams.
3. Gives every joint a least width and writes the module. Set its `id`,
   `name` and `real` (the size of a stone on a real road, in mm) by hand, and
   add it to `ROAD_TEXTURES` in `src/geometry/road-texture.js`.

The drawing is expected to be a 200 mm square with a 1 pt margin.

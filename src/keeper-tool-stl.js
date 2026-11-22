import { encodeSTL } from './editor.js';
import { buildKeeperTool } from './geometry/keeper-tool.js';
import { SolidWorkshop } from './geometry/solids.js';

export const KEEPER_TOOL_FILENAME = 'keeper-turning-tool.stl';

// Fit samples share a plate layout. A standalone key and a kit accessory
// can use the model's original print coordinates.
export function keeperToolSTL(wasm, plateCorner) {
  const work = new SolidWorkshop(wasm);
  try {
    const tool = buildKeeperTool(work);
    if (!plateCorner) return encodeSTL(tool);
    const { min } = tool.boundingBox();
    return encodeSTL(work.own(tool.translate([plateCorner[0] - min[0], plateCorner[1] - min[1], 0])));
  } finally {
    work.close();
  }
}

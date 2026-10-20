/* =========================================================
   模組一：世界座標 ↔ 邏輯網格
   ---------------------------------------------------------
   改成 3D 之後，「等距投影」交給正交攝影機處理：
   角色真正的位置是 3D 地面上的 (x, z)，所以判定格子時
   不需要再從螢幕座標逆推，直接在地面平面上換算即可，
   結果更精準，也不受鏡頭角度、縮放影響。

       gx = (x - originX) / tileSize
       gy = (z - originZ) / tileSize
       第 (i, j) 格範圍：gx ∈ [i, i+1)、gy ∈ [j, j+1)，中心 (i+0.5, j+0.5)

   對外介面與舊版 IsoProjection 相同（worldToGrid / worldToCell / cellCenter），
   GridTracker 不用改任何程式就能沿用。
   ========================================================= */
class GroundGrid {
  constructor({ tileSize = 1, originX = 0, originZ = 0 } = {}){
    this.tileSize = tileSize;
    this.originX = originX;
    this.originZ = originZ;
  }

  /** 地面世界座標 (x, z) → 網格浮點座標 */
  worldToGrid(x, z){
    return { gx: (x - this.originX) / this.tileSize, gy: (z - this.originZ) / this.tileSize };
  }

  /** 地面世界座標 → 所在格子的整數索引 */
  worldToCell(x, z){
    const g = this.worldToGrid(x, z);
    return { x: Math.floor(g.gx), y: Math.floor(g.gy) };
  }

  /** 格子中心的世界座標 */
  cellCenter(i, j){
    return { x: this.originX + (i + 0.5) * this.tileSize, z: this.originZ + (j + 0.5) * this.tileSize };
  }
}

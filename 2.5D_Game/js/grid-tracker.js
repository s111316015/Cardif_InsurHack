/* =========================================================
   模組二：即時網格追蹤器（Grid Tracker）
   ---------------------------------------------------------
   每一幀把角色錨點（腳底中心）的世界座標丟進 update()，
   追蹤器透過 projection（GroundGrid 或 IsoProjection）算出所在格子，正式進入新格子時觸發
   onGridChanged(newX, newY, prev)。

   防抖機制（避免在格線交界處來回跳動）
   1. 遲滯邊界（margin）：
      進入新格子後，錨點必須離新格子每一條邊都至少 margin（網格單位）
      才算「正式進入」。在交界附近晃動時，仍維持舊格子。
          ┌───────────┐
          │  ┌─────┐  │  ← 內框 = 有效區（margin 以內）
          │  │     │  │     錨點進入內框才切換
          │  └─────┘  │
          └───────────┘
   2. 停留時間（minDwellMs，可選）：
      候選格子需連續成立一段時間才確認，適合有抖動輸入（搖桿、物理）的情境。
   3. 跨格補償：
      若某一幀移動太多（例如分頁切回來 dt 很大）一次跨過多格，
      會依序補發中間經過的每一格，事件不會漏掉。
   ========================================================= */
class GridTracker {
  constructor(projection, { margin = 0.12, minDwellMs = 0, onGridChanged = null } = {}){
    this.proj = projection;
    this.margin = margin;
    this.minDwellMs = minDwellMs;
    this.onGridChanged = onGridChanged;
    this.cell = null;        // 目前確認的格子 {x, y}
    this.pending = null;     // 候選格子 {x, y, since}
    this.last = null;        // 最近一次輸入（除錯用）
  }

  /** 直接把角色放在某處，不觸發事件（開局、傳送時使用） */
  reset(x, y){
    this.cell = this.proj.worldToCell(x, y);
    this.pending = null;
  }

  /** 每幀呼叫。回傳目前確認的格子 */
  update(x, y, now = performance.now()){
    const g = this.proj.worldToGrid(x, y);
    const cx = Math.floor(g.gx), cy = Math.floor(g.gy);
    this.last = { x, y, gx: g.gx, gy: g.gy, cx, cy };

    if (!this.cell){ this.cell = { x: cx, y: cy }; return this.cell; }

    // 還在原本的格子 → 取消候選
    if (cx === this.cell.x && cy === this.cell.y){ this.pending = null; return this.cell; }

    // 1. 遲滯邊界：必須深入新格子 margin 以上
    const fx = g.gx - cx, fy = g.gy - cy, m = this.margin;
    if (fx < m || fx > 1 - m || fy < m || fy > 1 - m) return this.cell;

    // 2. 停留時間
    if (this.minDwellMs > 0){
      if (!this.pending || this.pending.x !== cx || this.pending.y !== cy){
        this.pending = { x: cx, y: cy, since: now };
        return this.cell;
      }
      if (now - this.pending.since < this.minDwellMs) return this.cell;
    }

    // 3. 確認切換（必要時補發中間格子）
    this._stepTo(cx, cy);
    this.pending = null;
    return this.cell;
  }

  _stepTo(tx, ty){
    // 沿 x 再沿 y 逐格前進，保證每次事件都只移動一格
    while (this.cell.x !== tx || this.cell.y !== ty){
      const prev = this.cell;
      const next = { x: prev.x, y: prev.y };
      if (next.x !== tx) next.x += Math.sign(tx - next.x);
      else               next.y += Math.sign(ty - next.y);
      this.cell = next;
      if (this.onGridChanged) this.onGridChanged(next.x, next.y, prev);
    }
  }
}

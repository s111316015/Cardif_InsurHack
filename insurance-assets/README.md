# 保險大富翁 — 遊戲素材

這些素材全部由 `tools/generate_assets.py` 用程式產生，沒有使用任何第三方模型、圖片或圖庫，屬於團隊原創作品，沒有授權疑慮（符合競賽辦法第十八條「可商用授權素材」的要求）。

要修改顏色或造型，就改 `tools/generate_assets.py` 裡的參數（例如 `PALETTE`、`PROP_SCALE`），再在 `Cardif_InsurHack` 根目錄執行：

```
python tools/generate_assets.py
```

執行前要先安裝：`pip install numpy pillow`

## 檔案對照

| 檔案 | 用途 | 匯入地圖編輯器時的類型 |
|---|---|---|
| `models/tile_start.glb` | 起點格（綠，旗子） | 模型 |
| `models/tile_salary.glb` | 薪資格（金，硬幣堆） | 模型 |
| `models/tile_shop.glb` | 保險商城格（藍，盾牌） | 模型 |
| `models/tile_risk.glb` | 突發風險格（紅，三角錐） | 模型 |
| `models/tile_chance.glb` | 機會命運格（紫，禮物盒） | 模型 |
| `icons/icon_*.png` | 平貼在格子表面的事件圖示（512×512，透明背景） | 圖片 |
| `roles/role_freshman.png` | 角色立牌：新鮮人小資族 | 圖片 |
| `roles/role_freelancer.png` | 角色立牌：斜槓自由業者 | 圖片 |
| `roles/role_engineer.png` | 角色立牌：科技業工程師 | 圖片 |
| `roles/role_family.png` | 角色立牌：雙薪小家庭 | 圖片 |
| `preview.png` | 所有素材的預覽圖 | — |

## 模型規格（配合 mine-monopoly 引擎）

- 1 格 = 1×1 單位，原點在格子中心，底部 y = 0。
- 名稱為 `base` 的零件是格子的頂面（y = 0.13）：棋子站在這個高度，事件圖示也貼在這上面。
- 道具（`prop_*`）放在右後角，不會擋到棋子和圖示。

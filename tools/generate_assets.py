#!/usr/bin/env python3
"""
保險大富翁 — 素材產生器（100% 程式產生，無第三方美術素材，無授權疑慮）

產出：
  insurance-assets/models/tile_*.glb   格子 3D 模型（glTF 2.0 binary）
  insurance-assets/icons/icon_*.png    事件圖示（平貼在格子表面）
  insurance-assets/roles/role_*.png    角色立牌（面向鏡頭的 2D 圖）

需求：Python 3.9+、numpy、Pillow
用法：python tools/generate_assets.py          （在 Cardif_InsurHack 根目錄執行）

遊戲引擎的模型慣例（mine-monopoly GameRenderer）：
  - 1 格 = 1×1 單位，模型原點在格子中心、底部 y=0
  - 引擎會找名稱含 "base" 的 Mesh 當地面：棋子站在它頂面、事件圖示貼在它頂面 +0.01
    → 所以 "base" 必須是最上層的平面，裝飾物（prop_*）放在角落
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "insurance-assets"

# ─────────────────────────── 調色盤 ───────────────────────────
PALETTE = {
    "start":  {"main": "#2BA36B", "dark": "#1C7A4E", "light": "#CDEFDC"},  # 起點
    "salary": {"main": "#E5A823", "dark": "#B07D10", "light": "#FBEBC2"},  # 薪資格
    "shop":   {"main": "#2F6FD6", "dark": "#1F4E9C", "light": "#D3E2FA"},  # 保險商城格
    "risk":   {"main": "#D9473F", "dark": "#9E2C26", "light": "#F8D3D0"},  # 突發風險格
    "chance": {"main": "#7E57C2", "dark": "#573A91", "light": "#E4DAF5"},  # 機會命運格
}
WHITE = "#FFFFFF"
INK = "#2B2B33"


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ══════════════════════════ 3D 幾何 ══════════════════════════
class Mesh:
    """平面著色（flat shading）的三角網格：每個面有自己的頂點，邊緣俐落。"""

    def __init__(self, pos=None, nor=None):
        self.pos = np.zeros((0, 3), np.float32) if pos is None else np.asarray(pos, np.float32)
        self.nor = np.zeros((0, 3), np.float32) if nor is None else np.asarray(nor, np.float32)

    def add_tri(self, a, b, c, n=None):
        a, b, c = map(np.asarray, (a, b, c))
        if n is None:
            n = np.cross(b - a, c - a)
            ln = np.linalg.norm(n)
            n = n / ln if ln > 1e-12 else np.array([0, 1, 0])
        self.pos = np.vstack([self.pos, [a, b, c]]).astype(np.float32)
        self.nor = np.vstack([self.nor, [n, n, n]]).astype(np.float32)

    def add_quad(self, a, b, c, d):  # 逆時針
        self.add_tri(a, b, c)
        self.add_tri(a, c, d)

    def merge(self, other: "Mesh"):
        self.pos = np.vstack([self.pos, other.pos])
        self.nor = np.vstack([self.nor, other.nor])
        return self

    def transform(self, rot=(0, 0, 0), tr=(0, 0, 0), scale=(1, 1, 1)):
        rx, ry, rz = rot
        Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
        Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
        Rz = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
        R = Rz @ Ry @ Rx
        S = np.diag(scale)
        self.pos = (self.pos @ (R @ S).T + np.asarray(tr)).astype(np.float32)
        n = self.nor @ (R @ np.linalg.inv(S)).T
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        self.nor = n.astype(np.float32)
        return self


def prism_y(poly_xz, y0, y1) -> Mesh:
    """把 xz 平面上的多邊形（逆時針、對中心呈星形）沿 y 擠出。"""
    m = Mesh()
    pts = [np.array(p, float) for p in poly_xz]
    c = np.mean(pts, axis=0)
    n = len(pts)
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        # 頂面（法向 +y）與底面（法向 -y）
        m.add_tri([c[0], y1, c[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [0, 1, 0])
        m.add_tri([c[0], y0, c[1]], [p[0], y0, p[1]], [q[0], y0, q[1]], [0, -1, 0])
        # 側面
        m.add_quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]])
    return m


def rounded_rect_poly(w, d, r, seg=6):
    pts = []
    corners = [(w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90),
               (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)]
    for cx, cz, a0 in corners:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    # xz 平面中 +z 朝螢幕外；轉成從 +y 往下看為逆時針
    return [(x, -z) for x, z in pts]


def circle_poly(r, seg=24):
    return [(r * math.cos(2 * math.pi * k / seg), -r * math.sin(2 * math.pi * k / seg)) for k in range(seg)]


def box(sx, sy, sz, center=(0, 0, 0)) -> Mesh:
    poly = [(x, -z) for x, z in [(sx / 2, sz / 2), (-sx / 2, sz / 2), (-sx / 2, -sz / 2), (sx / 2, -sz / 2)]]
    m = prism_y(poly, -sy / 2, sy / 2)
    return m.transform(tr=center)


def cylinder(r, h, seg=24, base=(0, 0, 0)) -> Mesh:
    return prism_y(circle_poly(r, seg), 0, h).transform(tr=base)


def cone(r, h, seg=24, base=(0, 0, 0)) -> Mesh:
    m = Mesh()
    pts = circle_poly(r, seg)
    apex = np.array([0, h, 0])
    for i in range(seg):
        p, q = pts[i], pts[(i + 1) % seg]
        m.add_tri([q[0], 0, q[1]], [p[0], 0, p[1]], apex)
        m.add_tri([0, 0, 0], [p[0], 0, p[1]], [q[0], 0, q[1]], [0, -1, 0])
    return m.transform(tr=base)


def frustum(r0, r1, y0, y1, seg=24) -> Mesh:
    m = Mesh()
    a, b = circle_poly(r0, seg), circle_poly(r1, seg)
    for i in range(seg):
        j = (i + 1) % seg
        m.add_quad([a[j][0], y0, a[j][1]], [a[i][0], y0, a[i][1]], [b[i][0], y1, b[i][1]], [b[j][0], y1, b[j][1]])
    return m


def extrude_xy(poly_xy, depth) -> Mesh:
    """xy 平面（立起來的）多邊形，沿 z 擠出 depth，正面朝 +z。"""
    # 先在 xz 做 prism_y，再繞 x 轉 90°：y→-z… 這裡直接換座標比較直觀
    m = prism_y([(x, -y) for x, y in poly_xy], -depth / 2, depth / 2)
    return m.transform(rot=(math.pi / 2, 0, 0))


# ─────────────────────────── GLB 寫出 ───────────────────────────
class GLBWriter:
    def __init__(self):
        self.gltf = {
            "asset": {"version": "2.0", "generator": "insurance-monopoly generate_assets.py"},
            "scene": 0, "scenes": [{"name": "Scene", "nodes": []}],
            "nodes": [], "meshes": [], "materials": [],
            "accessors": [], "bufferViews": [], "buffers": [],
        }
        self.bin = bytearray()
        self._mat_cache: dict[str, int] = {}

    def material(self, hex_color: str, rough=0.75) -> int:
        key = f"{hex_color}-{rough}"
        if key in self._mat_cache:
            return self._mat_cache[key]
        r, g, b = (srgb_to_linear(c) for c in hex_rgb(hex_color))
        self.gltf["materials"].append({
            "name": f"mat_{hex_color.lstrip('#')}",
            "pbrMetallicRoughness": {"baseColorFactor": [r, g, b, 1.0], "metallicFactor": 0.0, "roughnessFactor": rough},
        })
        idx = len(self.gltf["materials"]) - 1
        self._mat_cache[key] = idx
        return idx

    def _view(self, data: bytes, target: int) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin.extend(data)
        self.gltf["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(self.gltf["bufferViews"]) - 1

    @staticmethod
    def _orient_outward(pos: np.ndarray):
        """每個零件都是凸或星形 → 讓三角面朝向「遠離零件中心」，並重算平面法向。"""
        tris = pos.reshape(-1, 3, 3).copy()
        center = pos.mean(0)
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        flip = np.einsum("ij,ij->i", n, tris.mean(1) - center) < 0
        tris[flip, 1], tris[flip, 2] = tris[flip, 2].copy(), tris[flip, 1].copy()
        n[flip] *= -1
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        n = n / np.where(ln < 1e-12, 1, ln)
        return tris.reshape(-1, 3).astype(np.float32), np.repeat(n, 3, axis=0).astype(np.float32)

    def add(self, name: str, mesh: Mesh, color: str, rough=0.75):
        pos, nor = self._orient_outward(mesh.pos.astype(np.float32))
        n = len(pos)
        idx = np.arange(n, dtype=np.uint32 if n > 65535 else np.uint16)
        bv_p = self._view(pos.tobytes(), 34962)
        bv_n = self._view(nor.tobytes(), 34962)
        bv_i = self._view(idx.tobytes(), 34963)
        acc = self.gltf["accessors"]
        acc.append({"bufferView": bv_p, "componentType": 5126, "count": n, "type": "VEC3",
                    "min": pos.min(0).tolist(), "max": pos.max(0).tolist()})
        acc.append({"bufferView": bv_n, "componentType": 5126, "count": n, "type": "VEC3"})
        acc.append({"bufferView": bv_i, "componentType": 5125 if idx.dtype == np.uint32 else 5123,
                    "count": n, "type": "SCALAR"})
        a0 = len(acc) - 3
        self.gltf["meshes"].append({"name": name, "primitives": [
            {"attributes": {"POSITION": a0, "NORMAL": a0 + 1}, "indices": a0 + 2, "material": self.material(color, rough)}]})
        self.gltf["nodes"].append({"name": name, "mesh": len(self.gltf["meshes"]) - 1})
        self.gltf["scenes"][0]["nodes"].append(len(self.gltf["nodes"]) - 1)

    def save(self, path: Path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.gltf["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(self.gltf, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942))
            f.write(self.bin)


# ─────────────────────────── 格子模型 ───────────────────────────
PLINTH_H, BASE_TOP = 0.07, 0.13
PROP_AT = (0.27, BASE_TOP, -0.27)   # 道具放在右後角，不擋棋子與圖示
PROP_SCALE = 1.6                     # 道具整體放大倍率


def tile_common(g: GLBWriter, kind: str):
    p = PALETTE[kind]
    g.add("plinth", prism_y(rounded_rect_poly(0.98, 0.98, 0.12), 0, PLINTH_H), p["dark"])
    g.add("base", prism_y(rounded_rect_poly(0.90, 0.90, 0.10), PLINTH_H, BASE_TOP), p["light"], rough=0.9)


def at_prop(m: Mesh, yaw=-math.pi / 4) -> Mesh:
    return m.transform(rot=(0, yaw, 0), tr=PROP_AT, scale=(PROP_SCALE,) * 3)


def build_start(g):
    tile_common(g, "start")
    g.add("prop_pole", at_prop(cylinder(0.014, 0.34, 12)), WHITE)
    g.add("prop_pole_cap", at_prop(prism_y(circle_poly(0.026, 12), 0.34, 0.365)), "#F6C343")
    flag = extrude_xy([(0.0, 0.33), (0.0, 0.20), (0.17, 0.265)], 0.012)
    g.add("prop_flag", at_prop(flag.transform(tr=(0.014, 0, 0))), "#F6C343")
    g.add("prop_foot", at_prop(cylinder(0.05, 0.02, 16)), PALETTE["start"]["dark"])


def build_salary(g):
    tile_common(g, "salary")
    coin, rim = "#F7C948", "#C9951B"
    for i in range(4):  # 主堆
        g.add(f"prop_coin_{i}", at_prop(cylinder(0.075, 0.026, 28, base=(0, i * 0.03, 0))), coin if i % 2 == 0 else rim)
    for i in range(2):  # 旁邊小堆
        g.add(f"prop_coin_b{i}", at_prop(cylinder(0.075, 0.026, 28, base=(-0.15, i * 0.03, 0.03))), rim if i % 2 == 0 else coin)


def shield_poly(w=0.22, h=0.26):
    pts = [(-w / 2, h * 0.5), (-w * 0.25, h * 0.56), (0, h * 0.62), (w * 0.25, h * 0.56), (w / 2, h * 0.5),
           (w / 2, h * 0.05)]
    for k in range(1, 8):  # 下方弧線收成尖角
        t = k / 8
        pts.append((w / 2 * (1 - t) ** 1.3, h * 0.05 - h * 0.43 * math.sin(t * math.pi / 2)))
    pts.append((0, -h * 0.38))
    for k in range(7, 0, -1):
        t = k / 8
        pts.append((-w / 2 * (1 - t) ** 1.3, h * 0.05 - h * 0.43 * math.sin(t * math.pi / 2)))
    pts.append((-w / 2, h * 0.05))
    return pts[::-1]  # 逆時針


def build_shop(g):
    tile_common(g, "shop")
    lift = 0.17
    # 盾牌兩面都是藍底白十字（鏡頭角度不固定）；白色外框夾在中間、外緣露出
    rim = extrude_xy(shield_poly(0.25, 0.29), 0.03).transform(tr=(0, lift, 0))
    g.add("prop_shield_rim", at_prop(rim), WHITE)
    sh = extrude_xy(shield_poly(), 0.045).transform(tr=(0, lift, 0))
    g.add("prop_shield", at_prop(sh), PALETTE["shop"]["main"], rough=0.5)
    for side, z in (("f", 0.026), ("b", -0.026)):
        g.add(f"prop_cross_v_{side}", at_prop(box(0.03, 0.11, 0.008, center=(0, lift + 0.02, z))), WHITE)
        g.add(f"prop_cross_h_{side}", at_prop(box(0.11, 0.03, 0.008, center=(0, lift + 0.02, z))), WHITE)
    g.add("prop_stand", at_prop(cylinder(0.012, lift - 0.08, 10)), "#9AA5B1")
    g.add("prop_foot", at_prop(cylinder(0.05, 0.02, 16)), PALETTE["shop"]["dark"])


def build_risk(g):
    tile_common(g, "risk")
    orange = "#F26B1D"
    g.add("prop_cone_foot", at_prop(box(0.17, 0.02, 0.17, center=(0, 0.01, 0))), orange)
    g.add("prop_cone", at_prop(cone(0.07, 0.24, 24, base=(0, 0.02, 0))), orange, rough=0.6)
    # 反光白條：依錐體在該高度的半徑做外圍環帶
    for y0, y1 in [(0.07, 0.10), (0.14, 0.165)]:
        r0 = 0.07 * (1 - (y0 - 0.02) / 0.24) + 0.002
        r1 = 0.07 * (1 - (y1 - 0.02) / 0.24) + 0.002
        g.add(f"prop_stripe_{y0}", at_prop(frustum(r0, r1, y0, y1)), WHITE)


def build_chance(g):
    tile_common(g, "chance")
    s = 0.15
    gift = "#F6C343"
    ribbon = PALETTE["chance"]["main"]
    g.add("prop_gift", at_prop(box(s, s * 0.85, s, center=(0, s * 0.425, 0))), gift)
    g.add("prop_lid", at_prop(box(s * 1.1, s * 0.2, s * 1.1, center=(0, s * 0.95, 0))), gift)
    g.add("prop_ribbon_a", at_prop(box(s * 0.22, s * 1.07, s * 1.12, center=(0, s * 0.53, 0))), ribbon)
    g.add("prop_ribbon_b", at_prop(box(s * 1.12, s * 1.07, s * 0.22, center=(0, s * 0.53, 0))), ribbon)
    bow = extrude_xy([(0, 0), (-0.06, 0.045), (-0.065, -0.01)], 0.02)
    bow2 = extrude_xy([(0, 0), (0.065, -0.01), (0.06, 0.045)], 0.02)
    g.add("prop_bow_l", at_prop(bow.transform(tr=(0, s * 1.06, 0))), ribbon)
    g.add("prop_bow_r", at_prop(bow2.transform(tr=(0, s * 1.06, 0))), ribbon)


BUILDERS = {"start": build_start, "salary": build_salary, "shop": build_shop, "risk": build_risk, "chance": build_chance}


# ══════════════════════════ 2D 圖片 ══════════════════════════
SS = 4  # 超取樣倍率，畫大再縮小 → 邊緣平滑


def font(size, bold=True):
    cands = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf",
             "/Library/Fonts/Arial Bold.ttf", "DejaVuSans-Bold.ttf", "arialbd.ttf"]
    for c in cands:
        try:
            return ImageFont.truetype(c, size)
        except OSError:
            continue
    return ImageFont.load_default()


def finish(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


# ─────────────────────────── 事件圖示 ───────────────────────────
def make_icon(kind: str, size=512) -> Image.Image:
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p = PALETTE[kind]
    cx = cy = S / 2
    R = S * 0.30  # 圖示只佔中間，邊緣透明（模型 base 只有 0.9 寬）
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=WHITE, outline=p["main"], width=int(S * 0.028))
    col = p["main"]
    if kind == "salary":
        f = font(int(S * 0.36))
        d.text((cx, cy + S * 0.01), "$", font=f, fill=col, anchor="mm")
    elif kind == "chance":
        f = font(int(S * 0.36))
        d.text((cx, cy + S * 0.01), "?", font=f, fill=col, anchor="mm")
    elif kind == "risk":
        t = S * 0.2
        tri = [(cx, cy - t * 0.95), (cx + t * 1.0, cy + t * 0.75), (cx - t * 1.0, cy + t * 0.75)]
        d.polygon(tri, fill=col)
        f = font(int(S * 0.2))
        d.text((cx, cy + t * 0.18), "!", font=f, fill=WHITE, anchor="mm")
    elif kind == "shop":
        sc = S * 0.95
        poly = [(cx + x * sc, cy - y * sc - S * 0.03) for x, y in shield_poly(0.36, 0.42)]
        d.polygon(poly, fill=col)
        a, b = S * 0.022, S * 0.085
        oy = cy - S * 0.045
        d.rectangle([cx - a, oy - b, cx + a, oy + b], fill=WHITE)
        d.rectangle([cx - b, oy - a, cx + b, oy + a], fill=WHITE)
    elif kind == "start":
        a = S * 0.17
        arrow = [(cx - a, cy - a * 0.35), (cx + a * 0.15, cy - a * 0.35), (cx + a * 0.15, cy - a * 0.85),
                 (cx + a * 1.05, cy), (cx + a * 0.15, cy + a * 0.85), (cx + a * 0.15, cy + a * 0.35),
                 (cx - a, cy + a * 0.35)]
        d.polygon(arrow, fill=col)
    return finish(img, size)


# ─────────────────────────── 角色立牌 ───────────────────────────
OUTW = 14 * SS // 4 * 4  # 外框寬度（超取樣後）


class Painter:
    def __init__(self, size=512):
        self.S = size * SS
        self.size = size
        self.img = Image.new("RGBA", (self.S, self.S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    # 所有座標用 0~1 的比例，方便調整
    def P(self, x, y):
        return (x * self.S, y * self.S)

    def box(self, x0, y0, x1, y1, fill, r=0.03, outline=INK):
        self.d.rounded_rectangle([*self.P(x0, y0), *self.P(x1, y1)], radius=r * self.S, fill=fill,
                                 outline=outline, width=OUTW if outline else 0)

    def oval(self, x0, y0, x1, y1, fill, outline=INK, w=None):
        self.d.ellipse([*self.P(x0, y0), *self.P(x1, y1)], fill=fill, outline=outline,
                       width=(OUTW if w is None else w) if outline else 0)

    def poly(self, pts, fill, outline=INK):
        self.d.polygon([self.P(x, y) for x, y in pts], fill=fill, outline=outline, width=OUTW if outline else 0)

    def line(self, pts, fill=INK, w=None):
        self.d.line([self.P(x, y) for x, y in pts], fill=fill, width=w or OUTW, joint="curve")

    def arc(self, x0, y0, x1, y1, a0, a1, fill=INK, w=None):
        self.d.arc([*self.P(x0, y0), *self.P(x1, y1)], a0, a1, fill=fill, width=w or OUTW)

    def done(self):
        return finish(self.img, self.size)


SKIN = "#FFD9B8"


def person(pt: Painter, cx, foot_y, k, *, top, bottom, hair, hair_style="short", shoes=INK,
           skin=SKIN, hood=False):
    """畫一個 Q 版人物。cx: 中心 x、foot_y: 腳底 y、k: 縮放（1 = 佔滿立牌高度）。"""
    def X(v):
        return cx + v * k

    def Y(v):
        return foot_y - v * k
    # 腿與鞋
    for s in (-1, 1):
        pt.box(X(s * 0.07 - 0.045), Y(0.30), X(s * 0.07 + 0.045), Y(0.03), bottom, r=0.02 * k)
        pt.oval(X(s * 0.07 - 0.065), Y(0.06), X(s * 0.07 + 0.06), Y(0.0), shoes)
    # 手臂
    for s in (-1, 1):
        pt.box(X(s * 0.19 - 0.045), Y(0.56), X(s * 0.19 + 0.045), Y(0.30), top, r=0.04 * k)
        pt.oval(X(s * 0.19 - 0.04), Y(0.33), X(s * 0.19 + 0.04), Y(0.26), skin)
    # 身體
    pt.box(X(-0.17), Y(0.60), X(0.17), Y(0.26), top, r=0.07 * k)
    if hood:
        pt.oval(X(-0.13), Y(0.64), X(0.13), Y(0.54), top)
    # 長髮在頭後面
    if hair_style == "long":
        pt.box(X(-0.20), Y(0.92), X(0.20), Y(0.50), hair, r=0.10 * k)
    # 頭
    pt.oval(X(-0.22), Y(1.00), X(0.22), Y(0.56), hair)            # 頭髮外輪廓
    pt.oval(X(-0.195), Y(0.90), X(0.195), Y(0.56), skin)          # 臉
    if hair_style in ("short", "long"):
        pt.poly([(X(-0.20), Y(0.84)), (X(-0.12), Y(0.93)), (X(0.05), Y(0.95)), (X(0.20), Y(0.86)),
                 (X(0.17), Y(0.80)), (X(0.02), Y(0.84)), (X(-0.10), Y(0.80))], hair, outline=None)
    # 五官
    for s in (-1, 1):
        pt.oval(X(s * 0.085 - 0.022), Y(0.76), X(s * 0.085 + 0.022), Y(0.71), INK, outline=None)
        pt.oval(X(s * 0.085 - 0.009 + 0.006), Y(0.755), X(s * 0.085 + 0.006), Y(0.74), WHITE, outline=None)
        pt.oval(X(s * 0.13 - 0.03), Y(0.69), X(s * 0.13 + 0.03), Y(0.665), "#FFB3A7", outline=None)
    pt.arc(X(-0.045), Y(0.70), X(0.045), Y(0.645), 20, 160, w=max(4, OUTW * 3 // 4))
    return X, Y


def role_freshman():
    pt = Painter()
    X, Y = person(pt, 0.5, 0.97, 1.0, top=WHITE, bottom="#2E3A59", hair="#2B2420")
    pt.poly([(X(-0.025), Y(0.60)), (X(0.025), Y(0.60)), (X(0.035), Y(0.40)), (X(0), Y(0.35)), (X(-0.035), Y(0.40))],
            "#2F4F8F")                                              # 領帶
    pt.line([(X(-0.10), Y(0.60)), (X(-0.09), Y(0.45))], "#2F6FD6")  # 識別證掛繩
    pt.box(X(-0.14), Y(0.46), X(-0.04), Y(0.36), "#D3E2FA", r=0.01)  # 識別證
    return pt.done()


def role_freelancer():
    pt = Painter()
    X, Y = person(pt, 0.5, 0.97, 1.0, top="#F28C28", bottom="#4A5568", hair="#6B4226", hood=True)
    pt.d.pieslice([*pt.P(X(-0.215), Y(1.02)), *pt.P(X(0.215), Y(0.70))], 180, 360, fill="#2C7A7B",
                  outline=INK, width=OUTW)                          # 毛帽
    pt.box(X(-0.22), Y(0.88), X(0.22), Y(0.84), "#236465", r=0.02)
    pt.oval(X(-0.04), Y(1.06), X(0.04), Y(0.99), "#F6E05E")         # 毛球
    pt.box(X(-0.16), Y(0.42), X(0.16), Y(0.30), "#A0AEC0", r=0.015)  # 筆電
    pt.oval(X(-0.02), Y(0.38), X(0.02), Y(0.34), WHITE, outline=None)
    return pt.done()


def role_engineer():
    pt = Painter()
    X, Y = person(pt, 0.5, 0.97, 1.0, top="#4A5568", bottom="#2D3748", hair="#3B2A1E", hood=True)
    for s in (-1, 1):                                               # 眼鏡
        pt.oval(X(s * 0.085 - 0.055), Y(0.79), X(s * 0.085 + 0.055), Y(0.68), None)
    pt.line([(X(-0.03), Y(0.74)), (X(0.03), Y(0.74))])
    pt.box(X(0.17), Y(0.40), X(0.27), Y(0.27), WHITE, r=0.015)      # 咖啡杯
    pt.box(X(0.17), Y(0.36), X(0.27), Y(0.31), "#8B5A2B", r=0.005, outline=None)
    pt.d.text(pt.P(X(0), Y(0.46)), "</>", font=font(int(pt.S * 0.06)), fill="#68D391", anchor="mm")
    return pt.done()


def role_family():
    pt = Painter()
    person(pt, 0.30, 0.97, 0.66, top="#38A169", bottom="#2D3748", hair="#2B2420")
    person(pt, 0.70, 0.97, 0.66, top="#ED64A6", bottom="#4A5568", hair="#5A3A22", hair_style="long")
    person(pt, 0.50, 0.985, 0.42, top="#F6C343", bottom="#3182CE", hair="#2B2420")
    return pt.done()


ROLES = {
    "freshman": role_freshman,      # 新鮮人小資族
    "freelancer": role_freelancer,  # 斜槓自由業者
    "engineer": role_engineer,      # 科技業工程師
    "family": role_family,          # 雙薪小家庭
}


def main():
    for sub in ("models", "icons", "roles"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    for kind, build in BUILDERS.items():
        g = GLBWriter()
        build(g)
        g.save(OUT / "models" / f"tile_{kind}.glb")
        make_icon(kind).save(OUT / "icons" / f"icon_{kind}.png")
    for name, fn in ROLES.items():
        fn().save(OUT / "roles" / f"role_{name}.png")
    print("完成，輸出於", OUT)


if __name__ == "__main__":
    main()

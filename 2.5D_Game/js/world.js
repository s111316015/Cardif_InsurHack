/* =========================================================
   像素風現代城市（Three.js）
   - 一整片連續的街道：柏油路、磚紅人行道、斑馬線、路燈、紅綠燈
   - 事件格畫在馬路上，串成一條不規則的環狀路線
   - 所有貼圖都是程式即時畫的像素圖（每 1 世界單位 = 24 像素）
   - 靜態物件依材質合併，手機上也只有幾十次繪製
   ========================================================= */
const World = (() => {
  let seed = 7310;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const TX = 24;                                    // 每世界單位的貼圖像素數

  function shade(hex, f){
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(n >> 16)},${c(n >> 8 & 255)},${c(n & 255)})`;
  }

  /* =======================================================
     1. 像素貼圖工具
     ======================================================= */
  function pixelTexture(w, h, draw, { wrap = true } = {}){
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function speckle(g, w, h, colors, amount){
    for (let i = 0; i < w * h * amount; i++){
      g.fillStyle = pick(colors);
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
  }
  function drawIcon(g, name, ox, oy, scale, col){
    ICONS[name].forEach((row, v) => [...row].forEach((ch, u) => {
      if (ch === '.') return;
      g.fillStyle = ch === 'o' ? '#ffffff' : col;
      g.fillRect(ox + u * scale, oy + v * scale, scale, scale);
    }));
  }

  /* 立方體：把貼圖重複次數寫進 UV（材質可共用 → 可合併）
     rep = { x:[u,v,top], y:[u,v], z:[u,v,top] }；top = 貼圖上緣對齊頂端 */
  function boxGeo(w, h, d, rep = {}){
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv, axes = ['x', 'x', 'y', 'y', 'z', 'z'];
    for (let f = 0; f < 6; f++){
      const r = rep[axes[f]]; if (!r) continue;
      const [ru, rv, top] = r;
      for (let i = f * 4; i < f * 4 + 4; i++)
        uv.setXY(i, uv.getX(i) * ru, top ? 1 - (1 - uv.getY(i)) * rv : uv.getY(i) * rv);
    }
    return geo;
  }

  /* 地面方格：UV 直接用世界座標，相鄰格子的貼圖會無縫接起來 */
  function groundQuad(x, z, y = 0, s = 1){
    const g = new THREE.PlaneGeometry(s, s);
    g.rotateX(-Math.PI / 2);
    g.translate(x + 0.5, y, z + 0.5);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    return g;
  }

  /* =======================================================
     2. 材質
     ======================================================= */
  const matCache = new Map();
  function mat(key, make){ if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); }
  const colorMat = hex => mat('c' + hex, () => new THREE.MeshLambertMaterial({ color: hex }));
  const texMat = (tex, extra = {}) => mat('t' + tex.uuid, () => new THREE.MeshLambertMaterial({ map: tex, ...extra }));
  const glowMat = tex => mat('g' + tex.uuid, () => new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.85 }));

  /* ---------- 地面 ---------- */
  const asphalt = pixelTexture(TX, TX, (g, w, h) => {
    g.fillStyle = '#4f5562'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, ['#484e5a', '#575d6a', '#5e6471'], 0.3);
  });
  const T = {
    asphalt,
    sidewalk: pixelTexture(TX, TX, (g, w, h) => {
      g.fillStyle = '#d3cbd0'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, ['#cbc3c8', '#dad3d7'], 0.2);
      g.fillStyle = '#bab1b7';
      for (let y = 0; y < h; y += 6){
        g.fillRect(0, y, w, 1);
        for (let x = (y / 6) % 2 ? 0 : 6; x < w; x += 12) g.fillRect(x, y, 1, 6);
      }
    }),
    plaza: pixelTexture(TX, TX, (g, w, h) => {
      g.fillStyle = '#e4e0d8'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, ['#dcd7ce', '#ebe8e1'], 0.2);
      g.fillStyle = '#cdc7bc'; g.fillRect(0, 0, w, 1); g.fillRect(0, 12, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(12, 0, 1, h);
    }),
    grass: pixelTexture(TX, TX, (g, w, h) => {
      g.fillStyle = '#86c35f'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, ['#7cb957', '#92cd6b', '#73ae50'], 0.35);
      speckle(g, w, h, ['#fff4a8', '#ffc9dc', '#ffffff'], 0.012);
    }),
    curb: pixelTexture(TX, 4, (g, w, h) => {
      g.fillStyle = '#e2dde0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#a69ea4'; g.fillRect(0, h - 1, w, 1);
    }),
    // 支線道路中央虛線 / 斑馬線（沿 x 方向、沿 z 方向各一張）
    laneX: pixelTexture(TX, TX, (g, w, h) => {
      g.drawImage(asphalt.image, 0, 0);
      g.fillStyle = '#e9e3c5'; for (let x = 2; x < w; x += 12) g.fillRect(x, 11, 6, 2);
    }),
    laneZ: pixelTexture(TX, TX, (g, w, h) => {
      g.drawImage(asphalt.image, 0, 0);
      g.fillStyle = '#e9e3c5'; for (let y = 2; y < h; y += 12) g.fillRect(11, y, 2, 6);
    }),
    zebraX: pixelTexture(TX, TX, (g, w, h) => {
      g.drawImage(asphalt.image, 0, 0);
      g.fillStyle = '#f2efe6'; for (let y = 2; y < h; y += 5) g.fillRect(3, y, w - 6, 3);
    }),
    zebraZ: pixelTexture(TX, TX, (g, w, h) => {
      g.drawImage(asphalt.image, 0, 0);
      g.fillStyle = '#f2efe6'; for (let x = 2; x < w; x += 5) g.fillRect(x, 3, 3, h - 6);
    }),
  };

  /* ---------- 建築立面（1 世界單位 = 24px，一層樓 12px） ---------- */
  const FACADES = [
    // 玻璃帷幕：藍綠色玻璃 + 斜向反光
    ...[['#5f8fae', '#3f6178'], ['#6aa3a6', '#467072'], ['#7d93b8', '#566a8c']].map(([glass, mull]) =>
      pixelTexture(TX, TX, g => {
        g.fillStyle = glass; g.fillRect(0, 0, TX, TX);
        g.fillStyle = shade(glass, 1.18); for (let i = 0; i < TX; i++) g.fillRect((i + 6) % TX, i, 3, 1);
        g.fillStyle = mull;
        for (let x = 0; x < TX; x += 6) g.fillRect(x, 0, 1, TX);
        g.fillRect(0, 11, TX, 2); g.fillRect(0, 23, TX, 1);
      })),
    // 辦公大樓：水泥 + 橫向窗帶
    ...[['#cfc8bd', '#3f5672'], ['#b9c2c9', '#465a70'], ['#e1d6c2', '#5a6a7e']].map(([wall, win]) =>
      pixelTexture(TX, TX, g => {
        g.fillStyle = wall; g.fillRect(0, 0, TX, TX);
        for (const y of [3, 15]){
          g.fillStyle = win; g.fillRect(1, y, TX - 2, 6);
          g.fillStyle = shade(win, 1.5); for (let x = 2; x < TX - 2; x += 5) g.fillRect(x, y, 2, 1);
          g.fillStyle = wall; for (let x = 6; x < TX; x += 6) g.fillRect(x, y, 1, 6);
        }
        g.fillStyle = shade(wall, 0.85); g.fillRect(0, 11, TX, 1); g.fillRect(0, 23, TX, 1);
      })),
    // 住商公寓：磚牆 + 白框窗 + 冷氣
    ...[['#b97a68', '#2f3a4c'], ['#c99a73', '#33405a'], ['#8f8a9b', '#2d3446']].map(([wall, win]) =>
      pixelTexture(TX, TX, g => {
        g.fillStyle = wall; g.fillRect(0, 0, TX, TX);
        speckle(g, TX, TX, [shade(wall, 0.92), shade(wall, 1.06)], 0.25);
        for (const y of [3, 15]) for (const x of [2, 14]){
          g.fillStyle = '#f2ece2'; g.fillRect(x - 1, y - 1, 9, 7);
          g.fillStyle = rnd() < 0.35 ? '#ffd98a' : win; g.fillRect(x, y, 7, 5);
          g.fillStyle = '#f2ece2'; g.fillRect(x + 3, y, 1, 5);
        }
        g.fillStyle = '#e8e8e8'; g.fillRect(17, 9, 4, 2);
      })),
  ];
  const SHOPFRONTS = ['#e85d5d', '#2e9e6b', '#4a90e2', '#f5a623', '#8e6bd6', '#3b3b46'].map(band =>
    pixelTexture(TX, 14, g => {
      g.fillStyle = '#e9e4dc'; g.fillRect(0, 0, TX, 14);
      g.fillStyle = band; g.fillRect(0, 0, TX, 4);
      g.fillStyle = '#ffffff'; for (let x = 3; x < 20; x += 4) g.fillRect(x, 1, 2, 2);   // 招牌字
      g.fillStyle = '#9fd0e6'; g.fillRect(1, 5, 14, 9);
      g.fillStyle = '#d6eef8'; g.fillRect(2, 6, 3, 2);
      g.fillStyle = '#5c4636'; g.fillRect(17, 6, 6, 8);
      g.fillStyle = '#c9a76b'; g.fillRect(21, 10, 1, 1);
    }));
  const AWNINGS = ['#e85d5d', '#2e9e6b', '#4a90e2', '#f5a623'].map(col =>
    pixelTexture(TX, 6, g => {
      for (let x = 0; x < TX; x++){ g.fillStyle = (x >> 2) % 2 ? '#ffffff' : col; g.fillRect(x, 0, 1, 6); }
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 5, TX, 1);
    }));
  // 霓虹直式招牌（亂數像素字，營造亞洲街景感）
  const NEON = [['#ff7eb6', '#2a2233'], ['#7ef0ff', '#1f2a36'], ['#ffe27a', '#33251f'], ['#9dff8a', '#1f2b22'], ['#ffffff', '#c23a4a']].map(([fg, bg]) =>
    pixelTexture(8, 24, g => {
      g.fillStyle = bg; g.fillRect(0, 0, 8, 24);
      g.fillStyle = fg; g.fillRect(0, 0, 8, 1); g.fillRect(0, 23, 8, 1);
      for (let y = 2; y < 22; y += 5) for (let i = 0; i < 9; i++) if (rnd() < 0.6) g.fillRect(2 + (i % 3) * 1.5 | 0, y + (i / 3 | 0), 1, 1);
      for (let y = 2; y < 22; y += 5){ g.fillRect(2, y, 4, 1); if (rnd() < 0.7) g.fillRect(3, y + 1, 1, 3); if (rnd() < 0.7) g.fillRect(5, y + 2, 1, 2); }
    }));
  const ROOF = ['#8d929c', '#7f8a86', '#9a948c'];

  /* =======================================================
     3. 物件
     ======================================================= */
  function addMesh(parent, geo, material, x, y, z, { cast = true, receive = true } = {}){
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m);
    return m;
  }

  function building(parent, cx, cz, h, faceX, faceZ){
    const fw = 0.9, shopH = 0.58;
    const facade = pick(FACADES), roof = colorMat(pick(ROOF));
    const showShop = h > 0.9;
    const upper = showShop ? h - shopH : h;
    const wall = texMat(facade);
    // 一樓店面
    if (showShop){
      const shopMat = texMat(pick(SHOPFRONTS));
      addMesh(parent, boxGeo(fw, shopH, fw, { x: [fw, 1], z: [fw, 1] }), [shopMat, shopMat, roof, roof, shopMat, shopMat], cx, shopH / 2, cz);
      if (faceZ) addMesh(parent, boxGeo(fw * 0.9, 0.05, 0.22, { x: [0.22, 0.2], z: [0.9, 1], y: [1, 1] }), texMat(pick(AWNINGS)), cx, shopH * 0.82, cz + fw / 2 + 0.1);
      if (faceX) addMesh(parent, boxGeo(0.22, 0.05, fw * 0.9, { x: [0.9, 1], z: [0.22, 0.2], y: [1, 1] }), texMat(pick(AWNINGS)), cx + fw / 2 + 0.1, shopH * 0.82, cz);
    }
    // 上層
    const y0 = showShop ? shopH : 0;
    addMesh(parent, boxGeo(fw, upper, fw, { x: [fw, upper, true], z: [fw, upper, true] }), [wall, wall, roof, roof, wall, wall], cx, y0 + upper / 2, cz);
    // 屋頂女兒牆 + 設備
    const rim = colorMat('#c9c6c0');
    addMesh(parent, new THREE.BoxGeometry(fw, 0.08, 0.06), rim, cx, h + 0.04, cz + fw / 2 - 0.03);
    addMesh(parent, new THREE.BoxGeometry(0.06, 0.08, fw), rim, cx + fw / 2 - 0.03, h + 0.04, cz);
    if (rnd() < 0.6) addMesh(parent, new THREE.BoxGeometry(0.26, 0.16, 0.2), colorMat('#b7bec7'), cx - 0.15, h + 0.08, cz - 0.1);
    if (rnd() < 0.3) addMesh(parent, new THREE.CylinderGeometry(0.1, 0.1, 0.28, 6), colorMat('#d2bf96'), cx + 0.18, h + 0.14, cz - 0.2);
    if (h > 3 && rnd() < 0.4) addMesh(parent, new THREE.BoxGeometry(0.03, 0.7, 0.03), colorMat('#5b5f68'), cx - 0.3, h + 0.35, cz + 0.3);
    // 霓虹招牌（掛在面向鏡頭的牆上）
    if (h > 1.6 && rnd() < 0.55){
      const neon = glowMat(pick(NEON)), sh = Math.min(1.4, h - 0.9);
      if (faceZ || rnd() < 0.5) addMesh(parent, boxGeo(0.28, sh, 0.06, { z: [1, 1] }), neon, cx + 0.22, shopH + 0.15 + sh / 2, cz + fw / 2 + 0.05, { cast: false });
      else addMesh(parent, boxGeo(0.06, sh, 0.28, { x: [1, 1] }), neon, cx + fw / 2 + 0.05, shopH + 0.15 + sh / 2, cz - 0.22, { cast: false });
    }
  }

  function tree(parent, x, z, s = 1){
    addMesh(parent, new THREE.BoxGeometry(0.1 * s, 0.42 * s, 0.1 * s), colorMat('#7a5235'), x, 0.21 * s, z);
    addMesh(parent, new THREE.BoxGeometry(0.56 * s, 0.38 * s, 0.56 * s), colorMat(pick(['#3f8f4a', '#4a9a4f'])), x, 0.58 * s, z);
    addMesh(parent, new THREE.BoxGeometry(0.4 * s, 0.28 * s, 0.4 * s), colorMat(pick(['#5fb05f', '#6cc06a'])), x - 0.03, 0.86 * s, z - 0.03);
  }
  function planter(parent, x, z){
    addMesh(parent, new THREE.BoxGeometry(0.26, 0.16, 0.26), colorMat('#9b9a96'), x, 0.08, z);
    addMesh(parent, new THREE.BoxGeometry(0.22, 0.14, 0.22), colorMat('#5aa65a'), x, 0.22, z);
  }
  function bench(parent, x, z, alongX){
    const wood = colorMat('#a8724a'), iron = colorMat('#3c3f47');
    const [w, d] = alongX ? [0.6, 0.18] : [0.18, 0.6];
    addMesh(parent, new THREE.BoxGeometry(w, 0.05, d), wood, x, 0.2, z);
    addMesh(parent, new THREE.BoxGeometry(alongX ? w : 0.04, 0.16, alongX ? 0.04 : d), wood, x - (alongX ? 0 : 0.08), 0.32, z - (alongX ? 0.08 : 0));
    addMesh(parent, new THREE.BoxGeometry(alongX ? 0.04 : d * 0.1, 0.18, alongX ? d : 0.04), iron, x - (alongX ? w / 2 - 0.05 : 0), 0.09, z - (alongX ? 0 : d / 2 - 0.05));
    addMesh(parent, new THREE.BoxGeometry(alongX ? 0.04 : d * 0.1, 0.18, alongX ? d : 0.04), iron, x + (alongX ? w / 2 - 0.05 : 0), 0.09, z + (alongX ? 0 : d / 2 - 0.05));
  }
  function streetLamp(parent, x, z){
    addMesh(parent, new THREE.BoxGeometry(0.05, 1.1, 0.05), colorMat('#3c3f47'), x, 0.55, z);
    addMesh(parent, new THREE.BoxGeometry(0.22, 0.05, 0.05), colorMat('#3c3f47'), x + 0.09, 1.1, z);
    addMesh(parent, new THREE.BoxGeometry(0.12, 0.06, 0.1),
      mat('lampHead', () => new THREE.MeshLambertMaterial({ color: '#fff4c8', emissive: '#ffe79a', emissiveIntensity: 0.9 })), x + 0.18, 1.07, z, { cast: false });
  }
  function trafficLight(parent, x, z){
    const dark = colorMat('#2f323a');
    addMesh(parent, new THREE.BoxGeometry(0.05, 0.95, 0.05), dark, x, 0.475, z);
    addMesh(parent, new THREE.BoxGeometry(0.12, 0.32, 0.1), dark, x, 1.05, z);
    const lamp = (c) => mat('tl' + c, () => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 }));
    ['#ff5a4f', '#ffcc33', '#3ee07a'].forEach((c, i) =>
      addMesh(parent, new THREE.BoxGeometry(0.07, 0.06, 0.02), lamp(c), x, 1.15 - i * 0.09, z + 0.06, { cast: false }));
  }
  function kiosk(parent, x, z){
    const sign = pixelTexture(TX, 8, g => {
      g.fillStyle = '#4a3326'; g.fillRect(0, 0, TX, 8);
      g.fillStyle = '#f6e7c8';
      // C A F E（像素字）
      const L = { C:["xxx","x..","x..","x..","xxx"], A:[".x.","x.x","xxx","x.x","x.x"], F:["xxx","x..","xx.","x..","x.."], E:["xxx","x..","xx.","x..","xxx"] };
      [...'CAFE'].forEach((ch, i) => L[ch].forEach((r, y) => [...r].forEach((c, x) => { if (c === 'x') g.fillRect(3 + i * 5 + x, 1 + y, 1, 1); })));
    }, { wrap: false });
    const wood = colorMat('#7a5236');
    addMesh(parent, new THREE.BoxGeometry(0.7, 0.55, 0.5), wood, x, 0.275, z);
    addMesh(parent, new THREE.BoxGeometry(0.62, 0.06, 0.4), colorMat('#d9c09a'), x, 0.58, z);
    addMesh(parent, boxGeo(0.8, 0.06, 0.62, { x: [0.62, 0.25], z: [0.8, 0.25], y: [1, 1] }), texMat(AWNINGS[0]), x, 0.95, z);
    addMesh(parent, new THREE.BoxGeometry(0.04, 0.36, 0.04), wood, x - 0.36, 0.77, z + 0.28);
    addMesh(parent, new THREE.BoxGeometry(0.04, 0.36, 0.04), wood, x + 0.36, 0.77, z + 0.28);
    addMesh(parent, new THREE.BoxGeometry(0.6, 0.2, 0.04), [wood, wood, wood, wood, texMat(sign), wood], x, 1.1, z + 0.3, { cast: false });
  }


  /* =======================================================
     3b. 臺北街景：老公寓、騎樓、鐵窗、鐵皮加蓋、中文招牌、機車
     ======================================================= */
  const ZH_FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans CJK TC","Noto Sans TC","Heiti TC",sans-serif';
  const SHOP_WORDS = ['珍珠奶茶','牛肉麵','滷肉飯','鹹酥雞','早餐店','藥局','診所','眼鏡','書局','豆花',
                      '便當','水煎包','五金行','麵包店','KTV','手機','房屋仲介','補習班','當舖','火鍋'];
  const SIGN_COLORS = [['#d8322f','#fff6e0'],['#f3c537','#3a2412'],['#ffffff','#c42727'],['#1f6fb5','#ffffff'],
                       ['#2f8f4e','#ffffff'],['#ff7a1f','#ffffff'],['#2b2b33','#ffe36a'],['#7b3fb8','#ffffff']];

  // 用真正的中文字畫招牌（貼圖解析度較高，字才看得出來）
  function signTexture(text, bg, fg, vertical){
    const n = [...text].length;
    const w = vertical ? 16 : Math.max(36, n * 13 + 8), h = vertical ? n * 14 + 6 : 16;
    return pixelTexture(w, h, g => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = `900 12px ${ZH_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (vertical) [...text].forEach((ch, i) => g.fillText(ch, w / 2, 3 + 7 + i * 14));
      else g.fillText(text, w / 2, h / 2 + 1);
      g.strokeStyle = fg; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    }, { wrap: false });
  }
  // 預先做好固定數量的招牌（每個詞配一種顏色），重複使用 → 可合併繪製
  const makeSign = (word, i, vertical) => {
    const [bg, fg] = SIGN_COLORS[(i * 3 + (vertical ? 1 : 0)) % SIGN_COLORS.length];
    const tex = signTexture(vertical ? word.slice(0, 4) : word, bg, fg, vertical);
    return { mat: new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }),
             aspect: tex.image.width / tex.image.height };
  };
  const H_SIGNS = SHOP_WORDS.map((w, i) => makeSign(w, i, false));
  const V_SIGNS = SHOP_WORDS.filter(w => [...w].length >= 2).slice(0, 12).map((w, i) => makeSign(w, i, true));
  const signMat = vertical => pick(vertical ? V_SIGNS : H_SIGNS);

  // 老公寓外牆：小方塊磁磚 + 鐵窗（每 12px 一層樓）
  const APT_TEX = ['#e9e2d3','#d9cfbf','#c9b79f','#e3d7c2','#c3c6c1','#d6bfae','#b8a48c'].map(tile =>
    pixelTexture(TX, TX, g => {
      g.fillStyle = tile; g.fillRect(0, 0, TX, TX);
      g.fillStyle = shade(tile, 0.93);
      for (let i = 0; i < TX; i += 3){ g.fillRect(i, 0, 1, TX); g.fillRect(0, i, TX, 1); }
      for (const y of [2, 14]) for (const x of [2, 13]){
        g.fillStyle = '#46505e'; g.fillRect(x, y, 9, 7);                     // 窗
        g.fillStyle = pick(['#c9d8e6', '#e8d4a8', '#b8c9a8', '#d9b8b8']);    // 窗簾
        g.fillRect(x + 1, y + 1, 3, 5);
        g.fillStyle = '#7b8088';                                             // 鐵窗
        for (let i = 0; i <= 9; i += 2) g.fillRect(x + i, y - 1, 1, 9);
        g.fillRect(x - 1, y - 1, 11, 1); g.fillRect(x - 1, y + 3, 11, 1); g.fillRect(x - 1, y + 7, 11, 1);
      }
      g.fillStyle = shade(tile, 0.8); g.fillRect(0, 11, TX, 1); g.fillRect(0, 23, TX, 1);
    }));
  // 屋頂鐵皮加蓋：浪板條紋
  const TIN_TEX = ['#4f7fb3', '#5f9b70', '#a65e3c', '#d6dadd', '#3f8f9a'].map(col =>
    pixelTexture(TX, TX, g => {
      for (let x = 0; x < TX; x++){ g.fillStyle = x % 3 === 0 ? shade(col, 0.78) : x % 3 === 1 ? col : shade(col, 1.12); g.fillRect(x, 0, 1, TX); }
      g.fillStyle = shade(col, 0.6); g.fillRect(0, TX - 1, TX, 1);
    }));
  // 騎樓內的店面（較暗，像在陰影裡）
  const ARCADE_TEX = SHOPFRONTS.map(t => t);

  function taipeiApartment(parent, cx, cz, h, faceX, faceZ){
    const fw = 0.92, arcadeH = 0.5, inset = 0.24;
    const wall = texMat(pick(APT_TEX)), roof = colorMat('#9a9893');
    // 一樓騎樓：店面往內縮，外側留柱子，上面的樓層蓋出去
    const sx = faceX ? fw - inset : fw, sz = faceZ ? fw - inset : fw;
    const shop = texMat(pick(ARCADE_TEX), {});
    addMesh(parent, boxGeo(sx, arcadeH, sz, { x: [1, 1], z: [1, 1] }), [shop, shop, roof, roof, shop, shop],
      cx - (faceX ? inset / 2 : 0), arcadeH / 2, cz - (faceZ ? inset / 2 : 0));
    const pillar = colorMat('#cfc6b6');
    const ps = [];
    if (faceZ){ ps.push([cx - fw / 2 + 0.05, cz + fw / 2 - 0.05], [cx + 0.02, cz + fw / 2 - 0.05]); }
    if (faceX){ ps.push([cx + fw / 2 - 0.05, cz - fw / 2 + 0.05], [cx + fw / 2 - 0.05, cz + 0.02]); }
    if (faceX || faceZ) ps.push([cx + fw / 2 - 0.05, cz + fw / 2 - 0.05]);
    ps.forEach(([x, z]) => addMesh(parent, new THREE.BoxGeometry(0.09, arcadeH, 0.09), pillar, x, arcadeH / 2, z));
    // 樓上
    const up = h - arcadeH;
    addMesh(parent, boxGeo(fw, up, fw, { x: [fw, up, true], z: [fw, up, true] }), [wall, wall, roof, roof, wall, wall], cx, arcadeH + up / 2, cz);
    // 屋頂：鐵皮加蓋 + 不鏽鋼水塔
    if (rnd() < 0.7){
      const tin = texMat(pick(TIN_TEX)), th = 0.28;
      addMesh(parent, boxGeo(fw * 0.7, th, fw * 0.6, { x: [0.6, 0.3, true], z: [0.7, 0.3, true] }), [tin, tin, tin, tin, tin, tin],
        cx - 0.08, h + th / 2, cz - 0.1);
    }
    if (rnd() < 0.8){
      const steel = colorMat('#cfd6dc');
      addMesh(parent, new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8), steel, cx + 0.24, h + 0.2, cz + 0.2);
      addMesh(parent, new THREE.BoxGeometry(0.2, 0.07, 0.2), colorMat('#6b6f76'), cx + 0.24, h + 0.035, cz + 0.2);
    }
    // 外牆冷氣
    for (let i = 0; i < 2; i++) if (rnd() < 0.6){
      const y = arcadeH + 0.18 + Math.floor(rnd() * Math.max(1, up / 0.5)) * 0.5;
      if (y > h - 0.1) continue;
      if (faceZ || rnd() < 0.5) addMesh(parent, new THREE.BoxGeometry(0.2, 0.12, 0.08), colorMat('#e9ebec'), cx - 0.25 + rnd() * 0.5, y, cz + fw / 2 + 0.04);
      else addMesh(parent, new THREE.BoxGeometry(0.08, 0.12, 0.2), colorMat('#e9ebec'), cx + fw / 2 + 0.04, y, cz - 0.25 + rnd() * 0.5);
    }
    // 招牌：一樓上方的橫招牌 + 外牆直招牌
    const hsign = (onX, y) => {
      const { mat: m, aspect } = signMat(false), sh = 0.2, sw = Math.min(fw * 0.95, sh * aspect);
      const base = colorMat('#3a3a40');
      if (onX) addMesh(parent, new THREE.BoxGeometry(0.05, sh, sw), [m, base, base, base, base, base], cx + fw / 2 + 0.03, y, cz, { cast: false });
      else     addMesh(parent, new THREE.BoxGeometry(sw, sh, 0.05), [base, base, base, base, m, base], cx, y, cz + fw / 2 + 0.03, { cast: false });
    };
    if (faceZ) hsign(false, arcadeH + 0.13);
    if (faceX) hsign(true, arcadeH + 0.13);
    if (up > 1 && rnd() < 0.55){
      const { mat: m, aspect } = signMat(true), sw = 0.2, sh = Math.min(up - 0.4, sw / aspect);
      const base = colorMat('#3a3a40'), y = arcadeH + 0.35 + sh / 2;
      if (faceZ || !faceX) addMesh(parent, new THREE.BoxGeometry(sw, sh, 0.05), [base, base, base, base, m, base], cx + fw / 2 - 0.15, y, cz + fw / 2 + 0.06, { cast: false });
      else addMesh(parent, new THREE.BoxGeometry(0.05, sh, sw), [m, base, base, base, base, base], cx + fw / 2 + 0.06, y, cz + fw / 2 - 0.15, { cast: false });
    }
  }

  function scooter(parent, x, z, alongX){
    const col = colorMat(pick(['#d8322f', '#f2f2f2', '#2c6fb5', '#1f1f24', '#f3c537', '#8fd1c4']));
    const dark = colorMat('#26262c');
    const L = 0.36, W = 0.13;
    const [bw, bd] = alongX ? [L, W] : [W, L];
    addMesh(parent, new THREE.BoxGeometry(bw, 0.12, bd), col, x, 0.14, z);
    addMesh(parent, new THREE.BoxGeometry(alongX ? 0.16 : W * 0.9, 0.05, alongX ? W * 0.9 : 0.16), dark, x - (alongX ? 0.05 : 0), 0.225, z - (alongX ? 0 : 0.05));
    addMesh(parent, new THREE.BoxGeometry(alongX ? 0.05 : W, 0.2, alongX ? W : 0.05), col, x + (alongX ? L / 2 - 0.03 : 0), 0.22, z + (alongX ? 0 : L / 2 - 0.03));
    addMesh(parent, new THREE.BoxGeometry(alongX ? 0.03 : 0.2, 0.03, alongX ? 0.2 : 0.03), dark, x + (alongX ? L / 2 - 0.03 : 0), 0.33, z + (alongX ? 0 : L / 2 - 0.03));
    for (const s of [-1, 1]) addMesh(parent, new THREE.BoxGeometry(alongX ? 0.1 : 0.05, 0.1, alongX ? 0.05 : 0.1), dark,
      x + (alongX ? s * L * 0.36 : 0), 0.05, z + (alongX ? 0 : s * L * 0.36));
  }
  function mailboxes(parent, x, z){
    [['#c8382f', -0.13], ['#2d7a4a', 0.13]].forEach(([c, o]) => {
      addMesh(parent, new THREE.BoxGeometry(0.2, 0.34, 0.2), colorMat(c), x + o, 0.27, z);
      addMesh(parent, new THREE.BoxGeometry(0.21, 0.05, 0.21), colorMat(shade(c, 0.75)), x + o, 0.46, z);
      addMesh(parent, new THREE.BoxGeometry(0.1, 0.1, 0.1), colorMat('#3a3a40'), x + o, 0.05, z);
      addMesh(parent, new THREE.BoxGeometry(0.12, 0.02, 0.01), colorMat('#222'), x + o, 0.36, z + 0.105);
    });
  }

  /* ---------- 臺北 101（獨立物件，主角走到後面時會變半透明） ---------- */
  function taipei101(scene, bx, bz){
    const group = new THREE.Group();
    group.position.set(bx, 0, bz);
    const mats = [];
    const own = (opts) => { const m = new THREE.MeshLambertMaterial({ ...opts, transparent: false }); mats.push(m); return m; };
    const glassTex = (rows) => {
      const t = pixelTexture(TX, TX, g => {
        g.fillStyle = '#4f9c9a'; g.fillRect(0, 0, TX, TX);
        g.fillStyle = '#6fbab3'; for (let i = 0; i < TX; i++) g.fillRect((i * 2) % TX, i, 2, 1);
        g.fillStyle = '#2f6d6e'; for (let x = 0; x < TX; x += 4) g.fillRect(x, 0, 1, TX);
        g.fillStyle = '#28595b'; for (let y = 5; y < TX; y += 6) g.fillRect(0, y, TX, 1);
      });
      t.repeat.set(4, rows);
      return t;
    };
    const frame = own({ color: '#2f5f61' });
    const gold  = own({ color: '#d9b45a', emissive: '#6b4f12', emissiveIntensity: 0.4 });
    // 方錐台：CylinderGeometry 只用 4 邊，再轉 45° 就是正方形
    const frustum = (bottom, top, h, y, m) => {
      const g = new THREE.CylinderGeometry(top / Math.SQRT2, bottom / Math.SQRT2, h, 4, 1);
      g.rotateY(Math.PI / 4);
      const mesh = new THREE.Mesh(g, m); mesh.position.y = y + h / 2;
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    };
    // 裙樓
    frustum(2.1, 2.0, 0.55, 0, own({ map: glassTex(1.5), flatShading: true }));
    // 下段塔身（往上收）
    frustum(1.5, 1.18, 1.6, 0.55, own({ map: glassTex(4), flatShading: true }));
    // 如意裝飾（面向鏡頭的兩面）
    const ruyi = new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12);
    [[0.61, 0, Math.PI / 2, 'z'], [0, 0.61, Math.PI / 2, 'x']].forEach(([ox, oz, r, ax]) => {
      const m = new THREE.Mesh(ruyi, gold); m.position.set(ox, 2.0, oz);
      if (ax === 'z') m.rotation.z = r; else m.rotation.x = r;
      group.add(m);
    });
    // 八節「花開」：每節下窄上寬
    const segMat = own({ map: glassTex(2.4), flatShading: true });
    let y = 2.15;
    for (let i = 0; i < 8; i++){
      const ring = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.05, 1.06), frame);
      ring.position.y = y + 0.025; ring.castShadow = true; group.add(ring);
      frustum(1.02, 1.26, 0.56, y + 0.05, segMat);
      y += 0.61;
    }
    // 頂部收尖 + 塔尖
    frustum(0.9, 0.78, 0.32, y, own({ map: glassTex(1), flatShading: true })); y += 0.32;
    frustum(0.62, 0.5, 0.26, y, frame); y += 0.26;
    frustum(0.36, 0.3, 0.2, y, frame); y += 0.2;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.3, 6), own({ color: '#c9ced3' }));
    spire.position.y = y + 0.65; spire.castShadow = true; group.add(spire);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), own({ color: '#ff5a4f', emissive: '#ff3b30', emissiveIntensity: 1 }));
    tip.position.y = y + 1.32; group.add(tip);
    mats.push(gold, frame);
    scene.add(group);
    const height = y + 1.35;
    return { group, mats: [...new Set(mats)], base: { x: bx, z: bz }, height, radius: 1.1, opacity: 1 };
  }

  /* 合併靜態物件：幾百個 Mesh → 依材質合成幾十個 */
  function mergeMeshes(meshes){
    const buckets = new Map();
    for (const m of meshes){
      m.updateMatrixWorld(true);
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
      for (const gr of groups){
        const mt = Array.isArray(m.material) ? mats[gr.materialIndex] : m.material;
        if (!buckets.has(mt)) buckets.set(mt, { p: [], n: [], u: [], cast: false, receive: false });
        const b = buckets.get(mt);
        b.cast = b.cast || m.castShadow; b.receive = b.receive || m.receiveShadow;
        for (let i = gr.start; i < gr.start + gr.count; i++){
          b.p.push(P.getX(i), P.getY(i), P.getZ(i));
          b.n.push(N.getX(i), N.getY(i), N.getZ(i));
          b.u.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        }
      }
      geo.dispose();
    }
    const out = [];
    buckets.forEach((b, mt) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      const mesh = new THREE.Mesh(g, mt);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      out.push(mesh);
    });
    return out;
  }

  /* =======================================================
     4. 城市佈局
     ======================================================= */
  // 城市範圍：依路線大小自動決定，外圍多留 12 格
  const X0 = Math.min(...PATH.map(p => p[0])) - 12, X1 = Math.max(...PATH.map(p => p[0])) + 12;
  const Z0 = Math.min(...PATH.map(p => p[1])) - 12, Z1 = Math.max(...PATH.map(p => p[1])) + 12;
  const FAR = 10;                                   // 離路線超過這個距離就不蓋建築（鏡頭看不到）
  const key = (x, z) => `${x},${z}`;
  const STREETS = [];                             // 支線道路（給車子跑）

  function layout(){
    const road = new Map();                        // key → 'path' | 'x' | 'z'
    PATH.forEach(([x, z]) => road.set(key(x, z), 'path'));
    const zebra = new Map();
    STREETS.length = 0;
    SIDE_STREETS.forEach(({ from: [fx, fz], dir: [dx, dz] }) => {
      const street = { cells: [], dir: [dx, dz], endsAtPath: false };
      for (let i = 1; ; i++){
        const x = fx + dx * i, z = fz + dz * i;
        if (x < X0 || x > X1 || z < Z0 || z > Z1) break;
        if (road.get(key(x, z)) === 'path'){ street.endsAtPath = true; break; }
        if (!road.has(key(x, z))) road.set(key(x, z), dx ? 'x' : 'z');
        if (i === 1) zebra.set(key(x, z), dx ? 'x' : 'z');
        street.cells.push([x, z]);
      }
      if (street.cells.length >= 3) STREETS.push(street);
    });
    // 環城道路：在路線外圍 3 格繞一圈，把所有往外的支線串起來 → 車子可以一直開下去
    {
      const xs = PATH.map(p => p[0]), zs = PATH.map(p => p[1]);
      const rx0 = Math.min(...xs) - 3, rx1 = Math.max(...xs) + 3, rz0 = Math.min(...zs) - 3, rz1 = Math.max(...zs) + 3;
      for (let x = rx0; x <= rx1; x++) for (const z of [rz0, rz1]) if (!road.has(key(x, z))) road.set(key(x, z), 'x');
      for (let z = rz0; z <= rz1; z++) for (const x of [rx0, rx1]) if (!road.has(key(x, z))) road.set(key(x, z), 'z');
    }
    // 環狀路線內部 → 公園
    const poly = ROUTE_CORNERS.map(([x, z]) => [x + 0.5, z + 0.5]);
    const inside = (x, z) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    // 每一格到路線的距離（太遠的不蓋）
    const distToPath = (x, z) => { let d = 1e9; for (const [px, pz] of PATH) d = Math.min(d, Math.max(Math.abs(px - x), Math.abs(pz - z))); return d; };
    // 路線內部的中心 → 公園（臺北 101 會蓋在這裡），其餘內部空地照樣蓋房子
    const inner = [];
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) if (!road.has(key(x, z)) && inside(x + 0.5, z + 0.5)) inner.push([x, z]);
    const icx = inner.reduce((a, c) => a + c[0], 0) / inner.length, icz = inner.reduce((a, c) => a + c[1], 0) / inner.length;
    const cells = new Map();
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++){
      const k = key(x, z);
      if (road.has(k)){ cells.set(k, { x, z, type: 'road', dir: road.get(k), zebra: zebra.get(k) }); continue; }
      let nearRoad = false;
      for (let dz = -1; dz <= 1 && !nearRoad; dz++) for (let dx = -1; dx <= 1; dx++) if (road.has(key(x + dx, z + dz))) { nearRoad = true; break; }
      const far = distToPath(x, z) > FAR;
      if (nearRoad) cells.set(k, { x, z, type: 'walk', far });
      else if (inside(x + 0.5, z + 0.5) && Math.hypot(x + 0.5 - icx, z + 0.5 - icz) < 3.6) cells.set(k, { x, z, type: 'park' });
      else cells.set(k, { x, z, type: 'lot', far });
    }
    return cells;
  }

  /* 建築高度上限：避免擋住後方路線上的角色
     等角視角下，地面往鏡頭方向每前進 1 格，畫面就往下移約 0.5 個「樓高」，
     所以位在路線前方 D 格（沿 x+z 方向）的建築，高度不能超過約 D/2 */
  function maxHeight(x, z){
    let h = 99;
    const cx = x + 0.5, cz = z + 0.5;
    for (const [px, pz] of PATH){
      const D = (cx - px - 0.5) + (cz - pz - 0.5);
      const lateral = Math.abs((cx - cz) - (px - pz));
      if (D > 0 && lateral < 1.7) h = Math.min(h, D * 0.5 - 0.35);
    }
    return h;
  }

  /* =======================================================
     5. 建立場景
     ======================================================= */
  function build(scene){
    scene.add(new THREE.HemisphereLight('#e6f0f8', '#7a7466', 1.9));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    const rcx = (X0 + X1) / 2, rcz = (Z0 + Z1) / 2;            // 路線中心
    sun.position.set(rcx - 6, 14, rcz + 9);
    sun.target.position.set(rcx, 0, rcz);
    sun.castShadow = true;
    const big = Math.max(innerWidth, innerHeight) >= 1000;      // 電腦用高解析度陰影，手機省效能
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    const span = Math.max(X1 - X0, Z1 - Z0) * 0.62;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 80 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    const statics = new THREE.Group();
    const cells = layout();
    const lampSpots = [], propSpots = [];

    // 臺北 101 的位置：路線內部公園裡，最靠近中心、且有 2x2 空地的地方
    const parks = [...cells.values()].filter(c => c.type === 'park');
    const mx = parks.reduce((a, c) => a + c.x, 0) / parks.length, mz = parks.reduce((a, c) => a + c.z, 0) / parks.length;
    const isPark = (x, z) => cells.get(key(x, z))?.type === 'park';
    let spot = null, best = 1e9;
    parks.forEach(c => {
      if (!(isPark(c.x + 1, c.z) && isPark(c.x, c.z + 1) && isPark(c.x + 1, c.z + 1))) return;
      const d = (c.x + 1 - mx) ** 2 + (c.z + 1 - mz) ** 2;
      if (d < best){ best = d; spot = { x: c.x + 1, z: c.z + 1 }; }
    });
    const nearTower = (x, z) => spot && Math.abs(x + 0.5 - spot.x) < 2.2 && Math.abs(z + 0.5 - spot.z) < 2.2;

    cells.forEach(c => {
      const { x, z } = c;
      if (c.type === 'road'){
        const tex = c.zebra ? (c.zebra === 'x' ? T.zebraZ : T.zebraX)
                  : c.dir === 'x' ? T.laneX : c.dir === 'z' ? T.laneZ : T.asphalt;
        addMesh(statics, groundQuad(x, z, 0), texMat(tex), 0, 0, 0, { cast: false });
      } else if (c.type === 'walk' || c.type === 'lot'){
        // 人行道略高於路面（路緣石）
        const h = 0.06;
        const walk = texMat(c.type === 'walk' ? T.sidewalk : T.plaza), curb = texMat(T.curb);
        addMesh(statics, boxGeo(1, h, 1, { x: [1, 1], z: [1, 1] }), [curb, curb, walk, walk, curb, curb], x + 0.5, h / 2, z + 0.5, { cast: false });
        if (c.type === 'walk'){
          const adj = [[1,0],[-1,0],[0,1],[0,-1]].find(([dx, dz]) => cells.get(key(x + dx, z + dz))?.type === 'road' && cells.get(key(x + dx, z + dz)).dir === 'path');
          if (adj) lampSpots.push({ x, z, adj });
          else propSpots.push({ x, z });
        }
      } else if (c.type === 'park'){
        const plaza = nearTower(x, z);
        const top = texMat(plaza ? T.plaza : T.grass);
        addMesh(statics, boxGeo(1, 0.06, 1, { x: [1, 0.25], z: [1, 0.25] }), [texMat(T.curb), texMat(T.curb), top, top, texMat(T.curb), texMat(T.curb)], x + 0.5, 0.03, z + 0.5, { cast: false });
        const onFootprint = spot && x >= spot.x - 1 && x <= spot.x && z >= spot.z - 1 && z <= spot.z;
        if (onFootprint) return;
        if (plaza){ if (rnd() < 0.25) planter(statics, x + 0.5, z + 0.5); else if (rnd() < 0.2) bench(statics, x + 0.5, z + 0.5, rnd() < 0.5); }
        else if (rnd() < 0.4) tree(statics, x + 0.3 + rnd() * 0.4, z + 0.3 + rnd() * 0.4, 0.9 + rnd() * 0.35);
        else if (rnd() < 0.2) bench(statics, x + 0.5, z + 0.5, rnd() < 0.5);
      }
    });

    // 建築：越後面越高；靠近路線前方的自動壓低
    cells.forEach(c => {
      if (c.type !== 'lot' || c.far) return;
      const limit = maxHeight(c.x, c.z);
      const depthBias = Math.max(0, 6 - (c.x + c.z) * 0.25);
      let h = 1.2 + rnd() * 2.4 + depthBias * rnd();
      h = Math.min(h, limit);
      if (h < 0.5){ if (rnd() < 0.5) tree(statics, c.x + 0.5, c.z + 0.5, 0.8); else planter(statics, c.x + 0.5, c.z + 0.5); return; }
      const faceX = cells.get(key(c.x + 1, c.z))?.type === 'walk';
      const faceZ = cells.get(key(c.x, c.z + 1))?.type === 'walk';
      // 臺北街景：多數是 4~6 層的老公寓；後方偶爾夾著現代辦公大樓
      const modern = h > 3.2 && rnd() < 0.55;
      if (modern) building(statics, c.x + 0.5, c.z + 0.5, h, faceX, faceZ);
      else taipeiApartment(statics, c.x + 0.5, c.z + 0.5, Math.min(h, 1.6 + Math.floor(rnd() * 3) * 0.5), faceX, faceZ);
    });

    // 路燈：沿路線人行道，每隔幾格一盞
    lampSpots.forEach((s, i) => {
      const [dx, dz] = s.adj;
      // 放在人行道靠建築那一側；只有在路線「後方」（離鏡頭較遠）的人行道才放高的路燈，才不會擋住主角
      const behind = dx > 0 || dz > 0;
      if (i % 5 === 0 && behind) streetLamp(statics, s.x + 0.5 - dx * 0.3, s.z + 0.5 - dz * 0.3);
      else if (i % 5 === 2) planter(statics, s.x + 0.5 - dx * 0.3, s.z + 0.5 - dz * 0.3);
      else if (i % 9 === 4) bench(statics, s.x + 0.5 - dx * 0.25, s.z + 0.5 - dz * 0.25, dz !== 0);
    });
    // 紅綠燈：每個路線轉角的外側
    ROUTE_CORNERS.forEach(([x, z]) => {
      for (const [dx, dz] of [[-1,-1],[1,-1],[-1,1]]){        // 不放在路口前方（鏡頭那一側）
        if (cells.get(key(x + dx, z + dz))?.type === 'walk'){ trafficLight(statics, x + 0.5 + dx * 0.62, z + 0.5 + dz * 0.62); break; }
      }
    });
    // 機車：停在人行道靠路邊（路線後方那一側才停，才不會擋到主角）
    lampSpots.forEach((s, i) => {
      const [dx, dz] = s.adj;
      if (!(dx > 0 || dz > 0) || i % 4 === 0) return;
      const along = dz !== 0;        // 路在 z 方向 → 機車沿 x 排
      for (let k = -1; k <= 1; k++){
        if (rnd() < 0.25) continue;
        scooter(statics, s.x + 0.5 + dx * 0.32 + (along ? k * 0.22 : 0), s.z + 0.5 + dz * 0.32 + (along ? 0 : k * 0.22), !along);
      }
    });

    // 起點旁的咖啡亭與郵筒
    const [sx, sz] = PATH[0];
    kiosk(statics, sx + 0.5, sz - 1 + 0.45);
    mailboxes(statics, sx - 1 + 0.5, sz - 1 + 0.6);

    statics.updateMatrixWorld(true);
    const flat = []; statics.traverse(o => { if (o.isMesh) flat.push(o); });
    mergeMeshes(flat).forEach(m => scene.add(m));

    /* ---------- 事件格（每格獨立材質，可做踩格閃光） ---------- */
    const white = colorMat('#f4f1ea');
    const iconTex = {};
    Object.keys(TYPES).forEach(type => {
      const ty = TYPES[type];
      const t = pixelTexture(20, 20, g => drawIcon(g, ty.icon, 3, 3, 2, shade(ty.color, 0.5)), { wrap: false });
      t.center.set(0.5, 0.5); t.rotation = Math.PI / 4;     // 轉 45°，在這個視角下是正的
      iconTex[type] = t;
    });
    const tiles = PATH.map(([x, z], k) => {
      const type = LAYOUT[k].type, col = TYPES[type].color;
      const g = new THREE.Group();
      g.position.set(x + 0.5, 0, z + 0.5);
      addMesh(g, new THREE.BoxGeometry(0.9, 0.03, 0.9), white, 0, 0.015, 0, { cast: false });
      const top = new THREE.MeshLambertMaterial({ color: col, emissive: '#ffffff', emissiveIntensity: 0 });
      addMesh(g, new THREE.BoxGeometry(0.76, 0.04, 0.76), top, 0, 0.03, 0, { cast: false });
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62),
        mat('icon' + type, () => new THREE.MeshLambertMaterial({ map: iconTex[type], transparent: true, alphaTest: 0.5 })));
      icon.rotation.x = -Math.PI / 2; icon.position.y = 0.052; icon.receiveShadow = true;
      g.add(icon);
      scene.add(g);
      return { group: g, top };
    });

    const landmark = spot ? taipei101(scene, spot.x, spot.z) : null;

    /* ---------- 給動畫用的路網 ----------
       roadNet：車子可以開的道路（不含主線路線）
       walkNet：路人可以走的人行道。排除「主線路線正前方」的人行道（離鏡頭較近，會擋到主角），
                也排除咖啡亭、郵筒所在的格子 */
    const roadNet = new Set(), walkNet = new Set();
    const blocked = new Set([key(sx, sz - 1), key(sx - 1, sz - 1)]);
    cells.forEach(c => {
      const k = key(c.x, c.z);
      if (c.type === 'road' && c.dir !== 'path') roadNet.add(k);
      if (c.type === 'walk' && !blocked.has(k)){
        const inFront = [[-1, 0], [0, -1], [-1, -1]].some(([dx, dz]) => cells.get(key(c.x + dx, c.z + dz))?.dir === 'path');
        if (!inFront) walkNet.add(k);
      }
    });

    return { tiles, landmark, roadNet, walkNet };
  }

  return { build };
})();

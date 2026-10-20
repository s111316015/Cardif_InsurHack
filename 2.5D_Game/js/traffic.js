/* =========================================================
   街景動畫：汽車、計程車、機車騎士、路人
   - 車子在「道路網」上行駛：每到一個路口就隨機直走 / 左轉 / 右轉，
     轉彎走圓弧；只有開進死巷才會迴轉
   - 路人在「人行道網」上散步：到轉角會轉彎，偶爾停下來
   - 道路網與人行道網都不包含主線事件格，純裝飾，不影響遊戲
   ========================================================= */
const Traffic = (() => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const key = (x, z) => `${x},${z}`;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const vehicles = [], walkers = [];
  let camR = null, roadNet = null, walkNet = null;

  /* =======================================================
     1. 模型
     ======================================================= */
  // 用「頂點顏色」把一台車的零件合成一個 Mesh（每台車只要 1 次繪製）
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function part(list, w, h, d, x, y, z, color){ list.push({ w, h, d, x, y, z, c: new THREE.Color(color) }); }
  function buildMesh(parts){
    const pos = [], nor = [], col = [];
    parts.forEach(p => {
      const g = new THREE.BoxGeometry(p.w, p.h, p.d).toNonIndexed();
      g.translate(p.x, p.y, p.z);
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++){
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(p.c.r, p.c.g, p.c.b);
      }
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, vcMat); m.castShadow = true;
    return m;
  }
  // 車頭朝 +x 建模
  function carMesh(){
    const taxi = rnd() < 0.35;
    const body = taxi ? '#f2c200' : pick(['#e85d5d', '#f4f4f4', '#3b4a63', '#8a9aa8', '#2e6fb0', '#2b2b30', '#9b2f2f']);
    const p = [];
    part(p, 0.56, 0.13, 0.28, 0, 0.11, 0, body);
    part(p, 0.3, 0.11, 0.24, -0.03, 0.23, 0, '#bfe3f5');
    part(p, 0.3, 0.02, 0.25, -0.03, 0.295, 0, body);
    part(p, 0.02, 0.04, 0.06, 0.285, 0.12, 0.09, '#fff6c8'); part(p, 0.02, 0.04, 0.06, 0.285, 0.12, -0.09, '#fff6c8');
    part(p, 0.02, 0.04, 0.06, -0.285, 0.12, 0.09, '#d62b2b'); part(p, 0.02, 0.04, 0.06, -0.285, 0.12, -0.09, '#d62b2b');
    for (const [x, z] of [[0.17, 0.13], [0.17, -0.13], [-0.17, 0.13], [-0.17, -0.13]]) part(p, 0.11, 0.09, 0.04, x, 0.05, z, '#1c1c20');
    if (taxi) part(p, 0.1, 0.05, 0.08, -0.03, 0.325, 0, '#ffffff');
    return { mesh: buildMesh(p), speed: 1.1 + rnd() * 0.5, lane: 0.24 };
  }
  function scooterMesh(){
    const body = pick(['#d8322f', '#f2f2f2', '#2c6fb5', '#1f1f24', '#f3c537', '#8fd1c4']);
    const shirt = pick(['#4a90e2', '#e85d5d', '#2e9e6b', '#f5f5f5', '#f5a623', '#7b3fb8', '#2b3346']);
    const helmet = pick(['#f4f4f4', '#d8322f', '#1f1f24', '#f3c537', '#2c6fb5']);
    const p = [];
    part(p, 0.34, 0.1, 0.12, 0, 0.12, 0, body);
    part(p, 0.05, 0.2, 0.12, 0.15, 0.2, 0, body);
    part(p, 0.03, 0.03, 0.2, 0.16, 0.31, 0, '#26262c');
    part(p, 0.1, 0.1, 0.04, 0.12, 0.05, 0, '#1c1c20'); part(p, 0.1, 0.1, 0.04, -0.12, 0.05, 0, '#1c1c20');
    part(p, 0.12, 0.05, 0.13, -0.04, 0.2, 0, '#2b3346');                  // 騎士：腿
    part(p, 0.1, 0.17, 0.13, -0.05, 0.31, 0, shirt);                      // 身體
    part(p, 0.12, 0.03, 0.03, 0.04, 0.33, 0.07, shirt); part(p, 0.12, 0.03, 0.03, 0.04, 0.33, -0.07, shirt);
    part(p, 0.11, 0.1, 0.11, -0.04, 0.45, 0, helmet);                     // 安全帽
    part(p, 0.02, 0.04, 0.08, 0.015, 0.45, 0, '#2a2f3a');
    return { mesh: buildMesh(p), speed: 1.5 + rnd() * 0.6, lane: 0.18 };
  }

  // 路人：像素紙片人（無描邊），隨機髮色與衣著
  const PED = [
    "............",
    "....hhhh....",
    "...hhhhhh...",
    "...hhhhhh...",
    "...hssssh...",
    "...sesses...",
    "...ssssss...",
    "....ssss....",
    "...tttttt...",
    "..tttttttt..",
    "..stttttts..",
    "..stttttts..",
    "...tttttt...",
    "...bbbbbb...",
    "...bbbbbb...",
    "...bb..bb...",
    "...bb..bb...",
    "...bb..bb...",
    "...ff..ff...",
    "............",
  ];
  const LEG_A = { 15: "...bb...bb..", 16: "...bb...bb..", 17: "...bb...bb..", 18: "...ff...ff.." };
  const LEG_B = { 15: "..bb..bb....", 16: "..bb..bb....", 17: "..bb..bb....", 18: "..ff..ff...." };
  function pedTextures(){
    const pal = {
      h: pick(['#2b2230', '#4a3326', '#7a5a3a', '#1a1a1a', '#b9b9b9', '#6b3b2a']),
      s: pick(['#f6d2b4', '#e8bf9a', '#d9a882']),
      e: '#2a2430',
      t: pick(['#e85d5d', '#4a90e2', '#f5c542', '#2e9e6b', '#ffffff', '#8e6bd6', '#ff9fbd', '#f5a623']),
      b: pick(['#2b3346', '#5a4a3a', '#3a5a8a', '#222226', '#7a7f88']),
      f: pick(['#1c1c20', '#f2f2f2', '#8a4b2a']),
    };
    const make = legs => {
      const c = document.createElement('canvas'); c.width = 12; c.height = 20;
      const g = c.getContext('2d');
      PED.forEach((row, y) => [...(legs[y] || row)].forEach((ch, x) => {
        if (ch === '.') return; g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1);
      }));
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return [make({}), make(LEG_A), make(LEG_B)];
  }

  /* =======================================================
     2. 路網工具
     ======================================================= */
  const has = (net, x, z) => net.has(key(x, z));
  // 死巷：反覆剪掉「只連到一格」的道路，剩下的就是能繞圈的主幹道；被剪掉的就是死巷支線
  let deadEnd = new Set();
  function findDeadEnds(net){
    const deg = new Map(), dead = new Set();
    net.forEach(k => { const [x, z] = k.split(',').map(Number); deg.set(k, DIRS.filter(d => net.has(key(x + d[0], z + d[1]))).length); });
    const queue = [...net].filter(k => deg.get(k) <= 1);
    while (queue.length){
      const k = queue.pop(); if (dead.has(k)) continue;
      dead.add(k);
      const [x, z] = k.split(',').map(Number);
      DIRS.forEach(d => { const n = key(x + d[0], z + d[1]); if (net.has(n) && !dead.has(n)){ deg.set(n, deg.get(n) - 1); if (deg.get(n) <= 1) queue.push(n); } });
    }
    return dead;
  }

  // 到了一格之後，下一步往哪走：優先直走，其次左右轉；死巷支線很少開進去；只有死路才回頭
  function chooseDir(net, x, z, d, straightWeight = 3, avoidDead = false){
    const opts = [];
    let total = 0;
    const here = key(x, z);
    DIRS.forEach(n => {
      if (n[0] === -d[0] && n[1] === -d[1]) return;
      const nk = key(x + n[0], z + n[1]);
      if (!net.has(nk)) return;
      let w = (n[0] === d[0] && n[1] === d[1]) ? straightWeight : 1;
      if (avoidDead && deadEnd.has(nk) && !deadEnd.has(here)) w *= 0.12;
      opts.push([n, w]); total += w;
    });
    if (!opts.length) return [-d[0], -d[1]];
    let r = rnd() * total;
    for (const [n, w] of opts){ if ((r -= w) <= 0) return n; }
    return opts[opts.length - 1][0];
  }
  const randomCell = net => { const arr = [...net]; return arr[Math.floor(rnd() * arr.length)].split(',').map(Number); };

  /* =======================================================
     3. 建立
     ======================================================= */
  function init(scene, world, cameraRight){
    camR = cameraRight; roadNet = world.roadNet; walkNet = world.walkNet;
    deadEnd = findDeadEnds(roadNet);

    const nVeh = Math.min(60, Math.round(roadNet.size / 10));
    for (let i = 0; i < nVeh; i++){
      const v = rnd() < 0.5 ? scooterMesh() : carMesh();
      scene.add(v.mesh);
      // 出生點：只挑「前後都是道路」的格子，車子不會從主線格子或死巷尾端「開出來」
      let x, z, d1 = null;
      for (let tries = 0; tries < 50 && !d1; tries++){
        [x, z] = randomCell(roadNet);
        if (deadEnd.has(key(x, z)) && tries < 40) continue;
        d1 = DIRS.find(d => has(roadNet, x + d[0], z + d[1]) && has(roadNet, x - d[0], z - d[1])) || null;
      }
      d1 = d1 || [1, 0];
      vehicles.push({ ...v, x, z, d1, d2: chooseDir(roadNet, x, z, d1, 3, true), u: rnd() });
    }

    const nPed = Math.min(110, Math.round(walkNet.size / 9));
    for (let i = 0; i < nPed; i++){
      const frames = pedTextures();
      const mat = new THREE.SpriteMaterial({ map: frames[0], alphaTest: 0.5 });
      const sp = new THREE.Sprite(mat);
      sp.center.set(0.5, 0.02);
      scene.add(sp);
      const [x, z] = randomCell(walkNet);
      const d = DIRS.find(dd => has(walkNet, x + dd[0], z + dd[1])) || [1, 0];
      walkers.push({ sp, mat, frames, h: 0.58 + rnd() * 0.1, x, z, d, t: rnd(),
                     side: (rnd() - 0.5) * 0.24, speed: 0.3 + rnd() * 0.2, phase: rnd() * 1000, pause: 0 });
    }
  }

  /* =======================================================
     4. 每幀更新
     ======================================================= */
  const UT = 0.22;   // 迴轉前只往前開這麼多（格）
  // 一台車在某一格裡的行駛曲線（中心線位置 + 前進方向），u ∈ [0, 1]
  function pieceLength(v){
    const [a, b] = v.d1, [c, d] = v.d2;
    if (a === c && b === d) return 1;
    if (a === -c && b === -d) return 2 * UT + Math.PI * v.lane;    // 迴轉
    return Math.PI / 4;                                              // 90° 轉彎（半徑 0.5 的四分之一圓）
  }
  function pose(v){
    const cx = v.x + 0.5, cz = v.z + 0.5, [ax, az] = v.d1, [bx, bz] = v.d2;
    const right = (tx, tz) => [-tz, tx];
    if (ax === bx && az === bz){                                     // 直走
      const px = cx - ax * 0.5 + ax * v.u, pz = cz - az * 0.5 + az * v.u, [rx, rz] = right(ax, az);
      return [px + rx * v.lane, pz + rz * v.lane, ax, az];
    }
    if (ax === -bx && az === -bz){                                   // 迴轉：開進一點 → 半圓 → 開回去
      // 只開進 UT 格就迴轉，整台車（含車頭）都留在這一格內，不會碰到隔壁的主線格子
      const L = pieceLength(v), s = v.u * L, R = v.lane, [rx, rz] = right(ax, az);
      const ex = cx - ax * 0.5, ez = cz - az * 0.5;                  // 進入這格的邊
      const ox = ex + ax * UT, oz = ez + az * UT;                    // 迴轉中心
      if (s < UT) return [ex + ax * s + rx * R, ez + az * s + rz * R, ax, az];
      const arc = Math.PI * R;
      if (s < UT + arc){
        const th = (s - UT) / arc * Math.PI;
        return [ox + rx * R * Math.cos(th) + ax * R * Math.sin(th), oz + rz * R * Math.cos(th) + az * R * Math.sin(th),
                ax * Math.cos(th) - rx * Math.sin(th), az * Math.cos(th) - rz * Math.sin(th)];
      }
      const t = s - UT - arc;
      return [ox + bx * t - rx * R, oz + bz * t - rz * R, bx, bz];
    }
    // 轉彎：四分之一圓，圓心在「進入邊中點 + 出口方向半格」
    const ox = cx - ax * 0.5 + bx * 0.5, oz = cz - az * 0.5 + bz * 0.5;
    const ang = v.u * Math.PI / 2, co = Math.cos(ang), si = Math.sin(ang);
    const px = ox + 0.5 * (-bx * co + ax * si), pz = oz + 0.5 * (-bz * co + az * si);
    const tx = ax * co + bx * si, tz = az * co + bz * si, [rx, rz] = right(tx, tz);
    return [px + rx * v.lane, pz + rz * v.lane, tx, tz];
  }

  function update(dt, now){
    vehicles.forEach(v => {
      v.u += v.speed * dt / pieceLength(v);
      while (v.u >= 1){
        v.u -= 1;
        const uturn = v.d1[0] === -v.d2[0] && v.d1[1] === -v.d2[1];
        if (!uturn){ v.x += v.d2[0]; v.z += v.d2[1]; }              // 迴轉後還在同一格，只是方向反過來
        v.d1 = v.d2;
        if (uturn){ v.x += v.d1[0]; v.z += v.d1[1]; }
        v.d2 = chooseDir(roadNet, v.x, v.z, v.d1, 3, true);
      }
      const [x, z, tx, tz] = pose(v);
      v.mesh.position.set(x, 0, z);
      v.mesh.rotation.y = Math.atan2(-tz, tx);
    });

    walkers.forEach(w => {
      if (w.pause > 0) w.pause -= dt;
      else {
        w.t += w.speed * dt;
        if (w.t >= 1){                                               // 到達下一格中心 → 決定下一步
          w.t -= 1; w.x += w.d[0]; w.z += w.d[1];
          w.d = chooseDir(walkNet, w.x, w.z, w.d, 4);
          if (rnd() < 0.06) w.pause = 0.8 + rnd() * 2;                // 偶爾停下來
        }
      }
      const [dx, dz] = w.d;
      const x = w.x + 0.5 + dx * w.t - dz * w.side, z = w.z + 0.5 + dz * w.t + dx * w.side;
      const walking = w.pause <= 0;
      const step = Math.floor((now + w.phase) / 230) % 2;
      w.mat.map = walking ? w.frames[1 + step] : w.frames[0];
      w.sp.position.set(x, 0.06 + (walking ? step * 0.012 : 0), z);
      const sx = dx * camR.x + dz * camR.z;                          // 往畫面左邊走 → 翻轉
      w.sp.scale.set(w.h * 0.6 * (sx < 0 ? -1 : 1), w.h, 1);
    });
  }

  return { init, update };
})();

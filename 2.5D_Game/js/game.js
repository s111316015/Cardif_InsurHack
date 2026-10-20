/* =========================================================
   保險大富翁 – 主程式（像素城市版）
   依賴：three.min.js、data.js、grid.js、grid-tracker.js、world.js
   ========================================================= */
const $ = id => document.getElementById(id);

/* ---------------------------------------------------------
   1. 渲染器
   以裝置實際解析度渲染（不再先縮小再放大），像素感來自像素貼圖：
   → 鏡頭與角色都能以 1 個螢幕像素為單位平滑移動，不會抖
   --------------------------------------------------------- */
const app = $('app');
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b7cdd8');
const world = World.build(scene);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const VIEW_DIR = new THREE.Vector3(1, 0.95, 1).normalize();
camera.position.copy(VIEW_DIR).multiplyScalar(60);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const CAM_R = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
const CAM_U = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
Traffic.init(scene, world, CAM_R);           // 街景動畫：車子、機車、路人

let VW = 0, VH = 0, DPR = 1, PPU = 80, DU = 1 / 80;   // PPU：每世界單位幾個 CSS 像素；DU：1 個裝置像素的世界長度
const HERO_TEX_H = HERO.length, HERO_TEX_W = HERO[0].length;
let heroH = 1.5, heroW = 1;

function resize(){
  VW = app.clientWidth; VH = app.clientHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  // 直式（手機）：畫面約 5 格寬；橫式（電腦）：鏡頭拉近，畫面聚焦在角色與周圍幾格
  const landscape = VW >= VH;
  PPU = landscape ? Math.max(70, Math.min(170, VH / 6.2)) : Math.max(64, Math.min(100, VW / 5));
  DU = 1 / (PPU * DPR);
  renderer.setPixelRatio(DPR);
  renderer.setSize(VW, VH);
  Object.assign(camera, { left: -VW / 2 / PPU, right: VW / 2 / PPU, top: VH / 2 / PPU, bottom: -VH / 2 / PPU });
  camera.updateProjectionMatrix();
  // 主角：手機約佔畫面高度 14%、電腦 20%；貼圖像素放大成「整數」個裝置像素 → 清楚不變形
  const texel = Math.max(1, Math.round(VH * (landscape ? 0.2 : 0.14) * DPR / HERO_TEX_H));
  heroH = texel * HERO_TEX_H * DU; heroW = texel * HERO_TEX_W * DU;
}

/* ---------------------------------------------------------
   2. 主角（像素貼圖紙片人，放在 3D 場景中 → 會被前方建築正確遮擋）
   --------------------------------------------------------- */
function heroFrame(legShift){
  const c = document.createElement('canvas'); c.width = HERO_TEX_W; c.height = HERO_TEX_H;
  const g = c.getContext('2d');
  HERO.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    // 走路：把其中一隻腳往上抬 1 像素
    let yy = y;
    if (legShift && y >= 27 && ((legShift < 0 && x <= 11) || (legShift > 0 && x >= 12 && x <= 18))) yy = y - 1;
    g.fillStyle = HERO_PAL[ch]; g.fillRect(x, yy, 1, 1);
  }));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FRAMES = { stand: heroFrame(0), walkA: heroFrame(-1), walkB: heroFrame(1) };
const heroMat = new THREE.SpriteMaterial({ map: FRAMES.stand, alphaTest: 0.5 });
const hero = new THREE.Sprite(heroMat);
hero.center.set(0.5, 0.02);
scene.add(hero);

const blob = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16),
  new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
blob.scale.set(1, 0.7, 1);
scene.add(blob);

/* ---------------------------------------------------------
   3. 移動與網格追蹤
   --------------------------------------------------------- */
const grid = new GroundGrid({ tileSize: 1 });
const player = { idx: 0, cash: 10000, cover: new Set() };
const start = grid.cellCenter(...PATH[0]);
const mover = { x: start.x, z: start.z, speed: 2.1, path: [], walking: false, onArrive: null, face: 1 };

function walkTo(points){
  return new Promise(resolve => { mover.path = points.slice(); mover.walking = true; mover.onArrive = resolve; });
}
function updateMover(dt){
  if (!mover.walking) return;
  let dist = mover.speed * dt;
  while (dist > 0 && mover.path.length){
    const t = mover.path[0], dx = t.x - mover.x, dz = t.z - mover.z, d = Math.hypot(dx, dz);
    const sr = dx * CAM_R.x + dz * CAM_R.z;               // 畫面上往左還往右
    if (Math.abs(sr) > 1e-4) mover.face = sr > 0 ? 1 : -1;
    if (d <= dist){ mover.x = t.x; mover.z = t.z; dist -= d; mover.path.shift(); }
    else { mover.x += dx / d * dist; mover.z += dz / d * dist; dist = 0; }
  }
  if (!mover.path.length){
    mover.walking = false;
    const done = mover.onArrive; mover.onArrive = null; done && done();
  }
}

let turn = null;
const pulses = new Map();
const tracker = new GridTracker(grid, {
  margin: 0.12, minDwellMs: 30,
  onGridChanged(x, y){ const k = PATH_INDEX.get(`${x},${y}`); if (k !== undefined) enterTile(k); },
});
tracker.reset(mover.x, mover.z);

function enterTile(k){
  player.idx = k;
  pulses.set(k, performance.now());
  if (!turn) return;
  turn.left--;
  if (k === 0 && turn.left > 0){ addCash(2000); log('經過起點，領薪水 <b>+$2,000</b>'); }
  if (turn.left > 0) say(`剩餘${turn.left}步`);
}

function updateTiles(now){
  world.tiles.forEach((t, k) => {
    const age = now - (pulses.get(k) ?? -1e9);
    const hit = Math.min(1, Math.max(0, 1 - age / 320));
    let glow = hit * 0.55;
    if (k === player.idx && !mover.walking) glow = Math.max(glow, 0.1 + 0.1 * Math.sin(now / 240));
    t.top.emissiveIntensity = glow;
    t.group.position.y = -hit * 0.025;
  });
}

/* ---------------------------------------------------------
   4. 鏡頭：箱庭式區塊跟隨
   - 每 ROOM_SIZE 格一個街區，同區內鏡頭不動，跨區才平滑滑過去
   - 鏡頭與角色都對齊到「裝置像素」，像素貼圖不會閃爍
   --------------------------------------------------------- */
const cam = { x: 0, z: 0, vx: 0, vz: 0 };
const camSnap = new THREE.Vector3();

function roomCenter(r){
  let x = 0, z = 0, n = 0;
  for (let k = r * ROOM_SIZE; k < Math.min(PATH.length, (r + 1) * ROOM_SIZE); k++){
    const c = grid.cellCenter(...PATH[k]); x += c.x; z += c.z; n++;
  }
  return { x: x / n, z: z / n };
}
function smoothDamp(cur, target, vel, time, dt){
  const omega = 2 / time, x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (vel + omega * change) * dt;
  return [target + (change + temp) * exp, (vel - omega * temp) * exp];
}
function snapScreen(v, ref){
  const d = v.clone().sub(ref), r = d.dot(CAM_R), u = d.dot(CAM_U);
  return v.addScaledVector(CAM_R, Math.round(r / DU) * DU - r).addScaledVector(CAM_U, Math.round(u / DU) * DU - u);
}

/* 安全區：鏡頭以街區中心為目標，但若主角會跑出畫面中央區域，就把目標推回來
   （避免主角站在街區邊緣時被畫面邊緣或下方按鈕擋住） */
function keepHeroInView(t){
  const halfW = (camera.right - camera.left) / 2, halfH = (camera.top - camera.bottom) / 2;
  const d = new THREE.Vector3(mover.x - t.x, 0, mover.z - t.z);
  const r = d.dot(CAM_R), u = d.dot(CAM_U);
  // 允許範圍（以地面中心點計）：左右 45%，往上 25%（頭頂要留空間），往下 15%（下方有按鈕）
  const rMax = halfW * 0.45, uMax = halfH * 0.25 - heroH * 0.5, uMin = -halfH * 0.15;
  const cr = Math.max(-rMax, Math.min(rMax, r)), cu = Math.max(uMin, Math.min(uMax, u));
  // 把超出的部分換算回地面座標（R 與 U 在地面上的投影）
  const gR = new THREE.Vector3(CAM_R.x, 0, CAM_R.z), gU = new THREE.Vector3(CAM_U.x, 0, CAM_U.z);
  // 解 a*gR + b*gU 在螢幕上的位移 = (r-cr, u-cu)
  const a11 = gR.dot(CAM_R), a12 = gU.dot(CAM_R), a21 = gR.dot(CAM_U), a22 = gU.dot(CAM_U);
  const det = a11 * a22 - a12 * a21;
  const a = ((r - cr) * a22 - a12 * (u - cu)) / det, b = (a11 * (u - cu) - a21 * (r - cr)) / det;
  return { x: t.x + a * gR.x + b * gU.x, z: t.z + a * gR.z + b * gU.z };
}

function updateCamera(dt, snap = false){
  const room = Math.floor(player.idx / ROOM_SIZE);
  const t = keepHeroInView(roomCenter(room));
  if (snap){ cam.x = t.x; cam.z = t.z; cam.vx = cam.vz = 0; }
  else {
    [cam.x, cam.vx] = smoothDamp(cam.x, t.x, cam.vx, 0.5, dt);
    [cam.z, cam.vz] = smoothDamp(cam.z, t.z, cam.vz, 0.5, dt);
  }
  // 鏡頭稍微往上抬：地面中心落在畫面中下方，角色本身就會在畫面正中
  const target = new THREE.Vector3(cam.x, 0, cam.z).addScaledVector(CAM_U, heroH * 0.4);
  camSnap.copy(snapScreen(target, new THREE.Vector3()));
  camera.position.copy(camSnap).addScaledVector(VIEW_DIR, 60);
  camera.updateMatrixWorld();
}

/* ---------------------------------------------------------
   5. 主迴圈
   --------------------------------------------------------- */
let last = performance.now();
function frame(now){
  // 第一幀的時間戳記可能比啟動時還早 → dt 會是負的，夾在 0 以上避免東西倒退
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  updateMover(dt);
  tracker.update(mover.x, mover.z, now);
  updateCamera(dt);
  updateTiles(now);
  updateHero(now);
  updateLandmark(dt);
  Traffic.update(dt, now);
  renderer.render(scene, camera);
  placeBubble();
  requestAnimationFrame(frame);
}

function updateHero(now){
  let lift = 0;
  if (mover.walking){
    const t = now / 300;
    heroMat.map = Math.floor(t * 2) % 2 ? FRAMES.walkA : FRAMES.walkB;
    lift = Math.abs(Math.sin(t * Math.PI)) * 0.05;
  } else {
    heroMat.map = FRAMES.stand;
    lift = (Math.sin(now / 520) * 0.5 + 0.5) * 0.012;
  }
  hero.scale.set(heroW * mover.face, heroH, 1);
  const feet = new THREE.Vector3(mover.x, 0.06, mover.z).addScaledVector(CAM_U, lift);
  hero.position.copy(snapScreen(feet, camSnap));
  blob.position.set(mover.x, 0.062, mover.z);
}

/* 臺北 101 半透明：主角走到它「後面」、而且在畫面上被它蓋住時，自動變透明 */
const lmCorners = [];
if (world.landmark){
  const { base: b, radius: r, height: h } = world.landmark;
  for (const y of [0, h]) for (const dx of [-r, r]) for (const dz of [-r, r]) lmCorners.push(new THREE.Vector3(b.x + dx, y, b.z + dz));
}
const tmpP = new THREE.Vector3();
function updateLandmark(dt){
  const lm = world.landmark; if (!lm) return;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  lmCorners.forEach(c => { tmpP.copy(c).project(camera); x0 = Math.min(x0, tmpP.x); x1 = Math.max(x1, tmpP.x); y0 = Math.min(y0, tmpP.y); y1 = Math.max(y1, tmpP.y); });
  const f = tmpP.copy(hero.position).project(camera), fx = f.x, fy = f.y;
  const hTop = tmpP.copy(hero.position).addScaledVector(CAM_U, heroH).project(camera).y;
  const hw = heroW / (camera.right - camera.left);
  const overlap = fx + hw > x0 && fx - hw < x1 && hTop > y0 && fy < y1;
  const behind = (mover.x + mover.z) < (lm.base.x + lm.base.z);
  const target = overlap && behind ? 0.3 : 1;
  lm.opacity += (target - lm.opacity) * Math.min(1, dt * 8);
  const see = lm.opacity < 0.98;
  lm.mats.forEach(m => {
    if (m.transparent !== see){ m.transparent = see; m.needsUpdate = true; }
    m.opacity = lm.opacity; m.depthWrite = !see;
  });
}

/* ---------------------------------------------------------
   6. UI
   --------------------------------------------------------- */
const bubble = $('bubble');
const headV = new THREE.Vector3();
const head = { x: 0, y: 0 };
function placeBubble(){
  headV.copy(hero.position).addScaledVector(CAM_U, heroH * 0.98).project(camera);
  head.x = (headV.x * 0.5 + 0.5) * VW; head.y = (-headV.y * 0.5 + 0.5) * VH;
  bubble.style.left = head.x + 'px'; bubble.style.top = head.y + 'px';
}
const say = text => { bubble.textContent = text; bubble.classList.remove('hidden'); };
const hush = () => bubble.classList.add('hidden');

function floatText(text, cls){
  const el = document.createElement('div');
  el.className = 'float ' + cls; el.textContent = text;
  el.style.left = head.x + 'px'; el.style.top = (head.y - 34) + 'px';
  app.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

const logs = [];
function log(html){ logs.unshift(html); logs.length = Math.min(logs.length, 20); }

function updateUI(){
  $('cash').textContent = player.cash.toLocaleString();
  $('cashPill').classList.toggle('neg', player.cash < 0);
  const n = player.cover.size, total = INS_NAMES.length;
  $('level').textContent = n;
  $('levelBar').style.width = (n / total * 100) + '%';
  $('levelText').textContent = `${n}/${total}`;
  $('insRow').innerHTML = INS_NAMES.map(name =>
    `<div class="ins ${player.cover.has(name) ? 'on' : ''}" title="${name}">${INSURANCE[name].short}</div>`).join('');
}
function addCash(v){
  player.cash += v; updateUI();
  floatText((v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString(), v >= 0 ? 'gain' : 'loss');
}

function showCard({ title, text, tone = '', buttons = [{ label:'確定', primary:true }] }){
  return new Promise(resolve => {
    $('cardTitle').textContent = title;
    $('cardText').innerHTML = text;
    $('card').dataset.tone = tone;
    const box = $('cardBtns'); box.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.label; el.disabled = !!b.disabled;
      el.onclick = () => { $('card').classList.add('hidden'); b.fn && b.fn(); resolve(); };
      box.appendChild(el);
    });
    $('card').classList.remove('hidden');
  });
}

const PIPS = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };
function setDice(n){ $('dice').innerHTML = [...Array(9)].map((_, i) => `<span class="${PIPS[n].includes(i) ? 'on' : ''}"></span>`).join(''); }
function rollDice(){
  return new Promise(resolve => {
    const d = $('dice'); d.classList.add('rolling');
    const t = setInterval(() => setDice(1 + Math.floor(Math.random() * 6)), 70);
    setTimeout(() => {
      clearInterval(t); d.classList.remove('rolling');
      const n = 1 + Math.floor(Math.random() * 6); setDice(n); resolve(n);
    }, 700);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------
   7. 遊戲流程
   --------------------------------------------------------- */
let busy = false, round = 1;

async function takeTurn(){
  if (busy) return;
  busy = true; $('rollBtn').disabled = true; hush();

  const n = await rollDice();
  log(`第 ${round} 回合：擲出 <b>${n}</b> 點`);
  await wait(150);

  const from = player.idx, target = (from + n) % PATH.length;
  const points = [];
  for (let s = 1; s <= n; s++) points.push(grid.cellCenter(...PATH[(from + s) % PATH.length]));

  turn = { left: n };
  say(`剩餘${n}步`);
  await walkTo(points);
  turn = null;
  player.idx = target;

  const tile = LAYOUT[player.idx];
  say(`到達 ${tile.name}`);
  await wait(400);
  await resolveTile(tile);

  round++; $('round').textContent = round;
  busy = false; $('rollBtn').disabled = false;
}

async function resolveTile(tile){
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  switch (tile.type){
    case 'start':
      addCash(2000); log('停在起點，領薪水 <b>+$2,000</b>');
      return showCard({ title:'起點', tone:'good', text:'回到起點，領取薪水 <b>$2,000</b>！' });

    case 'ins': {
      const info = INSURANCE[tile.name];
      if (player.cover.has(tile.name))
        return showCard({ title:tile.name, tone:'ins', text:`你已擁有「${tile.name}」，保障持續中 🛡️` });
      return showCard({
        title:`投保 ${tile.name}？`, tone:'ins',
        text:`${info.d}<br>保費：<b>$${info.p.toLocaleString()}</b>`,
        buttons:[
          { label:`購買 $${info.p}`, primary:true, disabled: player.cash < info.p, fn: () => {
              player.cover.add(tile.name); addCash(-info.p); log(`購買了 <b>${tile.name}</b>`); } },
          { label:'先不要', fn: () => log(`略過 ${tile.name}`) },
        ]});
    }

    case 'risk':
    case 'hospital': {
      const pool = tile.type === 'hospital' ? RISKS.filter(r => r.health) : RISKS;
      const ev = pick(pool);
      if (player.cover.has(ev.cover)){
        log(`${ev.t}：<b>${ev.cover}</b> 理賠！`);
        return showCard({ title:'風險事件', tone:'good',
          text:`${ev.t}<br>損失 $${ev.cost.toLocaleString()}，但你有 <b>${ev.cover}</b>，由保險理賠，自付 $0！` });
      }
      addCash(-ev.cost); log(`${ev.t}：自付 -$${ev.cost.toLocaleString()}`);
      return showCard({ title:'風險事件', tone:'bad',
        text:`${ev.t}<br>沒有 ${ev.cover}，需自行負擔 <b>$${ev.cost.toLocaleString()}</b>。` });
    }

    case 'chance': {
      const ev = pick(CHANCES); addCash(ev.v); log(`機會：${ev.t}`);
      return showCard({ title:'機會', tone: ev.v >= 0 ? 'good' : 'bad',
        text:`${ev.t}<br><b>${ev.v >= 0 ? '+' : '-'}$${Math.abs(ev.v).toLocaleString()}</b>` });
    }

    case 'invest': {
      const ev = pick(MARKET); addCash(ev.v); log(`市場：${ev.t}`);
      return showCard({ title:'投資理財', tone: ev.v >= 0 ? 'good' : 'bad',
        text:`${ev.t}<br><b>${ev.v >= 0 ? '+' : '-'}$${Math.abs(ev.v).toLocaleString()}</b>` });
    }

    case 'salary':
      addCash(2000); log('發薪日 <b>+$2,000</b>');
      return showCard({ title:'發薪日', tone:'good', text:'辛苦工作一個月，薪水入帳 <b>$2,000</b>！' });

    case 'bank': {
      const v = Math.max(0, Math.round(player.cash * 0.02));
      addCash(v); log(`定存利息 <b>+$${v.toLocaleString()}</b>`);
      return showCard({ title:'銀行', tone:'good', text:`存款產生 2% 利息：<b>$${v.toLocaleString()}</b>` });
    }

    case 'rest':
      log('在咖啡廳休息一下');
      return showCard({ title:'咖啡廳', text:'喝杯咖啡，順便檢視一下自己的保障缺口吧 ☕' });
  }
}

/* 我的保障 / 事件紀錄 */
function showCover(){
  if (busy) return;
  const rows = INS_NAMES.map(n => {
    const on = player.cover.has(n);
    return `<div class="cover-row ${on ? 'on' : ''}"><span class="ins ${on ? 'on' : ''}">${INSURANCE[n].short}</span>
      <span><b>${n}</b>　${on ? '已投保' : '未投保'}<br><small>${INSURANCE[n].d}</small></span></div>`;
  }).join('');
  showCard({ title:'我的保障', tone:'ins', text:`<div class="cover-list">${rows}</div>`, buttons:[{ label:'關閉', primary:true }] });
}
function showLog(){
  if (busy) return;
  showCard({ title:'事件紀錄', text:`<div class="log-list">${logs.join('<br>') || '還沒有紀錄'}</div>`, buttons:[{ label:'關閉', primary:true }] });
}

/* ---------------------------------------------------------
   8. 啟動
   --------------------------------------------------------- */
$('rollBtn').addEventListener('click', takeTurn);
$('coverBtn').addEventListener('click', showCover);
$('logBtn').addEventListener('click', showLog);
addEventListener('keydown', e => { if (e.code === 'Space'){ e.preventDefault(); takeTurn(); } });
addEventListener('resize', () => { resize(); updateCamera(0, true); });

(function drawAvatar(){
  const c = $('avatar'), g = c.getContext('2d');
  HERO.slice(1, 18).forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return; g.fillStyle = HERO_PAL[ch]; g.fillRect(x, y + 3, 1, 1);
  }));
})();
resize();
setDice(1);
updateUI();
log('歡迎來到保險大富翁！');
updateCamera(0, true);
requestAnimationFrame(frame);

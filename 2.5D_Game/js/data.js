/* =========================================================
   遊戲資料：路線、格子類型、事件內容
   之後要換成 AI 生成事件，只需替換這個檔案的資料
   ========================================================= */

/* ---------- 路線：用轉角點描述一條不規則的環狀道路 ----------
   座標是地面網格 (gx, gy)，相鄰兩點必須同一列或同一行。
   想改地圖形狀，只要改這串轉角點即可。 */
const ROUTE_CORNERS = [
  [0, 0], [6, 0], [6, -4], [12, -4], [12, 2], [16, 2], [16, 9], [11, 9],
  [11, 13], [17, 13], [17, 20], [10, 20], [10, 17], [5, 17], [5, 22], [-2, 22],
  [-2, 16], [-7, 16], [-7, 10], [-3, 10], [-3, 6], [-8, 6], [-8, 1], [-4, 1],
  [-4, -3], [0, -3],
];
const PATH = [];
ROUTE_CORNERS.forEach(([x0, y0], i) => {
  const [x1, y1] = ROUTE_CORNERS[(i + 1) % ROUTE_CORNERS.length];
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  for (let x = x0, y = y0; x !== x1 || y !== y1; x += sx, y += sy) PATH.push([x, y]);
});
const PATH_INDEX = new Map(PATH.map(([i, j], k) => [`${i},${j}`, k]));

/* 從路線轉角往外延伸、純裝飾用的街道（沒有事件格） */
const SIDE_STREETS = [
  // 往城市外圍延伸
  { from: [6, -4],  dir: [0, -1] }, { from: [12, -4], dir: [0, -1] }, { from: [16, 2],  dir: [1, 0] },
  { from: [16, 9],  dir: [1, 0] },  { from: [17, 13], dir: [1, 0] },  { from: [17, 20], dir: [0, 1] },
  { from: [10, 20], dir: [0, 1] },  { from: [5, 22],  dir: [0, 1] },  { from: [-2, 22], dir: [-1, 0] },
  { from: [-7, 16], dir: [-1, 0] }, { from: [-8, 6],  dir: [-1, 0] }, { from: [-8, 1],  dir: [0, -1] },
  { from: [-4, -3], dir: [-1, 0] }, { from: [0, -3],  dir: [0, -1] },
  // 穿過路線內部、把街廓切開的道路（碰到路線就停）
  { from: [11, 13], dir: [-1, 0] }, { from: [5, 17],  dir: [0, -1] },
];

const TYPES = {
  start:   { color:'#f6c945', icon:'flag'   },
  ins:     { color:'#6fc3f5', icon:'shield' },
  chance:  { color:'#ffab5c', icon:'q'      },
  risk:    { color:'#f47c7c', icon:'bolt'   },
  invest:  { color:'#7fd38a', icon:'up'     },
  salary:  { color:'#ffd95e', icon:'coin'   },
  rest:    { color:'#c9a8f0', icon:'cup'    },
  hospital:{ color:'#ff9fbd', icon:'cross'  },
  bank:    { color:'#9fd6e8', icon:'bank'   },
};

/* ---------- 每一格的事件（依路線長度自動排列） ---------- */
const INS_NAMES = ['醫療險','意外險','壽險','產物險','長照險','旅平險'];
const NAMES = { start:'起點', chance:'機會', risk:'風險事件', invest:'投資理財', salary:'發薪日', rest:'咖啡廳', hospital:'醫院', bank:'銀行' };
const LAYOUT = (() => {
  // 起點固定在第 0 格；之後每 11 格輪流放咖啡廳、醫院、銀行
  const special = { 0:'start' };
  const SPECIAL_CYCLE = ['rest', 'hospital', 'bank'];
  for (let k = 11, i = 0; k < PATH.length - 3; k += 11, i++) special[k] = SPECIAL_CYCLE[i % SPECIAL_CYCLE.length];
  const cycle = ['ins','risk','chance','invest','risk','salary','ins','chance','risk','invest'];
  let c = 0, ins = 0;
  return PATH.map((_, k) => {
    const type = special[k] || cycle[c++ % cycle.length];
    const name = type === 'ins' ? INS_NAMES[ins++ % INS_NAMES.length] : NAMES[type];
    return { type, name };
  });
})();

/* ---------- 鏡頭：每 5 格為一個跟隨區塊（只影響鏡頭，不顯示名稱） ---------- */
const ROOM_SIZE = 5;
const INSURANCE = {
  '醫療險':{ p:800,  d:'住院、手術等醫療費用的保障。',     short:'醫' },
  '意外險':{ p:500,  d:'因意外事故造成的傷害、失能保障。', short:'意' },
  '壽險':  { p:1200, d:'萬一身故時，給家人一筆生活保障。', short:'壽' },
  '產物險':{ p:600,  d:'住宅火災、地震等財產損失保障。',   short:'產' },
  '長照險':{ p:1000, d:'需要長期照顧時，按月提供照護金。', short:'長' },
  '旅平險':{ p:300,  d:'出國旅遊的意外、醫療與不便保障。', short:'旅' },
};
const RISKS = [
  { t:'騎機車擦撞，住院 3 天',   cost:6000,  cover:'意外險', health:true },
  { t:'急性腸胃炎，掛急診打點滴', cost:3000,  cover:'醫療險', health:true },
  { t:'家中電線走火，裝潢受損',   cost:8000,  cover:'產物險' },
  { t:'出國行李遺失、班機延誤',   cost:4000,  cover:'旅平險' },
  { t:'家人中風，需要長期照顧',   cost:10000, cover:'長照險', health:true },
  { t:'家庭經濟支柱發生意外',     cost:12000, cover:'壽險' },
];
const CHANCES = [
  { t:'年終獎金入帳！',            v:3000 },
  { t:'統一發票中了 1000 元',      v:1000 },
  { t:'參加理財講座，學到記帳技巧', v:500  },
  { t:'手機摔壞，只好換新的',      v:-1500 },
  { t:'朋友結婚，包了紅包',        v:-1200 },
];
const MARKET = [
  { t:'台股大漲，ETF 帳面獲利',     v:1800 },
  { t:'科技股回檔，資產縮水',       v:-1500 },
  { t:'央行升息，債券價格下跌',     v:-800 },
  { t:'定期定額持續累積，穩定配息', v:900 },
];

/* 像素圖示（7x7）：x = 主色、o = 白色 */
const ICONS = {
  flag:  ["x......","xxxx...","xxxxxx.","xxxx...","x......","x......","x......"],
  shield:[".xxxxx.","xxxoxxx","xxoooxx","xxxoxxx",".xxxxx.","..xxx..","...x..."],
  q:     ["..xxx..",".xx.xx.","....xx.","...xx..","...x...",".......","...x..."],
  bolt:  ["....xx.","...xx..","..xx...",".xxxxx.","...xx..","..xx...",".xx...."],
  up:    ["...x...","..xxx..",".xxxxx.","...x...","...x...","...x...","xxxxxxx"],
  coin:  ["..xxx..",".xxoxx.","xxoooxx","xxxoxxx","xxoooxx",".xxoxx.","..xxx.."],
  cup:   ["..x.x..",".x.x...","xxxxxx.","xxxxx.x","xxxxxx.",".xxxx..","xxxxxx."],
  cross: ["..xxx..","..xxx..","xxxxxxx","xxxxxxx","xxxxxxx","..xxx..","..xxx.."],
  bank:  ["...x...","..xxx..","xxxxxxx",".x.x.x.",".x.x.x.",".x.x.x.","xxxxxxx"],
};

/* ---------- 主角：Q 版上班族（24 x 34 像素，提公事包） ---------- */
const HERO = [
  "........................",
  ".......kkkkkkkkkk.......",
  ".....kkhhhhhhhhhhkk.....",
  ".....khhhhHHhhhhhhk.....",
  "....khhhhhHHhhhhhhhk....",
  "...khhhhhhhhhhhhhhhhk...",
  "...khhhhhhhhhhhhhhhhk...",
  "...khhhssshhhhhssshhk...",
  "...khhsssssssssssshhk...",
  "...khsssssssssssssshk...",
  "...khssskksssskkssshk...",
  "...khssskksssskkssshk...",
  "...khsrssssssssssrshk...",
  "...khssssssmmsssssshk...",
  "....kSssssssssssssSk....",
  "......kSSssssssSSk......",
  ".......kkkssssskkk......",
  "......knnnwwwwnnnk......",
  ".....knnnnwttwnnnnk.....",
  "....knnnnnNttNnnnnnk....",
  "...knnnnnnNttNnnnnnnk...",
  "...knNnnnnnttnnnnnNnk...",
  "...kNnnnnnnttnnnnnnNk...",
  "...kNnnnnnnnnnnnnnnNk...",
  "...kNnnnnnnnnnnnnnnNk...",
  "...ksnnnnnnnnnnnnnnskk..",
  "....kppppppppppppppkkcck",
  "....kppppppkkppppppkkCck",
  ".....kppppk..kppppk.kcck",
  ".....kppppk..kppppk.kcck",
  ".....kppppk..kppppk.kkkk",
  ".....kbbbbk..kbbbbk.....",
  "....kbbbbbk..kbbbbbk....",
  ".....kkkkk....kkkkk.....",
];
const HERO_PAL = {
  k:'#1f1a24', h:'#2f2734', H:'#56485e', s:'#f6d2b4', S:'#e3b392', r:'#f0a0a0', m:'#b8645a',
  w:'#f4f4f4', t:'#8a2b3a', n:'#2b3346', N:'#414b63', p:'#232838', b:'#121216', c:'#5b3d2a', C:'#7d573c',
};

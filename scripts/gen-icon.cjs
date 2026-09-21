// 生成应用源图标（纯 Node，无外部依赖）：1024x1024 PNG
// 设计：深蓝渐变圆角底 + 等距堆叠集装箱（批量）+ 琥珀色齿轮（构建），2x 超采样抗锯齿
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 1024, SS = 2;          // 输出尺寸 / 超采样倍数
const W = S * SS, H = S * SS;

// ── PNG 编码（CRC32 + chunk）──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// ── 画布（RGBA），默认全透明 ──
const px = Buffer.alloc(W * H * 4);
const put = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};
const blend = (x, y, [r, g, b], a) => {
  if (a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = a / 255, da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  px[i]     = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
};

// ── 几何工具（坐标一律 1024 空间，绘制时乘 SS）──
const inRoundRect = (x, y, x0, y0, x1, y1, rad) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
  const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};
const inPoly = (x, y, pts) => {           // 射线法，任意凸/凹多边形
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const fillPoly = (pts, color, a = 255, clip) => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.floor(Math.min(...xs) * SS), x1 = Math.ceil(Math.max(...xs) * SS);
  const y0 = Math.floor(Math.min(...ys) * SS), y1 = Math.ceil(Math.max(...ys) * SS);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = x / SS, v = y / SS;
    if (clip && !clip(u, v)) continue;
    if (inPoly(u, v, pts)) blend(x, y, color, a);
  }
};

// 等距集装箱：a 半高（顶菱）/ b 半宽 / d 体高
const container = (cx, cy, a, b, d, alpha) => {
  const top = [[cx, cy - 2 * a], [cx + b, cy - a], [cx, cy], [cx - b, cy - a]];
  const left = [[cx - b, cy - a], [cx, cy], [cx, cy + d], [cx - b, cy - a + d]];
  const right = [[cx, cy], [cx + b, cy - a], [cx + b, cy - a + d], [cx, cy + d]];
  fillPoly(top, [252, 253, 255], alpha);
  fillPoly(left, [233, 242, 253], alpha);
  fillPoly(right, [188, 216, 247], alpha);
  if (b >= 200) {
    // 左面波纹（仅主箱，小尺寸保持干净）
    for (let k = 1; k <= 5; k++) {
      const rx = cx - b + (b * k) / 6;
      fillPoly([[rx - 4, cy - a - 999], [rx + 4, cy - a - 999], [rx + 4, cy + d + 999], [rx - 4, cy + d + 999]], [205, 226, 250], Math.round(alpha * 0.9), (u, v) => inPoly(u, v, left));
    }
    // 右面箱门缝
    const mx = cx + b / 2;
    fillPoly([[mx - 3, cy - a - 999], [mx + 3, cy - a - 999], [mx + 3, cy + d + 999], [mx - 3, cy + d + 999]], [150, 188, 232], Math.round(alpha * 0.9), (u, v) => inPoly(u, v, right));
  }
};

// ── 1. 背景 squircle 渐变 ──
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const u = x / SS, v = y / SS;
  if (inRoundRect(u, v, 96, 96, S - 96, S - 96, 216)) {
    const t = (x + y) / (W + H);                    // 左上→右下
    put(x, y, Math.round(30 + 40 * (1 - t)), Math.round(112 - 46 * t), Math.round(214 - 92 * t), 255);
  } else put(x, y, 0, 0, 0, 0);
}

// ── 2. 集装箱：两枚半透明垫后 + 一枚主体在前 ──
container(352, 322, 84, 132, 92, 150);              // 左后小箱
container(700, 292, 78, 122, 86, 150);              // 右后小箱
container(488, 548, 150, 250, 172, 255);            // 主箱

// ── 3. 琥珀齿轮（右下，收进圆角安全区）──
const gx = 766, gy = 750, gr = 112, tooth = 26, hole = 42;
for (let y = Math.floor((gy - gr - tooth) * SS); y <= Math.ceil((gy + gr + tooth) * SS); y++)
  for (let x = Math.floor((gx - gr - tooth) * SS); x <= Math.ceil((gx + gr + tooth) * SS); x++) {
    const u = x / SS - gx, v = y / SS - gy;
    const dist = Math.hypot(u, v), ang = Math.atan2(v, u);
    const toothOn = Math.cos(8 * ang) > 0.62;
    const rr = toothOn ? gr + tooth : gr;
    if (dist <= rr) {
      if (dist >= gr - 6 && !toothOn) continue;     // 无齿处收进内圈，齿感更清晰
      if (dist <= hole) blend(x, y, [23, 63, 128], 255);   // 中心孔
      else blend(x, y, [255, 168, 46], 255);               // 琥珀
    }
  }

// ── 4. 降采样 → 1024 + PNG 输出 ──
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    let acc = [0, 0, 0, 0];
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = (((y * SS + dy) * W) + x * SS + dx) * 4;
      for (let c = 0; c < 4; c++) acc[c] += px[i + c];
    }
    const o = y * (S * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 4; c++) raw[o + c] = acc[c] / (SS * SS);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('icon written:', S + 'x' + S, png.length, 'bytes');

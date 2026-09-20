// 生成应用源图标（纯 Node，无外部依赖）：1024x1024 PNG，蓝紫渐变 + 深色圆角边框 + 简化"容器"图案
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 1024, H = 1024;

// PNG 需要 CRC32
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

const px = Buffer.alloc(W * H * 4);
function setPixel(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
// 圆角矩形判定
function inRoundRect(x, y, x0, y0, x1, y1, rad) {
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad || (x >= x0 && x <= x1 && y >= y0 && y <= y1);
}
// 圆角外框（边框环）
function ring(x, y, x0, y0, x1, y1, rad, w) {
  return inRoundRect(x, y, x0, y0, x1, y1, rad) && !inRoundRect(x, y, x0 + w, y0 + w, x1 - w, y1 - w, Math.max(0, rad - w));
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (x + y) / (W + H);
    // 背景：透明（应用图标习惯留底）→ 使用深蓝渐变主体
    if (inRoundRect(x, y, 64, 64, W - 64, H - 64, 160)) {
      const r = Math.round(28 + 34 * t);
      const g = Math.round(88 + 52 * t);
      const b = Math.round(176 + 56 * t);
      setPixel(x, y, r, g, b, 255);
    } else {
      setPixel(x, y, 0, 0, 0, 0);
    }
  }
}
// 三条"镜像层"横条（白色，形似分层镜像）
for (const [y0, y1] of [[292, 356], [452, 516], [612, 676]]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = 256; x <= 768; x++) {
      if (inRoundRect(x, y, 256, y0, 768, y1, 32)) setPixel(x, y, 245, 248, 255, 255);
    }
  }
}
// 外框描边
for (let y = 64; y < H - 64; y++)
  for (let x = 64; x < W - 64; x++)
    if (ring(x, y, 64, 64, W - 64, H - 64, 160, 18)) setPixel(x, y, 16, 34, 66, 255);

// 组装 PNG（每行前置 filter byte 0）
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log('icon written:', out, png.length, 'bytes');

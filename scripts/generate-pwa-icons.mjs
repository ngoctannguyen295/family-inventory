// Script tạo icon PNG nhị phân thật 100% bằng Node.js zlib
// Xuất ra: pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png, apple-touch-icon-180x180.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

// Bảng tính CRC32 chuẩn PNG
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf, offset = 0, length = buf.length - offset) {
  let c = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);

  const typeAndData = Buffer.concat([typeBuf, dataBuf]);
  const crcVal = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function createPngBuffer(width, height, getPixelRgba) {
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression: 0
  ihdrData[11] = 0; // Filter: 0
  ihdrData[12] = 0; // Interlace: 0
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw Scanlines (1 filter byte 0 + width * 4 bytes RGBA)
  const bytesPerScanline = 1 + width * 4;
  const rawScanlines = Buffer.alloc(height * bytesPerScanline);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * bytesPerScanline;
    rawScanlines[lineOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = lineOffset + 1 + x * 4;
      // 2x2 Subpixel supersampling for anti-aliasing
      let totalR = 0, totalG = 0, totalB = 0, totalA = 0;
      for (const dy of [0.25, 0.75]) {
        for (const dx of [0.25, 0.75]) {
          const [r, g, b, a] = getPixelRgba(x + dx, y + dy, width, height);
          totalR += r;
          totalG += g;
          totalB += b;
          totalA += a;
        }
      }
      rawScanlines[pixelOffset] = Math.round(totalR / 4);
      rawScanlines[pixelOffset + 1] = Math.round(totalG / 4);
      rawScanlines[pixelOffset + 2] = Math.round(totalB / 4);
      rawScanlines[pixelOffset + 3] = Math.round(totalA / 4);
    }
  }

  const compressedData = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSig, ihdrChunk, idatChunk, iendChunk]);
}

// Kiểm tra điểm nằm trong đa giác lồi theo thứ tự cùng chiều kim đồng hồ
function pointInConvexPoly(px, py, vertices) {
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross < 0) return false;
  }
  return true;
}

/**
 * Trả về [R, G, B, A] cho pixel tại tọa độ (x, y)
 * @param {boolean} isMaskable - nếu true, dùng tỉ lệ an toàn 0.44 và nền tràn viền
 */
function renderBoxPixel(x, y, width, height, isMaskable = false) {
  const nx = (x - width / 2) / (width / 2);
  const ny = (y - height / 2) / (height / 2);

  // Nền xanh thương hiệu #2563eb
  const bgR = 37, bgG = 99, bgB = 235;

  // Tỉ lệ hộp hàng: maskable cần safe zone (<= 0.45)
  const scale = isMaskable ? 0.43 : 0.56;
  const centerY = 0.04; // Hơi dịch xuống một chút để cân bằng trọng tâm 3D

  // Tọa độ các đỉnh của hộp hàng isometric
  // Đỉnh trên cùng: (0, -0.68)
  // Đỉnh giữa top: (0, 0.08)
  // Đỉnh trái top: (-0.78, -0.30)
  // Đỉnh phải top: (0.78, -0.30)
  // Đỉnh đáy giữa: (0, 0.72)
  // Đỉnh đáy trái: (-0.78, 0.34)
  // Đỉnh đáy phải: (0.78, 0.34)

  const topV = { x: 0 * scale, y: (-0.68 + centerY) * scale };
  const rightV = { x: 0.78 * scale, y: (-0.30 + centerY) * scale };
  const centerV = { x: 0 * scale, y: (0.08 + centerY) * scale };
  const leftV = { x: -0.78 * scale, y: (-0.30 + centerY) * scale };
  const bottomV = { x: 0 * scale, y: (0.72 + centerY) * scale };
  const bottomLeftV = { x: -0.78 * scale, y: (0.34 + centerY) * scale };
  const bottomRightV = { x: 0.78 * scale, y: (0.34 + centerY) * scale };

  // 1. Mặt nắp trên (Top face)
  const topPoly = [topV, rightV, centerV, leftV];
  if (pointInConvexPoly(nx, ny, topPoly)) {
    // Băng dính niêm phong chạy dọc giữa nắp trên
    const tapeTop = [
      { x: -0.12 * scale, y: (-0.68 + 0.05 + centerY) * scale },
      { x: 0.12 * scale, y: (-0.68 + 0.05 + centerY) * scale },
      { x: 0.12 * scale, y: (0.08 - 0.02 + centerY) * scale },
      { x: -0.12 * scale, y: (0.08 - 0.02 + centerY) * scale },
    ];
    if (pointInConvexPoly(nx, ny, tapeTop)) {
      // Băng keo sáng màu #ffffff
      return [255, 255, 255, 255];
    }
    // Màu mặt trên carton (sáng nhất do hướng sáng từ trên)
    return [254, 215, 170, 255]; // #fed7aa
  }

  // 2. Mặt trước bên trái (Left face)
  const leftPoly = [leftV, centerV, bottomV, bottomLeftV];
  if (pointInConvexPoly(nx, ny, leftPoly)) {
    // Băng dính tiếp tục chạy xuống mép giữa mặt trái
    const tapeLeft = [
      { x: -0.12 * scale, y: (0.08 - 0.02 + centerY) * scale },
      { x: 0 * scale, y: (0.08 + centerY) * scale },
      { x: 0 * scale, y: (0.42 + centerY) * scale },
      { x: -0.12 * scale, y: (0.36 + centerY) * scale },
    ];
    if (pointInConvexPoly(nx, ny, tapeLeft)) {
      return [255, 255, 255, 255];
    }
    // Màu mặt bên trái (ánh sáng trung bình)
    return [245, 158, 11, 255]; // #f59e0b
  }

  // 3. Mặt trước bên phải (Right face)
  const rightPoly = [centerV, rightV, bottomRightV, bottomV];
  if (pointInConvexPoly(nx, ny, rightPoly)) {
    // Tem vận chuyển/nhãn kiểm kho dán trên mặt phải
    const labelPoly = [
      { x: 0.22 * scale, y: (0.02 + centerY) * scale },
      { x: 0.58 * scale, y: (-0.12 + centerY) * scale },
      { x: 0.58 * scale, y: (0.16 + centerY) * scale },
      { x: 0.22 * scale, y: (0.30 + centerY) * scale },
    ];
    if (pointInConvexPoly(nx, ny, labelPoly)) {
      // Tem trắng có sọc tượng trưng mã vạch
      const localY = (ny - (0.02 + centerY) * scale) / (0.28 * scale);
      if (localY > 0.4 && localY < 0.48) return [30, 41, 59, 255]; // vạch mã
      if (localY > 0.56 && localY < 0.64) return [30, 41, 59, 255]; // vạch mã
      if (localY > 0.72 && localY < 0.78) return [37, 99, 235, 255]; // vạch xanh
      return [255, 255, 255, 255];
    }
    // Màu mặt bên phải (bóng đổ nhẹ)
    return [217, 119, 6, 255]; // #d97706
  }

  // Nền xung quanh
  return [bgR, bgG, bgB, 255];
}

function main() {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const iconsToGenerate = [
    { name: 'pwa-192x192.png', width: 192, height: 192, maskable: false },
    { name: 'pwa-512x512.png', width: 512, height: 512, maskable: false },
    { name: 'maskable-icon-512x512.png', width: 512, height: 512, maskable: true },
    { name: 'apple-touch-icon-180x180.png', width: 180, height: 180, maskable: false },
  ];

  for (const item of iconsToGenerate) {
    console.log(`Đang sinh icon PNG chuẩn: ${item.name} (${item.width}x${item.height})...`);
    const buf = createPngBuffer(item.width, item.height, (x, y, w, h) =>
      renderBoxPixel(x, y, w, h, item.maskable)
    );
    const destPath = path.join(publicDir, item.name);
    fs.writeFileSync(destPath, buf);

    // Kiểm tra magic bytes
    const sig = buf.subarray(0, 8);
    const valid =
      sig[0] === 0x89 &&
      sig[1] === 0x50 &&
      sig[2] === 0x4e &&
      sig[3] === 0x47 &&
      sig[4] === 0x0d &&
      sig[5] === 0x0a &&
      sig[6] === 0x1a &&
      sig[7] === 0x0a;

    console.log(
      `✓ Đã tạo ${item.name}: ${buf.length} bytes (Magic bytes hợp lệ: ${valid})`
    );
  }

  console.log('\nĐã hoàn thành sinh 4 icon PNG PWA thành công!');
}

main();

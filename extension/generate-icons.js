import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPNG(size, primaryColor = [0, 242, 254], secondaryColor = [79, 172, 254]) {
  const width = size;
  const height = size;
  
  // Raw RGBA pixel buffer with filter byte per scanline
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  const radius = width / 2;
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius - 1) {
        // Gradient color
        const t = (x + y) / (width + height);
        const r = Math.round(primaryColor[0] * (1 - t) + secondaryColor[0] * t);
        const g = Math.round(primaryColor[1] * (1 - t) + secondaryColor[1] * t);
        const b = Math.round(primaryColor[2] * (1 - t) + secondaryColor[2] * t);

        // Center download arrow mark
        const isArrow = 
          (Math.abs(dx) <= 2 && dy >= -height * 0.25 && dy <= height * 0.15) || // stem
          (dy >= height * 0.1 && dy <= height * 0.25 && Math.abs(dx) <= (height * 0.25 - dy) * 1.5); // point

        if (isArrow) {
          rawData[pxOffset] = 6;
          rawData[pxOffset + 1] = 9;
          rawData[pxOffset + 2] = 17;
          rawData[pxOffset + 3] = 255;
        } else {
          rawData[pxOffset] = r;
          rawData[pxOffset + 1] = g;
          rawData[pxOffset + 2] = b;
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // Compress IDAT
  const compressedData = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = makeChunk('IDAT', compressedData);

  // IEND Chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Standard CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const iconsDir = path.join(process.cwd(), 'extension', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), createPNG(16));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), createPNG(48));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), createPNG(128));

console.log('Icons generated successfully in extension/icons/');

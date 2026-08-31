// 构建时：记录图片参数（分辨率/大小/EXIF）到 source/image_meta.json
// 这里使用 Node 自带的 Buffer 解析 JPEG，避免依赖 ImageMagick。
const fs = require('fs');
const path = require('path');
const out = {};

function rational(buf, offset, little) {
  const n = little ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  const d = little ? buf.readUInt32LE(offset + 4) : buf.readUInt32BE(offset + 4);
  return d ? n / d : 0;
}

function parseJpeg(buf) {
  const exif = {};
  let width = 0, height = 0, tiff = -1;
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { width, height, exif };
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = buf.readUInt16BE(off + 2);
    if (size < 2 || off + 2 + size > buf.length) break;
    if (marker === 0xe1 && buf.toString('ascii', off + 4, off + 10) === 'Exif\0\0') tiff = off + 10;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      height = buf.readUInt16BE(off + 5);
      width = buf.readUInt16BE(off + 7);
    }
    off += 2 + size;
  }
  if (tiff < 0 || tiff + 8 > buf.length) return { width, height, exif };
  const little = buf.toString('ascii', tiff, tiff + 2) === 'II';
  if (!little && buf.toString('ascii', tiff, tiff + 2) !== 'MM') return { width, height, exif };
  const u16 = o => little ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = o => little ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const typeBytes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  function value(type, count, pos) {
    const bytes = (typeBytes[type] || 1) * count;
    const p = bytes <= 4 ? pos : tiff + u32(pos);
    if (p < 0 || p + bytes > buf.length) return null;
    if (type === 2) return buf.toString('utf8', p, p + count).replace(/\0+$/, '').trim();
    if (type === 3) return Array.from({ length: count }, (_, i) => u16(p + i * 2));
    if (type === 4) return Array.from({ length: count }, (_, i) => u32(p + i * 4));
    if (type === 5) return Array.from({ length: count }, (_, i) => rational(buf, p + i * 8, little));
    if (type === 1 || type === 7) return Array.from(buf.subarray(p, p + count));
    return null;
  }
  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function formatRatio(v) { return typeof v === 'number' && isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) : ''; }
  function dms(v) { return Array.isArray(v) && v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : NaN; }
  function scan(ifd, callback) {
    if (!ifd || ifd < 0 || ifd + 2 > buf.length) return;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > buf.length) break;
      const tag = u16(entry), type = u16(entry + 2), number = u32(entry + 4);
      callback(tag, type, number, value(type, number, entry + 8));
    }
  }
  let gps = {};
  function scanIfd(ifd) {
    scan(ifd, (tag, type, count, v) => {
      if (tag === 0x010f) exif.Make = first(v);
      else if (tag === 0x0110) exif.Model = first(v);
      else if (tag === 0x829d) exif.FNumber = formatRatio(first(v));
      else if (tag === 0x829a) exif.ExposureTime = formatRatio(first(v));
      else if (tag === 0x8827) exif.ISO = first(v);
      else if (tag === 0x920a) exif.FocalLength = formatRatio(first(v));
      else if (tag === 0xa405) exif.FocalLength35 = formatRatio(first(v));
      else if (tag === 0x9209) exif.Flash = first(v);
      else if (tag === 0x9003) exif.DateTimeOriginal = first(v);
      else if (tag === 0x8769) scanIfd(tiff + first(v));
      else if (tag === 0x8825) scanGps(tiff + first(v));
    });
  }
  function scanGps(ifd) {
    scan(ifd, (tag, type, count, v) => {
      if (tag === 1) gps.latRef = first(v);
      else if (tag === 2) gps.lat = v;
      else if (tag === 3) gps.lngRef = first(v);
      else if (tag === 4) gps.lng = v;
    });
  }
  scanIfd(tiff + u32(tiff + 4));
  if (gps.lat && gps.lng) {
    let lat = dms(gps.lat), lng = dms(gps.lng);
    if (/^S/i.test(gps.latRef)) lat = -lat;
    if (/^W/i.test(gps.lngRef)) lng = -lng;
    if (!isNaN(lat) && !isNaN(lng)) {
      exif.GPS = lat.toFixed(6) + ', ' + lng.toFixed(6);
      exif.GPSUrl = 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6);
    }
  }
  return { width, height, exif };
}

function dimensions(buf) {
  if (buf.length >= 24 && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 10 && (buf.toString('ascii', 0, 6) === 'GIF89a' || buf.toString('ascii', 0, 6) === 'GIF87a')) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.toString('ascii', 12, 16) === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  return { width: 0, height: 0 };
}

function walk(dir) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  list.forEach(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    if (!/\.(jpg|jpeg|png|webp|gif|avif)$/i.test(entry.name)) return;
    const buf = fs.readFileSync(file);
    const parsed = parseJpeg(buf);
    const size = dimensions(buf);
    const ref = '/' + path.relative('source', file).replace(/\\/g, '/');
    out[ref] = { width: parsed.width || size.width, height: parsed.height || size.height, size: buf.length, exif: parsed.exif };
  });
}

walk('source/images');
fs.writeFileSync('source/image_meta.json', JSON.stringify(out));
console.log('image_meta.json written with ' + Object.keys(out).length + ' images');

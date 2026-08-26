// 构建时：记录原图参数（分辨率/大小/EXIF）到 source/image_meta.json
const fs = require('fs'), cp = require('child_process');
const out = {};
function walk(d) {
  let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
  list.forEach(x => {
    const p = d + '/' + x.name;
    if (x.isDirectory()) walk(p);
    else if (/\.(jpg|jpeg|png|webp|gif|avif)$/i.test(x.name)) {
      const ref = p.replace(/^source\//, '/');
      const fmt = "%w %h %b";
      const exif = "%[EXIF:Make]|%[EXIF:Model]|%[EXIF:ExposureTime]|%[EXIF:FNumber]|%[EXIF:ISOSpeedRatings]|%[EXIF:FocalLength]|%[EXIF:DateTimeOriginal]";
      try {
        const f = cp.execSync("identify -format '" + fmt + "' \"" + p + "\"", { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\s+/);
        const e = cp.execSync("identify -format '" + exif + "' \"" + p + "\"", { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('|');
        const ex = {}; const ks = ['Make', 'Model', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'DateTimeOriginal'];
        ks.forEach((k, i) => { const v = (e[i] || '').trim(); if (v) ex[k] = v; });
        out[ref] = { width: +f[0], height: +f[1], size: f[2] || '', exif: ex };
      } catch (err) {}
    }
  });
}
walk('source/images');
fs.writeFileSync('source/image_meta.json', JSON.stringify(out));
console.log('image_meta.json written with ' + Object.keys(out).length + ' images');

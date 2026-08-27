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
      const fmt = "%w %h";
      const exif = "%[EXIF:Make]|%[EXIF:Model]|%[EXIF:ExposureTime]|%[EXIF:FNumber]|%[EXIF:ISOSpeedRatings]|%[EXIF:FocalLength]|%[EXIF:DateTimeOriginal]|%[EXIF:FocalLengthIn35mmFilm]|%[EXIF:Flash]|%[EXIF:GPSLatitude]|%[EXIF:GPSLongitude]|%[EXIF:GPSLatitudeRef]|%[EXIF:GPSLongitudeRef]";
      try {
        const f = cp.execSync("identify -format '" + fmt + "' \"" + p + "\"", { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\s+/);
        const e = cp.execSync("identify -format '" + exif + "' \"" + p + "\"", { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('|');
        const ex = {}; const ks = ['Make', 'Model', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'DateTimeOriginal', 'FocalLength35', 'Flash', 'GPSLat', 'GPSLng', 'GPSLatRef', 'GPSLngRef'];
        ks.forEach((k, i) => { const v = (e[i] || '').trim(); if (v) ex[k] = v; });
        function dms(s){ if(!s) return NaN; const parts = String(s).trim().split(/[,\s]+/); if(parts.length < 3) return NaN; function val(x){ const p = String(x).split('/'); return p.length === 2 ? (+p[0] / +p[1]) : +x; } return val(parts[0]) + val(parts[1]) / 60 + val(parts[2]) / 3600; }
        if (ex.GPSLat && ex.GPSLng) { let la = dms(ex.GPSLat), ln = dms(ex.GPSLng); if (/^S/i.test(ex.GPSLatRef)) la = -la; if (/^W/i.test(ex.GPSLngRef)) ln = -ln; if (!isNaN(la) && !isNaN(ln)) { ex.GPS = la.toFixed(6) + ', ' + ln.toFixed(6); ex.GPSUrl = 'https://www.google.com/maps?q=' + la.toFixed(6) + ',' + ln.toFixed(6); } }
        out[ref] = { width: +f[0], height: +f[1], size: fs.statSync(p).size, exif: ex };
      } catch (err) { console.error('meta skip', p, err.message); }
    }
  });
}
walk('source/images');
fs.writeFileSync('source/image_meta.json', JSON.stringify(out));
console.log('image_meta.json written with ' + Object.keys(out).length + ' images');

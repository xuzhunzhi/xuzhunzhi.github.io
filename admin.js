// ============================================================
// 流浪猫的避难所 · 本地管理面板 (纯 Node，零依赖)
// 运行：node admin.js  然后浏览器打开 http://localhost:4001
// 功能：新建/编辑/删除文章（Markdown + 预览），一键 git 提交推送发布
// ============================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
function httpsGet(url, isText) { return new Promise((resolve, reject) => { let u; try { u = new URL(url); } catch (e) { return reject(e); } const lib = u.protocol === 'https:' ? https : http; const req = lib.get(u, res => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { return httpsGet(new URL(res.headers.location, url)).then(resolve, reject); } if (res.statusCode >= 400) { return reject(new Error('HTTP ' + res.statusCode)); } let chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); resolve(isText ? buf.toString('utf8') : buf); }); }); req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('timeout'))); }); }

const ROOT = process.env.ADMIN_ROOT || __dirname;         // 仓库根目录（Electron 可指定外部工作区）
const POSTS_DIR = path.join(ROOT, 'source', '_posts');    // 文章目录
const HISTORY_DIR = path.join(ROOT, 'source', '_data', 'post-history');
const PORT = process.env.PORT || 4001;

// ---------- 工具 ----------
function ensure() { if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true }); }
function slug(t) {
  const s = (t || '').trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'post-' + Date.now().toString(36);
}
function arr(v) {
  v = (v || '').replace(/^\[|\]$/g, '').trim();
  return v ? '[' + v + ']' : '';
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function parseFM(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: md };
  const fm = {}; const body = m[2];
  m[1].split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  });
  return { fm, body };
}
function listPosts() {
  ensure();
  return fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md')).sort((a, b) => {
    const da = parseFM(fs.readFileSync(path.join(POSTS_DIR, a), 'utf8')).fm.date || '';
    const db = parseFM(fs.readFileSync(path.join(POSTS_DIR, b), 'utf8')).fm.date || '';
    return b.localeCompare(a);
  }).map(f => {
    const { fm } = parseFM(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'));
    return { file: f, title: fm.title || f.replace(/\.md$/, ''), date: fm.date || '', categories: (fm.categories || '').replace(/^\[|\]$/g, ''), tags: (fm.tags || '').replace(/^\[|\]$/g, '') };
  });
}
function readPost(file) {
  const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
  const { fm, body } = parseFM(raw);
  return { file, title: fm.title || '', date: fm.date || '', updated: fm.updated || '', edits: Number(fm.edits || 0), categories: (fm.categories || '').replace(/^\[|\]$/g, ''), tags: (fm.tags || '').replace(/^\[|\]$/g, ''), description: fm.description || '', content: body.trim() };
}

// ---------- HTTP ----------
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } }); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(UI); return; }
    if (p.startsWith('/images/')) {
      let rel = decodeURIComponent(p.slice('/images/'.length));
      const fp = path.join(ROOT, 'source', 'images', rel);
      const mime = ({ '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp', '.avif':'image/avif', '.svg':'image/svg+xml', '.bmp':'image/bmp' })[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      try { const data = fs.readFileSync(fp); res.writeHead(200, { 'Content-Type': mime }); res.end(data); return; } catch (e) { res.writeHead(404); res.end('not found'); return; }
    }
    if (p === '/api/posts' && req.method === 'GET') { return json(res, 200, { posts: listPosts() }); }
    if (p === '/api/post' && req.method === 'GET') { return json(res, 200, readPost(u.searchParams.get('file') || '')); }
    if (p === '/api/save' && req.method === 'POST') {
      const body = await readBody(req);
      ensure();
      let file = body.file || (slug(body.title) + '.md');
      if (!file.endsWith('.md')) file += '.md';
      const target = path.join(POSTS_DIR, file);
      const exists = fs.existsSync(target);
      let old = null;
      if (exists) {
        try { old = readPost(file); } catch (e) {}
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
        const hp = path.join(HISTORY_DIR, slug(file) + '.json');
        let versions = [];
        try { versions = JSON.parse(fs.readFileSync(hp, 'utf8')); } catch (e) {}
        versions.push({ savedAt: new Date().toISOString(), title: old.title, date: old.date, updated: old.updated || '', edits: old.edits || 0, description: old.description || '', categories: old.categories || '', content: old.content || '' });
        fs.writeFileSync(hp, JSON.stringify(versions, null, 2), 'utf8');
      }
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const edits = exists ? (Number((old && old.edits) || 0) + 1) : 0;
      const lines = ['---', `title: ${body.title || ''}`, `date: ${body.date || now}`];
      if (body.updated || exists) lines.push(`updated: ${body.updated || now}`);
      lines.push(`edits: ${edits}`);
      if (body.description) lines.push(`description: ${body.description}`);
      const cats = arr(body.categories); if (cats) lines.push(`categories: ${cats}`);
      const tags = arr(body.tags); if (tags) lines.push(`tags: ${tags}`);
      lines.push('---', '', body.content || '');
      fs.writeFileSync(target, lines.join('\n'), 'utf8');
      return json(res, 200, { ok: true, file, updated: exists ? now : '', edits });
    }
    if (p === '/api/history' && req.method === 'GET') {
      const file = u.searchParams.get('file') || '';
      const hp = path.join(HISTORY_DIR, slug(file) + '.json');
      let versions = []; try { versions = JSON.parse(fs.readFileSync(hp, 'utf8')); } catch (e) {}
      return json(res, 200, { file, versions });
    }
    if (p === '/api/history/restore' && req.method === 'POST') {
      const body = await readBody(req);
      const file = body.file || ''; const index = Number(body.index);
      const hp = path.join(HISTORY_DIR, slug(file) + '.json');
      let versions = []; try { versions = JSON.parse(fs.readFileSync(hp, 'utf8')); } catch (e) {}
      const v = versions[index]; if (!v) return json(res, 404, { ok: false, msg: '版本不存在' });
      fs.writeFileSync(path.join(POSTS_DIR, file), ['---', `title: ${v.title || ''}`, `date: ${v.date || ''}`, `updated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`, `edits: ${Number(v.edits || 0) + 1}`, v.description ? `description: ${v.description}` : '', v.categories ? `categories: ${arr(v.categories)}` : '', '---', '', v.content || ''].filter(Boolean).join('\n'), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/delete' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.file) fs.unlinkSync(path.join(POSTS_DIR, body.file));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const body = await readBody(req);
      ensure();
      const slugName = slug(body.title || 'post');
      let content = body.content || '';
      const imgDir = path.join(ROOT, 'source', 'images', 'posts', slugName);
      fs.mkdirSync(imgDir, { recursive: true });
      const inFolder = p => { const parts = (p || '').split(/[\\/]/); return parts.slice(1).join('/'); };
      const mdDir = path.posix.dirname(inFolder(body.mdPath));
      const imgs = body.images || [];
      const saved = [];
      const refs = [...content.matchAll(/!\[[^\]]*\]\((.+?)\)/g)].map(m => m[1]);
      refs.forEach(ref => {
        const clean = decodeURIComponent(ref.split('?')[0].trim());
        if (/^(https?:)?\/\//.test(clean) || clean.startsWith('/')) return;
        const base = path.posix.basename(clean);
        const norm = path.posix.normalize(path.posix.join(mdDir, clean.replace(/^\.\//, '')));
        const img = imgs.find(i => inFolder(i.path || i.name) === norm) || imgs.find(i => path.posix.basename(i.name) === base);
        if (img) {
          const data = String(img.data).replace(/^data:.*?;base64,/, '');
          fs.writeFileSync(path.join(imgDir, base), Buffer.from(data, 'base64'));
          content = content.replace(new RegExp('\\(' + escapeRegExp(ref) + '\\)'), '(/' + ['images', 'posts', slugName, base].join('/') + ')');
          saved.push(base);
        }
      });
      const lines = ['---', 'title: ' + (body.title || slugName), 'date: ' + (body.date || new Date().toISOString().slice(0, 10)), '---'];
      let finalContent = content.trim();
      // 若 Markdown 已自带 front-matter，则不重复包裹
      if (/^---\s*\n/.test(finalContent)) {
        finalContent = finalContent;
      } else {
        finalContent = lines.join('\n') + '\n\n' + finalContent;
      }
      const file = slugName + '.md';
      fs.writeFileSync(path.join(POSTS_DIR, file), finalContent + '\n', 'utf8');
      return json(res, 200, { ok: true, file, saved, msg: '已保存文章与 ' + saved.length + ' 张图片' });
    }
    if (p === '/api/preview' && req.method === 'POST') {
      const body = await readBody(req);
      let content = body.content || '';
      const imgDir = path.join(ROOT, 'source', 'images', 'posts', (body.slug || 'draft'));
      fs.mkdirSync(imgDir, { recursive: true });
      const inFolder = p => { const parts = (p || '').split(/[\\/]/); return parts.slice(1).join('/'); };
      const mdDir = path.posix.dirname(inFolder(body.mdPath));
      const imgs = body.images || [];
      const saved = [];
      const refs = [...content.matchAll(/!\[[^\]]*\]\((.+?)\)/g)].map(m => m[1]);
      refs.forEach(ref => {
        const clean = decodeURIComponent(ref.split('?')[0].trim());
        if (/^(https?:)?\/\//.test(clean) || clean.startsWith('/')) return;
        const base = path.posix.basename(clean);
        const norm = path.posix.normalize(path.posix.join(mdDir, clean.replace(/^\.\//, '')));
        const img = imgs.find(i => inFolder(i.path || i.name) === norm) || imgs.find(i => path.posix.basename(i.name) === base);
        if (img) {
          const data = String(img.data).replace(/^data:.*?;base64,/, '');
          fs.writeFileSync(path.join(imgDir, base), Buffer.from(data, 'base64'));
          content = content.replace(new RegExp('\\(' + escapeRegExp(ref) + '\\)'), '(/' + ['images', 'posts', (body.slug || 'draft'), base].join('/') + ')');
          saved.push(base);
        }
      });
      let title = body.title || '文章';
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
      if (fmMatch) { const t = fmMatch[1].match(/title:\s*(.+)/); if (t) title = t[1].replace(/^['"]|['"]$/g, ''); content = content.slice(fmMatch[0].length); }
      else { const h = content.match(/^#\s+(.+)$/m); if (h) title = h[1]; }
      return json(res, 200, { ok: true, title, content: content.trim(), saved, msg: '已读入文章，识别标题「' + title + '」。' });
    }
    if (p === '/api/publish' && req.method === 'POST') {
      exec('git add . && git commit -m "admin publish" && git push', { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) return json(res, 500, { ok: false, msg: (stderr || err.message).slice(0, 800) });
        return json(res, 200, { ok: true, msg: '已提交并推送，等待 GitHub Actions 自动构建…' });
      });
      return;
    }
    const GALLERY_PATH = path.join(ROOT, 'source', '_data', 'gallery.json');
    const COLLECTIONS_PATH = path.join(ROOT, 'source', '_data', 'collections.json');
    const WATCHING_PATH = path.join(ROOT, 'source', '_data', 'watching.json');
    const FRIENDS_PATH = path.join(ROOT, 'source', '_data', 'friends.json');
    if (p === '/api/friends' && req.method === 'GET') {
      let data=[]; try { data = JSON.parse(fs.readFileSync(FRIENDS_PATH, 'utf8')); } catch (e) {}
      return json(res, 200, { friends: data });
    }
    if (p === '/api/friends' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(FRIENDS_PATH), { recursive: true });
      fs.writeFileSync(FRIENDS_PATH, JSON.stringify(body.friends || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    const DYNAMICS_PATH = path.join(ROOT, 'source', '_data', 'dynamics.json');
    const PINNED_PATH = path.join(ROOT, 'source', '_data', 'pinned.json');
    if (p === '/api/pinned' && req.method === 'GET') {
      let data = [];
      try { data = JSON.parse(fs.readFileSync(PINNED_PATH, 'utf8')); } catch (e) {}
      return json(res, 200, { pinned: data });
    }
    if (p === '/api/pinned' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(PINNED_PATH), { recursive: true });
      fs.writeFileSync(PINNED_PATH, JSON.stringify((body.pinned || []).slice(0, 8), null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/dynamics' && req.method === 'GET') {
      let data = [];
      try { data = JSON.parse(fs.readFileSync(DYNAMICS_PATH, 'utf8')); } catch (e) {}
      return json(res, 200, { dynamics: data });
    }
    if (p === '/api/dynamics' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(DYNAMICS_PATH), { recursive: true });
      fs.writeFileSync(DYNAMICS_PATH, JSON.stringify(body.dynamics || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/collections' && req.method === 'GET') {
      let meta = [];
      try { meta = JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf8')); } catch (e) {}
      const set = new Set();
      listPosts().forEach(po => { (po.categories || '').split(/[,，]/).forEach(c => { c = c.trim().replace(/^\[|\]$/g, ''); if (c) set.add(c); }); });
      const names = meta.map(c => c.name).concat(Array.from(set).filter(n => !meta.some(c => c.name === n)));
      return json(res, 200, { collections: meta, names });
    }
    if (p === '/api/collections' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(COLLECTIONS_PATH), { recursive: true });
      fs.writeFileSync(COLLECTIONS_PATH, JSON.stringify(body.collections || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/gallery' && req.method === 'GET') {
      let data = { albums: [] };
      try { data = JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf8')); } catch (e) {}
      return json(res, 200, data);
    }
    if (p === '/api/gallery' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(GALLERY_PATH), { recursive: true });
      fs.writeFileSync(GALLERY_PATH, JSON.stringify({ albums: body.albums || [] }, null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/watching' && req.method === 'GET') {
      let data = [];
      try { data = JSON.parse(fs.readFileSync(WATCHING_PATH, 'utf8')); } catch (e) {}
      return json(res, 200, { watching: data });
    }
    if (p === '/api/watching' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(WATCHING_PATH), { recursive: true });
      fs.writeFileSync(WATCHING_PATH, JSON.stringify(body.watching || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/moegirl' && req.method === 'GET') {
      const name = decodeURIComponent(u.searchParams.get('name') || '').trim();
      if (!name) return json(res, 200, { ok: false, msg: '请输入名称' });
      const pageUrl = 'https://zh.moegirl.org.cn/' + encodeURIComponent(name);
      const searchUrl = 'https://zh.moegirl.org.cn/index.php?search=' + encodeURIComponent(name);
      try {
        const html = await httpsGet(pageUrl, true);
        const ptitle = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
        let coverUrl = (html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1] || '';
        if (!coverUrl) { const m = html.match(/<img[^>]*class="[^"]*infobox[^"]*"[^>]*src=["']([^"']+)["']/i) || html.match(/infobox[\s\S]{0,800}?<img[^>]*src=["']([^"']+)["']/i); if (m) coverUrl = m[1] || ''; }
        if (coverUrl) { if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl; else if (coverUrl.startsWith('/')) coverUrl = 'https://zh.moegirl.org.cn' + coverUrl; coverUrl = coverUrl.replace(/\/thumb\/(.+?)\/\d+px-([^\/]+)$/, '/$1/$2'); }
        let localCover = '';
        if (coverUrl) {
          try {
            const extM = coverUrl.match(/\.(jpg|jpeg|png|webp|gif|svg)/i);
            const ext = extM ? extM[1].toLowerCase().replace('jpeg','jpg') : 'jpg';
            const buf = await httpsGet(coverUrl, false);
            const animeDir = path.join(ROOT, 'source', 'images', 'anime');
            fs.mkdirSync(animeDir, { recursive: true });
            const fp = path.join(animeDir, slug(name) + '.' + ext);
            fs.writeFileSync(fp, buf);
            localCover = '/images/anime/' + slug(name) + '.' + ext;
          } catch (e) {}
        }
        const cleanTitle = (ptitle || name).replace(/\s*[—｜|·-].*$/, '').trim();
        let total = ''; const tm = html.match(/(?:话数|集数|话)\s*[:：]?\s*(\d+)/) || html.match(/(\d+)\s*话/) || html.match(/总话数\s*[:：]?\s*(\d+)/); if (tm) total = tm[1];
        return json(res, 200, { ok: true, title: cleanTitle || name, pageUrl, searchUrl, cover: localCover, found: !!coverUrl, total, msg: coverUrl ? '已抓取：' + (cleanTitle || name) : '未取到封面，可能页面不存在' });
      } catch (e) {
        return json(res, 200, { ok: true, title: name, pageUrl, searchUrl, cover: '', found: false, msg: '抓取失败：' + e.message });
      }
    }
    if (p === '/api/img' && req.method === 'POST') {
      const body = await readBody(req);
      const albumDir = path.join(ROOT, 'source', 'images', (body.album || 'misc').replace(/[\\/:*?"<>|]/g, '_'));
      fs.mkdirSync(albumDir, { recursive: true });
      const fname = (body.file || 'img.png').replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(path.join(albumDir, fname), Buffer.from(String(body.data).replace(/^data:.*?;base64,/, ''), 'base64'));
      return json(res, 200, { ok: true, src: '/images/' + (body.album || 'misc') + '/' + fname });
    }
    if (p === '/app.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    json(res, 500, { ok: false, msg: String(e && e.message || e) });
  }
});

function startAdmin(port, onReady) {
  server.listen(port, () => {
    const actualPort = server.address().port;
    console.log('\n▶ 流浪猫管理面板已启动：http://localhost:' + actualPort + '\n   文章目录：' + POSTS_DIR + '\n   按 Ctrl+C 停止\n');
    if (onReady) onReady(actualPort);
  });
  return server;
}
if (require.main === module) {
  startAdmin(PORT);
} else {
  module.exports = { startAdmin, ROOT, POSTS_DIR };
}

// ---------- 管理界面 UI（内嵌） ----------
const UI = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>避难所管理台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a08;--surface:#141412;--surface2:#1c1c18;--accent:#d4a24e;--text-p:#f0ece4;--text-m:#6b6760;--text-b:#b0a99a;--border:rgba(107,103,96,.15);--rose:#c47a8b}
body{background:var(--bg);color:var(--text-b);font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7}
a{color:inherit;text-decoration:none}

/* 顶部标签导航（仿网站导航） */
.topnav{border-bottom:1px solid var(--border);padding:0 0;background:var(--bg)}
.navwrap{max-width:1000px;margin:0 auto;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}
.brand{font-family:Georgia,serif;color:var(--text-p);font-size:18px;letter-spacing:.02em;font-weight:600}
.brand em{font-style:italic;color:var(--accent)}
.navlinks{display:flex;gap:28px}
.nav-link{font-size:12px;text-transform:uppercase;letter-spacing:.18em;color:var(--text-m);padding-bottom:2px;border-bottom:1px solid transparent;cursor:pointer;transition:.3s}
.nav-link:hover,.nav-link.active{color:var(--accent);border-color:var(--accent)}

.wrap{max-width:1000px;margin:0 auto;padding:36px 24px 80px}
h1{font-family:Georgia,serif;font-weight:300;color:var(--text-p);font-size:30px;margin-bottom:8px}
h1 em{font-style:italic;color:var(--accent)}
.sub{color:var(--text-m);font-size:13px;margin-bottom:28px}
.tabpage{display:none}
.tabpage.active{display:block}

.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:20px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:var(--text-m);margin:14px 0 6px}
input,textarea,select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text-p);font-size:14px;padding:10px 12px;outline:none;border-radius:6px;font-family:inherit}
select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23b0a99a'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
select:focus{border-color:var(--accent)}
.dd{position:relative}
.dd-btn{width:100%;display:flex;justify-content:space-between;align-items:center;background:var(--bg);border:1px solid var(--border);color:var(--text-p);font-size:14px;padding:10px 12px;border-radius:6px;cursor:pointer;font-family:inherit;appearance:none}
.dd-btn:hover,.dd-btn:focus{border-color:var(--accent)}
.dd-arrow{transition:transform .2s;opacity:.6;flex-shrink:0;margin-left:8px}
.dd.open .dd-arrow{transform:rotate(180deg)}
.dd-menu{position:absolute;top:calc(100% + 6px);left:0;right:0;background:#141412;border:1px solid var(--border);border-radius:8px;z-index:50;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.35);max-height:200px;overflow-y:auto}
.dd-item{padding:10px 12px;color:var(--text-b);cursor:pointer;font-size:14px;display:block}
.dd-item:hover{background:#1c1c18;color:var(--text-p)}
.dd-item.sel{color:var(--accent)}
.pinrow{display:flex;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border)}
.pinrow input{width:auto;margin:0;flex-shrink:0}
.pinrow2{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border)}
.pin-idx{width:24px;font-family:var(--font-mono);color:var(--text-m);text-align:center}
.pin-tag{font-size:11px;color:var(--accent-dim);border:1px solid rgba(212,162,78,.3);padding:2px 8px;border-radius:4px;flex-shrink:0}
.pin-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--text-b)}
.pin-acts{display:flex;gap:6px;flex-shrink:0}
.friendrow{display:grid;grid-template-columns:1.2fr 1.4fr 1.2fr auto;gap:8px;margin-top:10px;align-items:center}
.collrow{border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:10px;background:#0a0a08}
.collrow input{padding:8px 10px;font-size:13px}
.coll-thumb{width:46px;height:46px;object-fit:cover;border:1px solid var(--border);border-radius:6px;flex-shrink:0}
.album-item{border:1px solid var(--border);border-radius:8px;margin-top:10px;overflow:hidden;background:#0a0a08}
.album-row{display:flex;align-items:center;gap:12px;padding:12px 14px}
.album-row-main{flex:1;min-width:0}
.album-row-name{font-size:15px;color:var(--text-p);font-weight:600}
.album-row-meta{font-size:12px;color:var(--text-m)}
.album-edit{padding:6px 14px 16px;border-top:1px solid var(--border)}
.imgcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:12px}
.imgcard{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#0f0f0d}
.imgcard-thumb{width:100%;height:130px;object-fit:cover;display:block}
.imgcard-body{padding:10px}
.imgcard-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.imgcard-fields input{padding:8px;font-size:12px}
.imgcard-src{width:100%;padding:8px;font-size:12px;margin-bottom:8px}
.btn-block{width:100%;justify-content:center}
.album-edit-grid{display:grid;grid-template-columns:190px 1fr;gap:18px;align-items:stretch}
.album-edit-cover{border:1px dashed var(--border);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;position:relative;background:#0f0f0d;min-height:150px}
.album-edit-cover:hover{border-color:var(--accent)}
.album-edit-cover img{width:100%;height:100%;object-fit:contain;display:block}
.album-edit-cover .cover-plus{color:var(--accent);font-size:34px;line-height:1}
.album-edit-cover .cover-hint{color:var(--text-m);font-size:12px;margin-top:6px}
.album-edit-cover .cover-replace{position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:11px;color:var(--text-p);background:rgba(0,0,0,.55);padding:3px 0}
.album-edit-fields{display:flex;flex-direction:column;gap:12px;justify-content:center}
.field{display:flex;align-items:center;gap:10px}
.field label{flex-shrink:0;min-width:56px;color:var(--text-m)}
.field input{flex:1}
.imgdetail{position:fixed;inset:0;background:rgba(8,8,6,.92);backdrop-filter:blur(8px);z-index:99999;display:none;align-items:center;justify-content:center;padding:24px}
.imgdetail.show{display:flex}
.imgdetail-inner{max-width:1000px;width:100%;max-height:88vh;overflow:hidden;background:#0d0d0b;border:1px solid var(--border);border-radius:16px;position:relative;display:grid;grid-template-columns:1fr 260px}
.imgdetail-media{display:flex;align-items:center;justify-content:center;background:#000;min-height:60vh;overflow:hidden}
.imgdetail-media img{max-width:100%;max-height:88vh;object-fit:contain}
.imgdetail-info{padding:24px;overflow-y:auto;border-left:1px solid var(--border)}
.imgdetail-loading{color:var(--text-m);font-size:13px}
.imgdetail-rows{display:flex;flex-direction:column}
.imgdetail-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.imgdetail-row .k{color:var(--text-m);flex-shrink:0}
.imgdetail-row .v{color:var(--text-b);text-align:right;font-family:var(--font-mono)}
.imgdetail-sub{font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:var(--accent-dim);margin:16px 0 4px}
.dynrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 10px;border-bottom:1px solid var(--border)}
.dynrow-main{min-width:0}
.dynrow-text{color:var(--text-b);font-size:14px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.dynrow-meta{font-size:12px;color:var(--text-m);margin-top:4px}
.dynrow-imgtag{color:var(--accent)}
input[type=file]{padding:6px 8px;color:var(--text-m);cursor:pointer}
input[type=file]::file-selector-button{background:transparent;border:1px solid var(--border);color:var(--text-b);font-size:12px;padding:8px 14px;margin-right:10px;cursor:pointer;border-radius:6px;transition:.2s}
input[type=file]::file-selector-button:hover{border-color:var(--accent);color:var(--accent)}
input:focus,textarea:focus{border-color:var(--accent)}
textarea{min-height:260px;resize:vertical;line-height:1.8}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.btn{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;font-size:13px;padding:10px 18px;border:none;cursor:pointer;letter-spacing:.05em;border-radius:6px;transition:.2s}
.btn-pub{background:var(--accent);color:var(--bg)}.btn-pub:hover{opacity:.9}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text-b)}.btn-ghost:hover{border-color:var(--accent);color:var(--text-p)}
.btn-del{background:transparent;border:1px solid var(--rose);color:var(--rose)}.btn-del:hover{background:var(--rose);color:var(--bg)}
.status{margin-top:12px;color:var(--text-m);font-size:13px;min-height:20px}
.small{font-size:12px;color:var(--text-m)}

/* 文章列表 */
.plist{border-top:1px solid var(--border)}
.pitem{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid var(--border);cursor:pointer;color:var(--text-b);font-family:Georgia,serif;font-size:17px;transition:.2s}
.pitem:hover{background:var(--surface2);color:var(--text-p)}
.pitem .x{color:var(--rose);font-size:15px;padding:0 4px}
.list-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.list-hd span{font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:var(--text-m)}
.form-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
#form_hd{font-weight:600;color:var(--text-p);font-size:15px}

/* 相册/番剧条目 */
.album{border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:14px;background:#0a0a08}
.imgrow{display:grid;grid-template-columns:1fr 120px 1fr auto;gap:8px;align-items:center;margin-top:8px}
.imgrow input{padding:8px 10px;font-size:13px}
.wrow{display:grid;grid-template-columns:48px 1.4fr 1fr 1.2fr auto auto;gap:8px;margin-top:10px;align-items:center}
.wrow-confirm{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-top:6px;border:1px dashed rgba(212,162,78,.4);border-radius:8px}
.wrow-confirm span{flex:1;color:var(--text-b);font-size:13px}
.wrow2{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)}
.wrow2-main{flex:1;min-width:0}
.wrow2-title{font-size:15px;color:var(--text-p);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wrow2-sub{font-size:12px;color:var(--text-m);margin-top:2px}
.wrow-edit{padding:12px 16px 16px;border-bottom:1px solid var(--border);background:#0a0a08}
.wrow-confirm-main{flex:1;min-width:0}
.wrow-confirm-main span{display:block;margin-bottom:4px;color:var(--text-b);font-size:13px}
.wrow-links{display:flex;gap:12px}
.wrow-links a{color:var(--accent);font-size:12px;text-decoration:none}
.wrow-links a:hover{text-decoration:underline}
.wrow input{padding:8px 10px;font-size:13px}
.img-thumb{width:46px;height:46px;object-fit:cover;border:1px solid var(--border);border-radius:6px}
/* ===== 桌面管理台排版 ===== */
body{min-width:1000px;background:radial-gradient(circle at 50% -20%,rgba(212,162,78,.08),transparent 34%),var(--bg)}
.topnav{position:sticky;top:0;z-index:100;background:rgba(10,10,8,.94);backdrop-filter:blur(16px);box-shadow:0 8px 28px rgba(0,0,0,.16)}
.navwrap{max-width:1180px;padding:18px 32px}.brand{font-size:19px}.navlinks{gap:6px}.nav-link{padding:8px 13px;border:1px solid transparent;border-radius:7px;letter-spacing:.12em}.nav-link:hover,.nav-link.active{border-color:rgba(212,162,78,.35);background:rgba(212,162,78,.08)}
.wrap{max-width:1180px;padding:48px 32px 100px}h1{font-size:38px;letter-spacing:.01em;margin-bottom:10px}.sub{max-width:720px;margin-bottom:32px;color:var(--text-m);font-size:14px}
.tabpage{animation:tab-in .22s ease-out}@keyframes tab-in{from{opacity:.5;transform:translateY(4px)}to{opacity:1;transform:none}}
.card{padding:26px;border-radius:14px;background:linear-gradient(145deg,rgba(20,20,18,.98),rgba(16,16,14,.98));border-color:rgba(107,103,96,.24);box-shadow:0 12px 32px rgba(0,0,0,.12)}
.list-hd,.form-hd{min-height:38px;margin-bottom:20px}.list-hd span,.form-hd span{font-size:12px;letter-spacing:.12em;color:var(--text-b)}.form-hd{border-bottom:1px solid rgba(107,103,96,.2);padding-bottom:16px}.form-hd #form_hd{font-size:17px;letter-spacing:0;color:var(--text-p)}
label{margin:18px 0 7px;font-size:10px;letter-spacing:.14em;color:var(--accent-dim)}input,textarea,select{min-height:42px;padding:10px 13px;border-color:rgba(107,103,96,.3);background:#0e0e0c;border-radius:8px}textarea{min-height:260px}
.row{gap:18px}.btn{min-height:40px;padding:9px 16px;border-radius:8px}.btn-ghost{background:rgba(255,255,255,.018);border-color:rgba(107,103,96,.3)}.btn-ghost:hover{background:rgba(212,162,78,.08)}
#tab-posts{display:grid;grid-template-columns:340px minmax(0,1fr);gap:20px;align-items:start}#tab-posts>h1,#tab-posts>.sub{grid-column:1/-1}#tab-posts>.sub{margin-bottom:10px}#tab-posts>.card:nth-of-type(1){grid-column:1;grid-row:3}#tab-posts>.card:nth-of-type(2){grid-column:2;grid-row:3}#tab-posts>.card:nth-of-type(3){grid-column:1/-1}
#tab-posts:not(.active){display:none}.tabpage:not(#tab-posts){display:none}.tabpage.active:not(#tab-posts){display:block}
.plist{border-top:0;display:flex;flex-direction:column;gap:8px}.pitem{padding:13px 12px;border:1px solid rgba(107,103,96,.18);border-radius:9px;background:rgba(255,255,255,.018);font-family:var(--font-sans);font-size:14px}.pitem:hover{background:rgba(212,162,78,.07);transform:translateX(2px)}
.collrow{padding:16px;border-color:rgba(107,103,96,.24);border-radius:11px;background:#0f0f0d}.collrow>div:first-child{gap:12px!important}.collrow>input{margin-top:14px!important}.collrow>div:last-child{margin-top:14px!important}.collrow>div:last-child input{flex:1}
.album-item{margin-top:12px;border-color:rgba(107,103,96,.24);border-radius:12px;background:#0f0f0d}.album-row{padding:16px 18px}.album-row-name{font-size:16px}.album-edit{padding:20px 18px 22px;background:rgba(10,10,8,.52);border-top-color:rgba(107,103,96,.22)}.album-edit-grid{grid-template-columns:210px 1fr;gap:24px}.album-edit-fields{gap:15px}.field{display:block}.field label{min-width:0;margin:0 0 7px}.imgcards{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.imgcard{border-color:rgba(107,103,96,.22);border-radius:10px}.imgcard-body{padding:12px}.imgcard-fields{gap:7px}.imgcard-fields input,.imgcard-src{min-height:36px;padding:8px 9px}.imgcard-thumb{height:145px}
.wrow2{margin-top:12px;padding:16px 18px;border:1px solid rgba(107,103,96,.24);border-radius:11px;background:#0f0f0d}.wrow2-title{font-size:16px}.wrow2-sub{margin-top:5px;color:var(--accent-dim)}.wrow-edit{margin-top:-13px;padding:22px 18px 20px;border:1px solid rgba(107,103,96,.24);border-top:0;border-radius:0 0 11px 11px;background:rgba(10,10,8,.58)}.wrow-edit label{margin-top:4px}.wrow-confirm{padding:14px;border-radius:10px;background:rgba(212,162,78,.06)}
.dynrow{margin-top:10px;padding:16px;border:1px solid rgba(107,103,96,.22);border-radius:10px;background:#0f0f0d}.dynrow-text{font-family:var(--font-sans);font-size:14px}.dynrow-meta{margin-top:7px}
.pinrow2{margin-top:8px;padding:12px 14px;border:1px solid rgba(107,103,96,.2);border-radius:9px;background:#0f0f0d}.pinrow2:first-child{margin-top:0}.pin-idx{color:var(--accent-dim)}
.friendrow{margin-top:10px;padding:10px;border:1px solid rgba(107,103,96,.2);border-radius:9px;background:#0f0f0d}.dd-btn{min-height:42px;border-color:rgba(107,103,96,.3);border-radius:8px}.dd-menu{border-color:rgba(212,162,78,.3);box-shadow:0 14px 30px rgba(0,0,0,.45)}.dd-item{padding:11px 13px}.dd-item:hover{background:rgba(212,162,78,.08)}
.status{min-height:22px;margin-top:16px}.small{font-family:var(--font-sans)}
#tab-dynamics .card:first-of-type textarea{min-height:190px}
#tab-dynamics .card:first-of-type .row{margin-top:18px!important}
#tab-site{max-width:1180px;margin:0 auto;padding:48px 32px 100px}
</style>
</head><body>
<nav class="topnav"><div class="navwrap">
  <span class="brand">避难所<em>管理台</em></span>
  <div class="navlinks">
    <a class="nav-link active" data-tab="posts" onclick="t('posts')">文章</a>
    <a class="nav-link" data-tab="home" onclick="t('home')">首页</a>
    <a class="nav-link" data-tab="dynamics" onclick="t('dynamics')">动态</a>
    <a class="nav-link" data-tab="gallery" onclick="t('gallery')">图片</a>
    <a class="nav-link" data-tab="watching" onclick="t('watching')">番剧</a>
    <a class="nav-link" data-tab="site" onclick="t('site')">站点</a>
  </div>
</div></nav>
<div class="wrap">

<section id="tab-posts" class="tabpage active">
  <h1>文章 <em>合集</em></h1>
  <p class="sub">上传本地文档 → 自动标题 → 填简介、选合集 → 发布。历史文章点「编辑」可修改。</p>
  <div class="card">
    <div class="list-hd"><span>文章列表</span><button class="btn btn-ghost" onclick="newPost()">＋ 新建</button></div>
    <div class="plist" id="posts"></div>
  </div>
  <div class="card">
    <div class="form-hd"><span id="form_hd">发布新文章</span><button class="btn btn-ghost" id="cancelEdit" style="display:none" onclick="cancelEdit()">取消编辑</button></div>
    <label>选择文章文件（.md 及它引用的图片，可多选；编辑时再上传 = 替换内容）</label>
    <input type="file" id="up_folder" multiple onchange="onFilesChanged()">
    <div class="status" id="upStatus"></div>
    <label>标题</label><input id="f_title" placeholder="文章标题">
    <label>简介（可选）</label><input id="f_summary" placeholder="一句话简介">
    <div class="row">
      <div><label>合集</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDD()"><span id="col_label">无合集</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="col_menu" style="display:none"></div></div><input type="hidden" id="f_collection"></div>
      <div><label>发布日期（自动 = 现在）</label><input id="f_date" placeholder="自动"></div>
    </div>
    <div id="f_newcol" style="display:none;margin-top:8px"><label>新合集名</label><input id="f_newcolname" placeholder="输入新合集名"></div>
    <input type="hidden" id="f_file"><input type="hidden" id="f_content"><input type="hidden" id="f_catsave">
    <div style="display:flex;gap:12px;margin-top:20px"><button class="btn btn-pub" id="pubBtn" onclick="publishPost()">发布</button></div>
    <div class="status" id="status"></div>
  </div>
  <div class="card">
    <div class="list-hd"><span>合集管理（封面 / 名字 / 简介）</span></div>
    <div id="collist"></div>
    <div style="margin-top:12px;display:flex;gap:12px"><button class="btn btn-pub" onclick="saveColls()">保存合集</button><button class="btn btn-ghost" onclick="addColl()">＋ 添加合集</button></div>
    <div class="status" id="collStatus"></div>
  </div>
</section>

<section id="tab-home" class="tabpage">
  <h1>首页 <em>置顶</em></h1>
  <p class="sub">选择并排序置顶（文章 + 动态），最多 8 篇，首页用横向卡片展示。</p>
  <div class="card">
    <div class="list-hd"><span>置顶列表（<b id="pinCount">0</b>/8）</span><button class="btn btn-pub" onclick="savePin()">保存置顶</button></div>
    <div id="pinnedList"></div>
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label>添加文章</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDd('addPinPostMenu')"><span id="addPinPostLbl">选择文章…</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="addPinPostMenu" style="display:none"></div></div></div>
      <div><label>添加动态</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDd('addPinDynMenu')"><span id="addPinDynLbl">选择动态…</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="addPinDynMenu" style="display:none"></div></div></div>
    </div>
    <div class="status" id="pinStatus"></div>
  </div>
</section>

<section id="tab-dynamics" class="tabpage">
  <h1>动态 <em>会动</em></h1>
  <p class="sub">QQ 空间式短动态：一句话 + 可选图片。</p>
  <div class="card">
    <div class="list-hd"><span id="dyn_mode">发布新动态</span></div>
    <textarea id="dyn_text" rows="3" placeholder="说点什么…"></textarea>
    <div class="row" style="margin-top:8px">
      <div><label>日期</label><input id="dyn_date"></div>
      <div><label>图片(可选)</label><div style="display:flex;gap:8px;align-items:center"><input id="dyn_img" placeholder="/images/…"><button class="btn btn-ghost" onclick="upDynCompose()">传图</button></div></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:12px"><button class="btn btn-pub" id="dyn_pubbtn" onclick="publishDyn()">发布</button><button class="btn btn-ghost" onclick="resetDyn()">重置</button></div>
    <div class="status" id="dynStatus"></div>
  </div>
  <div class="card">
    <div class="list-hd"><span>动态列表</span></div>
    <div id="dynlist"></div>
  </div>
</section>

<section id="tab-gallery" class="tabpage">
  <h1>图片 <em>相册</em></h1>
  <p class="sub">管理相册与图片。上传图片后会自动写入仓库地址。</p>
  <div class="card">
    <div class="list-hd"><span>相册</span><button class="btn btn-ghost" onclick="addAlbum()">＋ 添加相册</button></div>
    <div id="albums"></div>
    <div style="margin-top:20px;display:flex;gap:12px"><button class="btn btn-pub" onclick="saveGallery()">保存图片</button><button class="btn btn-ghost" onclick="loadGallery()">读取当前</button></div>
    <div class="status" id="galStatus"></div>
  </div>
</section>

<section id="tab-watching" class="tabpage">
  <h1>番剧 <em>在追</em></h1>
  <p class="sub">管理「在追」「Preparing」和已归档的番剧，前台会按状态分别展示。</p>
  <div class="card">
    <div class="list-hd"><span>列表</span><button class="btn btn-ghost" onclick="addWatch()">＋ 添加</button></div>
    <div id="watchlist"></div>
    <div style="margin-top:20px;display:flex;gap:12px"><button class="btn btn-pub" onclick="saveWatch()">保存番剧</button><button class="btn btn-ghost" onclick="loadWatch()">读取当前</button></div>
    <div class="status" id="watchStatus"></div>
  </div>
</section>

<section id="tab-site" class="tabpage">
  <h1>站点 <em>设置</em></h1>
  <p class="sub">管理网站页脚的「友链」。</p>
  <div class="card">
    <div class="list-hd"><span>友链 / Friends</span><button class="btn btn-ghost" onclick="addFriend()">＋ 添加友链</button></div>
    <div id="friendlist"></div>
    <div style="margin-top:20px;display:flex;gap:12px"><button class="btn btn-pub" onclick="saveFriends()">保存友链</button></div>
    <div class="status" id="friendStatus"></div>
  </div>
</section>

</div>

<div class="imgdetail" id="imgdetail" onclick="if(event.target===this)closeImgDetail()">
  <div class="imgdetail-inner">
    <button class="moment-x" onclick="closeImgDetail()" aria-label="关闭">×</button>
    <div class="imgdetail-media"><img id="imgDetailImg" alt=""></div>
    <div class="imgdetail-info" id="imgDetailInfo"></div>
  </div>
</div>
<script src="/app.js"></script>
</body></html>
`;

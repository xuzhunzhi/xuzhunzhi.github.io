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
function httpsGet(url, isText) { return new Promise((resolve, reject) => { let u; try { u = new URL(url); } catch (e) { return reject(e); } const lib = u.protocol === 'https:' ? https : http; const req = lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrayCatAdmin/1.0)', 'Accept': isText ? 'text/html,application/xhtml+xml' : '*/*' } }, res => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { return httpsGet(new URL(res.headers.location, url), isText).then(resolve, reject); } if (res.statusCode >= 400) { return reject(new Error('HTTP ' + res.statusCode)); } let chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); resolve(isText ? buf.toString('utf8') : buf); }); }); req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('timeout'))); }); }
function normalizeMoegirlUrl(value) { let raw = String(value || '').trim(); if (raw && !/^https?:\/\//i.test(raw)) raw = 'https://' + raw; try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && /(^|\.)moegirl\.org\.cn$/i.test(u.hostname) ? u.href : ''; } catch (e) { return ''; } }
function isMoegirlPageUrl(value) { return !!normalizeMoegirlUrl(value); }
function tagAttr(tag, name) { const m = tag.match(new RegExp(name + "\\s*=\\s*(?:\\\"([^\\\"]+)\\\"|'([^']+)'|([^\\s>]+))", 'i')); return m ? (m[1] || m[2] || m[3] || '') : ''; }
function decodeHtml(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2f;|&#47;/gi, '/').replace(/&#x5c;|&#92;/gi, '\\'); }
function moegirlCover(html, baseUrl) {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  let cover = '';
  metas.some(function(tag) { const key = (tagAttr(tag, 'property') || tagAttr(tag, 'name')).toLowerCase(); if (key === 'og:image' || key === 'twitter:image') { cover = tagAttr(tag, 'content'); return !!cover; } return false; });
  if (!cover) {
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    const blockMatch = html.match(/<(?:table|aside|div)\b[^>]*\bclass\s*=\s*["'][^"']*(?:\binfobox\b|\bportable-infobox\b)[^"']*["'][^>]*>[\s\S]*?<\/(?:table|aside|div)>/i);
    const infoImgs = blockMatch ? (blockMatch[0].match(/<img\b[^>]*>/gi) || []) : [];
    const sourceOf = function(tag) {
      const direct = tagAttr(tag, 'src') || tagAttr(tag, 'data-src') || tagAttr(tag, 'data-original') || tagAttr(tag, 'data-lazy-src');
      if (direct) return direct;
      const srcset = tagAttr(tag, 'srcset') || tagAttr(tag, 'data-srcset');
      return srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '';
    };
    const info = infoImgs.find(sourceOf) || imgs.find(function(tag) { return /\b(?:infobox|portable-infobox)\b/i.test(tagAttr(tag, 'class') || '') && sourceOf(tag); });
    cover = info ? sourceOf(info) : '';
  }
  if (!cover) return '';
  try {
    let raw = decodeHtml(cover).replace(/\\\//g, '/').replace(/\\u002f/gi, '/');
    if (raw.indexOf('//') === 0) raw = 'https:' + raw;
    const u = new URL(raw, baseUrl);
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hash = '';
    u.pathname = u.pathname.replace(/\/thumb\/(.+?)\/(?:\d+px-)?([^/]+)$/, '/$1/$2');
    return u.href;
  } catch (e) { return ''; }
}

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
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return fallback; }
}

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
        versions = readJson(hp, []);
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
      let versions = readJson(hp, []);
      return json(res, 200, { file, versions });
    }
    if (p === '/api/history/restore' && req.method === 'POST') {
      const body = await readBody(req);
      const file = body.file || ''; const index = Number(body.index);
      const hp = path.join(HISTORY_DIR, slug(file) + '.json');
      let versions = readJson(hp, []);
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
    const SITE_PATH = path.join(ROOT, 'source', '_data', 'site.json');
    if (p === '/api/site' && req.method === 'GET') {
      return json(res, 200, { site: readJson(SITE_PATH, {}) });
    }
    if (p === '/api/site' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(SITE_PATH), { recursive: true });
      fs.writeFileSync(SITE_PATH, JSON.stringify(body.site || {}, null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/friends' && req.method === 'GET') {
      const data = readJson(FRIENDS_PATH, []);
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
      const data = readJson(PINNED_PATH, []);
      return json(res, 200, { pinned: data });
    }
    if (p === '/api/pinned' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(PINNED_PATH), { recursive: true });
      fs.writeFileSync(PINNED_PATH, JSON.stringify((body.pinned || []).slice(0, 8), null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/dynamics' && req.method === 'GET') {
      const data = readJson(DYNAMICS_PATH, []);
      return json(res, 200, { dynamics: data });
    }
    if (p === '/api/dynamics' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(DYNAMICS_PATH), { recursive: true });
      fs.writeFileSync(DYNAMICS_PATH, JSON.stringify(body.dynamics || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/collections' && req.method === 'GET') {
      const meta = readJson(COLLECTIONS_PATH, []);
      const set = new Set();
      listPosts().forEach(po => { (po.categories || '').split(/[,，]/).forEach(c => { c = c.trim().replace(/^\[|\]$/g, ''); if (c) set.add(c); }); });
      const options = [];
      const optionValues = new Set();
      meta.forEach(c => { const value = String(c.slug || c.name || '').trim(); const label = String(c.name || value).trim(); if (value && !optionValues.has(value)) { options.push({ value, label }); optionValues.add(value); } });
      Array.from(set).forEach(value => { if (!optionValues.has(value)) { options.push({ value, label: value }); optionValues.add(value); } });
      return json(res, 200, { collections: meta, names: options.map(o => o.value), options });
    }
    if (p === '/api/collections' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(COLLECTIONS_PATH), { recursive: true });
      fs.writeFileSync(COLLECTIONS_PATH, JSON.stringify(body.collections || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/gallery' && req.method === 'GET') {
      const data = readJson(GALLERY_PATH, { albums: [] });
      return json(res, 200, data);
    }
    if (p === '/api/gallery' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(GALLERY_PATH), { recursive: true });
      fs.writeFileSync(GALLERY_PATH, JSON.stringify({ albums: body.albums || [] }, null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/watching' && req.method === 'GET') {
      const data = readJson(WATCHING_PATH, []);
      return json(res, 200, { watching: data });
    }
    if (p === '/api/watching' && req.method === 'POST') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(WATCHING_PATH), { recursive: true });
      fs.writeFileSync(WATCHING_PATH, JSON.stringify(body.watching || [], null, 2), 'utf8');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/moegirl' && req.method === 'GET') {
      const requestedUrl = decodeURIComponent(u.searchParams.get('url') || '').trim();
      let name = decodeURIComponent(u.searchParams.get('name') || '').trim();
      const manualName = name;
      let pageUrl = '';
      if (requestedUrl) {
        if (!isMoegirlPageUrl(requestedUrl)) return json(res, 200, { ok: false, msg: '请输入萌娘百科页面地址' });
        pageUrl = normalizeMoegirlUrl(requestedUrl);
        if (!pageUrl) return json(res, 200, { ok: false, msg: '请输入萌娘百科页面地址' });
        const lastPart = decodeURIComponent(new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || '').replace(/_/g, ' ').trim();
        if (!name) name = lastPart || '番剧';
      } else {
        if (!name) return json(res, 200, { ok: false, msg: '请输入番名或萌娘百科网址' });
        pageUrl = 'https://zh.moegirl.org.cn/' + encodeURIComponent(name);
      }
      const searchUrl = 'https://zh.moegirl.org.cn/index.php?search=' + encodeURIComponent(name);
      try {
        const html = await httpsGet(pageUrl, true);
        const ptitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
        const coverUrl = moegirlCover(html, pageUrl);
        let localCover = '';
        let coverError = '';
        if (coverUrl) {
          try {
            const extM = path.extname(new URL(coverUrl).pathname).replace('.', '').toLowerCase();
            const ext = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(extM) ? extM.replace('jpeg', 'jpg') : 'jpg';
            const buf = await httpsGet(coverUrl, false);
            const animeDir = path.join(ROOT, 'source', 'images', 'anime');
            fs.mkdirSync(animeDir, { recursive: true });
            const fp = path.join(animeDir, slug(name) + '.' + ext);
            fs.writeFileSync(fp, buf);
            localCover = '/images/anime/' + slug(name) + '.' + ext;
          } catch (e) { coverError = e.message; }
        }
        const cleanTitle = decodeHtml(ptitle || name).replace(/\s*[—｜|·-].*$/, '').trim();
        let total = ''; const tm = html.match(/(?:话数|集数|话)\s*[:：]?\s*(\d+)/) || html.match(/(\d+)\s*话/) || html.match(/总话数\s*[:：]?\s*(\d+)/); if (tm) total = tm[1];
        const msg = localCover ? '已抓取：' + (cleanTitle || name) : (coverUrl ? '找到了封面地址，但下载失败' + (coverError ? '：' + coverError : '') : '未取到封面，可能页面不存在');
        return json(res, 200, { ok: true, title: manualName || cleanTitle || name, sourceTitle: cleanTitle || name, pageUrl, searchUrl, cover: localCover, found: !!localCover, total, msg });
      } catch (e) {
        return json(res, 200, { ok: true, title: name, pageUrl, searchUrl, cover: '', found: false, msg: '抓取失败：' + (e.message || e.code || String(e)) });
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
/* 番剧编辑区：字段按信息层级排列，操作控件固定在各自行内 */
.watch-edit-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px 20px;align-items:start}
.watch-field{min-width:0}
.watch-field-wide{grid-column:1/-1}
.watch-field label{display:block;margin:0 0 7px}
.watch-field input,.watch-field select{width:100%;box-sizing:border-box}
.watch-inline{display:flex;align-items:center;gap:10px;min-width:0}
.watch-inline input{flex:1;min-width:0}
.watch-inline .btn{flex:0 0 auto}
.watch-row-actions{display:flex;gap:8px;flex-shrink:0}
.watch-confirm-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
.wrow-edit{margin-top:-1px;padding:22px 18px 20px;border:1px solid rgba(107,103,96,.24);border-top:0;border-radius:0 0 11px 11px;background:rgba(10,10,8,.58)}
.wrow-confirm{display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:12px;align-items:center}
/* ===== 管理台最终收口：统一桌面工作区的层级与密度 ===== */
body{font-size:15px;line-height:1.65;color:var(--text-b)}
.navwrap{max-width:1240px;padding:16px 30px}
.brand{font-size:20px}
.navlinks{gap:4px;padding:4px;border:1px solid rgba(107,103,96,.2);border-radius:10px;background:rgba(20,20,18,.62)}
.nav-link{padding:9px 15px;border:1px solid transparent;border-radius:7px;font-size:12px;letter-spacing:.1em}
.nav-link:hover,.nav-link.active{border-color:rgba(212,162,78,.38);background:rgba(212,162,78,.1);color:var(--accent)}
.wrap{max-width:1240px;padding:46px 30px 110px}
h1{font-size:40px;line-height:1.2;margin-bottom:12px}
.sub{max-width:780px;margin-bottom:30px;font-size:15px;line-height:1.7}
.card{padding:28px 30px;margin-bottom:24px;border-radius:15px;border-color:rgba(107,103,96,.28);background:linear-gradient(145deg,rgba(21,21,19,.98),rgba(15,15,13,.98));box-shadow:0 16px 38px rgba(0,0,0,.16)}
.list-hd,.form-hd{min-height:42px;margin-bottom:22px}
.list-hd span,.form-hd span{font-size:13px;letter-spacing:.1em;color:var(--text-b)}
.list-hd button,.form-hd button{align-self:center}
.form-hd{padding-bottom:17px;border-bottom-color:rgba(107,103,96,.28)}
.form-hd #form_hd{font-size:18px}
label{margin:20px 0 8px;font-size:11px;letter-spacing:.11em;color:#928b7d}
input,textarea,select{min-height:44px;padding:10px 14px;border-radius:9px;font-size:14px;border-color:rgba(107,103,96,.34)}
textarea{line-height:1.75}
.btn{min-height:42px;padding:9px 17px;border-radius:9px;font-size:13px}
.btn-pub{box-shadow:0 5px 14px rgba(212,162,78,.13)}
.plist{gap:10px}
.pitem{min-height:58px;padding:11px 14px;border-radius:10px;font-size:15px}
.pitem .small{font-size:12px}
#tab-posts{grid-template-columns:330px minmax(0,1fr);gap:24px}
#tab-posts>.card:nth-of-type(3){margin-top:0}
.collrow{padding:18px;border-radius:12px;background:rgba(12,12,10,.72)}
.collrow>div:first-child{gap:13px!important}
.wrow2{min-height:74px;padding:15px 18px;border-radius:12px;background:rgba(14,14,12,.8)}
.wrow2-title{font-size:17px}
.wrow2-sub{font-size:13px;margin-top:5px}
.wrow-edit{padding:24px 20px 22px;border-color:rgba(107,103,96,.28);background:rgba(9,9,8,.72)}
.watch-edit-fields{gap:20px 24px}
.watch-field label{margin:0 0 8px}
.watch-confirm-actions{gap:9px}
.wrow-confirm{padding:16px;border-color:rgba(212,162,78,.32);background:rgba(212,162,78,.055)}
.album-item{border-radius:13px;background:rgba(14,14,12,.82)}
.album-row{min-height:76px;padding:16px 18px}
.album-row-name{font-size:17px}
.album-row-meta{font-size:13px;margin-top:3px}
.album-edit{padding:22px 20px 24px;background:rgba(9,9,8,.7)}
.album-edit-grid{grid-template-columns:210px minmax(0,1fr);gap:24px}
.album-edit-fields{gap:15px}
.imgcards{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:24px;padding-top:20px;border-top:1px solid rgba(107,103,96,.22)}
.imgcard{border-radius:11px;border-color:rgba(107,103,96,.28);background:rgba(10,10,8,.8)}
.imgcard-thumb{height:160px;object-fit:contain;padding:12px;background:#080807}
.imgcard-body{padding:13px}
.imgcard-fields input,.imgcard-src{min-height:38px}
.dynrow{min-height:72px;padding:15px 16px;border-radius:10px;background:rgba(14,14,12,.8)}
.dynrow-text{font-size:15px}
#tab-dynamics .card:first-of-type textarea{min-height:170px}
.friendrow{padding:12px;border-radius:10px;background:rgba(14,14,12,.8)}
.status{font-size:13px}
.dd-btn{min-height:44px}
.dd-menu{border-radius:10px}
.collrow{display:grid;grid-template-columns:1fr;gap:12px;padding:18px;border-radius:12px;background:rgba(12,12,10,.72)}
.collrow>div:first-child{display:grid!important;grid-template-columns:46px minmax(0,1fr);align-items:center;gap:13px!important}
.collrow>input{margin:0!important}
.collrow>div:last-child{display:grid!important;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;margin:0!important}
.collrow>div:last-child input{min-width:0}
.dynrow>div:last-child{display:flex!important;align-items:center;gap:9px!important;flex-shrink:0}
/* ===== 内容工作区：浏览优先，编辑使用弹窗 ===== */
#tab-overview,#tab-posts{display:block}
.overview-grid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(380px,.88fr);gap:24px;align-items:start}.overview-friends-card{grid-column:1/-1}
.panel-note,.list-caption{color:var(--text-m);font-size:12px}.panel-note{margin:-10px 0 18px}
.overview-add-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
 .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.settings-wide{grid-column:1/-1}.settings-grid textarea{min-height:100px}.settings-divider{display:flex;align-items:center;gap:12px;margin-top:24px;padding-top:19px;border-top:1px solid rgba(107,103,96,.22);color:var(--accent-dim);font-family:monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase}.settings-divider::after{content:"";height:1px;flex:1;background:rgba(107,103,96,.18)}
.quick-links,.card-actions{display:flex;align-items:center;gap:10px;margin-top:18px}.card-actions .status{flex:1;margin:0}
.article-admin-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(360px,.75fr);gap:24px;align-items:start}.article-admin-grid .card{margin-bottom:0}
.site-like-list{display:flex;flex-direction:column;gap:10px}.site-like-list .pitem{min-height:82px;padding:15px 17px;background:linear-gradient(135deg,rgba(255,255,255,.03),rgba(255,255,255,.012));border:1px solid rgba(107,103,96,.25);border-radius:12px}.site-like-list .pitem:hover{transform:translateX(3px);border-color:rgba(212,162,78,.55)}
.post-admin-main{min-width:0}.post-admin-title{display:block;font-family:Georgia,serif;font-size:20px;color:var(--text-p);line-height:1.3}.post-admin-meta{display:block;margin-top:6px;color:var(--accent-dim);font-size:12px}.post-admin-desc{display:block;margin-top:5px;color:var(--text-m);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.collection-admin-list{display:flex;flex-direction:column;gap:12px}.collection-admin-card{position:relative;display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px;border:1px solid rgba(107,103,96,.24);border-radius:12px;background:linear-gradient(135deg,rgba(255,255,255,.03),rgba(255,255,255,.012))}.collection-admin-cover{width:92px;height:92px;border-radius:9px;overflow:hidden;background:linear-gradient(135deg,#263d2b,#101b14);display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:28px}.collection-admin-cover img{width:100%;height:100%;object-fit:cover}.collection-admin-name{font-family:Georgia,serif;font-size:19px;color:var(--text-p)}.collection-admin-meta{margin-top:6px;color:var(--accent-dim);font-size:12px}.collection-admin-desc{margin-top:7px;color:var(--text-m);font-size:13px;line-height:1.45}
.content-browser-card{position:relative}.moment-admin-feed{display:flex;flex-direction:column;gap:14px}.admin-moment{padding:22px 24px;border:1px solid rgba(107,103,96,.24);border-radius:14px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));cursor:pointer;transition:border-color .2s,transform .2s,box-shadow .2s}.admin-moment:hover{border-color:rgba(212,162,78,.55);transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.18)}.admin-moment-head{display:flex;align-items:center;gap:11px}.admin-moment-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid var(--border)}.admin-moment-author{color:var(--text-p);font-size:14px}.admin-moment-publish{display:block;margin-top:2px;color:var(--text-m);font-family:var(--font-mono);font-size:11px}.admin-moment-text{margin-top:17px;color:var(--text-b);font-size:15px;line-height:1.8;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}.admin-moment-edited{margin-top:14px;color:var(--accent-dim);font-family:var(--font-mono);font-size:11px}.admin-moment-gallery,.compose-image-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:16px}.admin-moment-gallery img,.compose-image-grid img{width:100%;aspect-ratio:1.3;object-fit:cover;border-radius:7px;background:#0b0b09}.admin-moment-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:17px;padding-top:13px;border-top:1px solid var(--border)}.admin-moment-actions{display:flex;gap:7px}.content-fab{position:fixed;right:34px;bottom:30px;z-index:150;min-width:58px;height:48px;padding:0 18px;border:1px solid rgba(212,162,78,.55);border-radius:13px;background:var(--accent);color:var(--bg);font-size:23px;line-height:1;cursor:pointer;box-shadow:0 12px 28px rgba(0,0,0,.35);transition:transform .2s,box-shadow .2s}.content-fab:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(0,0,0,.45)}
.album-admin-grid{display:flex;flex-direction:column;gap:18px}.album-admin-card{border:1px solid rgba(107,103,96,.24);border-radius:14px;overflow:hidden;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}.album-admin-head{display:grid;grid-template-columns:124px minmax(0,1fr) auto;gap:17px;align-items:center;padding:15px}.album-admin-cover{width:124px;height:92px;border-radius:9px;overflow:hidden;background:linear-gradient(135deg,#263d2b,#101b14);display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:28px}.album-admin-cover img{width:100%;height:100%;object-fit:cover}.album-admin-name{font-family:Georgia,serif;color:var(--text-p);font-size:20px}.album-admin-meta{margin-top:5px;color:var(--text-m);font-size:12px}.album-admin-desc{margin-top:7px;color:var(--text-m);font-size:13px}.album-admin-images{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:0 15px 15px}.admin-image-card{position:relative;overflow:hidden;aspect-ratio:4/3;border-radius:9px;background:#0b0b09;border:1px solid var(--border)}.admin-image-card>img{width:100%;height:100%;object-fit:cover;display:block}.admin-image-caption{position:absolute;left:0;right:0;bottom:0;padding:24px 8px 7px;background:linear-gradient(transparent,rgba(0,0,0,.85));color:var(--text-p);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.admin-image-actions{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;gap:7px;padding:9px;opacity:0;background:linear-gradient(transparent,rgba(0,0,0,.66));transition:opacity .2s}.admin-image-card:hover .admin-image-actions{opacity:1}.admin-image-actions .btn{min-height:30px;padding:5px 8px;font-size:11px}.admin-image-actions .image-actions-top{display:flex;justify-content:space-between;gap:7px}.admin-image-actions .image-preview-btn{width:100%}
.anime-admin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px}.anime-admin-card{border:1px solid rgba(107,103,96,.24);border-radius:13px;overflow:hidden;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));cursor:pointer;transition:transform .2s,border-color .2s,box-shadow .2s}.anime-admin-card:hover{transform:translateY(-3px);border-color:rgba(212,162,78,.55);box-shadow:0 14px 28px rgba(0,0,0,.2)}.anime-admin-cover{position:relative;height:220px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#11110f}.anime-admin-cover-backdrop{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(13px);opacity:.55;transform:scale(1.12)}.anime-admin-cover img{position:relative;z-index:1;max-width:82%;max-height:88%;object-fit:contain;border-radius:7px;box-shadow:0 14px 24px rgba(0,0,0,.48)}.anime-admin-cover-empty{color:var(--accent);font-size:32px}.anime-admin-body{padding:15px}.anime-admin-title{color:var(--text-p);font-family:Georgia,serif;font-size:19px;line-height:1.3}.anime-admin-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;color:var(--accent-dim);font-size:12px}.anime-admin-tag{padding:3px 7px;border:1px solid rgba(212,162,78,.3);border-radius:5px}.anime-admin-note{margin-top:9px;color:var(--text-m);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.anime-admin-card-actions{display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(107,103,96,.2)}.anime-admin-card-actions .btn{min-height:34px;padding:6px 12px;font-size:12px}.watch-moegirl-pending{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:20px;padding:13px 15px;border:1px solid rgba(212,162,78,.32);border-radius:9px;background:rgba(212,162,78,.06)}.watch-moegirl-pending>div:first-child{display:flex;flex-direction:column;gap:3px;min-width:0}.watch-moegirl-pending strong{color:var(--text-p);font-size:13px}.watch-moegirl-pending span{color:var(--text-m);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.watch-moegirl-pending .watch-confirm-actions{flex-shrink:0}
.admin-modal{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:28px;background:rgba(6,6,5,.82);backdrop-filter:blur(10px)}.admin-modal.show{display:flex}.admin-modal-inner{position:relative;width:min(760px,100%);max-height:90vh;overflow:auto;padding:30px 34px;background:linear-gradient(145deg,#171714,#0d0d0b);border:1px solid rgba(212,162,78,.28);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.58)}.post-modal-inner{width:min(860px,100%)}.dyn-modal-inner{width:min(700px,100%)}.album-modal-inner{width:min(960px,100%)}.watch-modal-inner{width:min(900px,100%)}.image-edit-modal-inner,.collection-modal-inner{width:min(520px,100%)}.modal-kicker{margin-bottom:9px;color:var(--accent-dim);font-family:var(--font-mono);font-size:10px;letter-spacing:.2em}.admin-modal .form-hd{margin-bottom:22px}.admin-modal .moment-x{position:absolute;right:18px;top:15px}.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:18px;border-top:1px solid var(--border)}.dyn-time-note{display:flex;justify-content:space-between;gap:14px;margin-top:17px;padding:12px 14px;border:1px solid rgba(107,103,96,.24);border-radius:8px;background:rgba(255,255,255,.018);font-size:12px}.dyn-time-note span{color:var(--text-m)}.dyn-time-note b{font-weight:400;color:var(--accent-dim);font-family:var(--font-mono)}.dyn-edit-time{margin-top:8px}.compose-image-grid img{aspect-ratio:1}.album-editor-head{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:stretch}.album-editor-head .album-edit-cover{min-height:150px}.album-image-editor{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.album-image-edit-card{padding:8px;border:1px solid var(--border);border-radius:8px;background:rgba(0,0,0,.18)}.album-image-edit-card img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:5px}.album-image-edit-card input{min-height:34px;margin-top:7px;padding:6px 8px;font-size:12px}.album-image-edit-card .btn{width:100%;min-height:30px;margin-top:7px;padding:5px;font-size:11px}.watch-editor{display:grid;grid-template-columns:190px minmax(0,1fr);gap:24px}.watch-editor-cover{height:260px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:10px;background:#0b0b09;overflow:hidden;cursor:pointer}.watch-editor-cover img{max-width:100%;max-height:100%;object-fit:contain}.watch-editor-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.watch-editor-fields .wide{grid-column:1/-1}.image-edit-preview{height:180px;margin-bottom:18px;border:1px solid var(--border);border-radius:9px;background:#0a0a08;display:flex;align-items:center;justify-content:center;overflow:hidden}.image-edit-preview img{max-width:100%;max-height:100%;object-fit:contain}.image-edit-defaults{display:flex;align-items:center;gap:10px;margin-top:13px;color:var(--text-m);font-size:12px}
@media(max-width:1100px){.overview-grid,.article-admin-grid{grid-template-columns:1fr}.overview-friends-card{grid-column:auto}.anime-admin-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* ===== 番剧管理与网站本体对齐：分组、固定卡片高度、纵向海报 ===== */
.anime-admin-browser{padding-bottom:26px}
.anime-admin-sections{display:flex;flex-direction:column;gap:52px}
.anime-admin-section+.anime-admin-section{padding-top:2px}
.anime-admin-section-head{display:flex;align-items:baseline;gap:14px;margin:0 0 18px;padding:0 2px 12px;border-bottom:1px solid rgba(107,103,96,.24)}
.anime-admin-section-kicker{color:var(--accent);font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:lowercase}
.anime-admin-section-head h2{color:var(--text-p);font-family:Georgia,serif;font-size:18px;font-weight:600}
.anime-admin-count{margin-left:auto;color:var(--text-m);font-family:var(--font-mono);font-size:12px}
.anime-admin-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px}
.anime-admin-card{display:flex;height:520px;min-width:0;flex-direction:column;overflow:hidden;border:1px solid rgba(107,103,96,.24);border-radius:14px;background:var(--surface);cursor:default;transition:transform .2s,border-color .2s,box-shadow .2s}
.anime-admin-card:hover{transform:translateY(-4px);border-color:var(--accent);box-shadow:0 12px 30px rgba(0,0,0,.28)}
.anime-admin-cover{position:relative;display:flex;flex:0 0 320px;align-items:center;justify-content:center;box-sizing:border-box;min-width:0;overflow:hidden;padding:18px;background:#171715;line-height:0;text-decoration:none}
.anime-admin-cover::after{content:"";position:absolute;inset:0;background:rgba(12,12,10,.12);pointer-events:none}
.anime-admin-cover-backdrop{position:absolute;inset:-6px;background-position:center;background-size:cover;filter:blur(3px);opacity:.38;transform:scale(1.03);pointer-events:none}
.anime-admin-cover img{position:relative;z-index:1;display:block;width:auto;height:auto;max-width:100%;max-height:100%;border-radius:8px;background:#171715;object-fit:contain;box-shadow:0 18px 30px -10px rgba(0,0,0,.82),0 5px 12px rgba(0,0,0,.38),0 0 0 1px rgba(240,236,228,.14);transition:transform .25s ease,box-shadow .25s ease}
.anime-admin-cover:hover img{transform:translateY(-3px);box-shadow:0 23px 34px -10px rgba(0,0,0,.88),0 7px 15px rgba(0,0,0,.42),0 0 0 1px rgba(240,236,228,.2)}
.anime-admin-cover-empty{position:relative;z-index:1;display:flex;width:min(72%,240px);aspect-ratio:4/3;align-items:center;justify-content:center;color:var(--accent);font-size:42px;line-height:1;box-shadow:0 18px 30px -10px rgba(0,0,0,.66),0 0 0 1px rgba(240,236,228,.1)}
.anime-admin-body{display:flex;min-width:0;flex:1;flex-direction:column;align-items:flex-start;padding:17px 18px 16px;background:var(--surface);cursor:pointer}
.anime-admin-title{max-width:100%;color:var(--text-p);font-family:Georgia,serif;font-size:21px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.anime-admin-meta{display:flex;gap:8px 11px;flex-wrap:wrap;margin-top:10px;color:var(--accent-dim);font-family:var(--font-mono);font-size:12px;line-height:1.6}
.anime-admin-tag{padding:3px 7px;border:1px solid rgba(212,162,78,.36);border-radius:5px;background:rgba(212,162,78,.05)}
.anime-admin-note{display:-webkit-box;max-width:100%;margin-top:12px;color:var(--text-m);font-family:var(--font-sans);font-size:13px;line-height:1.6;overflow:hidden;text-overflow:ellipsis;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.anime-admin-card-actions{display:flex;width:100%;gap:8px;margin-top:auto;padding-top:13px;border-top:1px solid var(--border)}
.anime-admin-card-actions .btn{min-height:34px;padding:6px 12px;font-size:12px}
.anime-admin-empty{grid-column:1/-1;margin:0;padding:24px;border:1px dashed var(--border);color:var(--text-m);text-align:center}
.watch-moegirl-pending{display:grid;grid-template-columns:84px minmax(0,1fr) auto;align-items:center;gap:16px;margin-top:20px;padding:14px 16px;border:1px solid rgba(212,162,78,.38);border-radius:10px;background:rgba(212,162,78,.06)}
.watch-moegirl-preview{display:flex;width:84px;height:108px;align-items:center;justify-content:center;overflow:hidden;border:1px solid rgba(240,236,228,.12);border-radius:7px;background:#11110f;color:var(--accent);font-size:28px}
.watch-moegirl-preview img{width:100%;height:100%;object-fit:contain}
.watch-moegirl-result{display:flex;min-width:0;flex-direction:column;gap:4px}
.watch-moegirl-label{color:var(--accent-dim);font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase}
.watch-moegirl-result strong{color:var(--text-p);font-family:Georgia,serif;font-size:17px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.watch-moegirl-source{color:var(--text-m);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.watch-moegirl-result a{width:max-content;margin-top:3px;color:var(--accent);font-size:12px;text-decoration:none}
.watch-moegirl-result a:hover{text-decoration:underline}
.watch-moegirl-pending .watch-confirm-actions{display:flex;flex-shrink:0;gap:8px}
@media(max-width:1100px){.anime-admin-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
/* ===== 弹窗最终收口：内容宽度由容器决定，避免表单网格被内容反向压窄 ===== */
body.admin-modal-open{overflow:hidden}
.admin-modal{overflow:hidden}
.admin-modal-inner{width:min(960px,calc(100vw - 56px));max-height:calc(100vh - 56px);overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable}
.post-modal-inner{width:min(860px,calc(100vw - 56px))}.dyn-modal-inner{width:min(700px,calc(100vw - 56px))}.album-modal-inner{width:min(960px,calc(100vw - 56px))}.watch-modal-inner{width:min(1020px,calc(100vw - 56px))}.image-edit-modal-inner,.collection-modal-inner{width:min(520px,calc(100vw - 56px))}
.watch-editor{width:100%;min-width:0;grid-template-columns:190px minmax(0,1fr);align-items:start}
.watch-editor-fields{width:100%;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 18px}
.watch-editor-fields>div{min-width:0}
.watch-editor-fields label{display:block;margin:0 0 8px}
.watch-editor-fields input,.watch-editor-fields select,.watch-editor-fields textarea{display:block;width:100%;min-width:0;box-sizing:border-box}
.watch-editor-fields .wide{grid-column:1/-1}
.admin-modal .moment-x{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;position:absolute;top:17px;right:19px;width:32px;height:32px;padding:0;border:1px solid rgba(107,103,96,.34);border-radius:7px;background:rgba(255,255,255,.025);color:var(--text-m);font:400 19px/1 var(--font-sans);cursor:pointer}
.admin-modal .moment-x:hover{border-color:var(--accent);background:rgba(212,162,78,.08);color:var(--accent)}
/* ===== 文章工作区：单一内容区，通过按钮切换文章与合集 ===== */
#tab-posts{display:block}
.article-workspace{display:flex;flex-direction:column;gap:18px}
.article-workspace-head,.article-view-head{display:flex;align-items:center;justify-content:space-between;gap:18px}
.admin-segmented{display:inline-flex;align-items:center;gap:4px;padding:4px;border:1px solid rgba(107,103,96,.28);border-radius:11px;background:rgba(14,14,12,.82)}
.admin-segmented .btn{min-height:36px;padding:7px 15px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--text-m);font-size:12px}
.admin-segmented .btn:hover{background:rgba(212,162,78,.08);color:var(--text-p)}
.admin-segmented .btn.is-active{border-color:rgba(212,162,78,.35);background:rgba(212,162,78,.13);color:var(--accent)}
.article-view-panel{margin-bottom:0}
.article-view-head{margin-bottom:22px;padding-bottom:17px;border-bottom:1px solid rgba(107,103,96,.24)}
.article-view-head>div:first-child{display:flex;align-items:baseline;gap:12px}
.panel-eyebrow{color:var(--text-p);font-size:18px;font-weight:600}
.post-group{display:flex;flex-direction:column;gap:10px}
.post-group+.post-group{margin-top:24px;padding-top:22px;border-top:1px solid rgba(107,103,96,.22)}
.post-group-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 2px 2px;color:var(--text-p);font-size:15px}
.post-group-head b{color:var(--accent-dim);font-size:12px;font-weight:400}
#articleViewArticles[hidden],#articleViewCollections[hidden]{display:none}
/* 相册无独立封面时，使用与网站相同的图片叠放封面 */
.album-admin-cover-row{width:46px;height:46px;min-width:46px;flex:0 0 46px;position:relative;padding:0;border:1px solid var(--border);border-radius:7px}
.album-admin-cover-inner{position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:#121210}
.album-admin-cover-inner>img{position:absolute;width:68%;height:72%;object-fit:cover;border:1px solid #0d0d0b;border-radius:3px;box-shadow:0 2px 7px rgba(0,0,0,.45);transform:rotate(calc((var(--i) - 1) * 6deg)) translateY(calc((var(--i) - 1) * 3px));opacity:.95}
.album-admin-cover-inner>img:nth-child(1){left:5%;top:14%}.album-admin-cover-inner>img:nth-child(2){left:16%;top:9%}.album-admin-cover-inner>img:nth-child(3){left:27%;top:14%}.album-admin-cover-inner>img:nth-child(4){left:16%;top:19%}.album-admin-cover-inner>img:nth-child(5){left:27%;top:9%}
 .album-admin-cover-count{position:absolute;right:3px;bottom:2px;z-index:4;padding:0 3px;border-radius:3px;background:rgba(0,0,0,.62);color:var(--text-p);font:11px/1.35 var(--font-mono)}
 .album-admin-cover-placeholder{color:var(--accent);font-size:21px}
 .album-edit-cover .album-admin-cover-inner{position:absolute}
 .album-row-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
 .album-editor-empty{grid-column:1/-1;padding:22px;border:1px dashed var(--border);border-radius:9px;color:var(--text-m);text-align:center}
 .album-image-edit-card label{margin:10px 0 5px;color:var(--text-m);font-size:10px;letter-spacing:.08em;text-transform:none}
 /* ===== 管理台表单：统一自绘控件与分页工作流 ===== */
 input,textarea{color-scheme:dark;caret-color:var(--accent)}
 input::placeholder,textarea::placeholder{color:rgba(176,169,154,.48)}
 input:hover,textarea:hover{border-color:rgba(212,162,78,.42)}
 input[readonly]{color:var(--text-m);background:rgba(255,255,255,.025)}
 input[type=file]{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;opacity:0!important}
 .file-picker{display:flex;align-items:center;gap:12px;min-height:52px;padding:7px 9px;border:1px dashed rgba(107,103,96,.4);border-radius:10px;background:rgba(255,255,255,.018);transition:border-color .2s,background .2s}
 .file-picker:hover{border-color:rgba(212,162,78,.7);background:rgba(212,162,78,.045)}
 .file-picker>span{min-width:0;overflow:hidden;color:var(--text-m);font-size:13px;text-overflow:ellipsis;white-space:nowrap}
 .file-picker .btn{flex:0 0 auto}
 .field-help{margin-top:7px;color:var(--text-m);font-size:12px;line-height:1.55}
 .field-intro{margin-bottom:19px;padding:12px 14px;border-left:2px solid var(--accent);background:rgba(212,162,78,.055);color:var(--text-b);font-size:13px;line-height:1.65}
 .custom-select{position:relative;width:100%;min-width:0}
 .custom-select-native{display:none!important;position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;opacity:0!important;pointer-events:none!important}
 .custom-select-button{display:flex;width:100%;min-height:44px;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;border:1px solid rgba(107,103,96,.34);border-radius:9px;background:#0e0e0c;color:var(--text-p);font:inherit;text-align:left;cursor:pointer;transition:border-color .2s,background .2s}
 .custom-select-button:hover,.custom-select.is-open .custom-select-button{border-color:var(--accent);background:rgba(212,162,78,.055)}
 .custom-select-chevron{color:var(--accent);font-size:17px;line-height:1;transition:transform .2s}
 .custom-select.is-open .custom-select-chevron{transform:rotate(180deg)}
 .custom-select-menu{position:absolute;z-index:80;top:calc(100% + 7px);left:0;right:0;display:none;max-height:230px;overflow:auto;padding:5px;border:1px solid rgba(212,162,78,.35);border-radius:10px;background:#171714;box-shadow:0 18px 38px rgba(0,0,0,.52)}
 .custom-select.is-open .custom-select-menu{display:block;animation:select-in .16s ease-out}
 .custom-option{display:block;width:100%;padding:10px 11px;border:0;border-radius:6px;background:transparent;color:var(--text-b);font:inherit;font-size:13px;text-align:left;cursor:pointer}
 .custom-option:hover,.custom-option.is-selected{background:rgba(212,162,78,.11);color:var(--accent)}
 .custom-option:disabled{opacity:.45;cursor:not-allowed}
 @keyframes select-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
 .wizard{min-width:0}
 .wizard-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 24px;padding:0 0 15px;border-bottom:1px solid rgba(107,103,96,.25)}
 .wizard-steps{display:flex;align-items:center;gap:8px;min-width:0}
 .wizard-step{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid transparent;border-radius:8px;color:var(--text-m);font-size:12px;white-space:nowrap;transition:color .2s,background .2s,border-color .2s}
 .wizard-step i{font:11px/1 var(--font-mono);color:var(--text-m);font-style:normal}
 .wizard-step.is-active{border-color:rgba(212,162,78,.36);background:rgba(212,162,78,.1);color:var(--text-p)}
 .wizard-step.is-active i,.wizard-step.is-done i{color:var(--accent)}
 .wizard-step.is-done{color:var(--accent-dim)}
 .wizard-count{flex:0 0 auto;color:var(--accent-dim);font:12px/1 var(--font-mono)}
 .form-page{display:none;min-height:260px;animation:form-page-in .2s ease-out}
 .form-page.is-active{display:block}
 @keyframes form-page-in{from{opacity:.35;transform:translateX(8px)}to{opacity:1;transform:none}}
 .wizard-nav{display:flex;justify-content:space-between;gap:10px;margin-top:24px;padding-top:17px;border-top:1px solid rgba(107,103,96,.22)}
 .wizard-nav .wizard-next{margin-left:auto;border-color:rgba(212,162,78,.36);color:var(--accent)}
 .wizard-nav .wizard-next:hover{background:rgba(212,162,78,.1)}
 .wizard-nav button:disabled{opacity:.35;cursor:not-allowed}
 .watch-editor>.wizard{min-width:0}
 .admin-date-input{font-family:var(--font-mono);letter-spacing:.02em}
 .admin-date-picker{display:flex;align-items:stretch;gap:8px;min-width:0}
 .admin-date-picker .admin-date-input{flex:1;min-width:0}
 .admin-date-button{display:inline-flex;width:44px;min-height:44px;align-items:center;justify-content:center;padding:0;border:1px solid rgba(107,103,96,.34);border-radius:9px;background:rgba(255,255,255,.025);color:var(--accent);font-size:20px;line-height:1;cursor:pointer;transition:border-color .2s,background .2s,transform .2s}
 .admin-date-button:hover{border-color:var(--accent);background:rgba(212,162,78,.1);transform:translateY(-1px)}
 .admin-calendar{position:fixed;z-index:1200;box-sizing:border-box;padding:14px;border:1px solid rgba(212,162,78,.32);border-radius:14px;background:linear-gradient(145deg,#1b1b18,#10100e);box-shadow:0 22px 55px rgba(0,0,0,.56);color:var(--text-b);font-size:13px}
 .admin-calendar-head{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;gap:8px;margin-bottom:12px}
 .admin-calendar-nav,.admin-calendar-title,.admin-calendar-foot button,.admin-calendar-day,.admin-calendar-month,.admin-calendar-year{appearance:none;-webkit-appearance:none;border:0;font:inherit;cursor:pointer}
 .admin-calendar-nav{display:inline-flex;width:36px;height:34px;align-items:center;justify-content:center;border:1px solid rgba(107,103,96,.34);border-radius:8px;background:rgba(255,255,255,.025);color:var(--accent);font-size:24px;line-height:1;transition:background .2s,border-color .2s}
 .admin-calendar-nav:hover{border-color:var(--accent);background:rgba(212,162,78,.1)}
 .admin-calendar-title{min-width:0;padding:7px 5px;border-radius:7px;background:transparent;color:var(--text-p);font-family:var(--font-sans);font-size:15px;font-weight:600;letter-spacing:.04em;white-space:nowrap}
 .admin-calendar-title:hover{background:rgba(212,162,78,.1);color:var(--accent)}
 .admin-calendar-weekdays,.admin-calendar-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
 .admin-calendar-weekdays{margin-bottom:5px;color:var(--accent-dim);font-family:var(--font-mono);font-size:10px;text-align:center}
 .admin-calendar-weekdays span{padding:4px 0}
 .admin-calendar-day{display:flex;min-height:32px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--text-b);transition:background .15s,border-color .15s,color .15s}
 .admin-calendar-day:hover{border-color:rgba(212,162,78,.5);background:rgba(212,162,78,.11);color:var(--accent)}
 .admin-calendar-day.is-outside{color:rgba(146,139,125,.38)}
 .admin-calendar-day.is-selected{border-color:var(--accent);background:var(--accent);color:#16130d;font-weight:700}
 .admin-calendar-months,.admin-calendar-years{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
 .admin-calendar-month,.admin-calendar-year{min-height:42px;border:1px solid rgba(107,103,96,.28);border-radius:8px;background:rgba(255,255,255,.025);color:var(--text-b);transition:background .15s,border-color .15s,color .15s}
 .admin-calendar-month:hover,.admin-calendar-year:hover,.admin-calendar-month.is-current,.admin-calendar-year.is-current{border-color:rgba(212,162,78,.62);background:rgba(212,162,78,.12);color:var(--accent)}
 .admin-calendar-foot{display:flex;justify-content:flex-end;margin-top:10px;padding-top:9px;border-top:1px solid rgba(107,103,96,.2)}
 .admin-calendar-foot button{padding:4px 7px;border-radius:6px;background:transparent;color:var(--accent-dim);font-size:11px}
 .admin-calendar-foot button:hover{background:rgba(212,162,78,.1);color:var(--accent)}
 .watch-editor{display:block;width:100%}
 .watch-basic-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:24px;align-items:start}
 .watch-cover-column{display:flex;flex-direction:column;gap:10px;min-width:0}
 .watch-cover-upload{width:100%;padding:7px 9px;font-size:12px}
 .watch-note-editor{display:block;width:100%;min-height:280px;resize:vertical;box-sizing:border-box;line-height:1.85}
 [data-watch-field]{min-width:0}
 @media(max-width:720px){.watch-basic-layout{grid-template-columns:1fr}.watch-cover-column{max-width:220px}.admin-calendar{padding:11px}.admin-calendar-day{min-height:30px}}
 .admin-modal-inner{scrollbar-color:rgba(212,162,78,.45) rgba(255,255,255,.04);scrollbar-width:thin}
 .admin-modal-inner::-webkit-scrollbar,.custom-select-menu::-webkit-scrollbar{width:7px}
 .admin-modal-inner::-webkit-scrollbar-thumb,.custom-select-menu::-webkit-scrollbar-thumb{border-radius:99px;background:rgba(212,162,78,.42)}
 .admin-modal-inner::-webkit-scrollbar-track,.custom-select-menu::-webkit-scrollbar-track{background:rgba(255,255,255,.035)}
 @media(max-width:1100px){.wizard-steps{gap:3px}.wizard-step{padding:7px 8px}.wizard-step i{display:none}}
</style>
</head><body>
 <nav class="topnav"><div class="navwrap">
   <span class="brand">避难所<em>管理台</em></span>
   <div class="navlinks">
     <a class="nav-link active" data-tab="overview" onclick="t('overview')">综合</a>
     <a class="nav-link" data-tab="posts" onclick="t('posts')">文章</a>
     <a class="nav-link" data-tab="dynamics" onclick="t('dynamics')">动态</a>
     <a class="nav-link" data-tab="gallery" onclick="t('gallery')">图片</a>
     <a class="nav-link" data-tab="watching" onclick="t('watching')">番剧</a>
   </div>
 </div></nav>
 <div class="wrap">

 <section id="tab-overview" class="tabpage active">
   <h1>综合 <em>Overview</em></h1>
    <p class="sub">首页、页头、页脚、关于页内容和友链等站点杂项集中在这里。</p>
   <div class="overview-grid">
     <div class="card overview-pin-card">
       <div class="list-hd"><span>首页置顶 · <b id="pinCount">0</b>/8</span><button class="btn btn-pub" onclick="savePin()">保存置顶</button></div>
       <div class="panel-note">首页置顶会按这里的顺序展示文章和动态。</div>
       <div id="pinnedList"></div>
       <div class="overview-add-grid">
         <div><label>添加文章</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDd('addPinPostMenu')"><span id="addPinPostLbl">选择文章…</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="addPinPostMenu" style="display:none"></div></div></div>
         <div><label>添加动态</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDd('addPinDynMenu')"><span id="addPinDynLbl">选择动态…</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="addPinDynMenu" style="display:none"></div></div></div>
       </div>
       <div class="status" id="pinStatus"></div>
     </div>
     <div class="card overview-settings-card">
       <div class="list-hd"><span>站点与关于页</span><button class="btn btn-pub" onclick="saveSiteSettings()">保存设置</button></div>
       <div class="settings-grid">
         <div><label>页头英文名</label><input id="site_header" placeholder="Shelter"></div>
         <div><label>首页大标题</label><input id="site_home_title" placeholder="流浪猫的避难所"></div>
         <div class="settings-wide"><label>首页副标题（每行一句）</label><textarea id="site_home_subtitle" rows="3"></textarea></div>
         <div><label>页脚署名</label><input id="site_footer_byline" placeholder="by 流浪猫不是LLM"></div>
         <div><label>关于页姓名</label><input id="site_about_name" placeholder="许纯之"></div>
         <div class="settings-wide"><label>关于页别名</label><input id="site_about_aka" placeholder="Xu Zhunzhi / 流浪猫不是LLM / 幼儿班的小超超"></div>
         <div class="settings-wide settings-divider"><span>关于页内容</span></div>
         <div class="settings-wide"><label>关于页诗句（每行一句）</label><textarea id="site_about_poem" rows="3"></textarea></div>
         <div class="settings-wide"><label>About Me（段落之间空一行）</label><textarea id="site_about_bio" rows="6"></textarea></div>
         <div><label>正在做的项目</label><input id="site_about_projects" placeholder="03"></div>
         <div><label>深夜灵感次数</label><input id="site_about_inspiration" placeholder="∞"></div>
         <div><label>喝掉的咖啡</label><input id="site_about_coffee" placeholder="42"></div>
         <div><label>窗外的月亮</label><input id="site_about_moon" placeholder="01"></div>
         <div class="settings-wide"><label>联系邮箱</label><input id="site_about_contact" placeholder="xuzhunzhi@foxmail.com"></div>
       </div>
       <div class="quick-links"><a class="btn btn-ghost" href="/" target="_blank">打开首页 ↗</a><a class="btn btn-ghost" href="/about/" target="_blank">打开关于页 ↗</a></div>
       <div class="status" id="siteStatus"></div>
     </div>
     <div class="card overview-friends-card">
       <div class="list-hd"><span>友链 / Friends</span><button class="btn btn-ghost" onclick="addFriend()">＋ 添加友链</button></div>
       <div id="friendlist"></div>
       <div class="card-actions"><button class="btn btn-pub" onclick="saveFriends()">保存友链</button><div class="status" id="friendStatus"></div></div>
     </div>
   </div>
 </section>

 <section id="tab-posts" class="tabpage">
   <h1>文章 <em>Notes</em></h1>
   <p class="sub">文章列表和合集展示与网站本体保持一致；需要编辑时再打开对应弹窗。</p>
   <div class="article-workspace">
     <div class="article-workspace-head">
       <div class="admin-segmented" role="tablist" aria-label="文章管理视图">
         <button class="btn is-active" id="postViewArticles" onclick="setPostView('articles')">文章列表</button>
         <button class="btn" id="postViewCollections" onclick="setPostView('collections')">合集列表</button>
       </div>
       <button class="btn btn-pub" onclick="newPost()">＋ 新建文章</button>
     </div>
     <div class="card article-view-panel" id="articleViewArticles">
       <div class="article-view-head">
         <div><span class="panel-eyebrow">文章列表</span><span class="list-caption">共 <b id="postCount">0</b> 篇</span></div>
         <div class="admin-segmented" role="tablist" aria-label="文章排序方式">
           <button class="btn is-active" id="postModeTimeline" onclick="setPostListMode('timeline')">时间线</button>
           <button class="btn" id="postModeCollections" onclick="setPostListMode('collections')">按合集</button>
         </div>
       </div>
       <div class="plist site-like-list" id="posts"></div>
     </div>
     <div class="card article-view-panel" id="articleViewCollections" hidden>
       <div class="list-hd"><span>合集列表</span><button class="btn btn-ghost" onclick="addColl()">＋ 新建合集</button></div>
       <div id="collist" class="collection-admin-list"></div>
       <div class="card-actions"><button class="btn btn-pub" onclick="saveColls()">保存合集</button><div class="status" id="collStatus"></div></div>
     </div>
   </div>
 </section>

 <section id="tab-dynamics" class="tabpage">
   <h1>动态 <em>Moments</em></h1>
   <p class="sub">按首次发布时间排序，卡片显示最后编辑时间；详情、编辑和多图上传都在弹窗中完成。</p>
   <div class="card content-browser-card">
     <div class="list-hd"><span>动态时间线</span><span class="list-caption">共 <b id="dynCount">0</b> 条</span></div>
     <div id="dynlist" class="moment-admin-feed"></div>
   </div>
   <button class="content-fab" onclick="newDyn()" aria-label="发布新动态">＋</button>
 </section>

 <section id="tab-gallery" class="tabpage">
   <h1>图片 <em>Fragments</em></h1>
   <p class="sub">相册与图片沿用网站本体的视觉层级，悬停图片即可进行删除、编辑或预览。</p>
   <div class="card content-browser-card">
     <div class="list-hd"><span>相册时间线</span><button class="btn btn-pub" onclick="newAlbum()">＋ 新建相册</button></div>
     <div id="albums" class="album-admin-grid"></div>
     <div class="card-actions"><button class="btn btn-pub" onclick="saveGallery()">保存图片</button><button class="btn btn-ghost" onclick="loadGallery()">重新读取</button><div class="status" id="galStatus"></div></div>
   </div>
 </section>

 <section id="tab-watching" class="tabpage">
   <h1>番剧 <em>Watching</em></h1>
   <p class="sub">按网站本体的分组和卡片展示番剧；海报查看原页，信息区打开弹窗编辑。</p>
   <div class="card content-browser-card anime-admin-browser">
     <div class="list-hd"><span>番剧时间线 · <b id="watchCount">0</b> 部</span><button class="btn btn-pub" onclick="newWatch()">＋ 添加番剧</button></div>
     <div id="watchlist" class="anime-admin-sections"></div>
     <div class="card-actions"><button class="btn btn-pub" onclick="saveWatch()">保存番剧</button><button class="btn btn-ghost" onclick="loadWatch()">重新读取</button><div class="status" id="watchStatus"></div></div>
   </div>
 </section>

 </div>

 <div class="admin-modal" id="postModal" onclick="if(event.target===this)closeAdminModal('postModal')">
   <div class="admin-modal-inner post-modal-inner">
     <button class="moment-x" onclick="closeAdminModal('postModal')" aria-label="关闭">×</button>
      <div class="modal-kicker">ARTICLE EDITOR</div><div class="form-hd"><span id="form_hd">发布新文章</span><button class="btn btn-ghost" id="cancelEdit" onclick="cancelEdit()">取消编辑</button></div>
      <div class="wizard" data-wizard="postWizard">
        <div class="wizard-head"><div class="wizard-steps"><span class="wizard-step is-active"><i>01</i>基础信息</span><span class="wizard-step"><i>02</i>正文内容</span></div><span class="wizard-count">1 / 2</span></div>
        <section class="form-page is-active" data-page-title="基础信息">
          <div class="field-intro">先填写文章的基本资料，正文可以在下一步继续编辑。</div>
          <label>选择文章文件</label><div class="file-picker"><input type="file" id="up_folder" aria-hidden="true" webkitdirectory multiple onchange="onFilesChanged()"><button type="button" class="btn btn-ghost" onclick="document.getElementById('up_folder').click()">选择 Markdown 文件夹</button><span id="up_folder_name">尚未选择文件</span></div><div class="field-help">可选择包含 .md 文件及图片的文件夹；编辑时上传会替换正文。</div><div class="status" id="upStatus"></div>
          <label>标题</label><input id="f_title" placeholder="文章标题">
          <label>简介（可选）</label><input id="f_summary" placeholder="一句话简介">
          <div class="row"><div><label>合集</label><div class="dd"><button type="button" class="dd-btn" onclick="toggleDD()"><span id="col_label">无合集</span><svg class="dd-arrow" viewBox="0 0 10 6" width="10" height="6"><path d="M0 0l5 6 5-6z" fill="currentColor"/></svg></button><div class="dd-menu" id="col_menu" style="display:none"></div></div><input type="hidden" id="f_collection"></div><div><label>发布日期</label><input id="f_date" placeholder="自动" readonly><div class="field-help">新文章自动使用现在；编辑文章时保留原发布日期。</div></div></div>
          <div id="f_newcol" style="display:none"><label>新合集名</label><input id="f_newcolname" placeholder="输入新合集名"></div>
        </section>
        <section class="form-page" data-page-title="正文内容">
          <div class="field-intro">支持 Markdown。上传文章文件后，图片引用会自动整理为本站路径。</div>
          <label>正文</label><textarea id="f_content" rows="12" placeholder="正文内容…"></textarea>
        </section>
        <div class="wizard-nav"><button type="button" class="btn btn-ghost wizard-prev" onclick="wizardMove('postWizard',-1)">上一步</button><button type="button" class="btn btn-ghost wizard-next" onclick="wizardMove('postWizard',1)">下一步</button></div>
      </div>
     <input type="hidden" id="f_file"><input type="hidden" id="f_catsave">
     <div class="modal-actions"><button class="btn btn-pub" id="pubBtn" onclick="publishPost()">发布</button><button class="btn btn-ghost" onclick="closeAdminModal('postModal')">取消</button></div><div class="status" id="status"></div>
   </div>
 </div>

 <div class="admin-modal" id="collectionModal" onclick="if(event.target===this)closeAdminModal('collectionModal')">
   <div class="admin-modal-inner collection-modal-inner">
     <button class="moment-x" onclick="closeAdminModal('collectionModal')" aria-label="关闭">×</button>
      <div class="modal-kicker">COLLECTION EDITOR</div><div class="form-hd"><span id="collection_mode">新建合集</span></div>
      <div class="wizard" data-wizard="collectionWizard">
        <div class="wizard-head"><div class="wizard-steps"><span class="wizard-step is-active"><i>01</i>合集资料</span><span class="wizard-step"><i>02</i>封面与确认</span></div><span class="wizard-count">1 / 2</span></div>
        <section class="form-page is-active"><div class="field-intro">合集名称会用于网址和文章归类，建议保持简洁。</div><label>合集名称</label><input id="collection_name" placeholder="合集名称"><label>简介</label><textarea id="collection_desc" rows="4" placeholder="一句话简介"></textarea></section>
        <section class="form-page"><div class="field-intro">可以填写已有图片地址；不填时网站会根据合集图片生成默认封面。</div><label>封面地址</label><input id="collection_cover" placeholder="/images/…"><div class="field-help">支持 /images/... 或完整图片地址。</div></section>
        <div class="wizard-nav"><button type="button" class="btn btn-ghost wizard-prev" onclick="wizardMove('collectionWizard',-1)">上一步</button><button type="button" class="btn btn-ghost wizard-next" onclick="wizardMove('collectionWizard',1)">下一步</button></div>
      </div>
     <div class="modal-actions"><button class="btn btn-pub" onclick="saveCollectionEditor()">保存合集</button><button class="btn btn-ghost" onclick="closeAdminModal('collectionModal')">取消</button></div><div class="status" id="collectionStatus"></div>
   </div>
 </div>

 <div class="admin-modal" id="dynModal" onclick="if(event.target===this)closeAdminModal('dynModal')">
   <div class="admin-modal-inner dyn-modal-inner">
     <button class="moment-x" onclick="closeAdminModal('dynModal')" aria-label="关闭">×</button>
      <div class="modal-kicker">MOMENT EDITOR</div><div class="form-hd"><span id="dyn_mode">发布新动态</span></div>
      <div class="wizard" data-wizard="dynWizard">
        <div class="wizard-head"><div class="wizard-steps"><span class="wizard-step is-active"><i>01</i>动态内容</span><span class="wizard-step"><i>02</i>时间与图片</span></div><span class="wizard-count">1 / 2</span></div>
        <section class="form-page is-active"><div class="field-intro">动态会按首次发布时间排序，编辑时只更新编辑时间。</div><label>正文</label><textarea id="dyn_text" rows="7" placeholder="说点什么…"></textarea><div class="dyn-time-note"><span>首次发布</span><b id="dyn_publish_time">新动态将使用系统时间</b></div></section>
        <section class="form-page"><label>编辑时间</label><input id="dyn_edit_time" type="text" class="admin-date-input" placeholder="YYYY-MM-DD HH:mm"><div class="field-help">留空时使用当前系统时间；这里不会出现浏览器原生日期控件。</div><label>图片</label><div class="file-picker"><input type="file" id="dyn_img_files" aria-hidden="true" accept="image/*" multiple onchange="upDynCompose()"><button type="button" class="btn btn-ghost" onclick="document.getElementById('dyn_img_files').click()">选择图片</button><span id="dyn_img_files_name">尚未选择图片</span></div><input type="hidden" id="dyn_img"><div id="dyn_image_preview" class="compose-image-grid"></div></section>
        <div class="wizard-nav"><button type="button" class="btn btn-ghost wizard-prev" onclick="wizardMove('dynWizard',-1)">上一步</button><button type="button" class="btn btn-ghost wizard-next" onclick="wizardMove('dynWizard',1)">下一步</button></div>
      </div>
      <div class="modal-actions"><button class="btn btn-pub" id="dyn_pubbtn" onclick="publishDyn()">发布</button><button class="btn btn-ghost" onclick="cancelDyn()">取消</button></div><div class="status" id="dynStatus"></div>
   </div>
 </div>

  <div class="admin-modal" id="albumModal" onclick="if(event.target===this)cancelAlbumEditor()">
   <div class="admin-modal-inner album-modal-inner">
      <button class="moment-x" onclick="cancelAlbumEditor()" aria-label="关闭">×</button>
      <div class="modal-kicker">ALBUM EDITOR</div><div class="form-hd"><span id="album_mode">新建相册</span></div>
      <div class="wizard" data-wizard="albumWizard">
        <div class="wizard-head"><div class="wizard-steps"><span class="wizard-step is-active"><i>01</i>相册资料</span><span class="wizard-step"><i>02</i>图片内容</span></div><span class="wizard-count">1 / 2</span></div>
        <section class="form-page is-active"><div class="album-editor-head"><div class="album-edit-cover" id="album_editor_cover" onclick="upAlbumCover(editAlbumIdx)"></div><div class="album-edit-fields"><div class="field"><label>相册名</label><input id="album_name" placeholder="相册名称"></div><div class="field"><label>简介</label><input id="album_desc" placeholder="可选简介"></div></div></div></section>
        <section class="form-page"><div class="field-intro">可以一次选择多张图片，上传后再逐张调整名称和日期。</div><label>上传图片</label><div class="file-picker"><input type="file" id="album_img_files" aria-hidden="true" accept="image/*" multiple onchange="uploadGalImg(editAlbumIdx)"><button type="button" class="btn btn-ghost" onclick="document.getElementById('album_img_files').click()">选择多张图片</button><span id="album_img_files_name">尚未选择图片</span></div><div id="album_image_editor" class="album-image-editor"></div></section>
        <div class="wizard-nav"><button type="button" class="btn btn-ghost wizard-prev" onclick="wizardMove('albumWizard',-1)">上一步</button><button type="button" class="btn btn-ghost wizard-next" onclick="wizardMove('albumWizard',1)">下一步</button></div>
      </div>
      <div class="modal-actions"><button class="btn btn-pub" onclick="saveAlbumEditor()">保存相册</button><button class="btn btn-ghost" onclick="cancelAlbumEditor()">取消</button></div><div class="status" id="albumStatus"></div>
   </div>
 </div>

 <div class="admin-modal" id="watchModal" onclick="if(event.target===this)closeAdminModal('watchModal')">
   <div class="admin-modal-inner watch-modal-inner">
     <button class="moment-x" onclick="closeAdminModal('watchModal')" aria-label="关闭">×</button>
     <div class="modal-kicker">ANIME EDITOR</div><div class="form-hd"><span id="watch_mode">添加番剧</span></div>
     <div id="watch_editor"></div>
     <div class="modal-actions"><button class="btn btn-pub" onclick="saveWatchEditor()">保存番剧</button><button class="btn btn-ghost" onclick="closeAdminModal('watchModal')">取消</button></div><div class="status" id="watchModalStatus"></div>
   </div>
 </div>

 <div class="admin-modal" id="imageEditModal" onclick="if(event.target===this)closeAdminModal('imageEditModal')">
   <div class="admin-modal-inner image-edit-modal-inner">
     <button class="moment-x" onclick="closeAdminModal('imageEditModal')" aria-label="关闭">×</button>
      <div class="modal-kicker">IMAGE DETAILS</div><div class="form-hd"><span>编辑图片信息</span></div>
      <div class="wizard" data-wizard="imageWizard">
        <div class="wizard-head"><div class="wizard-steps"><span class="wizard-step is-active"><i>01</i>预览图片</span><span class="wizard-step"><i>02</i>编辑信息</span></div><span class="wizard-count">1 / 2</span></div>
        <section class="form-page is-active"><div id="image_edit_preview" class="image-edit-preview"></div></section>
        <section class="form-page"><label>图片名称</label><input id="image_edit_caption" placeholder="默认读取文件名 / EXIF"><label>日期</label><input id="image_edit_date" type="text" class="admin-date-input" placeholder="YYYY-MM-DD"><div class="image-edit-defaults"><button class="btn btn-ghost" type="button" onclick="restoreImageDefaults()">恢复 EXIF 默认值</button><span>留空后恢复为图片默认信息</span></div></section>
        <div class="wizard-nav"><button type="button" class="btn btn-ghost wizard-prev" onclick="wizardMove('imageWizard',-1)">上一步</button><button type="button" class="btn btn-ghost wizard-next" onclick="wizardMove('imageWizard',1)">下一步</button></div>
      </div>
     <div class="modal-actions"><button class="btn btn-pub" onclick="saveImageEditor()">保存修改</button><button class="btn btn-ghost" onclick="closeAdminModal('imageEditModal')">取消</button></div>
   </div>
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

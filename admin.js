// ============================================================
// 流浪猫的避难所 · 本地管理面板 (纯 Node，零依赖)
// 运行：node admin.js  然后浏览器打开 http://localhost:4001
// 功能：新建/编辑/删除文章（Markdown + 预览），一键 git 提交推送发布
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;                                   // 仓库根目录
const POSTS_DIR = path.join(ROOT, 'source', '_posts');    // 文章目录
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
  return { file, title: fm.title || '', date: fm.date || '', categories: (fm.categories || '').replace(/^\[|\]$/g, ''), tags: (fm.tags || '').replace(/^\[|\]$/g, ''), description: fm.description || '', content: body.trim() };
}

// ---------- HTTP ----------
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } }); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(UI); return; }
    if (p === '/api/posts' && req.method === 'GET') { return json(res, 200, { posts: listPosts() }); }
    if (p === '/api/post' && req.method === 'GET') { return json(res, 200, readPost(u.searchParams.get('file') || '')); }
    if (p === '/api/save' && req.method === 'POST') {
      const body = await readBody(req);
      ensure();
      let file = body.file || (slug(body.title) + '.md');
      if (!file.endsWith('.md')) file += '.md';
      const lines = ['---', `title: ${body.title || ''}`, `date: ${body.date || ''}`];
      if (body.description) lines.push(`description: ${body.description}`);
      const cats = arr(body.categories); if (cats) lines.push(`categories: ${cats}`);
      const tags = arr(body.tags); if (tags) lines.push(`tags: ${tags}`);
      lines.push('---', '', body.content || '');
      fs.writeFileSync(path.join(POSTS_DIR, file), lines.join('\n'), 'utf8');
      return json(res, 200, { ok: true, file });
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

function startAdmin(port) {
  server.listen(port, () => console.log('\n▶ 流浪猫管理面板已启动：http://localhost:' + port + '\n   文章目录：' + POSTS_DIR + '\n   按 Ctrl+C 停止\n'));
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
.collrow{border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:10px;background:#0a0a08}
.collrow input{padding:8px 10px;font-size:13px}
.coll-thumb{width:46px;height:46px;object-fit:cover;border:1px solid var(--border);border-radius:6px;flex-shrink:0}
.dynrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 10px;border-bottom:1px solid var(--border)}
.dynrow-main{min-width:0}
.dynrow-text{color:var(--text-b);font-size:14px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dynrow-meta{font-size:12px;color:var(--text-m);margin-top:4px}
.dynrow-imgtag{color:var(--accent)}
input[type=file]{padding:6px 8px;color:var(--text-m);cursor:pointer}
input[type=file]::file-selector-button{background:transparent;border:1px solid var(--border);color:var(--text-b);font-size:12px;padding:8px 14px;margin-right:10px;cursor:pointer;border-radius:6px;transition:.2s}
input[type=file]::file-selector-button:hover{border-color:var(--accent);color:var(--accent)}
input:focus,textarea:focus{border-color:var(--accent)}
textarea{min-height:260px;resize:vertical;line-height:1.8}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.btn{display:inline-block;font-size:13px;padding:11px 22px;border:none;cursor:pointer;letter-spacing:.05em;border-radius:6px;transition:.2s}
.btn-pub{background:var(--accent);color:var(--bg)}.btn-pub:hover{opacity:.9}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text-b)}.btn-ghost:hover{border-color:var(--accent);color:var(--text-p)}
.btn-del{background:transparent;border:1px solid var(--rose);color:var(--rose);font-size:12px;padding:5px 12px}.btn-del:hover{background:var(--rose);color:var(--bg)}
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
.wrow{display:grid;grid-template-columns:1.4fr 1fr 1.4fr auto;gap:8px;margin-top:10px}
.wrow input{padding:8px 10px;font-size:13px}
.img-thumb{width:46px;height:46px;object-fit:cover;border:1px solid var(--border);border-radius:6px}
@media(max-width:760px){.row,.imgrow,.wrow{grid-template-columns:1fr}.navlinks{gap:16px}}
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
  <p class="sub">选择要置顶的内容（文章 + 动态），最多 8 篇，首页会用横向卡片展示。</p>
  <div class="card">
    <div class="list-hd"><span>已选 <b id="pinCount">0</b>/8</span><button class="btn btn-pub" onclick="savePin()">保存置顶</button></div>
    <label style="margin-top:12px">文章</label>
    <div id="pin_posts"></div>
    <label style="margin-top:16px">动态</label>
    <div id="pin_dyns"></div>
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
  <p class="sub">管理「在追的番」。</p>
  <div class="card">
    <div class="list-hd"><span>列表</span><button class="btn btn-ghost" onclick="addWatch()">＋ 添加</button></div>
    <div id="watchlist"></div>
    <div style="margin-top:20px;display:flex;gap:12px"><button class="btn btn-pub" onclick="saveWatch()">保存番剧</button><button class="btn btn-ghost" onclick="loadWatch()">读取当前</button></div>
    <div class="status" id="watchStatus"></div>
  </div>
</section>

</div>
<script src="/app.js"></script>
</body></html>
`;

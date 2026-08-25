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
  return { file, title: fm.title || '', date: fm.date || '', categories: (fm.categories || '').replace(/^\[|\]$/g, ''), tags: (fm.tags || '').replace(/^\[|\]$/g, ''), content: body.trim() };
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
    if (p === '/api/publish' && req.method === 'POST') {
      exec('git add . && git commit -m "admin publish" && git push', { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) return json(res, 500, { ok: false, msg: (stderr || err.message).slice(0, 800) });
        return json(res, 200, { ok: true, msg: '已提交并推送，等待 GitHub Actions 自动构建…' });
      });
      return;
    }
    const GALLERY_PATH = path.join(ROOT, 'source', '_data', 'gallery.json');
    const WATCHING_PATH = path.join(ROOT, 'source', '_data', 'watching.json');
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
<title>流浪猫管理台</title>
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
input,textarea{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text-p);font-size:14px;padding:10px 12px;outline:none;border-radius:6px;font-family:inherit}
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
  <span class="brand">流浪猫<em>管理台</em></span>
  <div class="navlinks">
    <a class="nav-link active" data-tab="posts" onclick="t('posts')">文章</a>
    <a class="nav-link" data-tab="gallery" onclick="t('gallery')">图片</a>
    <a class="nav-link" data-tab="watching" onclick="t('watching')">番剧</a>
  </div>
</div></nav>
<div class="wrap">

<section id="tab-posts" class="tabpage active">
  <h1>文章 &amp; <em>动态</em></h1>
  <p class="sub">新建 / 编辑 / 上传本地文章，分类填「碎碎念」即为动态。</p>
  <div class="card">
    <div class="list-hd"><span>文章列表</span></div>
    <div class="plist" id="posts"></div>
    <div style="margin-top:14px"><button class="btn btn-ghost" onclick="newPost()">＋ 新建文章</button></div>
  </div>
  <div class="card">
    <label>上传本地文章（选择包含 .md 和图片的文件夹）</label>
    <input type="file" id="up_folder" webkitdirectory directory>
    <div style="margin-top:12px"><button class="btn btn-pub" onclick="uploadPost()">上传并保存</button></div>
    <div class="status" id="upStatus"></div>
  </div>
  <div class="card">
    <input type="hidden" id="f_file">
    <label>标题</label><input id="f_title" placeholder="文章标题">
    <div class="row">
      <div><label>日期</label><input id="f_date" placeholder="2026-08-20 00:00:00"></div>
      <div><label>分类（逗号分隔）</label><input id="f_cats" placeholder="RTS设计笔记, 王者荣耀自设。填「碎碎念」=动态"></div>
    </div>
    <label>标签（逗号分隔）</label><input id="f_tags" placeholder="RTS, 设计">
    <label>正文（Markdown）</label><textarea id="f_content" placeholder="写点什么…"></textarea>
    <div style="display:flex;gap:12px;margin-top:20px">
      <button class="btn btn-ghost" onclick="savePost()">保存</button>
      <button class="btn btn-pub" onclick="publish()">发布</button>
      <button class="btn btn-del" onclick="delPost()">删除</button>
    </div>
    <div class="status" id="status"></div>
    <div id="preview" style="display:none;margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:16px;background:#0a0a08;line-height:1.8"></div>
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
<script>
function t(tab){
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  document.querySelectorAll('.tabpage').forEach(s=>s.classList.toggle('active',s.id==='tab-'+tab));
}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function api(path,opt){const r=await fetch(path,opt);return r.json()}
function show(id,s,ok){const el=document.getElementById(id);el.style.color=ok?'#7a9e7e':'#c47a8b';el.textContent=s;setTimeout(()=>el.textContent='',4000)}
function readAsDataURL(f){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)})}

/* ---- 文章 ---- */
async function load(){const d=await api('/api/posts');const el=document.getElementById('posts');el.innerHTML=d.posts.map(p=>'<div class="pitem" onclick="openPost(\''+encodeURIComponent(p.file)+'\')"><span>'+esc(p.title)+'</span><span class="x" onclick="event.stopPropagation();delPost(\''+encodeURIComponent(p.file)+'\')">×</span></div>').join('')||'<div class="small" style="padding:8px 0">还没有文章</div>'}
function newPost(){document.getElementById('f_file').value='';document.getElementById('f_title').value='';document.getElementById('f_date').value=new Date().toISOString().slice(0,10)+' 00:00:00';document.getElementById('f_cats').value='';document.getElementById('f_tags').value='';document.getElementById('f_content').value='';document.getElementById('preview').style.display='none'}
async function openPost(file){const d=await api('/api/post?file='+file);document.getElementById('f_file').value=d.file;document.getElementById('f_title').value=d.title;document.getElementById('f_date').value=d.date;document.getElementById('f_cats').value=d.categories;document.getElementById('f_tags').value=d.tags;document.getElementById('f_content').value=d.content;preview()}
async function savePost(){const body={file:document.getElementById('f_file').value,title:document.getElementById('f_title').value.trim(),date:document.getElementById('f_date').value.trim(),categories:document.getElementById('f_cats').value.trim(),tags:document.getElementById('f_tags').value.trim(),content:document.getElementById('f_content').value};const d=await api('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('f_file').value=d.file;show('status','已保存',true);load()}
async function delPost(file){if(!confirm('确定删除这篇？'))return;const body={file:file||document.getElementById('f_file').value};await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});show('status','已删除',true);load()}
async function publish(){show('status','正在提交并推送…',true);const d=await api('/api/publish',{method:'POST'});show('status',d.msg||'完成',d.ok)}
function md(t){let h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h2>$1</h2>').replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.+?)\\*/g,'<em>$1</em>').replace(/\`(.+?)\`/g,'<code>$1</code>').replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>').replace(/^---$/gm,'<hr>').replace(/^- (.+)$/gm,'<li>$1</li>');h=h.replace(/((?:<li>.*<\\/li>\\n?)+)/g,'<ul>$1</ul>');return h.split('\\n\\n').map(b=>{b=b.trim();if(!b)return '';if(/^<[a-z]/.test(b))return b;return '<p>'+b.replace(/\\n/g,'<br>')+'</p>'}).join('\\n')}
function preview(){const t=document.getElementById('f_content').value;const el=document.getElementById('preview');if(!t.trim()){el.style.display='none';return}el.style.display='block';el.innerHTML='<h2 style="font-family:Georgia,serif;color:#f0ece4;margin-bottom:10px">'+esc(document.getElementById('f_title').value)+'</h2>'+md(t)}
async function uploadPost(){
  const input=document.getElementById('up_folder');
  if(!input.files.length){show('upStatus','请选择文章文件夹',false);return}
  const files=Array.from(input.files);
  const mdFile=files.find(f=>/\.md$/i.test(f.name));
  if(!mdFile){show('upStatus','文件夹里没找到 .md 文件',false);return}
  const mdContent=await mdFile.text();const images=[];
  for(const f of files){ if(/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)){ images.push({name:f.name,path:f.webkitRelativePath||f.name,data:await readAsDataURL(f)}) } }
  show('upStatus','正在上传…',true);
  const d=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:mdFile.name.replace(/\.md$/i,''),content:mdContent,images,mdPath:mdFile.webkitRelativePath||mdFile.name})});
  show('upStatus',d.msg||'完成',d.ok); if(d.ok){load()}
}

/* ---- 图片（相册） ---- */
var albums=[];
async function loadGallery(){const d=await api('/api/gallery');albums=d.albums||[];renderAlbums()}
function renderAlbums(){const el=document.getElementById('albums');el.innerHTML=albums.map((a,ai)=>'<div class="album"><div class="row"><div><label>相册名</label><input value="'+esc(a.name)+'" onchange="albums['+ai+'].name=this.value"></div><div><label>简介</label><input value="'+esc(a.desc||'')+'" onchange="albums['+ai+'].desc=this.value"></div></div><div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center"><span class="small">图片</span><div><button class="btn btn-ghost" onclick="addImg('+ai+')">＋ 图片</button> <button class="btn btn-del" onclick="delAlbum('+ai+')">删相册</button></div></div>'+ (a.images||[]).map((im,ii)=>'<div class="imgrow">'+'<input value="'+esc(im.caption||'')+'" placeholder="图片说明" onchange="albums['+ai+'].images['+ii+'].caption=this.value">'+'<input value="'+esc(im.date||'')+'" placeholder="日期" onchange="albums['+ai+'].images['+ii+'].date=this.value">'+'<div style="display:flex;gap:6px;align-items:center;min-width:0"><img class="img-thumb" src="'+esc(im.src||'')+'" onerror="this.style.opacity=0"><input value="'+esc(im.src||'')+'" placeholder="/images/…" onchange="albums['+ai+'].images['+ii+'].src=this.value"></div>'+'<button class="btn btn-del" onclick="delImg('+ai+','+ii+')">删</button></div>').join('')+'<div style="margin-top:8px"><label>上传图片(存到 相册'+ai+')</label><input type="file" id="galup'+ai+'" accept="image/*" onchange="uploadGalImg('+ai+')"></div></div>').join('')||'<div class="small" style="padding:8px 0">还没有相册</div>'}
function addAlbum(){albums.push({name:'新相册',desc:'',images:[]});renderAlbums()}
function delAlbum(i){albums.splice(i,1);renderAlbums()}
function addImg(i){(albums[i].images=albums[i].images||[]).push({caption:'',date:'',src:''});renderAlbums()}
function delImg(i,j){albums[i].images.splice(j,1);renderAlbums()}
async function uploadGalImg(ai){const input=document.getElementById('galup'+ai);const f=input.files[0];if(!f)return;const data=await readAsDataURL(f);const d=await api('/api/img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:f.name,album:albums[ai].name||'misc',data})});albums[ai].images.push({caption:f.name.replace(/\.[^.]+$/,''),date:'',src:d.src});renderAlbums();show('galStatus','已上传 '+d.src,true)}
async function saveGallery(){await api('/api/gallery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({albums})});show('galStatus','已保存图片',true)}

/* ---- 番剧 ---- */
var watching=[];
async function loadWatch(){const d=await api('/api/watching');watching=d.watching||[];renderWatch()}
function renderWatch(){const el=document.getElementById('watchlist');el.innerHTML=watching.map((w,i)=>'<div class="wrow"><input value="'+esc(w.title||'')+'" placeholder="番名" onchange="watching['+i+'].title=this.value"><input value="'+esc(w.status||'')+'" placeholder="进度(如 更新至 4/24)" onchange="watching['+i+'].status=this.value"><input value="'+esc(w.note||'')+'" placeholder="一句话" onchange="watching['+i+'].note=this.value"><button class="btn btn-del" onclick="delWatch('+i+')">删</button></div>').join('')||'<div class="small" style="padding:8px 0">还没有番剧</div>'}
function addWatch(){watching.push({title:'',status:'',note:''});renderWatch()}
function delWatch(i){watching.splice(i,1);renderWatch()}
async function saveWatch(){await api('/api/watching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watching})});show('watchStatus','已保存番剧',true)}

document.getElementById('f_content').addEventListener('input',preview);
load();loadGallery();loadWatch();
</script>
</body></html>
`;

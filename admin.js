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
const UI = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>流浪猫管理面板</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a08;color:#b0a99a;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7}
a{color:#d4a24e;text-decoration:none}
.wrap{max-width:1200px;margin:0 auto;padding:24px}
h1{font-family:Georgia,serif;color:#f0ece4;font-size:26px;margin-bottom:20px;border-bottom:1px solid rgba(107,103,96,.15);padding-bottom:16px}
.layout{display:grid;grid-template-columns:300px 1fr;gap:24px;align-items:start}
.list{background:#141412;border:1px solid rgba(107,103,96,.15);border-radius:10px;padding:16px}
.list h2{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:#6b6760;margin-bottom:12px}
.post{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid rgba(107,103,96,.1);cursor:pointer;color:#b0a99a;font-size:14px;transition:.2s}
.post:hover{background:#1c1c18;color:#f0ece4}
.post .x{color:#c47a8b;font-size:16px;padding:0 4px}
.newbtn{display:block;width:100%;text-align:center;margin-top:14px;padding:10px;border:1px solid #d4a24e;color:#d4a24e;cursor:pointer;font-size:13px;letter-spacing:.05em;background:transparent}
.newbtn:hover{background:#d4a24e;color:#0a0a08}
.form{background:#141412;border:1px solid rgba(107,103,96,.15);border-radius:10px;padding:20px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.15em;color:#6b6760;margin:14px 0 6px}
input,textarea{width:100%;background:#0a0a08;border:1px solid rgba(107,103,96,.15);color:#f0ece4;font-family:-apple-system,"Segoe UI","PingFang SC",monospace;font-size:14px;padding:10px 12px;outline:none;border-radius:6px}
input:focus,textarea:focus{border-color:#d4a24e}
textarea{min-height:300px;resize:vertical;line-height:1.8}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.actions{display:flex;gap:12px;margin-top:20px}
button{font-size:13px;padding:11px 24px;border:none;cursor:pointer;letter-spacing:.05em;border-radius:6px}
.btn-pub{background:#d4a24e;color:#0a0a08}.btn-pub:hover{opacity:.9}
.btn-save{background:transparent;border:1px solid rgba(107,103,96,.3);color:#b0a99a}.btn-save:hover{border-color:#d4a24e}
.btn-del{background:transparent;border:1px solid #c47a8b;color:#c47a8b}.btn-del:hover{background:#c47a8b;color:#0a0a08}
.status{margin-top:14px;color:#7a9e7e;font-size:13px;min-height:20px}
.preview{border:1px solid rgba(107,103,96,.15);border-radius:8px;padding:16px;margin-top:16px;background:#0a0a08;color:#b0a99a;line-height:1.8}
.preview h2{border:none;color:#f0ece4;font-size:20px;font-family:Georgia,serif;margin-bottom:10px;padding:0}
.preview h2{border-bottom:none!important}
.preview h3{color:#f0ece4;margin:14px 0 8px}
.preview blockquote{border-left:2px solid #d4a24e;padding-left:14px;margin:12px 0;color:#6b6760;font-style:italic}
.preview code{background:#1c1c18;padding:2px 6px;color:#d4a24e}
.preview a{color:#d4a24e;border-bottom:1px solid rgba(212,162,78,.3)}
@media(max-width:800px){.layout{grid-template-columns:1fr}.row{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>流浪猫的避难所 · 管理面板</h1>
<div class="layout">
  <div class="list"><h2>文章</h2><div id="posts"></div><button class="newbtn" onclick="newPost()">＋ 新建文章</button></div>
  <div class="form">
    <div class="up">
      <label>上传本地文章（选择包含 .md 和图片的文件夹）</label>
      <input type="file" id="up_folder" webkitdirectory directory>
      <div style="margin-top:12px"><button class="btn-pub" onclick="uploadPost()">上传并保存</button></div>
      <div class="status" id="upStatus"></div>
      <hr style="border:none;border-top:1px solid rgba(107,103,96,.15);margin:18px 0">
    </div>
    <input type="hidden" id="f_file">
    <label>标题</label><input id="f_title" placeholder="文章标题">
    <div class="row"><div><label>日期</label><input id="f_date" placeholder="2026-08-20 00:00:00"></div><div><label>分类（逗号分隔）</label><input id="f_cats" placeholder="RTS设计笔记, 王者荣耀自设"></div></div>
    <label>标签（逗号分隔）</label><input id="f_tags" placeholder="RTS, 设计">
    <label>正文（Markdown）</label><textarea id="f_content" placeholder="写点什么…"></textarea>
    <div class="actions"><button class="btn-save" onclick="savePost()">保存</button><button class="btn-pub" onclick="publish()">发布</button><button class="btn-del" onclick="delPost()">删除</button></div>
    <div class="status" id="status"></div>
    <div class="preview" id="preview" style="display:none"></div>
  </div>
</div></div>
<script>
function md(t){let h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h2>$1</h2>').replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/\\*(.+?)\\*/g,'<em>$1</em>').replace(/\`(.+?)\`/g,'<code>$1</code>').replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>').replace(/^---$/gm,'<hr>').replace(/^- (.+)$/gm,'<li>$1</li>');h=h.replace(/((?:<li>.*<\\/li>\\n?)+)/g,'<ul>$1</ul>');return h.split('\\n\\n').map(b=>{b=b.trim();if(!b)return '';if(/^<[a-z]/.test(b))return b;return '<p>'+b.replace(/\\n/g,'<br>')+'</p>'}).join('\\n')}
async function api(path,opt){const r=await fetch(path,opt);return r.json()}
async function load(){const d=await api('/api/posts');const el=document.getElementById('posts');el.innerHTML=d.posts.map(p=>'<div class="post" onclick="openPost(\''+encodeURIComponent(p.file)+'\')"><span>'+esc(p.title)+'</span><span class="x" onclick="event.stopPropagation();delPost(\''+encodeURIComponent(p.file)+'\')">×</span></div>').join('')||'<div style="color:#6b6760;padding:8px 0">还没有文章</div>'}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function show(s,ok){const el=document.getElementById('status');el.style.color=ok?'#7a9e7e':'#c47a8b';el.textContent=s;setTimeout(()=>el.textContent='',4000)}
function newPost(){document.getElementById('f_file').value='';document.getElementById('f_title').value='';document.getElementById('f_date').value=new Date().toISOString().slice(0,10)+' 00:00:00';document.getElementById('f_cats').value='';document.getElementById('f_tags').value='';document.getElementById('f_content').value='';document.getElementById('preview').style.display='none'}
async function openPost(file){const d=await api('/api/post?file='+file);document.getElementById('f_file').value=d.file;document.getElementById('f_title').value=d.title;document.getElementById('f_date').value=d.date;document.getElementById('f_cats').value=d.categories;document.getElementById('f_tags').value=d.tags;document.getElementById('f_content').value=d.content;preview()}
async function savePost(){const body={file:document.getElementById('f_file').value,title:document.getElementById('f_title').value.trim(),date:document.getElementById('f_date').value.trim(),categories:document.getElementById('f_cats').value.trim(),tags:document.getElementById('f_tags').value.trim(),content:document.getElementById('f_content').value};const d=await api('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('f_file').value=d.file;show('已保存');load()}
async function delPost(file){if(!confirm('确定删除这篇？'))return;const body={file:file||document.getElementById('f_file').value};await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});show('已删除');load()}
async function publish(){show('正在提交并推送…',true);const d=await api('/api/publish',{method:'POST'});show(d.msg||'完成',d.ok)}
function preview(){const t=document.getElementById('f_content').value;const el=document.getElementById('preview');if(!t.trim()){el.style.display='none';return}el.style.display='block';el.innerHTML='<h2>'+esc(document.getElementById('f_title').value)+'</h2>'+md(t)}
function showUp(s,ok){const el=document.getElementById('upStatus');el.style.color=ok?'#7a9e7e':'#c47a8b';el.textContent=s}
function readAsDataURL(f){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)})}
async function uploadPost(){
  const input=document.getElementById('up_folder');
  if(!input.files.length){showUp('请选择文章文件夹',false);return}
  const files=Array.from(input.files);
  const mdFile=files.find(f=>/\.md$/i.test(f.name));
  if(!mdFile){showUp('文件夹里没找到 .md 文件',false);return}
  const mdContent=await mdFile.text();
  const images=[];
  for(const f of files){ if(/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)){ images.push({name:f.name,path:f.webkitRelativePath||f.name,data:await readAsDataURL(f)}) } }
  showUp('正在上传…',true);
  const d=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:mdFile.name.replace(/\.md$/i,''),content:mdContent,images,mdPath:mdFile.webkitRelativePath||mdFile.name})});
  showUp(d.msg||'完成',d.ok);
  if(d.ok){load()}
}
document.getElementById('f_content').addEventListener('input',preview);
load();
</script></body></html>`;

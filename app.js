// 流浪猫管理台 —— 前端脚本（独立文件，避免模板字符串转义问题）
function t(tab){
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  document.querySelectorAll('.tabpage').forEach(s=>s.classList.toggle('active',s.id==='tab-'+tab));
}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function api(path,opt){const r=await fetch(path,opt);return r.json()}
function show(id,s,ok){const el=document.getElementById(id);el.style.color=ok?'#7a9e7e':'#c47a8b';el.textContent=s;setTimeout(()=>el.textContent='',4000)}
function readAsDataURL(f){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result)};fr.readAsDataURL(f)})}

/* ---- 文章 ---- */
async function load(){const d=await api('/api/posts');const el=document.getElementById('posts');el.innerHTML=d.posts.map(function(p){return '<div class="pitem" data-f="'+encodeURIComponent(p.file)+'"><span>'+esc(p.title)+'</span><span class="x">×</span></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有文章</div>';}
document.getElementById('posts').addEventListener('click',function(e){var it=e.target.closest('.pitem');if(!it)return;var f=decodeURIComponent(it.dataset.f);if(e.target.classList.contains('x')){delPost(f)}else{openPost(f)}});
function newPost(){document.getElementById('f_file').value='';document.getElementById('f_title').value='';document.getElementById('f_date').value=new Date().toISOString().slice(0,10)+' 00:00:00';document.getElementById('f_cats').value='';document.getElementById('f_tags').value='';document.getElementById('f_content').value='';document.getElementById('preview').style.display='none'}
async function openPost(file){var d=await api('/api/post?file='+file);document.getElementById('f_file').value=d.file;document.getElementById('f_title').value=d.title;document.getElementById('f_date').value=d.date;document.getElementById('f_cats').value=d.categories;document.getElementById('f_tags').value=d.tags;document.getElementById('f_content').value=d.content;preview()}
async function savePost(){var body={file:document.getElementById('f_file').value,title:document.getElementById('f_title').value.trim(),date:document.getElementById('f_date').value.trim(),categories:document.getElementById('f_cats').value.trim(),tags:document.getElementById('f_tags').value.trim(),content:document.getElementById('f_content').value};var d=await api('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('f_file').value=d.file;show('status','已保存',true);load()}
async function delPost(file){if(!confirm('确定删除这篇？'))return;var body={file:file||document.getElementById('f_file').value};await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});show('status','已删除',true);load()}
async function publish(){show('status','正在提交并推送…',true);var d=await api('/api/publish',{method:'POST'});show('status',d.msg||'完成',d.ok)}
function md(t){let h=t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h2>$1</h2>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>').replace(/^---$/gm,'<hr>').replace(/^- (.+)$/gm,'<li>$1</li>');h=h.replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul>$1</ul>');return h.split('\n\n').map(function(b){b=b.trim();if(!b)return '';if(/^<[a-z]/.test(b))return b;return '<p>'+b.replace(/\n/g,'<br>')+'</p>'}).join('\n')}
function preview(){var t=document.getElementById('f_content').value;var el=document.getElementById('preview');if(!t.trim()){el.style.display='none';return}el.style.display='block';el.innerHTML='<h2 style="font-family:Georgia,serif;color:#f0ece4;margin-bottom:10px">'+esc(document.getElementById('f_title').value)+'</h2>'+md(t)}
async function uploadPost(){
  var input=document.getElementById('up_folder');
  if(!input.files.length){show('upStatus','请选择文章文件夹',false);return}
  var files=Array.from(input.files);
  var mdFile=files.find(function(f){return /\.md$/i.test(f.name)});
  if(!mdFile){show('upStatus','文件夹里没找到 .md 文件',false);return}
  var mdContent=await mdFile.text();var images=[];
  for(var i=0;i<files.length;i++){var f=files[i];if(/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)){images.push({name:f.name,path:f.webkitRelativePath||f.name,data:await readAsDataURL(f)})}}
  show('upStatus','正在上传…',true);
  var d=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:mdFile.name.replace(/\.md$/i,''),content:mdContent,images:images,mdPath:mdFile.webkitRelativePath||mdFile.name})});
  show('upStatus',d.msg||'完成',d.ok); if(d.ok){load()}
}

/* ---- 图片（相册） ---- */
var albums=[];
async function loadGallery(){var d=await api('/api/gallery');albums=d.albums||[];renderAlbums()}
function renderAlbums(){var el=document.getElementById('albums');el.innerHTML=albums.map(function(a,ai){return '<div class="album"><div class="row"><div><label>相册名</label><input value="'+esc(a.name)+'" onchange="albums['+ai+'].name=this.value"></div><div><label>简介</label><input value="'+esc(a.desc||'')+'" onchange="albums['+ai+'].desc=this.value"></div></div><div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center"><span class="small">图片</span><div><button class="btn btn-ghost" onclick="addImg('+ai+')">＋ 图片</button> <button class="btn btn-del" onclick="delAlbum('+ai+')">删相册</button></div></div>'+ (a.images||[]).map(function(im,ii){return '<div class="imgrow"><input value="'+esc(im.caption||'')+'" placeholder="图片说明" onchange="albums['+ai+'].images['+ii+'].caption=this.value"><input value="'+esc(im.date||'')+'" placeholder="日期" onchange="albums['+ai+'].images['+ii+'].date=this.value"><div style="display:flex;gap:6px;align-items:center;min-width:0"><img class="img-thumb" src="'+esc(im.src||'')+'" onerror="this.style.opacity=0"><input value="'+esc(im.src||'')+'" placeholder="/images/…" onchange="albums['+ai+'].images['+ii+'].src=this.value"></div><button class="btn btn-del" onclick="delImg('+ai+','+ii+')">删</button></div>'}).join('')+'<div style="margin-top:8px"><label>上传图片(存到 相册'+ai+')</label><input type="file" id="galup'+ai+'" accept="image/*" onchange="uploadGalImg('+ai+')"></div></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有相册</div>'}
function addAlbum(){albums.push({name:'新相册',desc:'',images:[]});renderAlbums()}
function delAlbum(i){albums.splice(i,1);renderAlbums()}
function addImg(i){(albums[i].images=albums[i].images||[]).push({caption:'',date:'',src:''});renderAlbums()}
function delImg(i,j){albums[i].images.splice(j,1);renderAlbums()}
async function uploadGalImg(ai){var input=document.getElementById('galup'+ai);var f=input.files[0];if(!f)return;var data=await readAsDataURL(f);var d=await api('/api/img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:f.name,album:albums[ai].name||'misc',data:data})});albums[ai].images.push({caption:f.name.replace(/\.[^.]+$/,''),date:'',src:d.src});renderAlbums();show('galStatus','已上传 '+d.src,true)}
async function saveGallery(){await api('/api/gallery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({albums:albums})});show('galStatus','已保存图片',true)}

/* ---- 番剧 ---- */
var watching=[];
async function loadWatch(){var d=await api('/api/watching');watching=d.watching||[];renderWatch()}
function renderWatch(){var el=document.getElementById('watchlist');el.innerHTML=watching.map(function(w,i){return '<div class="wrow"><input value="'+esc(w.title||'')+'" placeholder="番名" onchange="watching['+i+'].title=this.value"><input value="'+esc(w.status||'')+'" placeholder="进度(如 更新至 4/24)" onchange="watching['+i+'].status=this.value"><input value="'+esc(w.note||'')+'" placeholder="一句话" onchange="watching['+i+'].note=this.value"><button class="btn btn-del" onclick="delWatch('+i+')">删</button></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有番剧</div>'}
function addWatch(){watching.push({title:'',status:'',note:''});renderWatch()}
function delWatch(i){watching.splice(i,1);renderWatch()}
async function saveWatch(){await api('/api/watching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watching:watching})});show('watchStatus','已保存番剧',true)}

document.getElementById('f_content').addEventListener('input',preview);
load();loadGallery();loadWatch();

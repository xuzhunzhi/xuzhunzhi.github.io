// 避难所管理台 —— 前端脚本
function t(tab){
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  document.querySelectorAll('.tabpage').forEach(s=>s.classList.toggle('active',s.id==='tab-'+tab));
}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function api(path,opt){const r=await fetch(path,opt);return r.json()}
function show(id,s,ok){const el=document.getElementById(id);if(!el)return;el.style.color=ok?'#7a9e7e':'#c47a8b';el.textContent=s;setTimeout(()=>el.textContent='',4000)}
function readAsDataURL(f){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result)};fr.readAsDataURL(f)})}
function nowStr(){return new Date().toISOString().slice(0,10)+' 00:00:00'}

/* ---- 文章 ---- */
var collections=[];
async function load(){var d=await api('/api/posts');var el=document.getElementById('posts');el.innerHTML=d.posts.map(function(p){return '<div class="pitem" data-f="'+encodeURIComponent(p.file)+'"><span>'+esc(p.title)+' <span class="small">['+esc(p.categories||'无合集')+']</span></span><span class="x">×</span></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有文章</div>'}
document.getElementById('posts').addEventListener('click',function(e){var it=e.target.closest('.pitem');if(!it)return;var f=decodeURIComponent(it.dataset.f);if(e.target.classList.contains('x')){delPost(f)}else{openPost(f)}});
async function loadCollections(){var d=await api('/api/collections');collections=d.collections||[];renderColMenu()}
function renderColMenu(){if(!document.getElementById('col_menu'))return;var saved=document.getElementById('f_catsave').value;var opts=[{v:'',t:'无合集'}].concat(collections.map(function(c){return {v:c,t:c}})).concat([{v:'__new__',t:'＋ 创建新合集'}]);document.getElementById('col_menu').innerHTML=opts.map(function(o){return '<div class="dd-item'+(o.v===saved?' sel':'')+'" onclick="pickCol(\''+esc(o.v)+'\',\''+esc(o.t)+'\')">'+esc(o.t)+'</div>'}).join('');if(saved){document.getElementById('f_collection').value=saved;document.getElementById('col_label').textContent=saved}else{document.getElementById('f_collection').value='';document.getElementById('col_label').textContent='无合集'}document.getElementById('f_newcol').style.display=document.getElementById('f_collection').value==='__new__'?'block':'none'}
function toggleDD(){var m=document.getElementById('col_menu');var dd=m.parentElement;var open=m.style.display==='block';m.style.display=open?'none':'block';dd.classList.toggle('open',!open)}
function pickCol(v,t){document.getElementById('f_collection').value=v;document.getElementById('col_label').textContent=t;document.getElementById('col_menu').style.display='none';document.getElementById('col_menu').parentElement.classList.remove('open');document.getElementById('f_newcol').style.display=v==='__new__'?'block':'none'}
function newPost(){document.getElementById('f_file').value='';document.getElementById('f_catsave').value='';document.getElementById('f_title').value='';document.getElementById('f_summary').value='';document.getElementById('f_content').value='';document.getElementById('f_newcolname').value='';document.getElementById('f_date').value=nowStr();renderColMenu()}
async function openPost(file){var d=await api('/api/post?file='+file);var sel=document.getElementById('f_collection');document.getElementById('f_file').value=d.file;document.getElementById('f_catsave').value=d.categories;document.getElementById('f_title').value=d.title;document.getElementById('f_summary').value=d.description||'';document.getElementById('f_content').value=d.content;document.getElementById('f_date').value=nowStr();if(d.categories&&collections.indexOf(d.categories)<0)collections.push(d.categories);renderColMenu();sel.value=d.categories;document.getElementById('f_newcol').style.display=sel.value==='__new__'?'block':'none'}
async function readFolder(){var input=document.getElementById('up_folder');if(!input.files.length){show('upStatus','请选择文档文件夹',false);return null}var files=Array.from(input.files);var mdFile=files.find(function(f){return /\.md$/i.test(f.name)});if(!mdFile){show('upStatus','文件夹里没找到 .md 文件',false);return null}var mdContent=await mdFile.text();var images=[];for(var i=0;i<files.length;i++){var f=files[i];if(/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)){images.push({name:f.name,path:f.webkitRelativePath||f.name,data:await readAsDataURL(f)})}}show('upStatus','正在读入…',true);var d=await api('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:mdFile.name.replace(/\.md$/i,''),content:mdContent,images:images,mdPath:mdFile.webkitRelativePath||mdFile.name})});if(!d.ok){show('upStatus',d.msg||'读入失败',false);return null}document.getElementById('f_title').value=d.title;document.getElementById('f_content').value=d.content;show('upStatus',d.msg||'已读入',true);return d}
async function publishPost(){
  var file=document.getElementById('f_file').value;var hasUp=document.getElementById('up_folder').files.length>0;
  if(hasUp&&file&&!confirm('检测到上传文档，确定替换《'+document.getElementById('f_title').value+'》的正文吗？'))return;
  if(hasUp){var rd=await readFolder();if(!rd)return}
  var title=document.getElementById('f_title').value.trim();if(!title){show('status','请输入标题',false);return}
  var sel=document.getElementById('f_collection');var cat=sel.value;var newcol='';
  if(cat==='__new__'){newcol=document.getElementById('f_newcolname').value.trim();if(!newcol){show('status','请输入新合集名',false);return}cat=newcol;collections.push(cat)}
  var body={file:file,title:title,date:nowStr(),categories:cat,description:document.getElementById('f_summary').value.trim(),content:document.getElementById('f_content').value};
  var d=await api('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('f_file').value=d.file;document.getElementById('f_catsave').value=cat;
  var p=await api('/api/publish',{method:'POST'});show('status',p.msg||'已发布',p.ok);load();loadCollections();
}
async function delPost(file){if(!confirm('确定删除这篇？'))return;var body={file:file||document.getElementById('f_file').value};await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});show('status','已删除',true);load()}

/* ---- 图片（相册） ---- */
var albums=[];
async function loadGallery(){var d=await api('/api/gallery');albums=d.albums||[];renderAlbums()}
function renderAlbums(){var el=document.getElementById('albums');el.innerHTML=albums.map(function(a,ai){return '<div class="album"><div class="row"><div><label>相册名</label><input value="'+esc(a.name)+'" onchange="albums['+ai+'].name=this.value"></div><div><label>简介</label><input value="'+esc(a.desc||'')+'" onchange="albums['+ai+'].desc=this.value"></div></div><div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center"><span class="small">图片</span><div><button class="btn btn-ghost" onclick="addImg('+ai+')">＋ 图片</button> <button class="btn btn-del" onclick="delAlbum('+ai+')">删相册</button></div></div>'+ (a.images||[]).map(function(im,ii){return '<div class="imgrow"><input value="'+esc(im.caption||'')+'" placeholder="说明" onchange="albums['+ai+'].images['+ii+'].caption=this.value"><input value="'+esc(im.date||'')+'" placeholder="日期" onchange="albums['+ai+'].images['+ii+'].date=this.value"><div style="display:flex;gap:6px;align-items:center;min-width:0"><img class="img-thumb" src="'+esc(im.src||'')+'" onerror="this.style.opacity=0"><input value="'+esc(im.src||'')+'" placeholder="/images/…" onchange="albums['+ai+'].images['+ii+'].src=this.value"></div><button class="btn btn-del" onclick="delImg('+ai+','+ii+')">删</button></div>'}).join('')+'<div style="margin-top:8px"><label>上传图片(存到 相册'+ai+')</label><input type="file" id="galup'+ai+'" accept="image/*" onchange="uploadGalImg('+ai+')"></div></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有相册</div>'}
function addAlbum(){albums.push({name:'新相册',desc:'',images:[]});renderAlbums()}
function delAlbum(i){albums.splice(i,1);renderAlbums()}
function addImg(i){(albums[i].images=albums[i].images||[]).push({caption:'',date:'',src:''});renderAlbums()}
function delImg(i,j){albums[i].images.splice(j,1);renderAlbums()}
async function uploadGalImg(ai){var input=document.getElementById('galup'+ai);var f=input.files[0];if(!f)return;var data=await readAsDataURL(f);var d=await api('/api/img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:f.name,album:albums[ai].name||'misc',data:data})});albums[ai].images.push({caption:f.name.replace(/\.[^.]+$/,''),date:'',src:d.src});renderAlbums();show('galStatus','已上传 '+d.src,true)}
async function saveGallery(){await api('/api/gallery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({albums:albums})});show('galStatus','已保存图片',true)}

/* ---- 番剧 ---- */
var watching=[];
async function loadWatch(){var d=await api('/api/watching');watching=d.watching||[];renderWatch()}
function renderWatch(){var el=document.getElementById('watchlist');el.innerHTML=watching.map(function(w,i){return '<div class="wrow"><input value="'+esc(w.title||'')+'" placeholder="番名" onchange="watching['+i+'].title=this.value"><input value="'+esc(w.status||'')+'" placeholder="进度" onchange="watching['+i+'].status=this.value"><input value="'+esc(w.note||'')+'" placeholder="一句话" onchange="watching['+i+'].note=this.value"><button class="btn btn-del" onclick="delWatch('+i+')">删</button></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有番剧</div>'}
function addWatch(){watching.push({title:'',status:'',note:''});renderWatch()}
function delWatch(i){watching.splice(i,1);renderWatch()}
async function saveWatch(){await api('/api/watching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watching:watching})});show('watchStatus','已保存番剧',true)}

/* ---- 动态 ---- */
var dynamics=[];
async function loadDyn(){var d=await api('/api/dynamics');dynamics=d.dynamics||[];renderDyn()}
function renderDyn(){var el=document.getElementById('dynlist');el.innerHTML=dynamics.map(function(d,i){return '<div class="dynrow"><textarea rows="2" placeholder="动态内容" onchange="dynamics['+i+'].text=this.value">'+esc(d.text||'')+'</textarea><div class="row" style="margin-top:8px"><input value="'+esc(d.date||'')+'" placeholder="日期" onchange="dynamics['+i+'].date=this.value"><div style="display:flex;gap:6px;align-items:center"><input value="'+esc(d.image||'')+'" placeholder="图片地址(可选)" onchange="dynamics['+i+'].image=this.value"><button class="btn btn-ghost" onclick="upDynImg(this,'+i+')">传图</button></div></div><div style="margin-top:8px"><button class="btn btn-del" onclick="delDyn('+i+')">删</button></div></div>'}).join('')||'<div class="small" style="padding:8px 0">还没有动态</div>'}
function addDyn(){dynamics.unshift({text:'',date:new Date().toISOString().slice(0,10),image:''});renderDyn()}
function delDyn(i){dynamics.splice(i,1);renderDyn()}
function upDynImg(input,i){var file=input.files[0];if(!file)return;readAsDataURL(file).then(function(data){api('/api/img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:file.name,album:'dynamics',data:data})}).then(function(d){dynamics[i].image=d.src;renderDyn()})})}
async function saveDyn(){await api('/api/dynamics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dynamics:dynamics})});show('dynStatus','已保存动态',true)}

load();loadCollections();loadGallery();loadWatch();loadDyn();

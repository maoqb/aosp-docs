/* Framework Notes editor. Source of truth: private maoqb/Notes. */
"use strict";
const $ = id => document.getElementById(id);
const allowedFolders = ["wms","Input","binder","servicemanager","cpp","winscope","环境搭建","日志&命令","窗口动画","开机动画","截屏"];
const base = "https://maoqb.github.io/aosp-docs/Notes/";
const categoryTitles = {"wms":"窗口管理 WMS","Input":"输入系统","binder":"Binder IPC","servicemanager":"ServiceManager","cpp":"C++ / Native","winscope":"Winscope","环境搭建":"开发环境","日志&命令":"日志与命令","窗口动画":"窗口动画","开机动画":"开机动画","截屏":"截屏"};
const apiHost = "https://aosp-notes-api.maoqb.workers.dev";
let session = sessionStorage.getItem("notes-session") || "";
let current = null, currentSha = null, original = "", currentFiles = [], repoTree = [], busy = false;
let diagram = null;
let selectedFolder = "wms";
let movingPath = null;
let moveSupported = false, deleteSupported = false;
const collapsedFolders = new Set();
const mdStarter = "# Framework 笔记\n\n在这里开始编写你的文章。\n";
const cherry = new Cherry({
  id: "markdown", value: mdStarter,
  toolbars: { toolbar: ["bold","italic","strikethrough","|","color","header","list","insert","graph","togglePreview"],
    bubble: ["bold","italic","strikethrough","|","color"], float: ["h1","h2","h3","|","quote","code"] },
  callback: { afterChange: () => setDirty() }
});
function tip(s) { $("message").textContent = s; }
function setDirty() { $("dirty").classList.toggle("dirty", !!current && cherry.getMarkdown() !== original); }
function updateStatus() {
  $("connection").innerHTML = '<span class="status-dot"></span> '+(session?"已连接 GitHub":"等待 GitHub 登录");
  $("connection").classList.toggle("online",!!session);
  $("saveBtn").disabled = !session || !current || busy;
  $("loginBtn").hidden = !!session;
  $("logoutBtn").hidden = !session;
  $("newFolderBtn").disabled = !session;
  document.querySelectorAll(".file-move").forEach(button=>{button.disabled=!session||busy||!moveSupported;});
  document.querySelectorAll(".file-delete").forEach(button=>{button.disabled=!session||busy||!deleteSupported;});
}
function getHost() { return apiHost; }
async function call(path, options={}) {
  if (!session) throw Error("请先使用 GitHub 登录");
  const r=await fetch(getHost()+"/api"+path,{...options,headers:{
    "Authorization":"Bearer "+session,"Content-Type":"application/json",
    ...(options.headers||{})
  }, cache:"no-store"});
  const data=await r.json().catch(()=>({error:"无法解析服务器响应"}));
  if (!r.ok) { if(r.status===401){ session="";sessionStorage.removeItem("notes-session");updateStatus(); }
    throw Error(data.error||("HTTP "+r.status)); }
  return data;
}
function uint8fromB64(value) { const binary=atob(value.replace(/\s/g,""));return Uint8Array.from(binary,x=>x.charCodeAt(0)); }
function decodeB64(value) { return new TextDecoder().decode(uint8fromB64(value)); }
function encodeB64(value) { const bytes=new TextEncoder().encode(value);let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s); }
function slug(s) {return s.trim().replace(/[\\/:*?"<>|]/g,"-").slice(0,70);}
function relUrl(path) {return base+path.split("/").map(encodeURIComponent).join("/");}
async function readFile(path) {
  const result=await call("/file?path="+encodeURIComponent(path));
  return {body:decodeB64(result.content),sha:result.sha};
}
async function writeFile(path, data, sha=null, isBase64=false) {
  return call("/file",{method:"PUT",body:JSON.stringify({
    path, content:isBase64?data:encodeB64(data),
    ...(sha?{sha}:{}), message:"docs: update "+path+" via Notes Studio"
  })});
}
async function loadTree() {
  const result=await call("/tree");
  repoTree=result.tree;
  try{const capabilities=await call("/capabilities");moveSupported=!!capabilities.move;deleteSupported=!!capabilities.delete;}
  catch{moveSupported=false;deleteSupported=false;}
  currentFiles=NotesFolders.visibleArticles(repoTree,allowedFolders);
  drawFiles();
  renderWelcome();
  $("sidebarCount").textContent=currentFiles.length;
  tip("已同步 "+currentFiles.length+" 篇 Markdown");
}
function showFolderOptions(select,selected){
  select.replaceChildren();
  const paths=NotesFolders.folderPaths(repoTree,allowedFolders);
  for(const folder of paths){
    const opt=document.createElement("option");
    const level=folder.split("/").length-1;
    opt.value=folder;
    opt.textContent="　".repeat(level)+(level?"└ ":"")+(categoryTitles[folder]||folder.split("/").pop());
    select.append(opt);
  }
  select.value=paths.includes(selected)?selected:(paths[0]||"");
}
function drawFiles(){
  const q=$("filter").value.trim().toLowerCase(),list=$("files");
  list.replaceChildren();
  const dirs=NotesFolders.foldersWithChildren(repoTree,allowedFolders);
  const folderPaths=dirs.map(x=>x.path);
  const matchingArticles=currentFiles.filter(f=>!q||f.path.toLowerCase().includes(q));
  const matches=new Set();
  for(const file of matchingArticles){
    const names=file.path.split("/");
    for(let i=1;i<names.length;i++)matches.add(names.slice(0,i).join("/"));
  }
  for(const dir of dirs){
    if(q&&!matches.has(dir.path)&&!dir.path.toLowerCase().includes(q))continue;
    const segments=dir.path.split("/");
    if(!q&&segments.some((_,index)=>index>0&&collapsedFolders.has(segments.slice(0,index).join("/"))))continue;
    const row=document.createElement("div");
    row.className="folder-row"+(selectedFolder===dir.path?" selected":"");
    row.style.setProperty("--folder-depth",String(dir.depth));
    const caret=document.createElement("button");caret.type="button";
    caret.className="folder-caret";caret.textContent=collapsedFolders.has(dir.path)?"▸":"▾";
    caret.title=collapsedFolders.has(dir.path)?"展开目录":"折叠目录";
    caret.onclick=()=>{if(collapsedFolders.has(dir.path))collapsedFolders.delete(dir.path);else collapsedFolders.add(dir.path);drawFiles();};
    const label=document.createElement("button");label.type="button";label.className="folder-label";
    const name=dir.depth?dir.path.split("/").pop():(categoryTitles[dir.path]||dir.path);
    label.textContent="▤ "+name;label.title=dir.path+" · 点击选择此目录";
    label.onclick=()=>{selectedFolder=dir.path;collapsedFolders.delete(dir.path);drawFiles();};
    const count=document.createElement("span");count.className="folder-count";count.textContent=String(dir.articleCount);
    row.append(caret,label,count);list.append(row);
    if(collapsedFolders.has(dir.path)&&!q)continue;
    for(const file of matchingArticles.filter(f=>f.path.slice(0,f.path.lastIndexOf("/"))===dir.path)){
      const b=document.createElement("button");b.type="button";
      b.className="file-item folder-file"+(current===file.path?" active":"");
      b.style.setProperty("--folder-depth",String(dir.depth+1));
      b.textContent="▧ "+file.path.split("/").pop().replace(/\.md$/,"");
      b.title=file.path;
      b.addEventListener("click",()=>void openDoc(file.path));
      const item=document.createElement("div");item.className="file-entry";
      item.style.setProperty("--folder-depth",String(dir.depth+1));
      const move=document.createElement("button");move.type="button";
      move.className="file-move";move.textContent="↗";move.title="移动到其他目录："+file.path;
      move.setAttribute("aria-label","移动笔记 "+file.path);
      move.disabled=!session||busy||!moveSupported;
      if(!moveSupported)move.title="需要先部署新版 Cloudflare Worker 才能移动文章";
      move.onclick=()=>openMoveDialog(file.path);
      const del=document.createElement("button");del.type="button";
      del.className="file-delete";del.textContent="×";del.title="删除笔记："+file.path;
      del.setAttribute("aria-label","删除笔记 "+file.path);
      del.disabled=!session||busy||!deleteSupported;
      if(!deleteSupported)del.title="需要先部署支持删除功能的 Cloudflare Worker";
      del.onclick=()=>void deleteArticle(file.path);
      item.append(b,move,del);list.append(item);
    }
  }
  if(!list.children.length){
    const el=document.createElement("p");el.className="hint";
    el.textContent=q?"没有匹配的笔记或目录":"当前知识库没有可显示的目录";
    list.append(el);
  }
}
function createFolderDialog(){
  if(!session){alert("请先通过 GitHub 登录");return;}
  showFolderOptions($("folderParent"),selectedFolder);
  $("folderName").value="";
  $("folderDialog").showModal();$("folderName").focus();
}
async function submitFolder(event){
  event.preventDefault();
  const submit=$("folderSubmit");
  if(submit.disabled)return;
  try{
    const request=NotesFolders.newFolder($("folderParent").value,$("folderName").value,repoTree,allowedFolders);
    submit.disabled=true;
    tip("正在 GitHub 创建目录："+request.folder);
    await writeFile(request.marker,request.content);
    $("folderDialog").close();
    selectedFolder=request.folder;
    await loadTree();
    tip("目录已创建："+request.folder+" · 可直接在其中新建笔记");
  }catch(e){alert("创建目录失败："+e.message)}
  finally{submit.disabled=false;}
}
function openNewArticleDialog(){
  showFolderOptions($("articleFolder"),selectedFolder);
  $("articleTitle").value="";
  $("newArticleDialog").showModal();$("articleTitle").focus();
}
function submitArticle(event){
  event.preventDefault();
  const folder=$("articleFolder").value,title=$("articleTitle").value.trim();
  try{
    const path=NotesFolders.newArticle(folder,title,repoTree,allowedFolders);
    if(current&&cherry.getMarkdown()!==original&&!confirm("放弃当前未保存修改？"))return;
    $("newArticleDialog").close();
    selectedFolder=folder;collapsedFolders.delete(folder);
    current=path;currentSha=null;original="";
    cherry.setMarkdown("# "+title+"\n\n");
    $("currentPath").textContent=path;
    setEditorState();drawFiles();setDirty();updateStatus();
    tip("新笔记待保存："+path);
  }catch(e){alert("新建文章失败："+e.message);}
}
function openMoveDialog(path){
  if(!session){alert("请先登录 GitHub");return;}
  if(!moveSupported){alert("需要先部署支持移动功能的 Cloudflare Worker");return;}
  if(busy || diagram){alert("当前正在处理其他操作");return;}
  const entry=repoTree.find(e=>e.path===path&&e.type==="blob");
  if(!entry){alert("文章尚未保存到 GitHub，无法移动");return;}
  if(current===path&&cherry.getMarkdown()!==original){
    alert("当前文章有未保存修改，请先保存到 GitHub 再移动");return;
  }
  movingPath=path;
  $("moveSource").textContent=path;
  const options=NotesFolders.folderPaths(repoTree,allowedFolders).filter(p=>p!==path.slice(0,path.lastIndexOf("/")));
  const select=$("moveTarget");select.replaceChildren();
  for(const folder of options){
    const opt=document.createElement("option");opt.value=folder;
    opt.textContent="　".repeat(folder.split("/").length-1)+(categoryTitles[folder]||folder);
    select.append(opt);
  }
  select.value=options.includes(selectedFolder)?selectedFolder:(options[0]||"");
  updateMovePreview();
  $("moveDialog").showModal();
}
function updateMovePreview(){
  if(!movingPath)return;
  try{
    const plan=NotesFolders.planMove(movingPath,$("moveTarget").value,repoTree,allowedFolders);
    $("moveAssets").textContent="目标："+plan.destination+" · 关联资源："+plan.assetCount+" 个";
    $("moveSubmit").disabled=false;
  }catch(e){
    $("moveAssets").textContent=e.message;
    $("moveSubmit").disabled=true;
  }
}
async function submitMove(event){
  event.preventDefault();
  if(!movingPath||busy)return;
  let plan;
  try{plan=NotesFolders.planMove(movingPath,$("moveTarget").value,repoTree,allowedFolders);}
  catch(e){alert(e.message);return;}
  if(current===plan.source&&cherry.getMarkdown()!==original){
    alert("请先保存文章修改，再执行移动");return;
  }
  if(!confirm("确认移动？\n"+plan.source+"\n→ "+plan.destination+
    "\n包含 "+plan.assetCount+" 个关联资源，原路径会从 GitHub 主分支移除。"))return;
  const movingCurrent=current===plan.source;
  try{
    busy=true;updateStatus();$("moveSubmit").disabled=true;
    tip("正在移动文章及资源到 "+plan.destination);
    const result=await call("/move",{method:"POST",body:JSON.stringify({
      source:plan.source,destinationFolder:plan.destinationFolder,sha:plan.sha
    })});
    $("moveDialog").close();movingPath=null;
    selectedFolder=plan.destinationFolder;
    for(const ancestor of plan.destinationFolder.split("/").map((_,i,a)=>a.slice(0,i+1).join("/")))collapsedFolders.delete(ancestor);
    const recent=recentPaths().map(p=>p===plan.source?result.target:p);
    localStorage.setItem("aosp-notes-recent",JSON.stringify([...new Set(recent)]));
    if(movingCurrent){
      current=null;currentSha=null;original=""; // reset before reopening: no stale save to the old path
    }
    await loadTree();
    if(movingCurrent)await openDoc(result.target);
    tip("已移动："+result.target+"（含 "+result.movedAssets+" 个资源）");
  }catch(e){
    alert("移动失败："+(e.message==="HTTP 404"||e.message==="Unknown API endpoint"?
      "Cloudflare Worker 尚未部署 /api/move 接口，请先更新并部署 Worker":e.message));
    tip("移动未完成，原始文件不会被主动删除；请同步目录确认状态");
  }finally{busy=false;$("moveSubmit").disabled=false;updateStatus();}
}
async function deleteArticle(path){
  if(!session){alert("请先登录 GitHub");return;}
  if(!deleteSupported){alert("需要先部署支持删除功能的 Cloudflare Worker");return;}
  if(busy||diagram){alert("当前正在处理其他操作");return;}
  const entry=repoTree.find(e=>e.path===path&&e.type==="blob");
  if(!entry){alert("文章不存在，请先刷新文件列表");return;}
  if(current===path&&cherry.getMarkdown()!==original){
    alert("当前文章存在未保存修改，请先保存或放弃修改，再删除");return;
  }
  const assets=NotesFolders.articleAssetEntries(path,repoTree);
  const question="删除文档？\\n"+path+"\\n\\n同时删除 "+assets.length+
    " 个专属图片/图表资源。\\n此操作会提交到 GitHub，其他文章若引用这些资源将失效；可以通过 Git 历史恢复。";
  if(!confirm(question))return;
  // Second confirmation guards destructive removal of an article plus its assets.
  if(!confirm("最终确认：从 GitHub main 删除 \\n"+path+"\\n及其关联资源？"))return;
  const deletingCurrent=current===path;
  try{
    busy=true;updateStatus();tip("正在删除 "+path);
    const result=await call("/delete",{method:"POST",body:JSON.stringify({path,sha:entry.sha})});
    localStorage.setItem("aosp-notes-recent",JSON.stringify(recentPaths().filter(p=>p!==path)));
    if(deletingCurrent){
      current=null;currentSha=null;original="";
      cherry.setMarkdown(mdStarter);$("currentPath").textContent="选择或创建一篇笔记";
      setEditorState();setDirty();
    }
    try{await loadTree();}
    catch(e){tip("已删除，但列表刷新失败："+e.message);return;}
    tip("已删除 "+result.path+"（含 "+result.deletedAssets+" 个资源）");
  }catch(e){
    alert("删除失败："+e.message+"\\n请刷新目录确认状态");
  }finally{busy=false;updateStatus();}
}
function recentPaths(){
  try{const paths=JSON.parse(localStorage.getItem("aosp-notes-recent")||"[]");
    return Array.isArray(paths)?paths.filter(x=>typeof x==="string").slice(0,20):[];
  }catch{return [];}
}
function rememberDoc(path){
  const recent=[path,...recentPaths().filter(x=>x!==path)].slice(0,20);
  localStorage.setItem("aosp-notes-recent",JSON.stringify(recent));
  renderWelcome();
}
function renderWelcome(){
  const list=$("welcomeRecent");list.replaceChildren();
  $("welcomeCount").textContent=currentFiles.length+" 篇文档";
  if(!currentFiles.length){const el=document.createElement("div");el.className="welcome-empty";el.textContent=session?"知识库中还没有 Markdown，创建第一篇笔记吧。":"登录 GitHub 后会在这里显示笔记。";list.append(el);return;}
  const recent=recentPaths();
  const sorted=[...currentFiles].sort((a,b)=>{
    const ai=recent.indexOf(a.path),bi=recent.indexOf(b.path);
    if(ai<0&&bi<0)return 0;
    if(ai<0)return 1;if(bi<0)return -1;return ai-bi;
  });
  for(const entry of sorted.slice(0,6)){
    const card=document.createElement("button");card.className="welcome-article";
    card.innerHTML='<span class="welcome-article__icon">▤</span><span class="welcome-article__text"><b></b><small></small></span><span class="welcome-article__arrow">↗</span>';
    const short=entry.path.split("/").pop().replace(/\.md$/,"");
    card.querySelector("b").textContent=short;
    card.querySelector("small").textContent=categoryTitles[entry.path.split("/")[0]]||"技术笔记";
    card.title=entry.path;card.onclick=()=>void openDoc(entry.path);list.append(card);
  }
}
function setEditorState(){
  $("editorPane").classList.toggle("is-empty",!current);
  $("insertMenu").open=false;
}
async function openDoc(path){
  if(current && cherry.getMarkdown()!==original && !confirm("当前文章尚未保存，确定放弃修改吗？"))return;
  try {
    busy=true;updateStatus();tip("正在读取 "+path);
    const f=await readFile(path);current=path;currentSha=f.sha;original=f.body;
    cherry.setMarkdown(f.body);$("currentPath").textContent=path;
    selectedFolder=path.slice(0,path.lastIndexOf("/"));
    setEditorState();drawFiles();setDirty();rememberDoc(path);tip("已加载 "+path);
  }catch(e){alert(e.message)}finally{busy=false;updateStatus()}
}
async function saveDoc(){
  if(!current ||busy)return;
  try{
    busy=true;updateStatus();tip("正在提交 "+current);
    const body=cherry.getMarkdown();
    const r=await writeFile(current,body,currentSha);currentSha=r.content?.sha||r.content_sha||r.sha;
    original=body;setDirty();
    try{await loadTree();}catch(refreshError){tip("文章已保存，但列表刷新失败："+refreshError.message);return;}
    tip("已提交到 GitHub main · "+current);
  }catch(e){alert("保存失败："+e.message)}finally{busy=false;updateStatus()}
}
function newDoc(){openNewArticleDialog();}
async function fileUpload(file){
  if(!current){alert("请先打开或新建文章");return;}
  if(file.size>4*1024*1024){alert("单张图片暂限制 4 MB");return;}
  const ext=({ "image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/svg+xml":"svg"})[file.type];
  if(!ext){alert("仅支持 PNG/JPG/WebP/GIF/SVG");return;}
  const data=new Uint8Array(await file.arrayBuffer());
  let s="";for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));
  const path=NoteDiagrams.assetFolder(current)+
    "/image-"+Date.now()+"."+ext;
  try{
    await writeFile(path,btoa(s),null,true);
    cherry.insert("\n![图片]("+relUrl(path)+")\n");setDirty();
    tip("图片已提交 GitHub · 站点部署后即可公开显示");
  }catch(e){alert(e.message)}
}
function insertMermaid(kind){
  const f=String.fromCharCode(96).repeat(3);
  const content=kind==="mindmap"?
    "mindmap\n  root((Android Input))\n    InputReader\n      EventHub\n    InputDispatcher\n      InputChannel":
    "sequenceDiagram\n  participant App\n  participant WMS\n  App->>WMS: addWindow()\n  WMS-->>App: result";
  cherry.insert("\n"+f+"mermaid\n"+content+"\n"+f+"\n");setDirty();
}
function postDraw(data){$("drawioFrame").contentWindow.postMessage(JSON.stringify(data),"https://embed.diagrams.net");}
function showDiagramPicker(){
  if(!current){alert("请先打开文章");return;}
  const entries=NoteDiagrams.diagramEntries(current,repoTree,cherry.getMarkdown());
  const list=$("diagramList");list.replaceChildren();
  if(!entries.length){
    const p=document.createElement("p");p.className="hint";p.textContent="这篇文章还没有独立的 draw.io 源文件，可以新建图表。";
    list.append(p);
  }
  for(const entry of entries){
    const b=document.createElement("button");b.type="button";b.className="file-item diagram-item";
    b.textContent=(entry.referenced?"📌 ":"✎ ")+entry.source.split("/").pop()+(entry.svgExists?" · SVG 已关联":" · SVG 待生成");
    b.title=entry.source;list.append(b);
    b.onclick=()=>{$("diagramPicker").close();void openDraw(entry);};
  }
  $("diagramPicker").showModal();
}
async function openDraw(entry){
  if(!current)return;
  if(diagram)return;
  const existing=repoTree.find(x=>x.path===entry.source);
  const svgBlob=repoTree.find(x=>x.path===entry.svg);
  diagram={source:"",xml:"",sourcePath:entry.source,svgPath:entry.svg,
    sha:existing?.sha||null,svgSha:svgBlob?.sha||null,state:"opening",saving:false,exitAfterSave:false};
  try{
    if(existing){
      const found=await readFile(entry.source);
      if(!found.body.includes("<mxfile") && !found.body.includes("<mxGraphModel"))throw Error("源文件不是 draw.io XML");
      diagram.source=found.body;diagram.sha=found.sha;
    }else{
      diagram.source='<mxfile host="embed.diagrams.net"><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
    }
    $("diagramInfo").textContent="编辑："+entry.source+" · 点击保存即可同步更新源文件与 SVG";
    $("diagramDialog").showModal();
    $("drawioFrame").src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=1&saveAndExit=1";
  }catch(e){diagram=null;alert("无法打开图表："+e.message);}
}
function isDiagramReferenced(svgPath){
  const body=cherry.getMarkdown();
  const short="./"+svgPath.slice(current.indexOf("/")+1);
  return body.includes(NoteDiagrams.imageUrl(svgPath)) || body.includes(short) ||
    body.includes(svgPath.split("/").pop());
}
function encodeSvgData(uri){
  if(!uri.startsWith("data:image/svg+xml"))throw Error("draw.io 未返回 SVG 图片");
  const index=uri.indexOf(",");
  if(index<0)throw Error("SVG 内容无效");
  const payload=uri.slice(index+1);
  return uri.slice(0,index).includes(";base64") ? payload : encodeB64(decodeURIComponent(payload));
}
async function persistDrawio(data){
  const task=diagram;
  if(!task || task.saving || !task.xml)return;
  task.saving=true;task.state="saving";
  $("diagramInfo").textContent="正在保存可编辑源文件与 SVG 到 GitHub...";
  try{
    const svg=encodeSvgData(data.data);
    // Keep the original filenames: never create diagram.drawio when editing drawio-001.drawio.
    const savedXml=await writeFile(task.sourcePath,task.xml,task.sha);
    task.sha=savedXml.sha||savedXml.content_sha;
    const savedSvg=await writeFile(task.svgPath,svg,task.svgSha,true);
    task.svgSha=savedSvg.sha||savedSvg.content_sha;
    if(!isDiagramReferenced(task.svgPath)){
      cherry.insert("\n![draw.io 图表]("+NoteDiagrams.imageUrl(task.svgPath)+")\n");
    }
    setDirty();
    tip("draw.io 已保存："+task.sourcePath+" 和 "+task.svgPath+
      (cherry.getMarkdown()!==original?"；正文变更请再点保存到 GitHub":""));
    $("diagramDialog").close();
    $("drawioFrame").src="about:blank";diagram=null;
    // Refresh file index so subsequent sessions have correct Git blob SHA.
    try {await loadTree();} catch(e){tip("图表已保存；文件列表刷新失败："+e.message);}
  }catch(err){
    task.state="error";
    $("diagramInfo").textContent="保存失败："+err.message+"。请勿关闭弹窗，可再次点击 draw.io 的保存重试。";
  }finally{task.saving=false;}
}
window.addEventListener("message",async e=>{
  if(e.origin!=="https://embed.diagrams.net" ||
     e.source!==$("drawioFrame").contentWindow || !diagram)return;
  let data;try{data=typeof e.data==="string"?JSON.parse(e.data):e.data;}catch{return;}
  if(data.event==="init"){
    postDraw({action:"load",xml:diagram.source,title:diagram.sourcePath.split("/").pop(),saveAndExit:1});
    return;
  }
  if(data.event==="save" && data.xml){
    if(diagram.saving)return;
    diagram.xml=data.xml;diagram.exitAfterSave=!!data.exit;diagram.state="exporting";
    $("diagramInfo").textContent="正在导出更新后的 SVG...";
    postDraw({action:"export",format:"svg",xml:data.xml});
    return;
  }
  if(data.event==="export" && data.data && diagram.state==="exporting"){
    await persistDrawio(data);
    return;
  }
  if(data.event==="exit" && diagram.state!=="saving" && diagram.state!=="exporting"){
    $("diagramDialog").close();$("drawioFrame").src="about:blank";diagram=null;
  }
});
$("saveBtn").onclick=()=>void saveDoc();
$("refreshBtn").onclick=()=>loadTree().catch(e=>alert(e.message));
$("newBtn").onclick=newDoc;
$("newFolderBtn").onclick=createFolderDialog;
$("folderCancel").onclick=()=>$("folderDialog").close();
$("folderForm").onsubmit=event=>void submitFolder(event);
$("articleCancel").onclick=()=>$("newArticleDialog").close();
$("newArticleForm").onsubmit=submitArticle;
$("moveCancel").onclick=()=>$("moveDialog").close();
$("moveTarget").onchange=updateMovePreview;
$("moveForm").onsubmit=event=>void submitMove(event);
$("moveDialog").addEventListener("close",()=>{movingPath=null;});
$("filter").oninput=drawFiles;
$("logoutBtn").onclick=()=>{session="";sessionStorage.removeItem("notes-session");updateStatus();tip("已退出 GitHub 编辑会话。点击「GitHub 登录」可重新授权。");};
$("mermaidBtn").onclick=()=>insertMermaid("sequence");
$("mermaidMindmapBtn").onclick=()=>insertMermaid("mindmap");
$("drawioBtn").onclick=showDiagramPicker;
$("pickerCancel").onclick=()=>$("diagramPicker").close();
$("createDiagram").onclick=()=>{
  try{
    const entry=NoteDiagrams.nextDiagram(current,repoTree);
    $("diagramPicker").close();void openDraw(entry);
  }catch(e){alert(e.message);}
};
$("uploadBtn").onclick=()=>$("uploadInput").click();
$("uploadInput").onchange=e=>{const f=e.target.files?.[0];if(f)void fileUpload(f);e.target.value="";};
$("diagramCancel").onclick=()=>{if(diagram?.saving||diagram?.state==="exporting"){alert("图表正在导出或保存，请等待结果");return;} $("diagramDialog").close();$("drawioFrame").src="about:blank";diagram=null;};
window.addEventListener("keydown",event=>{
  if(document.querySelector("dialog[open]"))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){
    event.preventDefault();
    if(current&&!busy)void saveDoc();
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){
    event.preventDefault();$("filter").focus();$("filter").select();
  }
});
window.addEventListener("beforeunload",e=>{if(current && cherry.getMarkdown()!==original){e.preventDefault();e.returnValue="";}});
if(location.hash.startsWith("#session=")){
  session=decodeURIComponent(location.hash.slice(9));sessionStorage.setItem("notes-session",session);
  history.replaceState(null,"",location.pathname+location.search);
}
$("welcomeNew").onclick=newDoc;
$("welcomeOpen").onclick=()=>{$("filter").focus();$("files").scrollIntoView({behavior:"smooth",block:"nearest"});};
$("insertMenu").addEventListener("click",event=>{
  if(event.target.closest(".insert-option"))$("insertMenu").open=false;
});
document.addEventListener("pointerdown",event=>{
  if(!$("insertMenu").contains(event.target))$("insertMenu").open=false;
});
AospMindmap.setup(()=>({
  get article(){return current;},
  get repoTree(){return repoTree;},
  readFile,writeFile,
  imageUrl:NoteDiagrams.imageUrl,
  getMarkdown:()=>cherry.getMarkdown(),
  insertMarkdown:text=>{cherry.insert(text);setDirty();},
  refreshTree:loadTree,tip
}));
renderWelcome();setEditorState();updateStatus();
if(session)void loadTree().catch(e=>tip("加载失败："+e.message));

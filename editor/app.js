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
  $("loginBtn").textContent = session ? "退出登录" : "GitHub 登录";
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
  currentFiles=result.tree.filter(t=>t.type==="blob" && t.path.endsWith(".md")
    && allowedFolders.some(f=>t.path.startsWith(f+"/")));
  drawFiles();
  renderWelcome();
  $("sidebarCount").textContent=currentFiles.length;
  tip("已同步 "+currentFiles.length+" 篇 Markdown");
}
function drawFiles(){
  const q=$("filter").value.trim().toLowerCase(),list=$("files");list.replaceChildren();
  for(const folder of allowedFolders){
    const files=currentFiles.filter(f=>f.path.startsWith(folder+"/")&&f.path.toLowerCase().includes(q));
    if(!files.length)continue;
    const heading=document.createElement("div");heading.className="group-label";heading.textContent=categoryTitles[folder]||folder;list.append(heading);
    for(const f of files){
      const b=document.createElement("button");b.className="file-item"+(current===f.path?" active":"");
      b.textContent=f.path.slice(folder.length+1);b.title=f.path;
      b.addEventListener("click",()=>void openDoc(f.path));list.append(b);
    }
  }
}
function renderWelcome(){
  const list=$("welcomeRecent");list.replaceChildren();
  $("welcomeCount").textContent=currentFiles.length+" 篇文档";
  if(!currentFiles.length){const el=document.createElement("div");el.className="welcome-empty";el.textContent=session?"知识库中还没有 Markdown，创建第一篇笔记吧。":"登录 GitHub 后会在这里显示笔记。";list.append(el);return;}
  for(const entry of currentFiles.slice(0,6)){
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
    setEditorState();drawFiles();setDirty();tip("已加载 "+path);
  }catch(e){alert(e.message)}finally{busy=false;updateStatus()}
}
async function saveDoc(){
  if(!current ||busy)return;
  try{
    busy=true;updateStatus();tip("正在提交 "+current);
    const body=cherry.getMarkdown();
    const r=await writeFile(current,body,currentSha);currentSha=r.content?.sha||r.content_sha||r.sha;
    original=body;setDirty();tip("已提交到 GitHub main · "+current);
    await loadTree();
  }catch(e){alert("保存失败："+e.message)}finally{busy=false;updateStatus()}
}
function newDoc(){
  const folder=prompt("所属分类（选择已有目录）", "wms");
  if(!folder)return;
  if(!allowedFolders.includes(folder)){alert("目录必须是："+allowedFolders.join("、"));return;}
  const title=prompt("文章标题 / 文件名（无需 .md）","新笔记");
  if(!title)return;
  const clean=slug(title);
  const path=folder+"/"+clean+".md";
  if(currentFiles.some(f=>f.path===path)){alert("同名文章已存在");return;}
  if(current && cherry.getMarkdown()!==original&&!confirm("放弃当前未保存修改？"))return;
  current=path;currentSha=null;original="";cherry.setMarkdown("# "+title+"\n\n");
  $("currentPath").textContent=path;setEditorState();drawFiles();setDirty();updateStatus();
}
async function fileUpload(file){
  if(!current){alert("请先打开或新建文章");return;}
  if(file.size>4*1024*1024){alert("单张图片暂限制 4 MB");return;}
  const ext=({ "image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/svg+xml":"svg"})[file.type];
  if(!ext){alert("仅支持 PNG/JPG/WebP/GIF/SVG");return;}
  const data=new Uint8Array(await file.arrayBuffer());
  let s="";for(let i=0;i<data.length;i+=8192)s+=String.fromCharCode(...data.subarray(i,i+8192));
  const path=current.split("/")[0]+"/assets/"+current.split("/").pop().replace(/\.md$/,"")+
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
$("filter").oninput=drawFiles;
$("loginBtn").onclick=(event)=>{if(session){event.preventDefault();session="";sessionStorage.removeItem("notes-session");updateStatus();}};
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

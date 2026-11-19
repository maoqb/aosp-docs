/* Framework Notes editor. Source of truth: private maoqb/Notes. */
"use strict";
const $ = id => document.getElementById(id);
const allowedFolders = ["wms","Input","binder","servicemanager","cpp","winscope","环境搭建","日志&命令","窗口动画","开机动画","截屏"];
const base = "https://maoqb.github.io/aosp-docs/Notes/";
let apiHost = localStorage.getItem("notes-worker-url") || "";
let session = sessionStorage.getItem("notes-session") || "";
let current = null, currentSha = null, original = "", currentFiles = [], busy = false;
let diagram = null;
const mdStarter = "# Framework 笔记\n\n在这里开始编写你的文章。\n";
const cherry = new Cherry({
  id: "markdown", value: mdStarter,
  toolbars: { toolbar: ["bold","italic","strikethrough","|","header","list","insert","graph","togglePreview"],
    bubble: ["bold","italic","strikethrough","|","color"], float: ["h1","h2","h3","|","quote","code"] },
  callback: { afterChange: () => setDirty() }
});
function tip(s) { $("message").textContent = s; }
function setDirty() { $("dirty").classList.toggle("dirty", !!current && cherry.getMarkdown() !== original); }
function updateStatus() {
  $("connection").textContent = !apiHost ? "未设置 Worker" : session ? "已登录" : "等待 GitHub 登录";
  $("saveBtn").disabled = !session || !current || busy;
  $("loginBtn").textContent = session ? "退出登录" : "GitHub 登录";
}
function getHost() {
  if (!apiHost) throw Error("请先点击设置，填写 Cloudflare Worker 地址");
  return apiHost.replace(/\/$/, "");
}
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
  currentFiles=result.tree.filter(t=>t.type==="blob" && t.path.endsWith(".md")
    && allowedFolders.some(f=>t.path.startsWith(f+"/")));
  drawFiles();
  tip("找到 "+currentFiles.length+" 篇 Markdown");
}
function drawFiles(){
  const q=$("filter").value.trim().toLowerCase(),list=$("files");list.replaceChildren();
  for(const folder of allowedFolders){
    const files=currentFiles.filter(f=>f.path.startsWith(folder+"/")&&f.path.toLowerCase().includes(q));
    if(!files.length)continue;
    const heading=document.createElement("div");heading.className="group-label";heading.textContent=folder;list.append(heading);
    for(const f of files){
      const b=document.createElement("button");b.className="file-item"+(current===f.path?" active":"");
      b.textContent=f.path.slice(folder.length+1);b.title=f.path;
      b.addEventListener("click",()=>void openDoc(f.path));list.append(b);
    }
  }
}
async function openDoc(path){
  if(current && cherry.getMarkdown()!==original && !confirm("当前文章尚未保存，确定放弃修改吗？"))return;
  try {
    busy=true;updateStatus();tip("正在读取 "+path);
    const f=await readFile(path);current=path;currentSha=f.sha;original=f.body;
    cherry.setMarkdown(f.body);$("currentPath").textContent=path;
    drawFiles();setDirty();tip("已加载 "+path);
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
  $("currentPath").textContent=path;drawFiles();setDirty();updateStatus();
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
function diagPath(){const baseName=current.split("/").pop().replace(/\.md$/,"");return current.split("/")[0]+"/assets/"+baseName+"/diagram.drawio";}
function svgPath(){return diagPath().replace(/\.drawio$/,".svg");}
function postDraw(data){$("drawioFrame").contentWindow.postMessage(JSON.stringify(data),"https://embed.diagrams.net");}
async function openDraw(){
  if(!current){alert("请先打开文章");return;}
  diagram={source:"",xml:"",state:"opening"};
  try{const found=await readFile(diagPath());diagram.source=found.body;diagram.sha=found.sha;}catch(e){
    if(!/404|Not Found|not found/i.test(e.message)){alert(e.message);return;}
    diagram.source='<mxfile host="app.diagrams.net"><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
  }
  $("diagramDialog").showModal();
  $("drawioFrame").src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=1&saveAndExit=1";
}
window.addEventListener("message",async e=>{
  if(e.origin!=="https://embed.diagrams.net"||e.source!==$("drawioFrame").contentWindow||!diagram)return;
  let data;try{data=typeof e.data==="string"?JSON.parse(e.data):e.data;}catch{return;}
  if(data.event==="init"){postDraw({action:"load",xml:diagram.source,title:"diagram.drawio",saveAndExit:1});return;}
  if(data.event==="save" && data.xml){
    diagram.xml=data.xml;
    $("diagramInfo").textContent="正在导出 SVG...";
    postDraw({action:"export",format:"svg",xml:data.xml});
    return;
  }
  if(data.event==="export" && data.data && diagram.xml){
    try{
      const uri=data.data;
      const xml=diagram.xml;
      if(!uri.startsWith("data:image/svg+xml"))throw Error("导出结果不是 SVG");
      const raw=uri.slice(uri.indexOf(",")+1);
      const svg=uri.includes(";base64,")?raw:encodeB64(decodeURIComponent(raw));
      if(diagram.sha){await writeFile(diagPath(),xml,diagram.sha);}
      else{await writeFile(diagPath(),xml);}
      let oldSvg=null;try{oldSvg=(await readFile(svgPath())).sha}catch(e){if(!/404|not found/i.test(e.message))throw e;}
      await writeFile(svgPath(),svg,oldSvg,true);
      if(!cherry.getMarkdown().includes("diagram.svg"))cherry.insert("\n![draw.io 图表]("+relUrl(svgPath())+")\n");
      setDirty();tip("draw.io 源文件和 SVG 已提交，请记得保存正文链接");
      $("diagramDialog").close();diagram=null;
    }catch(err){$("diagramInfo").textContent="保存失败："+err.message;}
  }
  if(data.event==="exit"){$("diagramDialog").close();diagram=null;}
});
$("saveBtn").onclick=()=>void saveDoc();
$("refreshBtn").onclick=()=>loadTree().catch(e=>alert(e.message));
$("newBtn").onclick=newDoc;
$("filter").oninput=drawFiles;
$("setupBtn").onclick=()=>{$("workerUrl").value=apiHost;$("settings").showModal()};
$("applyWorker").onclick=e=>{const u=$("workerUrl").value.trim().replace(/\/+$/,"");if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(u)){e.preventDefault();alert("请填写 HTTPS Worker 域名");return;}
 apiHost=u;localStorage.setItem("notes-worker-url",u);session="";sessionStorage.removeItem("notes-session");updateStatus();};
$("loginBtn").onclick=()=>{if(session){session="";sessionStorage.removeItem("notes-session");updateStatus();return;}try{location.href=getHost()+"/auth/start";}catch(e){alert(e.message)}};
$("colorBtn").onclick=()=>{try{cherry.toolbar.toolbarHandlers.color("color: #c34c67")}catch{cherry.insert('<span style="color:#c34c67">彩色文字</span>')}};
$("mermaidBtn").onclick=()=>insertMermaid("sequence");
$("mindmapBtn").onclick=()=>insertMermaid("mindmap");
$("drawioBtn").onclick=()=>void openDraw();
$("uploadBtn").onclick=()=>$("uploadInput").click();
$("uploadInput").onchange=e=>{const f=e.target.files?.[0];if(f)void fileUpload(f);e.target.value="";};
$("diagramCancel").onclick=()=>{$("diagramDialog").close();diagram=null};
window.addEventListener("beforeunload",e=>{if(current && cherry.getMarkdown()!==original){e.preventDefault();e.returnValue="";}});
if(location.hash.startsWith("#session=")){
  session=decodeURIComponent(location.hash.slice(9));sessionStorage.setItem("notes-session",session);
  history.replaceState(null,"",location.pathname+location.search);
}
updateStatus();
if(session&&apiHost)void loadTree().catch(e=>tip("加载失败："+e.message));

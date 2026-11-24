/* Pure, side-effect-free rename planning and Markdown link updates.
 * The Worker commits all renames and associated link edits in one Git commit. */
export function planRename(kind, source, newName, entries) {
  const blobs=entries.filter(e=>e.type==="blob");
  const files=new Map(blobs.map(e=>[e.path,e]));
  if(kind!=="article"&&kind!=="folder")throw Error("不支持的重命名类型");
  if(typeof newName!=="string" || newName!==newName.trim() || !newName ||
     newName.length>70 || newName==="." || newName===".." ||
     /[\\/:*?"<>|\u0000-\u001f]/.test(newName) || newName===".folder" ||
     (kind==="folder"&&newName==="assets"))throw Error("名称无效或包含非法字符");
  if(typeof source!=="string"||!source.includes("/"))throw Error("路径无效");
  const parent=source.slice(0,source.lastIndexOf("/"));
  if(!parent||parent.split("/")[0]==="assets"||source.split("/")[1]==="assets")
    throw Error("不可重命名根分类或 assets 目录");
  let target, moved;
  if(kind==="article"){
    if(!source.endsWith(".md")||source.endsWith("/.folder.md")||!files.has(source))
      throw Error("原始文章不存在");
    target=parent+"/"+newName.replace(/\\.md$/i,"")+".md";
    const oldAsset=source.split("/")[0]+"/assets/"+source.slice(source.indexOf("/")+1,-3)+"/";
    const newAsset=target.split("/")[0]+"/assets/"+target.slice(target.indexOf("/")+1,-3)+"/";
    moved=[{old:source,path:target,sha:files.get(source).sha},
      ...blobs.filter(e=>e.path.startsWith(oldAsset)).map(e=>({
        old:e.path,path:newAsset+e.path.slice(oldAsset.length),sha:e.sha}))];
  }else{
    if(source.split("/").length<2||!blobs.some(e=>e.path.startsWith(source+"/")))
      throw Error("目录不存在或为空");
    target=parent+"/"+newName;
    const root=source.split("/")[0];
    const oldAsset=root+"/assets/"+source.slice(root.length+1)+"/";
    const newAsset=root+"/assets/"+target.slice(root.length+1)+"/";
    moved=[...blobs.filter(e=>e.path.startsWith(source+"/")).map(e=>({
      old:e.path,path:target+e.path.slice(source.length),sha:e.sha})),
      ...blobs.filter(e=>e.path.startsWith(oldAsset)).map(e=>({
        old:e.path,path:newAsset+e.path.slice(oldAsset.length),sha:e.sha}))];
  }
  if(target===source)throw Error("新名称与原名称相同");
  const oldPaths=new Set(moved.map(m=>m.old));
  const targetPaths=new Set();
  if(entries.some(e=>e.path===target&&!oldPaths.has(e.path)))
    throw Error("目标名称已存在");
  for(const item of moved){
    if(targetPaths.has(item.path))throw Error("重命名产生重复路径");
    targetPaths.add(item.path);
    if(entries.some(e=>!oldPaths.has(e.path)&&(
      e.path===item.path || (e.type==="blob"&&item.path.startsWith(e.path+"/")))))
      throw Error("目标路径或资源已被占用");
  }
  if(moved.length>500)throw Error("文件过多，请拆分目录再操作");
  return {kind,source,target,mappings:moved,articleCount:moved.filter(e=>e.old.endsWith(".md")&&!e.old.endsWith("/.folder.md")&&!e.old.includes("/assets/")).length,
    assetCount:moved.filter(e=>e.old.includes("/assets/")).length};
}
function encodePath(p){return p.split("/").map(encodeURIComponent).join("/");}
function posixResolve(base,rel){
  const stack=base.split("/").filter(Boolean);
  for(const seg of rel.split("/")){
    if(!seg||seg===".")continue;
    if(seg===".."){if(!stack.length)return null;stack.pop();}else stack.push(seg);
  }
  return stack.join("/");
}
function posixRelative(from,target){
  const a=from.split("/"),b=target.split("/");
  while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}
  return "../".repeat(a.length)+b.join("/");
}
function mapped(path,rename){
  if(path===rename.source)return rename.target;
  if(rename.kind==="article"&&path===rename.source.slice(0,-3)+".html")
    return rename.target.slice(0,-3)+".html";
  if(rename.kind==="folder"&&path.startsWith(rename.source+"/"))
    return rename.target+path.slice(rename.source.length);
  const root=rename.source.split("/")[0];
  const oldAssets=rename.kind==="folder"?
    root+"/assets/"+rename.source.slice(root.length+1)+"/":
    root+"/assets/"+rename.source.slice(root.length+1,-3)+"/";
  const newAssets=rename.kind==="folder"?
    root+"/assets/"+rename.target.slice(root.length+1)+"/":
    root+"/assets/"+rename.target.slice(root.length+1,-3)+"/";
  return path.startsWith(oldAssets)?newAssets+path.slice(oldAssets.length):path;
}
export function rewriteRenameLinks(markdown,oldDocumentPath,newDocumentPath,rename){
  let result=markdown;
  const root="https://maoqb.github.io/aosp-docs/Notes/";
  const webRoot="/aosp-docs/Notes/";
  const rootName=rename.source.split("/")[0];
  const assetOld=rename.kind==="folder"?rootName+"/assets/"+rename.source.slice(rootName.length+1)+"/":
    rootName+"/assets/"+rename.source.slice(rootName.length+1,-3)+"/";
  const assetNew=rename.kind==="folder"?rootName+"/assets/"+rename.target.slice(rootName.length+1)+"/":
    rootName+"/assets/"+rename.target.slice(rootName.length+1,-3)+"/";
  // Prefix replacement must not change a similarly named sibling.
  const pairs=[[assetOld,assetNew],[rename.source,rename.target]];
  if(rename.kind==="article")pairs.push([
    rename.source.slice(0,-3)+".html",rename.target.slice(0,-3)+".html"
  ]);
  for(const [oldPath,newPath] of pairs){
    for(const [before,after] of [[oldPath,newPath],[encodePath(oldPath),encodePath(newPath)]]){
      const esc=before.replace(/[.*+?^\${}()|[\]\\]/g,"\\$&");
      const boundary=oldPath.endsWith("/")?"":"(?=$|[\\/?#)\\]\\s\\\"'<>])";
      for(const prefix of [root,webRoot]){
        result=result.replace(new RegExp(prefix.replace(/[.*+?^\${}()|[\]\\]/g,"\\$&")+esc+boundary,"g"),prefix+after);
      }
    }
  }
  // Resolve local Markdown links relative to the *old* document and emit a
  // correct relative link based on the *new* document location.
  const oldDir=oldDocumentPath.slice(0,oldDocumentPath.lastIndexOf("/"));
  const newDir=newDocumentPath.slice(0,newDocumentPath.lastIndexOf("/"));
  result=result.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g,(all,open,url,close)=>{
    if(/^(?:[a-z]+:|\/|#)/i.test(url))return all;
    const hit=url.match(/^([^?#]+)([?#].*)?$/);
    if(!hit)return all;
    let decoded;
    try{decoded=decodeURIComponent(hit[1]);}catch{return all;}
    const resolved=posixResolve(oldDir,decoded);
    if(!resolved)return all;
    const dest=mapped(resolved,rename);
    if(dest===resolved && oldDir===newDir)return all;
    let rel=posixRelative(newDir,dest);
    if(!rel.startsWith("."))rel="./"+rel;
    return open+rel.split("/").map(x=>encodeURIComponent(x)).join("/").replace(/%2E%2E/g,"..")+(hit[2]||"")+close;
  });
  return result;
}

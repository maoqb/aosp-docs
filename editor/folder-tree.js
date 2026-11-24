/* Folder model for the GitHub-backed Notes editor.
   Git does not track empty directories: .folder.md persists them without
   generating a public article. Nested directories use the existing /api/file
   endpoint, so the deployed Worker does not need to be changed. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.NotesFolders=api;
})(typeof window!=="undefined"?window:null,function(){
  const MARKER=".folder.md";
  function pathValid(path, allowedRoots){
    if(typeof path!=="string"||!path||path.length>350||path.startsWith("/")||path.endsWith("/")||path.includes("\\")||path.includes("\0"))return false;
    const segments=path.split("/");
    if(segments.length<1||segments.length>15||!allowedRoots.includes(segments[0])||(segments.length>1&&segments[1]==="assets"))return false;
    return segments.every(x=>x&&x!=="."&&x!==".."&&!/[<>:"|?*]/.test(x)&&x.trim()===x);
  }
  function folderPaths(tree,allowedRoots){
    const all=new Set(allowedRoots);
    for(const entry of tree||[]){
      if(entry.type!=="blob"||!entry.path||!pathValid(entry.path.split("/").slice(0,-1).join("/"),allowedRoots))continue;
      const segments=entry.path.split("/");
      for(let i=1;i<segments.length;i++)all.add(segments.slice(0,i).join("/"));
    }
    return [...all].sort((a,b)=>a.localeCompare(b,"zh"));
  }
  function visibleArticles(tree,allowedRoots){
    return (tree||[]).filter(t=>t.type==="blob"&&/\.md$/i.test(t.path)&&!t.path.endsWith("/"+MARKER)
      &&allowedRoots.includes(t.path.split("/")[0]));
  }
  function newFolder(parent,name,tree,allowedRoots){
    if(typeof name!=="string"||!name.trim()||name!==name.trim()||name.includes("/"))throw Error("目录名不能留空或包含 /");
    const folder=parent+"/"+name;
    if(!pathValid(folder,allowedRoots))throw Error("目录名称无效，或父目录不在可编辑分类内");
    const used=folderPaths(tree,allowedRoots);
    if(!used.includes(parent))throw Error("父目录不存在，请先创建父目录");
    if(used.includes(folder))throw Error("同名目录已经存在");
    const collision=(tree||[]).some(t=>t.path===folder);
    if(collision)throw Error("同名文件已经存在");
    return {folder,marker:folder+"/"+MARKER,content:"# "+name+"\n\n<!-- Notes Studio folder marker: hidden from public navigation -->\n"};
  }
  function newArticle(folder,name,tree,allowedRoots){
    if(typeof name!=="string"||!name.trim())throw Error("请输入文章标题");
    const filename=name.trim().replace(/[\\/:*?"<>|]/g,"-").slice(0,70);
    if(!filename||filename==="."||filename===".."||filename.toLowerCase()===".folder")throw Error("文章标题无效");
    if(!pathValid(folder,allowedRoots)||!folderPaths(tree,allowedRoots).includes(folder))throw Error("请选择已有目录");
    const path=folder+"/"+filename+".md";
    if((tree||[]).some(t=>t.path===path))throw Error("同名文章已经存在");
    return path;
  }
  function planMove(source,destinationFolder,tree,allowedRoots){
    if(typeof source!=="string"||!source.endsWith(".md")||source.endsWith("/"+MARKER)
       ||!(tree||[]).some(e=>e.type==="blob"&&e.path===source))
      throw Error("请选择已保存到 GitHub 的 Markdown 文章");
    if(!pathValid(destinationFolder,allowedRoots)||
       !folderPaths(tree,allowedRoots).includes(destinationFolder))
      throw Error("请选择已存在的目标目录");
    const origin=source.slice(0,source.lastIndexOf("/"));
    if(origin===destinationFolder)throw Error("文章已在当前目录");
    const destination=destinationFolder+"/"+source.split("/").pop();
    if((tree||[]).some(e=>e.path===destination))
      throw Error("目标目录中已有同名文件，请先重命名或选择其他目录");
    const oldAssets=source.split("/")[0]+"/assets/"+source.slice(source.indexOf("/")+1,-3)+"/";
    const newAssets=destinationFolder.split("/")[0]+"/assets/"+destination.slice(destination.indexOf("/")+1,-3)+"/";
    const assets=(tree||[]).filter(e=>e.type==="blob"&&e.path.startsWith(oldAssets));
    if(assets.some(e=>(tree||[]).some(t=>t.path===newAssets+e.path.slice(oldAssets.length))))
      throw Error("目标目录存在同名图片或图表资源，不能覆盖");
    return {source,destination,destinationFolder,sha:tree.find(e=>e.path===source).sha,assetCount:assets.length};
  }
  function foldersWithChildren(tree,allowedRoots){
    const folders=folderPaths(tree,allowedRoots);
    const articles=visibleArticles(tree,allowedRoots);
    return folders.map(folder=>({
      path:folder,
      depth:folder.split("/").length-1,
      articleCount:articles.filter(t=>t.path.startsWith(folder+"/")).length,
      childFolderCount:folders.filter(f=>f!==folder&&f.startsWith(folder+"/")&&f.split("/").length===folder.split("/").length+1).length
    }));
  }
  return {MARKER,pathValid,folderPaths,visibleArticles,newFolder,newArticle,foldersWithChildren,planMove};
});

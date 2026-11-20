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
    if(segments.length<1||segments.length>15||!allowedRoots.includes(segments[0]))return false;
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
    if(!filename||filename==="."||filename==="..")throw Error("文章标题无效");
    if(!pathValid(folder,allowedRoots)||!folderPaths(tree,allowedRoots).includes(folder))throw Error("请选择已有目录");
    const path=folder+"/"+filename+".md";
    if((tree||[]).some(t=>t.path===path))throw Error("同名文章已经存在");
    return path;
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
  return {MARKER,pathValid,folderPaths,visibleArticles,newFolder,newArticle,foldersWithChildren};
});

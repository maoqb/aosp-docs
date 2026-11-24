/* Pure move planner shared by Worker tests.
 * Source and destination paths have already been validated by the API.
 * Git tree entries are preserved by SHA so binary .drawio, SVG and images
 * move without decoding/re-encoding. */
export function planArticleMove(source, destinationFolder, entries) {
  if (!source || !source.endsWith(".md") || source.endsWith("/.folder.md")) throw new Error("只能移动 Markdown 文章");
  const slash=source.lastIndexOf("/");
  if (slash<0) throw new Error("文章路径无效");
  const fromFolder=source.slice(0,slash);
  if(fromFolder===destinationFolder)throw new Error("文章已经在该目录中");
  const target=destinationFolder+"/"+source.slice(slash+1);
  const oldAsset=source.slice(0,source.indexOf("/"))+"/assets/"+source.slice(source.indexOf("/")+1,-3)+"/";
  const newAsset=destinationFolder.split("/")[0]+"/assets/"+target.slice(target.indexOf("/")+1,-3)+"/";
  const files=entries.filter(e=>e.type==="blob");
  const paths=new Set(entries.map(e=>e.path));
  const src=files.find(e=>e.path===source);
  if(!src)throw new Error("原始文章不存在，请同步目录后重试");
  if(paths.has(target))throw new Error("目标目录中已有同名文件");
  if(paths.has(destinationFolder))throw new Error("目标路径被文件占用");
  const assets=files.filter(e=>e.path.startsWith(oldAsset));
  const mappings=[{old:source,path:target,sha:src.sha,article:true},...assets.map(e=>({
    old:e.path,path:newAsset+e.path.slice(oldAsset.length),sha:e.sha,article:false
  }))];
  if(new Set(mappings.map(x=>x.path)).size!==mappings.length || mappings.some(x=>paths.has(x.path)))throw new Error("目标文章或资源文件已存在，已取消移动");
  return {source,target,oldAsset,newAsset,mappings,assetCount:assets.length,sourceSha:src.sha};
}
export function rewriteMovedAssetLinks(markdown,oldAsset,newAsset){
  const pub="https://maoqb.github.io/aosp-docs/Notes/";
  const encode=s=>s.split("/").map(v=>encodeURIComponent(v).replace(/[()]/g,c=>c==="("?"%28":"%29")).join("/");
  // Preserve URL style (encoded/unencoded, absolute/root-relative).
  let result=markdown;
  for(const [oldValue,newValue] of [
    [pub+encode(oldAsset),pub+encode(newAsset)],
    ["/aosp-docs/Notes/"+encode(oldAsset),"/aosp-docs/Notes/"+encode(newAsset)],
    [pub+oldAsset,pub+newAsset],
    ["/aosp-docs/Notes/"+oldAsset,"/aosp-docs/Notes/"+newAsset],
    [oldAsset,newAsset]
  ]) result=result.split(oldValue).join(newValue);
  return result;
}

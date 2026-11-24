/* Plan a safe, atomic removal of one Markdown article and its private
 * asset subtree. No other document or sibling asset folders may be touched. */
export function planArticleDelete(path,entries) {
  if(typeof path!=="string"||!path.endsWith(".md")||path.endsWith("/.folder.md")||
     !path.includes("/")||path.startsWith("/")||path.includes(".."))
    throw new Error("只能删除已保存的 Markdown 文章");
  const files=entries.filter(e=>e.type==="blob");
  const source=files.find(e=>e.path===path);
  if(!source)throw new Error("原始文章不存在，请同步目录后重试");
  const slash=path.indexOf("/");
  const assets=path.slice(0,slash)+"/assets/"+path.slice(slash+1,-3)+"/";
  const linked=files.filter(e=>e.path.startsWith(assets));
  return {
    path,sourceSha:source.sha,assetCount:linked.length,
    mappings:[{path,sha:source.sha},...linked.map(e=>({path:e.path,sha:e.sha}))]
  };
}

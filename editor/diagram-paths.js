/* Pure, testable path logic for editable draw.io files in Notes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NoteDiagrams = api;
})(typeof window !== "undefined" ? window : null, function () {
  const PUBLIC_BASE = "https://maoqb.github.io/aosp-docs/Notes/";
  function assetFolder(article) {
    if (!/^[^/]+\/(?:[^/]+\/)*[^/]+\.md$/.test(article)) throw Error("请选择有效的 Markdown 文章");
    if (article.split("/").some(segment => segment === "." || segment === "..")) throw Error("不允许父目录引用");
    const slash = article.indexOf("/");
    return article.slice(0, slash) + "/assets/" + article.slice(slash + 1, -3) + "/";
  }
  function imageUrl(path) {
    return PUBLIC_BASE + path.split("/").map(segment => encodeURIComponent(segment).replace(/[()]/g, ch => ch === "(" ? "%28" : "%29")).join("/");
  }
  function diagramEntries(article, tree, markdown) {
    const prefix=assetFolder(article);
    const entries=(tree||[]).filter(x=>x.type==="blob" && x.path.startsWith(prefix) && x.path.endsWith(".drawio"))
      .map(x=>{
        const source=x.path, svg=source.slice(0,-7)+".svg";
        const referenced=(markdown||"").includes(imageUrl(svg)) || (markdown||"").includes("./"+svg.slice(article.indexOf("/")+1))
          || (markdown||"").includes(svg.split("/").pop());
        return {source, svg, svgExists:tree.some(y=>y.type==="blob"&&y.path===svg),referenced};
      });
    entries.sort((a,b)=>Number(b.referenced)-Number(a.referenced)||a.source.localeCompare(b.source,"zh"));
    return entries;
  }
  function nextDiagram(article,tree) {
    const directory=assetFolder(article);
    const paths=new Set((tree||[]).map(x=>x.path));
    for(let i=1;i<=999;i++){
      const name="drawio-"+String(i).padStart(3,"0");
      const source=directory+name+".drawio",svg=directory+name+".svg";
      if(!paths.has(source)&&!paths.has(svg))return {source,svg,svgExists:false,referenced:false};
    }
    throw Error("图表数量超出支持上限");
  }
  return {assetFolder,imageUrl,diagramEntries,nextDiagram};
});

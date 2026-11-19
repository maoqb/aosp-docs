/* Browser + Node compatible visual mind-map format and SVG renderer.
 * The editable source is a Mermaid mindmap (.mmd); the SVG also embeds lossless
 * JSON metadata, so reopening preserves labels and tree structure exactly. */
(function (root,factory) {
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.AospMindmapCore=api;
})(typeof window!=="undefined"?window:null,function(){
  const colors=["#3c8c6b","#6278aa","#c28a4e","#a06bb1","#c16c76","#619d9a"];
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  const unesc=s=>String(s).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&");
  function create(title="中心主题"){return {id:"root",text:title,children:[{id:"a",text:"核心概念",children:[]},{id:"b",text:"实现流程",children:[]},{id:"c",text:"实践与调试",children:[]}]};}
  function walk(node,fn,parent=null,level=0){fn(node,parent,level);for(const c of node.children||[])walk(c,fn,node,level+1);}
  function find(tree,id){let found=null;walk(tree,(node,parent)=>{if(node.id===id)found={node,parent}});return found;}
  function nextId(tree){const used=new Set();walk(tree,n=>used.add(n.id));let id;do{id="n"+Math.random().toString(36).slice(2,10);}while(used.has(id));return id;}
  function addChild(tree,id,label="新分支"){const f=find(tree,id);if(!f)return null;const item={id:nextId(tree),text:label,children:[]};f.node.children.push(item);return item.id;}
  function addSibling(tree,id,label="新主题"){const f=find(tree,id);if(!f||!f.parent)return null;const item={id:nextId(tree),text:label,children:[]};f.parent.children.splice(f.parent.children.indexOf(f.node)+1,0,item);return item.id;}
  function remove(tree,id){const f=find(tree,id);if(!f||!f.parent)return false;f.parent.children=f.parent.children.filter(c=>c.id!==id);return true;}
  function label(s){return String(s??"").replace(/[\r\n]+/g," ").trim().slice(0,96)||"未命名主题";}
  function mermaid(tree){
    const lines=["mindmap"];
    const visit=(n,d)=>{
      const str=label(n.text).replace(/[()\[\]{}]/g,"").replace(/"/g,"'").replace(/:::/g,": ");
      lines.push("  ".repeat(d+1)+(d===0?"root(("+str+"))":str));
      for(const child of n.children||[])visit(child,d+1);
    };visit(tree,0);return lines.join("\n")+"\n";
  }
  function fromMermaid(source){
    const stack=[],lines=String(source).split(/\r?\n/).filter(x=>x.trim()&&x.trim()!=="mindmap");
    let tree=null,i=0;
    for(const line of lines){
      const ws=line.match(/^\s*/)[0].length;
      let raw=line.trim().replace(/^root\(\((.*)\)\)$/,"$1").replace(/^["'\[]|["'\]]$/g,"");
      const item={id:i++?"n"+i:"root",text:label(raw),children:[]};
      while(stack.length&&stack[stack.length-1].indent>=ws)stack.pop();
      if(!tree)tree=item;else if(stack.length)stack[stack.length-1].node.children.push(item);
      stack.push({indent:ws,node:item});
    }
    return tree||create();
  }
  function coordinates(tree){
    const nodes=[],edges=[];let leaf=0;
    function assign(node,depth,parent=null,colorIndex=0){
      const children=node.children||[];
      const width=Math.max(depth===0?190:124,Math.min(280,32+Array.from(label(node.text)).reduce((x,ch)=>x+(ch.charCodeAt(0)>127?15:8),0)));
      const item={id:node.id,text:label(node.text),depth,x:64+depth*242,y:0,w:width,h:depth===0?56:44,color:colors[colorIndex%colors.length],parent:parent?.id};
      nodes.push(item);
      if(!children.length)item.y=54+(leaf++)*91;
      else{
        children.forEach((c,index)=>assign(c,depth+1,item,depth===0?index:colorIndex));
        const c=nodes.filter(n=>n.parent===item.id);
        item.y=(c[0].y+c[c.length-1].y)/2;
      }
      if(parent)edges.push([parent.id,item.id]);
    }
    assign(tree,0);
    const lookup=Object.fromEntries(nodes.map(n=>[n.id,n]));
    const width=Math.max(720,...nodes.map(n=>n.x+n.w+80));
    const height=Math.max(320,...nodes.map(n=>n.y+n.h+65));
    return {nodes,edges,lookup,width,height};
  }
  function svg(tree,{selected=null,editor=false}={}){
    const l=coordinates(tree);
    let out='<svg xmlns="http://www.w3.org/2000/svg" width="'+l.width+'" height="'+l.height+'" viewBox="0 0 '+l.width+' '+l.height+'" role="img" aria-label="思维导图">';
    out+='<metadata id="aosp-mindmap-data">'+esc(JSON.stringify(tree))+'</metadata>';
    out+='<rect x="0" y="0" width="'+l.width+'" height="'+l.height+'" fill="#fcfdfa"/>';
    for(const [from,to] of l.edges){
      const p=l.lookup[from],c=l.lookup[to],x=p.x+p.w,y=p.y+p.h/2,tx=c.x,ty=c.y+c.h/2;
      out+='<path d="M '+x+" "+y+" C "+(x+75)+" "+y+" "+(tx-74)+" "+ty+" "+tx+" "+ty+'" fill="none" stroke="'+c.color+'" stroke-width="2.4" stroke-opacity=".48"/>';
    }
    for(const n of l.nodes){
      const sel=selected===n.id;
      const bg=n.depth===0?"#145b47":"#ffffff",fg=n.depth===0?"#ffffff":"#263c33";
      out+='<g'+(editor?' data-node-id="'+esc(n.id)+'" style="cursor:pointer"':'')+'>';
      out+='<rect x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" rx="'+(n.depth===0?13:10)+'" fill="'+bg+'" stroke="'+(sel?"#3ba779":n.depth===0?"#145b47":"#dce8dd")+'" stroke-width="'+(sel?"3":"1.4")+'"/>';
      if(n.depth>0)out+='<rect x="'+n.x+'" y="'+(n.y+7)+'" width="3" height="'+(n.h-14)+'" rx="1.5" fill="'+n.color+'"/>';
      const measure=text=>Array.from(text).reduce((sum,c)=>sum+(c.charCodeAt(0)>127?15:8),0);
      let short=n.text;
      while(short.length>1&&measure(short)>n.w-36)short=Array.from(short).slice(0,-1).join("");
      if(short!==n.text)short=Array.from(short).slice(0,-1).join("")+"…";
      out+='<text x="'+(n.x+17)+'" y="'+(n.y+n.h/2+5)+'" font-size="'+(n.depth===0?16:13)+'" font-weight="'+(n.depth===0?700:540)+'" font-family="Inter,Noto Sans SC,Arial,sans-serif" fill="'+fg+'">'+esc(short)+'</text>';
      out+='</g>';
    }
    out+='</svg>';return out;
  }
  function fromSvg(content){
    const m=String(content).match(/<metadata id="aosp-mindmap-data">([\s\S]*?)<\/metadata>/);
    if(!m)return null;
    const data=JSON.parse(unesc(m[1]));if(!data||typeof data.text!=="string"||!Array.isArray(data.children))throw Error("SVG 图表源数据已损坏");
    return data;
  }
  function paths(article,tree){
    if(!article||!article.endsWith(".md"))throw Error("请先选择笔记");
    const prefix=windowPath(article);
    const files=tree||[];
    const entries=files.filter(x=>x.type==="blob"&&x.path.startsWith(prefix)&&/^mindmap-\d{3}\.mmd$/.test(x.path.slice(prefix.length)))
      .map(x=>{const svgPath=x.path.replace(/\.mmd$/,".svg");return {source:x.path,svg:svgPath,sourceSha:x.sha||null,svgSha:files.find(y=>y.path===svgPath)?.sha||null};});
    entries.sort((a,b)=>a.source.localeCompare(b.source));
    return entries;
  }
  function windowPath(article){
    const p=article.indexOf("/");return article.slice(0,p)+"/assets/"+article.slice(p+1,-3)+"/";
  }
  function next(article,tree){
    const prefix=windowPath(article),used=new Set((tree||[]).map(x=>x.path));
    for(let n=1;n<=999;n++){
      const name="mindmap-"+String(n).padStart(3,"0");
      const source=prefix+name+".mmd",svg=prefix+name+".svg";
      if(!used.has(source)&&!used.has(svg))return {source,svg,sourceSha:null,svgSha:null};
    }
    throw Error("可视化导图数量超出上限");
  }
  return {create,walk,find,addChild,addSibling,remove,label,mermaid,fromMermaid,coordinates,svg,fromSvg,paths,next};
});

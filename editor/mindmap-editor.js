/* Visual mind map editor: no Mermaid syntax required for authors.
 * Mouse selection + double-click rename, Tab child, Enter sibling, Delete,
 * wheel pan, Ctrl+wheel zoom, and GitHub source/SVG persistence. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id), core=window.AospMindmapCore;
  let context=null, entry=null, tree=null, selected="root", zoom=1, panX=0, panY=0, pointer=null, loading=false, modified=false;
  function status(s){$("mmStatus").textContent=s;}
  function setActions(){
    const has=!!tree, isRoot=selected==="root";
    for(const id of ["mmAddChild","mmRename","mmSave"])$(id).disabled=!has||loading;
    for(const id of ["mmAddSibling","mmRemove"])$(id).disabled=!has||isRoot||loading;
    $("mmZoomLabel").textContent=Math.round(zoom*100)+"%";
  }
  function render(){
    if(!tree)return;
    const svg=core.svg(tree,{selected,editor:true});
    $("mmScene").innerHTML=svg;
    const map=$("mmScene").querySelector("svg");
    map.setAttribute("aria-label","可视化思维导图，双击主题编辑，Tab 添加子节点");
    map.style.width="max-content";map.style.height="max-content";
    const current=core.find(tree,selected)?.node;
    $("mmNodeTitle").textContent=current?.text||"中心主题";
    $("mmBranchCount").textContent=(()=>{let count=0;core.walk(tree,()=>count++);return count+" 个主题";})();
    $("mmScene").style.transform="translate("+panX+"px,"+panY+"px) scale("+zoom+")";
    setActions();
  }
  function refreshTransform(){
    $("mmScene").style.transform="translate("+panX+"px,"+panY+"px) scale("+zoom+")";
    $("mmZoomLabel").textContent=Math.round(zoom*100)+"%";
  }
  function center(){
    if(!tree)return;
    const size=core.coordinates(tree),box=$("mmCanvas").getBoundingClientRect();
    zoom=Math.max(.45,Math.min(1.05,(box.width-70)/size.width,(box.height-70)/size.height));
    panX=Math.max(12,(box.width-size.width*zoom)/2);panY=Math.max(12,(box.height-size.height*zoom)/2);
    refreshTransform();
  }
  function select(id){selected=id;render();}
  function edit(){
    if(!tree)return;
    const found=core.find(tree,selected);
    if(!found)return;
    const el=$("mmScene").querySelector('[data-node-id="'+selected+'"]');
    if(!el)return;
    const r=el.getBoundingClientRect(),p=$("mmCanvas").getBoundingClientRect(),input=$("mmEditInput");
    input.style.left=Math.min(p.width-250,Math.max(8,r.left-p.left+6))+"px";
    input.style.top=Math.min(p.height-42,Math.max(8,r.top-p.top+4))+"px";
    input.value=found.node.text;input.hidden=false;input.focus();input.select();
  }
  function completeEdit(save){
    const input=$("mmEditInput");
    if(input.hidden)return;
    if(save&&tree){const node=core.find(tree,selected)?.node;if(node){const value=core.label(input.value);if(value!==node.text){node.text=value;modified=true;}}}
    input.hidden=true;render();
  }
  function child(){
    if(!tree)return;
    const id=core.addChild(tree,selected);if(id){modified=true;select(id);edit();status("已添加子主题 · 点击保存同步 GitHub");}
  }
  function sibling(){
    if(!tree)return;
    const id=core.addSibling(tree,selected);if(id){modified=true;select(id);edit();status("已添加同级主题 · 点击保存同步 GitHub");}
  }
  function remove(){
    if(!tree||selected==="root")return;
    const parent=core.find(tree,selected)?.parent?.id||"root";
    if(core.remove(tree,selected)){modified=true;select(parent);status("主题已删除，保存后生效");}
  }
  function zoomBy(k){
    zoom=Math.min(2,Math.max(.3,zoom*k));refreshTransform();
  }
  function pick(){
    if(!context?.article){alert("请先打开或创建笔记");return;}
    const entries=core.paths(context.article,context.repoTree),list=$("mmDiagramList");list.replaceChildren();
    if(!entries.length){const p=document.createElement("p");p.className="hint";p.textContent="暂无思维导图。点击下方新建，像 XMind 一样直接添加和编辑分支。";list.append(p);}
    for(const e of entries){
      const b=document.createElement("button");b.type="button";b.className="diagram-item file-item";
      b.innerHTML='<span class="mindmap-icon">✳</span><span class="mindmap-item-text"></span><span class="mindmap-item-arrow">↗</span>';
      b.querySelector(".mindmap-item-text").textContent=e.source.split("/").pop();b.onclick=()=>{ $("mindmapPicker").close();void open(e);};list.append(b);
    }
    $("mindmapPicker").showModal();
  }
  async function open(e){
    entry={...e};tree=null;selected="root";zoom=1;panX=0;panY=0;modified=false;
    $("mmScene").replaceChildren();$("mmEditInput").hidden=true;$("mindmapDialog").showModal();
    status("正在读取思维导图源文件…");
    try{
      if(entry.sourceSha){
        const data=await context.readFile(entry.source);
        entry.sourceSha=data.sha;
        tree=core.fromMermaid(data.body);
        // The SVG keeps an exact JSON copy for fidelity (e.g. punctuation).
        if(entry.svgSha) {
          try{const svg=await context.readFile(entry.svg);entry.svgSha=svg.sha;tree=core.fromSvg(svg.body)||tree;}catch(e){/* source MMD remains editable */ }
        }
      }else tree=core.create(context.article.split("/").pop().replace(/\.md$/,""));
      render();requestAnimationFrame(center);status("双击文字改名 · Tab 子主题 · Enter 同级 · 拖拽画布移动");
    }catch(error){$("mindmapDialog").close();alert("打开思维导图失败："+error.message);}
  }
  function hasPreview(url){
    const text=context.getMarkdown();
    return text.includes(url)||text.includes("./"+entry.svg.slice(context.article.indexOf("/")+1))||text.includes(entry.svg.split("/").pop());
  }
  async function save(){
    if(!tree||!entry||loading)return;
    loading=true;setActions();status("正在保存 Mermaid 源码和 SVG 图片…");
    try{
      const mermaid=core.mermaid(tree),svg=core.svg(tree);
      const sourceResult=await context.writeFile(entry.source,mermaid,entry.sourceSha);
      entry.sourceSha=sourceResult.sha||sourceResult.content_sha||entry.sourceSha;
      const svgResult=await context.writeFile(entry.svg,svg,entry.svgSha);
      entry.svgSha=svgResult.sha||svgResult.content_sha||entry.svgSha;
      const url=context.imageUrl(entry.svg);
      if(!hasPreview(url))context.insertMarkdown("\n![思维导图]("+url+")\n");
      modified=false;status("已保存");$("mindmapDialog").close();
      context.tip("思维导图已提交到 GitHub（.mmd + .svg）；如新增图片引用，请保存文章正文。");
      await context.refreshTree();
    }catch(error){status("保存失败："+error.message+"。图表未关闭，可重试保存。");}
    finally{loading=false;setActions();}
  }
  function bind(){
    $("mindmapBtn").onclick=()=>{if(!context?.article)return alert("请先打开文章");pick();};
    $("mmPickerCancel").onclick=()=>{$("mindmapPicker").close();};
    $("mmPickerCreate").onclick=()=>{
      try{const e=core.next(context.article,context.repoTree);$("mindmapPicker").close();void open(e);}
      catch(error){alert(error.message);}
    };
    $("mmAddChild").onclick=child;$("mmAddSibling").onclick=sibling;$("mmRename").onclick=edit;$("mmRemove").onclick=remove;
    $("mmSave").onclick=()=>void save();
    $("mmClose").onclick=()=>{if(loading)return; if(!modified||confirm("关闭思维导图？未保存的修改将丢失。")){$("mindmapDialog").close();tree=null;modified=false;}};
    $("mindmapDialog").addEventListener("cancel",e=>{if(loading||(modified&&!confirm("未保存的思维导图更改将丢失，确定关闭吗？")))e.preventDefault();});
    $("mmFit").onclick=center;$("mmZoomIn").onclick=()=>zoomBy(1.18);$("mmZoomOut").onclick=()=>zoomBy(1/1.18);
    $("mmEditInput").addEventListener("keydown",e=>{
      if(e.key==="Enter"){e.preventDefault();completeEdit(true);}
      if(e.key==="Escape"){e.preventDefault();completeEdit(false);}
      e.stopPropagation();
    });
    $("mmEditInput").addEventListener("blur",()=>completeEdit(true));
    $("mmCanvas").addEventListener("click",e=>{
      const el=e.target.closest?.("[data-node-id]");
      if(el)select(el.getAttribute("data-node-id"));
      $("mmCanvas").focus({preventScroll:true});
    });
    $("mmCanvas").addEventListener("dblclick",e=>{
      const el=e.target.closest?.("[data-node-id]");
      if(el){select(el.getAttribute("data-node-id"));edit();}
    });
    $("mmCanvas").addEventListener("pointerdown",e=>{
      if(e.button!==0 || e.target.closest?.("[data-node-id]"))return;
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,panX,panY};
      $("mmCanvas").setPointerCapture(e.pointerId);
      $("mmCanvas").classList.add("is-panning");
    });
    $("mmCanvas").addEventListener("pointermove",e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      panX=pointer.panX+e.clientX-pointer.x;panY=pointer.panY+e.clientY-pointer.y;refreshTransform();
    });
    const finish=e=>{if(pointer?.id!==e.pointerId)return;pointer=null;$("mmCanvas").classList.remove("is-panning");};
    $("mmCanvas").addEventListener("pointerup",finish);$("mmCanvas").addEventListener("pointercancel",finish);
    $("mmCanvas").addEventListener("wheel",e=>{
      if(!tree)return;e.preventDefault();
      if(e.ctrlKey||e.metaKey)zoomBy(e.deltaY<0?1.08:.92);
      else{panY-=e.deltaY;panX-=e.deltaX;refreshTransform();}
    },{passive:false});
    window.addEventListener("beforeunload",e=>{if(modified){e.preventDefault();e.returnValue="";}});
    $("mindmapDialog").addEventListener("keydown",e=>{
      if(!tree||!$("mmEditInput").hidden||e.target.tagName==="INPUT")return;
      if(e.key==="Tab"){e.preventDefault();child();}
      else if(e.key==="Enter"){e.preventDefault();sibling();}
      else if(e.key==="F2"){e.preventDefault();edit();}
      else if(["Delete","Backspace"].includes(e.key)){e.preventDefault();remove();}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();void save();}
    });
  }
  window.AospMindmap={
    setup:getContext=>{context=getContext();bind();},
    setContext:getContext=>{context=getContext();}
  };
})();

import { planArticleMove, rewriteMovedAssetLinks } from "./move.js";
import { planArticleDelete } from "./delete.js";
import { planRename, rewriteRenameLinks } from "./rename.js";
/**
 * AOSP Notes Studio API - Cloudflare Worker.
 * Security model: GitHub OAuth + owner check + hard-coded single repository.
 * OAuth tokens stay in KV, not in browser; browser only receives opaque 6-hour session ID.
 * REQUIRED env secrets: GITHUB_CLIENT_SECRET. Bind KV SESSIONS before deploy.
 */
const DEFAULT_REPO = "maoqb/Notes";
const SESSION_SECONDS = 6*60*60;
const utf8 = new TextEncoder();
function json(value,status=200,headers={}) {
  return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
}
function randomKey() { const a=new Uint8Array(32);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join(""); }
function isValidPath(path){
  if(typeof path!=="string" || !path || path.length>450 || path.startsWith("/") || path.includes("\\")
    || path.includes("\0") || /(^|\/)\.{1,2}(\/|$)/.test(path)) return false;
  const folders=["wms","Input","binder","servicemanager","cpp","winscope","环境搭建","日志&命令","窗口动画","开机动画","截屏","media"];
  if(!folders.some(x=>path.startsWith(x+"/")))return false;
  return /\.(md|png|jpg|jpeg|gif|webp|svg|drawio|mmd)$/i.test(path);
}
function cors(request,env){
  const origin=request.headers.get("Origin");
  return origin===env.EDITOR_ORIGIN ? {
    "Access-Control-Allow-Origin":env.EDITOR_ORIGIN,
    "Access-Control-Allow-Headers":"Authorization,Content-Type",
    "Access-Control-Allow-Methods":"GET,PUT,POST,OPTIONS",
    "Vary":"Origin"
  }:{};
}
async function github(token,path,method="GET",body){
  const reply=await fetch("https://api.github.com"+path,{
    method,headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28","User-Agent":"aosp-notes-studio",
      ...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await reply.json().catch(()=>({}));
  if(!reply.ok) {
    const error=new Error((data.message||"GitHub API returned "+reply.status));
    error.status=reply.status;throw error;
  }
  return data;
}
function callbackUrl(req){return new URL("/auth/callback",new URL(req.url).origin).toString();}
async function startLogin(req,env) {
  if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.EDITOR_ORIGIN||!env.SESSIONS) return json({error:"Worker OAuth environment is not configured"},503);
  const state=randomKey();
  await env.SESSIONS.put("state:"+state,"1",{expirationTtl:600});
  const url=new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id",env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri",callbackUrl(req));
  url.searchParams.set("state",state);
  url.searchParams.set("scope","repo"); // GitHub OAuth Apps require broad repo scope to access a private repository.
  url.searchParams.set("allow_signup","false");
  return new Response(null,{status:302,headers:{
    "Location":url.toString(),"Cache-Control":"no-store",
    "Set-Cookie":"__Host-notes_state="+state+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600"
  }});
}
async function oauthCallback(req,env) {
  const u=new URL(req.url);
  const code=u.searchParams.get("code"),state=u.searchParams.get("state");
  const cookie=req.headers.get("Cookie")||"";
  const match=cookie.match(/(?:^|;\s*)__Host-notes_state=([0-9a-f]{64})(?:;|$)/);
  if(!code||!state||!match||match[1]!==state)return json({error:"OAuth state verification failed"},403);
  const key="state:"+state;
  if(!(await env.SESSIONS.get(key)))return json({error:"OAuth state expired or already used"},403);
  await env.SESSIONS.delete(key);
  const response=await fetch("https://github.com/login/oauth/access_token",{
    method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json","User-Agent":"aosp-notes-studio"},
    body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,
      redirect_uri:callbackUrl(req)})
  });
  const result=await response.json();
  if(!result.access_token)return json({error:"GitHub OAuth exchange failed"},403);
  const user=await github(result.access_token,"/user");
  if(user.login!=="maoqb")return json({error:"Only maoqb may edit this repository"},403);
  // Verify the exact target repository can be read with this grant.
  await github(result.access_token,"/repos/"+DEFAULT_REPO);
  const session=randomKey();
  await env.SESSIONS.put("session:"+session,JSON.stringify({token:result.access_token,user:user.login}),{expirationTtl:SESSION_SECONDS});
  const target=env.EDITOR_URL+"#session="+encodeURIComponent(session);
  return new Response(null,{status:302,headers:{
    "Location":target,"Cache-Control":"no-store","Referrer-Policy":"no-referrer",
    "Set-Cookie":"__Host-notes_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  }});
}
async function sessionFrom(req,env){
  const m=(req.headers.get("Authorization")||"").match(/^Bearer ([0-9a-f]{64})$/);
  if(!m)return null;
  const item=await env.SESSIONS.get("session:"+m[1]);
  if(!item)return null;
  const session=JSON.parse(item);
  return session.user==="maoqb" ? session : null;
}
async function api(req,env){
  if(!env.SESSIONS)return json({error:"Missing SESSIONS KV binding"},503);
  const session=await sessionFrom(req,env);
  if(!session)return json({error:"Session expired; sign in again"},401);
  const u=new URL(req.url);
  const prefix="/repos/"+DEFAULT_REPO;
  if(u.pathname==="/api/capabilities"&&req.method==="GET")return json({move:true,delete:true,rename:true});
  if(u.pathname==="/api/tree"&&req.method==="GET"){
    const tree=await github(session.token,prefix+"/git/trees/main?recursive=1");
    if(tree.truncated)return json({error:"Repository tree is truncated"},500);
    return json({tree:tree.tree.map(({path,type,sha,size})=>({path,type,sha,size}))});
  }
  if(u.pathname==="/api/file"&&req.method==="GET"){
    const path=u.searchParams.get("path");
    if(!isValidPath(path))return json({error:"Invalid path"},400);
    const item=await github(session.token,prefix+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref=main");
    if(item.type!=="file"||!item.content)return json({error:"File is not readable via contents API"},400);
    return json({path:item.path,sha:item.sha,content:item.content,encoding:item.encoding});
  }
  if(u.pathname==="/api/rename"&&req.method==="POST"){
    if(Number(req.headers.get("Content-Length")||0)>4096)return json({error:"Invalid rename request"},413);
    const payload=await req.json().catch(()=>null);
    const {kind,source,newName,sha:expectedSha}=payload||{};
    const path=kind==="folder"?source+"/.folder.md":source;
    if(!isValidPath(path)||typeof expectedSha!=="string"||!/^[0-9a-f]{40}$/.test(expectedSha)||
      (kind!=="folder"&&kind!=="article")||
      (kind==="folder"&&(source.split("/").length<2||source.split("/")[1]==="assets"))||
      (kind==="article"&&(!source.endsWith(".md")||source.endsWith("/.folder.md"))))
      return json({error:"重命名请求无效"},400);
    const ref=await github(session.token,prefix+"/git/ref/heads/main");
    const head=ref.object.sha;
    const commit=await github(session.token,prefix+"/git/commits/"+head);
    const tree=await github(session.token,prefix+"/git/trees/"+commit.tree.sha+"?recursive=1");
    if(tree.truncated)return json({error:"仓库目录树过大，已取消重命名"},409);
    const entries=tree.tree;
    const sourceEntry=entries.find(e=>e.path===source&&e.type===(kind==="folder"?"tree":"blob"));
    if(!sourceEntry||sourceEntry.sha!==expectedSha)return json({error:"来源已更改，请同步目录后重试"},409);
    let plan;
    try{plan=planRename(kind,source,newName,entries);}
    catch(e){return json({error:e.message},409);}
    const markdown=entries.filter(e=>e.type==="blob"&&e.path.endsWith(".md")&&!e.path.includes("/assets/")&&!e.path.endsWith("/.folder.md"));
    if(markdown.length>250)return json({error:"笔记过多，无法安全检查全部链接"},413);
    const changes=new Map();
    const moved=new Map(plan.mappings.map(e=>[e.old,e]));
    for(const m of plan.mappings){
      changes.set(m.old,{path:m.old,mode:"100644",type:"blob",sha:null});
      changes.set(m.path,{path:m.path,mode:"100644",type:"blob",sha:m.sha});
    }
    // Check and rewrite links across all Markdown articles, not just the renamed one.
    // Fetch immutable blob SHAs from the same base tree to avoid mixing revisions.
    let linkEdits=0;
    for(let start=0;start<markdown.length;start+=8){
      const batch=markdown.slice(start,start+8);
      await Promise.all(batch.map(async entry=>{
        const obj=await github(session.token,prefix+"/git/blobs/"+entry.sha);
        if(obj.encoding!=="base64")throw Error("无法读取 Markdown: "+entry.path);
        const bytes=Uint8Array.from(atob(obj.content.replace(/\\s/g,"")),c=>c.charCodeAt(0));
        const original=new TextDecoder().decode(bytes);
        const newPath=moved.get(entry.path)?.path||entry.path;
        const rewritten=rewriteRenameLinks(original,entry.path,newPath,plan);
        if(rewritten===original)return;
        const data=new TextEncoder().encode(rewritten);
        let binary="";
        for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
        const blob=await github(session.token,prefix+"/git/blobs","POST",{content:btoa(binary),encoding:"base64"});
        changes.set(newPath,{path:newPath,mode:"100644",type:"blob",sha:blob.sha});
        linkEdits++;
      }));
    }
    if(changes.size>1250)return json({error:"变更文件过多，已取消重命名"},413);
    const nextTree=await github(session.token,prefix+"/git/trees","POST",{
      base_tree:commit.tree.sha,tree:[...changes.values()]
    });
    const nextCommit=await github(session.token,prefix+"/git/commits","POST",{
      message:"docs: rename "+source+" to "+plan.target+" via Notes Studio",
      tree:nextTree.sha,parents:[head]
    });
    try{
      await github(session.token,prefix+"/git/refs/heads/main","PATCH",{sha:nextCommit.sha,force:false});
    }catch(e){
      if(e.status===422)return json({error:"仓库在重命名期间发生变化，请同步后重试"},409);
      throw e;
    }
    return json({kind,source,target:plan.target,articleCount:plan.articleCount,
      assetCount:plan.assetCount,linkEdits,commit:nextCommit.sha});
  }
  if(u.pathname==="/api/delete"&&req.method==="POST"){
    if(Number(req.headers.get("Content-Length")||0)>4096)return json({error:"Invalid delete request"},413);
    const payload=await req.json().catch(()=>null);
    const path=payload?.path,expectedSha=payload?.sha;
    if(!isValidPath(path)||!path.endsWith(".md")||path.endsWith("/.folder.md")||
       typeof expectedSha!=="string"||!/^[0-9a-f]{40}$/.test(expectedSha))
      return json({error:"Invalid article path or source revision"},400);
    // Read a single immutable base commit, check the document's latest revision
    // and remove article plus its dedicated assets in one atomic Git commit.
    const ref=await github(session.token,prefix+"/git/ref/heads/main");
    const head=ref.object.sha;
    const commit=await github(session.token,prefix+"/git/commits/"+head);
    const tree=await github(session.token,prefix+"/git/trees/"+commit.tree.sha+"?recursive=1");
    if(tree.truncated)return json({error:"Repository tree too large to delete safely"},409);
    let plan;
    try{plan=planArticleDelete(path,tree.tree);}
    catch(e){return json({error:e.message},409);}
    if(plan.sourceSha!==expectedSha)return json({error:"Source changed since listing; refresh and retry"},409);
    if(plan.mappings.length>500)return json({error:"Too many associated assets to delete"},413);
    const changes=plan.mappings.map(e=>({path:e.path,mode:"100644",type:"blob",sha:null}));
    const nextTree=await github(session.token,prefix+"/git/trees","POST",{
      base_tree:commit.tree.sha,tree:changes
    });
    const nextCommit=await github(session.token,prefix+"/git/commits","POST",{
      message:"docs: delete "+path+" via Notes Studio",tree:nextTree.sha,parents:[head]
    });
    try{
      await github(session.token,prefix+"/git/refs/heads/main","PATCH",{
        sha:nextCommit.sha,force:false
      });
    }catch(e){
      if(e.status===422)return json({error:"Repository changed during delete; refresh and retry"},409);
      throw e;
    }
    return json({path,deletedAssets:plan.assetCount,commit:nextCommit.sha});
  }
  if(u.pathname==="/api/move"&&req.method==="POST"){
    if(Number(req.headers.get("Content-Length")||0)>4096)return json({error:"Invalid move request"},413);
    const body=await req.json();
    const source=body?.source, destinationFolder=body?.destinationFolder;
    const expectedSha=body?.sha;
    if(!isValidPath(source)||!source.endsWith(".md")||source.endsWith("/.folder.md")||
       typeof destinationFolder!=="string"||!isValidPath(destinationFolder+"/.folder.md")||
       typeof expectedSha!=="string"||!/^[0-9a-f]{40}$/.test(expectedSha))
      return json({error:"Invalid move paths or source revision"},400);
    if(destinationFolder.split("/")[1]==="assets")
      return json({error:"Cannot move article into an assets directory"},400);

    // Use a single Git commit for the deletion and creation of all paths:
    // no half-moved article if a source or asset conflicts.
    const ref=await github(session.token,prefix+"/git/ref/heads/main");
    const head=ref.object.sha;
    const commit=await github(session.token,prefix+"/git/commits/"+head);
    const fullTree=await github(session.token,prefix+"/git/trees/"+commit.tree.sha+"?recursive=1");
    if(fullTree.truncated)return json({error:"Repository tree too large to move safely"},409);
    const files=fullTree.tree;
    const parentPaths=new Set(files.map(e=>e.path));
    if(!parentPaths.has(destinationFolder+"/.folder.md") &&
       !files.some(e=>e.type==="blob"&&e.path.startsWith(destinationFolder+"/")))
      return json({error:"Target folder does not exist"},409);
    let plan;
    try{plan=planArticleMove(source,destinationFolder,files);}
    catch(e){return json({error:e.message},409);}
    if(plan.sourceSha!==expectedSha)return json({error:"Source changed since listing; refresh and retry"},409);
    if(plan.mappings.length>500)return json({error:"Too many associated assets to move"},413);

    // Preserve the Markdown's own image / diagram references.
    const original=await github(session.token,prefix+"/contents/"+
       source.split("/").map(encodeURIComponent).join("/")+"?ref="+head);
    if(original.sha!==expectedSha||original.encoding!=="base64")
      return json({error:"Source revision mismatch or unreadable Markdown"},409);
    const raw=Uint8Array.from(atob(original.content.replace(/\s/g,"")),c=>c.charCodeAt(0));
    const markdown=new TextDecoder().decode(raw);
    const rewritten=rewriteMovedAssetLinks(markdown,plan.oldAsset,plan.newAsset);
    let articleSha=plan.sourceSha;
    if(rewritten!==markdown){
      const bytes=new TextEncoder().encode(rewritten);
      let binary="";
      for(let i=0;i<bytes.length;i+=8192)
        binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const created=await github(session.token,prefix+"/git/blobs","POST",{
        content:btoa(binary),encoding:"base64"
      });
      articleSha=created.sha;
    }

    const changes=[];
    for(const moved of plan.mappings){
      changes.push({path:moved.old,mode:"100644",type:"blob",sha:null});
      changes.push({path:moved.path,mode:"100644",type:"blob",
        sha:moved.article?articleSha:moved.sha});
    }
    const nextTree=await github(session.token,prefix+"/git/trees","POST",{
      base_tree:commit.tree.sha,tree:changes
    });
    const nextCommit=await github(session.token,prefix+"/git/commits","POST",{
      message:"docs: move "+source+" to "+plan.target+" via Notes Studio",
      tree:nextTree.sha,parents:[head]
    });
    try{
      await github(session.token,prefix+"/git/refs/heads/main","PATCH",{
        sha:nextCommit.sha,force:false
      });
    }catch(e){
      if(e.status===422)return json({error:"Repository changed during move; refresh and retry"},409);
      throw e;
    }
    return json({source:plan.source,target:plan.target,sha:articleSha,
      movedAssets:plan.assetCount,commit:nextCommit.sha});
  }
  if(u.pathname==="/api/file"&&req.method==="PUT"){
    if(Number(req.headers.get("Content-Length")||0)>7*1024*1024)return json({error:"File too large"},413);
    const payload=await req.json();
    if(!isValidPath(payload?.path) || !/^[a-zA-Z0-9+/=\r\n]+$/.test(payload?.content||"")
      || payload.content.length>6*1024*1024)return json({error:"Invalid content or path"},400);
    const item=await github(session.token,prefix+"/contents/"+payload.path.split("/").map(encodeURIComponent).join("/"),"PUT",{
      message: String(payload.message||"docs: edit via Notes Studio").slice(0,140),
      content:payload.content.replace(/[\r\n]/g,""), branch:"main",
      ...(payload.sha?{sha:payload.sha}:{})
    });
    return json({sha:item.content?.sha,content_sha:item.content?.sha,commit:item.commit?.sha});
  }
  return json({error:"Unknown API endpoint"},404);
}
export default {
  async fetch(req,env) {
    try{
      const url=new URL(req.url);
      if(req.method==="OPTIONS"){
        return new Response(null,{status:204,headers:cors(req,env)});
      }
      if(url.pathname==="/auth/start"&&req.method==="GET")return startLogin(req,env);
      if(url.pathname==="/auth/callback"&&req.method==="GET")return oauthCallback(req,env);
      if(url.pathname==="/health")return json({ok:true,repo:DEFAULT_REPO});
      if(url.pathname.startsWith("/api/")){
        if(req.headers.get("Origin")!==env.EDITOR_ORIGIN)return json({error:"Origin is not allowed"},403);
        const response=await api(req,env);
        const headers=new Headers(response.headers);
        for(const [k,v] of Object.entries(cors(req,env)))headers.set(k,v);
        return new Response(response.body,{status:response.status,headers});
      }
      return json({error:"Not found"},404);
    }catch(e){
      return json({error:e.message||"Internal error"},e.status>=400&&e.status<600?e.status:500,
        req.url.includes("/api/")?cors(req,env):{});
    }
  }
};

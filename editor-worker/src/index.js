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
    "Access-Control-Allow-Methods":"GET,PUT,OPTIONS",
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
  const target=env.EDITOR_ORIGIN+"/editor/#session="+encodeURIComponent(session);
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

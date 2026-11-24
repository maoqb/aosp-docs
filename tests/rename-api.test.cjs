const test=require("node:test");
const assert=require("node:assert/strict");
const SHA="a".repeat(40),HEAD="b".repeat(40),TREE="c".repeat(40),NEW="d".repeat(40);
const blob=(path,sha=SHA)=>({path,type:"blob",sha,mode:"100644"});
const folder=(path,sha=SHA)=>({path,type:"tree",sha,mode:"040000"});
const prefix="/repos/maoqb/Notes";
async function request(kind,source,newName,sha=SHA){
 const worker=(await import("../editor-worker/src/index.js")).default;
 const req=new Request("https://test.workers.dev/api/rename",{
  method:"POST",headers:{"Origin":"https://maoqb.github.io",
   "Authorization":"Bearer "+"1".repeat(64),"Content-Type":"application/json"},
  body:JSON.stringify({kind,source,newName,sha})
 });
 const res=await worker.fetch(req,{EDITOR_ORIGIN:"https://maoqb.github.io",
  SESSIONS:{get:async()=>JSON.stringify({token:"TEST",user:"maoqb"})}});
 return {status:res.status,body:await res.json()};
}
function mock(entries,contents){
 const original=global.fetch,changes=[],commits=[];
 let updates=0;
 global.fetch=async(url,opts={})=>{
  const u=new URL(url),p=decodeURIComponent(u.pathname.slice(prefix.length));
  const body=opts.body?JSON.parse(opts.body):{};
  const output=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"Content-Type":"application/json"}});
  if(p==="/git/ref/heads/main")return output({object:{sha:HEAD}});
  if(p==="/git/commits/"+HEAD)return output({tree:{sha:TREE}});
  if(p==="/git/trees/"+TREE)return output({tree:entries,truncated:false});
  if(p.startsWith("/git/blobs/")){
   const sha=p.slice("/git/blobs/".length);
   const source=contents[sha]||"";
   return output({encoding:"base64",content:Buffer.from(source).toString("base64")});
  }
  if(p==="/git/blobs"&&opts.method==="POST"){
   return output({sha:NEW});
  }
  if(p==="/git/trees"&&opts.method==="POST"){changes.push(body);return output({sha:"e".repeat(40)});}
  if(p==="/git/commits"&&opts.method==="POST"){commits.push(body);return output({sha:"f".repeat(40)});}
  if(p==="/git/refs/heads/main"&&opts.method==="PATCH"){updates++;return output({});}
  return output({message:"Unexpected "+p},500);
 };
 return {changes,commits,get updates(){return updates;},restore(){global.fetch=original}};
}
test("rename document, assets and linked Markdown in a single Git commit",async()=>{
 const gh=mock([folder("wms/a"),blob("wms/a/old.md"),blob("wms/a/ref.md"),
  blob("wms/assets/a/old/g.svg")],{[SHA]:"[old](/aosp-docs/Notes/wms/a/old.md)"});
 try{
  const result=await request("article","wms/a/old.md","new");
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.body.target,"wms/a/new.md");
  assert.equal(gh.updates,1);
  assert.equal(gh.commits.length,1);
  const changes=gh.changes[0].tree;
  assert.ok(changes.some(e=>e.path==="wms/a/old.md"&&e.sha===null));
  assert.ok(changes.some(e=>e.path==="wms/a/new.md"&&e.sha===NEW));
  assert.ok(changes.some(e=>e.path==="wms/assets/a/new/g.svg"));
 }finally{gh.restore();}
});
test("folder rename source SHA mismatch refuses mutation",async()=>{
 const gh=mock([folder("wms/a"),blob("wms/a/.folder.md")],{});
 try{
  const r=await request("folder","wms/a","b","9".repeat(40));
  assert.equal(r.status,409);assert.equal(gh.updates,0);assert.equal(gh.commits.length,0);
 }finally{gh.restore();}
});

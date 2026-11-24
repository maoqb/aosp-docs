const test=require("node:test");
const assert=require("node:assert/strict");
const SHA="a".repeat(40);
const blob=(path,sha=SHA)=>({path,type:"blob",mode:"100644",sha});
const prefix="https://api.github.com/repos/maoqb/Notes";
function mockGitHub(initial){
 let tree=initial,createdTrees=[],refsUpdated=0,callIndex=[];
 const original=global.fetch;
 global.fetch=async(url,options={})=>{
  const u=new URL(url),p=u.pathname.slice("/repos/maoqb/Notes".length);
  const body=options.body?JSON.parse(options.body):{};
  callIndex.push({method:options.method||"GET",path:p,body});
  const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
  if(p==="/git/ref/heads/main")return response({object:{sha:"b".repeat(40)}});
  if(p==="/git/commits/"+"b".repeat(40))return response({tree:{sha:"c".repeat(40)}});
  if(p.startsWith("/git/trees/"+"c".repeat(40)))return response({truncated:false,tree});
  if(p==="/contents/wms%2Fa%2Ftest.md"||p==="/contents/wms/a/test.md"){
   return response({sha:SHA,encoding:"base64",content:Buffer.from("![x](https://maoqb.github.io/aosp-docs/Notes/wms/assets/a/test/image.svg)").toString("base64")});
  }
  if(p==="/git/blobs"&&options.method==="POST")return response({sha:"d".repeat(40)});
  if(p==="/git/trees"&&options.method==="POST"){
   createdTrees.push(body);
   return response({sha:"e".repeat(40)});
  }
  if(p==="/git/commits"&&options.method==="POST")return response({sha:"f".repeat(40)});
  if(p==="/git/refs/heads/main"&&options.method==="PATCH"){
   refsUpdated++;return response({object:{sha:body.sha}});
  }
  return response({message:"Unexpected mock API path: "+p},500);
 };
 return {createdTrees,get refsUpdated(){return refsUpdated},callIndex,restore(){global.fetch=original}};
}
async function workerRequest(source,target,sha=SHA){
 const worker=(await import("../editor-worker/src/index.js")).default;
 const req=new Request("https://test.workers.dev/api/move",{
  method:"POST",headers:{"Origin":"https://maoqb.github.io","Authorization":"Bearer "+"1".repeat(64),"Content-Type":"application/json"},
  body:JSON.stringify({source,destinationFolder:target,sha})
 });
 const res=await worker.fetch(req,{
   EDITOR_ORIGIN:"https://maoqb.github.io",
   SESSIONS:{get:async()=>JSON.stringify({token:"MOCK-TOKEN",user:"maoqb"})}
 });
 return {status:res.status,body:await res.json()};
}
test("Worker moves Markdown, image and drawio together using one git commit",async()=>{
 const gh=mockGitHub([blob("wms/a/test.md"),blob("wms/a/.folder.md"),blob("wms/b/.folder.md"),
  blob("wms/assets/a/test/image.svg"),blob("wms/assets/a/test/one.drawio")]);
 try{
  const out=await workerRequest("wms/a/test.md","wms/b");
  assert.equal(out.status,200,JSON.stringify(out));
  assert.equal(out.body.target,"wms/b/test.md");
  assert.equal(out.body.movedAssets,2);
  assert.equal(gh.createdTrees.length,1);
  assert.equal(gh.refsUpdated,1);
  const changes=gh.createdTrees[0].tree;
  assert.equal(changes.length,6);
  assert.equal(changes.filter(x=>x.sha===null).length,3);
  assert.ok(changes.some(x=>x.path==="wms/assets/b/test/one.drawio"));
  assert.ok(changes.some(x=>x.path==="wms/b/test.md"&&x.sha==="d".repeat(40)));
 }finally{gh.restore();}
});
test("Worker accepts an existing Git tree directory as the move destination",async()=>{
 const gh=mockGitHub([blob("wms/a/test.md"),{path:"wms/b",type:"tree",mode:"040000",sha:"e".repeat(40)},
  blob("wms/b/.folder.md"),blob("wms/assets/a/test/image.svg")]);
 try{
  const out=await workerRequest("wms/a/test.md","wms/b");
  assert.equal(out.status,200,JSON.stringify(out));
  assert.equal(out.body.target,"wms/b/test.md");
  assert.equal(out.body.movedAssets,1);
  assert.equal(gh.refsUpdated,1);
 }finally{gh.restore();}
});
test("Move planner rejects a blob occupying destination folder",async()=>{
 const gh=mockGitHub([blob("wms/a/test.md"),blob("wms/b"),blob("wms/b/.folder.md")]);
 try{
  const out=await workerRequest("wms/a/test.md","wms/b");
  assert.equal(out.status,409);
  assert.match(out.body.error,/目标路径被文件占用/);
  assert.equal(gh.refsUpdated,0);
 }finally{gh.restore();}
});
test("Worker refuses target collision and leaves repository untouched",async()=>{
 const gh=mockGitHub([blob("wms/a/test.md"),blob("wms/b/.folder.md"),blob("wms/b/test.md")]);
 try{
  const out=await workerRequest("wms/a/test.md","wms/b");
  assert.equal(out.status,409);assert.equal(gh.refsUpdated,0);
  assert.equal(gh.createdTrees.length,0);
 }finally{gh.restore();}
});
test("Worker rejects stale source revisions",async()=>{
 const gh=mockGitHub([blob("wms/a/test.md"),blob("wms/b/.folder.md")]);
 try{
  const out=await workerRequest("wms/a/test.md","wms/b","f".repeat(40));
  assert.equal(out.status,409);assert.equal(gh.refsUpdated,0);
 }finally{gh.restore();}
});

const test=require("node:test");
const assert=require("node:assert/strict");
const SHA="a".repeat(40);
const blob=(path,sha=SHA)=>({path,type:"blob",mode:"100644",sha});
const SHA_HEAD="b".repeat(40),SHA_TREE="c".repeat(40);
async function workerRequest(path,sha=SHA,tree=[]){
 const original=global.fetch, calls=[],changes=[];
 global.fetch=async(url,opts={})=>{
  const u=new URL(url),p=u.pathname.slice("/repos/maoqb/Notes".length);
  const payload=opts.body?JSON.parse(opts.body):{};
  calls.push({path:p,method:opts.method||"GET"});
  const ok=v=>new Response(JSON.stringify(v),{status:200});
  if(p==="/git/ref/heads/main")return ok({object:{sha:SHA_HEAD}});
  if(p==="/git/commits/"+SHA_HEAD)return ok({tree:{sha:SHA_TREE}});
  if(p==="/git/trees/"+SHA_TREE)return ok({tree,truncated:false});
  if(p==="/git/trees"&&opts.method==="POST"){changes.push(payload);return ok({sha:"d".repeat(40)});}
  if(p==="/git/commits"&&opts.method==="POST")return ok({sha:"e".repeat(40)});
  if(p==="/git/refs/heads/main"&&opts.method==="PATCH")return ok({object:{sha:payload.sha}});
  return new Response(JSON.stringify({message:"Unexpected: "+p}),{status:500});
 };
 try{
  const worker=(await import("../editor-worker/src/index.js")).default;
  const request=new Request("https://test.workers.dev/api/delete",{
   method:"POST",headers:{"Origin":"https://maoqb.github.io","Authorization":"Bearer "+"1".repeat(64),"Content-Type":"application/json"},
   body:JSON.stringify({path,sha})
  });
  const resp=await worker.fetch(request,{EDITOR_ORIGIN:"https://maoqb.github.io",
   SESSIONS:{get:async()=>JSON.stringify({token:"TEST",user:"maoqb"})}});
  return {status:resp.status,result:await resp.json(),calls,changes};
 }finally{global.fetch=original;}
}
test("delete article plus dedicated assets in exactly one Git commit",async()=>{
 const out=await workerRequest("wms/a/One.md",SHA,[
  blob("wms/a/One.md"),blob("wms/assets/a/One/diagram.drawio"),
  blob("wms/assets/a/One/image.svg"),blob("wms/assets/a/Other/keep.svg"),
  blob("wms/a/Another.md")
 ]);
 assert.equal(out.status,200,JSON.stringify(out.result));
 assert.equal(out.result.deletedAssets,2);
 assert.equal(out.changes.length,1);
 assert.deepEqual(out.changes[0].tree.map(e=>e.path),[
  "wms/a/One.md","wms/assets/a/One/diagram.drawio","wms/assets/a/One/image.svg"
 ]);
 assert.ok(out.changes[0].tree.every(e=>e.sha===null));
 assert.equal(out.calls.filter(e=>e.path==="/git/commits"&&e.method==="POST").length,1);
 assert.equal(out.calls.filter(e=>e.path==="/git/refs/heads/main"&&e.method==="PATCH").length,1);
});
test("stale SHA refuses delete without mutation",async()=>{
 const out=await workerRequest("wms/One.md","f".repeat(40),[blob("wms/One.md")]);
 assert.equal(out.status,409);
 assert.equal(out.changes.length,0);
 assert.ok(!out.calls.some(e=>e.method==="PATCH"));
});
test("nonexistent document refuses delete",async()=>{
 const out=await workerRequest("wms/Missing.md",SHA,[blob("wms/Other.md")]);
 assert.equal(out.status,409);assert.equal(out.changes.length,0);
});
test("folder marker cannot be deleted",async()=>{
 const out=await workerRequest("wms/a/.folder.md",SHA,[blob("wms/a/.folder.md")]);
 assert.equal(out.status,400);assert.equal(out.calls.length,0);
});
test("only whitelisted document paths are accepted",async()=>{
 const out=await workerRequest("unknown/One.md",SHA,[blob("unknown/One.md")]);
 assert.equal(out.status,400);assert.equal(out.calls.length,0);
});

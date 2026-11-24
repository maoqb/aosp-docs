const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const folders=require("../editor/folder-tree.js");
const b=p=>({path:p,type:"blob",sha:"a".repeat(40)});
const roots=["wms","binder"];
test("UI plan allows moving a Markdown file between nested folders",()=>{
 const tree=[b("wms/a/note.md"),b("wms/a/.folder.md"),b("wms/b/.folder.md"),b("wms/assets/a/note/one.svg")];
 const p=folders.planMove("wms/a/note.md","wms/b",tree,roots);
 assert.equal(p.destination,"wms/b/note.md");
 assert.equal(p.assetCount,1);
 assert.equal(p.sha,"a".repeat(40));
});
test("UI disallows moving unsaved, same-folder, target conflicts, and asset conflicts",()=>{
 const tree=[b("wms/a/note.md"),b("wms/b/other.md"),b("wms/b/note.md"),b("wms/assets/a/note/one.svg")];
 assert.throws(()=>folders.planMove("wms/a/missing.md","wms/b",tree,roots));
 assert.throws(()=>folders.planMove("wms/a/note.md","wms/a",tree,roots));
 assert.throws(()=>folders.planMove("wms/a/note.md","wms/b",tree,roots));
 tree.splice(tree.findIndex(e=>e.path==="wms/b/note.md"),1);
 tree.push(b("wms/assets/b/note/one.svg"));
 assert.throws(()=>folders.planMove("wms/a/note.md","wms/b",tree,roots));
 assert.throws(()=>folders.planMove("wms/a/note.md","wms/missing",tree,roots));
});
test("server produces one atomic rename plan for the article and all binary assets",async()=>{
 const {planArticleMove,rewriteMovedAssetLinks}=await import("../editor-worker/src/move.js");
 const tree=[b("wms/a/note.md"),b("wms/a/.folder.md"),b("wms/b/.folder.md"),
 b("wms/assets/a/note/one.svg"),b("wms/assets/a/note/one.drawio"),b("wms/assets/a/note/drawing.mmd")];
 const plan=planArticleMove("wms/a/note.md","wms/b",tree);
 assert.equal(plan.target,"wms/b/note.md");
 assert.equal(plan.assetCount,3);
 assert.equal(plan.mappings.length,4);
 assert.ok(plan.mappings.some(x=>x.path==="wms/assets/b/note/one.drawio"));
 assert.ok(plan.mappings.some(x=>x.path==="wms/assets/b/note/drawing.mmd"));
 const old="https://maoqb.github.io/aosp-docs/Notes/"+["wms","assets","a","note","one.svg"].map(encodeURIComponent).join("/");
 const rewritten=rewriteMovedAssetLinks("![drawing]("+old+")","wms/assets/a/note/","wms/assets/b/note/");
 assert.match(rewritten,/wms\/assets\/b\/note\/one.svg/);
 assert.doesNotMatch(rewritten,/wms\/assets\/a\/note\/one.svg/);
 assert.throws(()=>planArticleMove("wms/a/note.md","wms/a",tree));
 assert.throws(()=>planArticleMove("wms/a/note.md","wms/b",[...tree,b("wms/b/note.md")]));
 assert.throws(()=>planArticleMove("wms/a/note.md","wms/b",[...tree,b("wms/assets/b/note/one.svg")]));
});
test("move dialog and API integration are present, with no DOM contract gaps",()=>{
 const html=fs.readFileSync(path.resolve(__dirname,"../editor/index.html"),"utf8");
 const app=fs.readFileSync(path.resolve(__dirname,"../editor/app.js"),"utf8");
 const worker=fs.readFileSync(path.resolve(__dirname,"../editor-worker/src/index.js"),"utf8");
 for(const id of ["moveDialog","moveForm","moveSource","moveTarget","moveCancel","moveAssets","moveSubmit"]){
  assert.ok(html.includes('id="'+id+'"'));
 }
 assert.ok(app.includes('call("/move"'));
 assert.ok(worker.includes('req.method==="POST"'));
 assert.ok(worker.includes('force:false'));
 assert.ok(worker.includes("planArticleMove("));
});

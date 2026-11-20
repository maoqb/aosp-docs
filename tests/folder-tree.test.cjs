const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const sandbox={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../editor/folder-tree.js"),"utf8"),sandbox);
const folders=sandbox.module.exports;
const roots=["wms","binder","cpp"];
const blob=path=>({type:"blob",path});
test("create nested folder through an existing root using hidden Git-tracked marker",()=>{
  const tree=[blob("wms/WindowState.md"),blob("binder/Binder.md")];
  const req=folders.newFolder("wms","窗口动画",tree,roots);
  assert.equal(req.folder,"wms/窗口动画");
  assert.equal(req.marker,"wms/窗口动画/.folder.md");
  const next=[...tree,blob(req.marker)];
  assert.ok(folders.folderPaths(next,roots).includes(req.folder));
  const nested=folders.newFolder(req.folder,"Insets",next,roots);
  assert.equal(nested.marker,"wms/窗口动画/Insets/.folder.md");
});
test("marker not rendered as a user document",()=>{
  const tree=[blob("wms/a/.folder.md"),blob("wms/a/内容.md"),blob("wms/WindowState.md")];
  const files=folders.visibleArticles(tree,roots);
  assert.equal(files.length,2);
  assert.equal(files.some(f=>f.path.endsWith(".folder.md")),false);
  assert.equal(folders.foldersWithChildren(tree,roots).find(x=>x.path==="wms/a").articleCount,1);
});
test("new documents can target any existing nested folder",()=>{
  const files=[blob("wms/绘制流程/.folder.md")];
  const article=folders.newArticle("wms/绘制流程","finishDrawingWindow",files,roots);
  assert.equal(article,"wms/绘制流程/finishDrawingWindow.md");
  assert.throws(()=>folders.newArticle("wms/unknown","test",files,roots));
  assert.throws(()=>folders.newArticle("wms/绘制流程","finishDrawingWindow",[...files,blob(article)],roots));
});
test("reject invalid directories, unsupported roots and duplicates",()=>{
  const tree=[blob("wms/绘制流程/.folder.md")];
  for(const name of ["../escape","a/b","..",".","folder\\test","a?b",""])assert.throws(()=>folders.newFolder("wms",name,tree,roots));
  assert.throws(()=>folders.newFolder("other","foo",tree,roots));
  assert.throws(()=>folders.newFolder("wms","绘制流程",tree,roots));
});
test("editor includes both create actions and routes folder creation through authenticated API",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../editor/index.html"),"utf8");
  const app=fs.readFileSync(path.join(__dirname,"../editor/app.js"),"utf8");
  const build=fs.readFileSync(path.join(__dirname,"../scripts/prepare_docs.py"),"utf8");
  for(const id of ["newFolderBtn","folderDialog","folderForm","folderParent","folderName","newArticleDialog","newArticleForm","articleFolder"]){
    assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  }
  assert.ok(app.includes("NotesFolders.newFolder("));
  assert.ok(app.includes("await writeFile(request.marker,request.content)"));
  assert.ok(build.includes('relative.name == ".folder.md"'));
});

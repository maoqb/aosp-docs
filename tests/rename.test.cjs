const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../editor-worker/src/rename.js"),"utf8");
const {planRename,rewriteRenameLinks}=new Function(source.replaceAll("export function ","function ")+";return {planRename,rewriteRenameLinks}")();
const sha="a".repeat(40);
const blob=p=>({path:p,type:"blob",sha});
const folder=p=>({path:p,type:"tree",sha});
test("article rename moves dedicated graphics but preserves unrelated assets",()=>{
 const entries=[blob("wms/a/doc.md"),blob("wms/assets/a/doc/g.svg"),blob("wms/assets/a/doc/d.drawio"),blob("wms/assets/a/doc2/g.svg")];
 const p=planRename("article","wms/a/doc.md","new",entries);
 assert.equal(p.target,"wms/a/new.md");
 assert.equal(p.assetCount,2);
 assert.ok(p.mappings.some(e=>e.path==="wms/assets/a/new/d.drawio"));
 assert.ok(!p.mappings.some(e=>e.path.includes("doc2")));
});
test("nested folder rename recursively relocates children and matching assets",()=>{
 const entries=[folder("wms/a"),folder("wms/a/sub"),blob("wms/a/.folder.md"),blob("wms/a/sub/doc.md"),
 blob("wms/assets/a/sub/doc/i.svg"),blob("wms/assets/ab/sub/doc/i.svg")];
 const p=planRename("folder","wms/a","b",entries);
 assert.equal(p.target,"wms/b");
 assert.equal(p.articleCount,1);
 assert.equal(p.assetCount,1);
 assert.ok(p.mappings.some(e=>e.path==="wms/b/sub/doc.md"));
 assert.ok(p.mappings.some(e=>e.path==="wms/assets/b/sub/doc/i.svg"));
 assert.ok(!p.mappings.some(e=>e.old.includes("/assets/ab/")));
});
test("rename rejects collisions, invalid inputs and root/category renaming",()=>{
 const entries=[folder("wms/a"),folder("wms/b"),blob("wms/a/.folder.md"),blob("wms/a/test.md"),
 blob("wms/b/.folder.md"),blob("wms/a/new.md")];
 assert.throws(()=>planRename("folder","wms/a","b",entries),/已存在/);
 assert.throws(()=>planRename("article","wms/a/test.md","new",entries),/被占用|已存在/);
 assert.throws(()=>planRename("folder","wms","new",entries));
 assert.throws(()=>planRename("article","wms/a/test.md","../bad",entries));
 assert.throws(()=>planRename("folder","wms/a","assets",entries));
});
test("update public links, encoded links and relative markdown links",()=>{
 const p=planRename("article","wms/a/old.md","新名字",[blob("wms/a/old.md"),blob("wms/assets/a/old/i.svg")]);
 const text="![x](https://maoqb.github.io/aosp-docs/Notes/wms/assets/a/old/i.svg)\n"+
 "[doc](/aosp-docs/Notes/wms/a/old.md)\n"+
 "[local](./old.md)\n"+
 "[not renamed](./older.md)\n";
 const result=rewriteRenameLinks(text,"wms/a/ref.md","wms/a/ref.md",p);
 assert.ok(result.includes("/wms/assets/a/新名字/i.svg"));
 assert.ok(result.includes("/wms/a/新名字.md"));
 assert.ok(result.includes("[local](./%E6%96%B0%E5%90%8D%E5%AD%97.md)"));
 assert.ok(result.includes("[not renamed](./older.md)"));
});
test("rewrites relative links when an article moves with its renamed folder",()=>{
 const p=planRename("folder","wms/old","new",[folder("wms/old"),blob("wms/old/x.md"),blob("wms/other.md")]);
 const result=rewriteRenameLinks("[parent](../other.md) [self](./x.md)","wms/old/x.md","wms/new/x.md",p);
 assert.ok(result.includes("[parent](../other.md)"));
 assert.ok(result.includes("[self](./x.md)"));
});
test("rename controls are present with capability negotiation",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../editor/index.html"),"utf8");
 const app=fs.readFileSync(path.join(__dirname,"../editor/app.js"),"utf8");
 const worker=fs.readFileSync(path.join(__dirname,"../editor-worker/src/index.js"),"utf8");
 for(const id of ["renameDialog","renameForm","renameSource","renameName","renameSubmit"])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(app.includes('call("/rename"'));
 assert.ok(app.includes('folder-rename'));
 assert.ok(worker.includes('rename:true'));
});

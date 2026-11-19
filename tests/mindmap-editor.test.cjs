const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const sandbox={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../editor/mindmap-core.js"),"utf8"),sandbox);
const m=sandbox.module.exports;
test("visual editing: add child, sibling, rename and delete",()=>{
  const tree=m.create("WMS");
  const first=tree.children[0].id;
  const id=m.addChild(tree,first,"DisplayContent");
  assert.equal(m.find(tree,id).node.text,"DisplayContent");
  const peer=m.addSibling(tree,id,"TaskDisplayArea");
  assert.equal(m.find(tree,peer).node.text,"TaskDisplayArea");
  m.find(tree,peer).node.text="WindowContainer";
  assert.equal(m.find(tree,peer).node.text,"WindowContainer");
  assert.equal(m.remove(tree,id),true);
  assert.equal(m.find(tree,id),null);
  assert.equal(m.remove(tree,"root"),false);
});
test("Mermaid source preserves nested topic hierarchy",()=>{
  const tree=m.create("Framework");
  const mmd=m.mermaid(tree);
  assert.match(mmd,/^mindmap\n  root\(\(Framework\)\)/);
  const parsed=m.fromMermaid(mmd);
  assert.equal(parsed.text,"Framework");
  assert.deepEqual(Array.from(parsed.children,c=>c.text),["核心概念","实现流程","实践与调试"]);
});
test("SVG includes fully editable JSON and escapes special XML chars",()=>{
  const tree=m.create('WMS & <SF> "架构"');
  const svg=m.svg(tree);
  assert.match(svg,/&amp;/);
  assert.match(svg,/&lt;SF&gt;/);
  assert.match(svg,/id="aosp-mindmap-data"/);
  assert.doesNotMatch(svg,/<SF>/);
  const revived=m.fromSvg(svg);
  assert.equal(revived.text,tree.text);
  assert.equal(revived.children.length,3);
});
test("layout is stable for empty root and deep trees",()=>{
  const tree={id:"root",text:"Root",children:[]};
  const small=m.coordinates(tree);
  assert.equal(small.nodes.length,1);
  m.addChild(tree,"root","Level 1");
  m.addChild(tree,tree.children[0].id,"Level 2");
  const deep=m.coordinates(tree);
  assert.equal(deep.nodes.length,3);
  assert.equal(deep.edges.length,2);
  assert.ok(deep.width>small.width);
  assert.match(m.svg(tree),/<path d="M/);
});
test("matching paths and next unused filename respect Chinese article names",()=>{
  const article="wms/窗口层级树.md";
  const folder="wms/assets/窗口层级树/";
  const files=[
    {type:"blob",path:folder+"mindmap-001.mmd",sha:"A"},
    {type:"blob",path:folder+"mindmap-001.svg",sha:"B"},
    {type:"blob",path:folder+"mindmap-002.svg",sha:"C"}
  ];
  const entries=m.paths(article,files);
  assert.equal(entries.length,1);
  assert.equal(entries[0].sourceSha,"A");
  assert.equal(entries[0].svgSha,"B");
  assert.equal(m.next(article,files).source,folder+"mindmap-003.mmd");
});
test("missing preview remains editable as source",()=>{
  const article="binder/binder关键类.md";
  const f="binder/assets/binder关键类/mindmap-001.mmd";
  assert.equal(m.paths(article,[{path:f,type:"blob"}]).length,1);
  assert.equal(m.paths(article,[{path:f,type:"blob"}])[0].svgSha,null);
});
test("HTML contains working keyboard-driven visual mind map controls",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../editor/index.html"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"../editor/app.js"),"utf8");
  for(const id of ["mindmapBtn","mindmapPicker","mindmapDialog","mmCanvas","mmAddChild","mmAddSibling","mmRename","mmRemove","mmSave"])assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  assert.ok(!html.includes('id="colorBtn"'));
  assert.ok(js.includes('"color","header"'),"color toolbar belongs in Cherry Markdown");
  assert.ok(html.includes('mindmap-core.js'));
  assert.ok(html.includes('mindmap-editor.js'));
});

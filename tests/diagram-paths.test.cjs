const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const file=path.join(__dirname,"..","editor","diagram-paths.js");
const sandbox={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(file,"utf8"),sandbox,{filename:file});
const diagrams=sandbox.module.exports;

test("restore WMS original drawio-001.drawio with matching existing SVG",()=>{
  const article="wms/窗口层级树.md";
  const prefix="wms/assets/窗口层级树/drawio-001";
  const tree=[{type:"blob",path:prefix+".drawio",sha:"a"},{type:"blob",path:prefix+".svg",sha:"b"}];
  const md="![drawio 图表 1]("+diagrams.imageUrl(prefix+".svg")+")";
  const entries=diagrams.diagramEntries(article,tree,md);
  assert.equal(entries.length,1);
  assert.equal(entries[0].source,prefix+".drawio");
  assert.equal(entries[0].svg,prefix+".svg");
  assert.equal(entries[0].svgExists,true);
  assert.equal(entries[0].referenced,true);
  assert.equal(diagrams.nextDiagram(article,tree).source,"wms/assets/窗口层级树/drawio-002.drawio");
});

test("recover Binder diagram from exact article directory",()=>{
  const article="binder/binder关键类.md";
  const prefix="binder/assets/binder关键类/drawio-001";
  const files=[{type:"blob",path:prefix+".drawio"},{type:"blob",path:prefix+".svg"}];
  const results=diagrams.diagramEntries(article,files,"[源文件](./assets/binder关键类/drawio-001.drawio)");
  assert.equal(results.length,1);
  assert.equal(results[0].source,prefix+".drawio");
});

test("multiple drawings keep existing original names and ranked markdown images",()=>{
  const article="wms/窗口添加流程(app进程).md";
  const prefix="wms/assets/窗口添加流程(app进程)/";
  const tree=["drawio-001.drawio","drawio-001.svg","drawio-002.drawio","drawio-002.svg"].map(name=>({path:prefix+name,type:"blob"}));
  const markdown="![image]("+diagrams.imageUrl(prefix+"drawio-002.svg")+")";
  const entries=diagrams.diagramEntries(article,tree,markdown);
  assert.equal(entries.length,2);
  assert.equal(entries[0].source,prefix+"drawio-002.drawio");
  assert.equal(entries[0].svg,prefix+"drawio-002.svg");
  assert.equal(entries[0].referenced,true);
  assert.equal(diagrams.nextDiagram(article,tree).source,prefix+"drawio-003.drawio");
  assert.ok(diagrams.imageUrl(prefix+"drawio-001.svg").includes("%28app%E8%BF%9B%E7%A8%8B%29"));
});

test("skip a reserved SVG filename without a draw.io source",()=>{
  const article="wms/窗口层级树.md";
  const prefix=diagrams.assetFolder(article);
  const tree=[{type:"blob",path:prefix+"drawio-001.svg"}];
  assert.equal(diagrams.nextDiagram(article,tree).source,prefix+"drawio-002.drawio");
  assert.equal(diagrams.diagramEntries(article,tree,"").length,0);
});

test("ignore foreign files and refuse non-article paths",()=>{
  const a="binder/binder关键类.md";
  const tree=[{type:"blob",path:"wms/assets/窗口层级树/drawio-001.drawio"}];
  assert.equal(diagrams.diagramEntries(a,tree,"").length,0);
  assert.throws(()=>diagrams.assetFolder("../secret.md"));
});

test("missing SVG is reported without creating a new source",()=>{
  const file="wms/assets/窗口层级树/drawio-001.drawio";
  const results=diagrams.diagramEntries("wms/窗口层级树.md",[{type:"blob",path:file}],"");
  assert.equal(results.length,1);
  assert.equal(results[0].svgExists,false);
  assert.equal(results[0].source,file);
});

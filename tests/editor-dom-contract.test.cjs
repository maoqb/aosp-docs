const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"../editor");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const js=["app.js","mindmap-editor.js"].map(p=>fs.readFileSync(path.join(root,p),"utf8"));
test("every imperative HTML control referenced by JavaScript exists in the page",()=>{
  const ids=new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]));
  const referenced=new Set(js.flatMap(src=>Array.from(src.matchAll(/\$\("([^"]+)"\)/g),m=>m[1])));
  const missing=[...referenced].filter(id=>!ids.has(id));
  assert.deepEqual(missing,[],"missing DOM elements (fatal initialization error)");
});
test("OAuth session is captured before optional editor scripts are loaded",()=>{
  const bootstrap=html.indexOf("sessionStorage.setItem(\"notes-session\"");
  const cherry=html.indexOf("cherry-markdown.js");
  const main=html.indexOf("app.js?v=");
  assert.ok(bootstrap>0&&bootstrap<cherry&&cherry<main);
});
test("restore image upload input and ensure login is independent of JS handlers",()=>{
  assert.match(html,/<input id="uploadInput" type="file"/);
  assert.match(html,/<a id="loginBtn"[^>]+href="https:\/\/aosp-notes-api\.maoqb\.workers\.dev\/auth\/start"/);
});

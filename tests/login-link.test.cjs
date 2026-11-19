const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../editor/index.html"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"../editor/app.js"),"utf8");
test("OAuth login remains functional without JavaScript",()=>{
  assert.match(html,/<a\s+id="loginBtn"[^>]*href="https:\/\/aosp-notes-api\.maoqb\.workers\.dev\/auth\/start"/);
  assert.doesNotMatch(html,/<button\s+id="loginBtn"/);
});
test("logout prevents native navigation only when already logged in",()=>{
  assert.match(app,/\$\("loginBtn"\)\.onclick=\(event\)=>\{if\(session\)\{event\.preventDefault\(\)/);
});

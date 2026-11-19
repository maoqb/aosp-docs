const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../editor/index.html"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"../editor/app.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../editor/style.css"),"utf8");

test("GitHub login is a native anchor that always navigates without requiring JavaScript",()=>{
  assert.match(html,/<a\s+id="loginBtn"[^>]*href="https:\/\/aosp-notes-api\.maoqb\.workers\.dev\/auth\/start"/);
  assert.doesNotMatch(html,/<button\s+id="loginBtn"/);
});
test("logout is a distinct action and cannot intercept the OAuth link",()=>{
  assert.match(html,/<button\s+id="logoutBtn"[^>]*type="button" hidden/);
  assert.match(app,/\$\("logoutBtn"\)\.onclick=/);
  assert.doesNotMatch(app,/\$\("loginBtn"\)\.onclick=/);
  assert.match(app,/\$\("loginBtn"\)\.hidden = !!session/);
  assert.match(app,/\$\("logoutBtn"\)\.hidden = !session/);
  assert.match(css,/\.headtools \[hidden\]\{display:none!important\}/);
});
test("login asset URL uses new cache key to prevent stale JS click interception",()=>{
  assert.match(html,/app\.js\?v=oauth-session-bootstrap-20261120/);
  assert.match(html,/style\.css\?v=oauth-session-bootstrap-20261120/);
});

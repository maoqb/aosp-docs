const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const home=fs.readFileSync(path.resolve(__dirname,"../.vitepress/theme/HomeIndex.vue"),"utf8");
const config=fs.readFileSync(path.resolve(__dirname,"../.vitepress/config.mts"),"utf8");
test("book homepage uses full navigation for every static editor link",()=>{
  const links=Array.from(home.matchAll(/<a\s+[^>]*:href="withBase\('\/editor\/'\)"[^>]*>/g),x=>x[0]);
  assert.equal(links.length,2,"expected header and footer editor links");
  for(const link of links)assert.match(link,/target="_self"/);
});
test("top navigation editor link bypasses VitePress SPA router",()=>{
  assert.match(config,/text: '写作', link: '\/editor\/', target: '_self'/);
});

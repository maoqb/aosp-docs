const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async()=>{
  const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
  try{
    const url=process.env.PREVIEW_URL||"http://127.0.0.1:4173/aosp-docs/";
    const page=await browser.newPage();
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
    await page.getByRole("link",{name:"写作",exact:true}).click();
    await page.waitForURL("**/editor/",{timeout:15000});
    await page.waitForFunction(()=>document.title.includes("Notes Studio"),{timeout:15000});
    assert.match(await page.title(),/Notes Studio/);
    assert.ok(await page.locator("#loginBtn").count(),"editor standalone HTML must load, not VitePress 404");
    console.log("PASS: navbar -> standalone editor without refresh");

    await page.goto(url,{waitUntil:"domcontentloaded"});
    await page.getByRole("link",{name:/写作工作台/}).first().click();
    await page.waitForURL("**/editor/",{timeout:15000});
    await page.waitForFunction(()=>document.title.includes("Notes Studio"),{timeout:15000});
    assert.ok(await page.locator("#loginBtn").count());
    console.log("PASS: book home -> standalone editor without refresh");
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

const {chromium}=require("playwright");
const assert=require("node:assert/strict");
(async()=>{
  const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
  try{
    const page=await browser.newPage(),errors=[],writes=[];
    let tree=[{type:"blob",path:"wms/已有文章.md",sha:"oldsha"},{type:"blob",path:"binder/Binder.md",sha:"binder"}];
    page.on("pageerror",e=>errors.push(e.message));
    await page.route(/aosp-notes-api\.maoqb\.workers\.dev\/api\//,async route=>{
      const request=route.request(),url=new URL(request.url());
      const headers={"access-control-allow-origin":"*","content-type":"application/json"};
      if(url.pathname==="/api/tree")return route.fulfill({status:200,headers,body:JSON.stringify({tree})});
      if(url.pathname==="/api/file"&&request.method()==="PUT"){
        const data=JSON.parse(request.postData());
        writes.push(data);
        if(tree.some(x=>x.path===data.path))return route.fulfill({status:409,headers,body:'{"error":"conflict"}'});
        tree=[...tree,{type:"blob",path:data.path,sha:"created-"+writes.length}];
        return route.fulfill({status:200,headers,body:JSON.stringify({sha:"created-"+writes.length})});
      }
      return route.fulfill({status:404,headers,body:'{"error":"not mocked"}'});
    });
    const url=process.env.SMOKE_URL||"http://127.0.0.1:8765/editor/";
    await page.goto(url+"#session="+"a".repeat(64),{waitUntil:"domcontentloaded"});
    await page.waitForSelector('.folder-row',{timeout:20000});
    assert.equal(await page.locator("#newFolderBtn").isEnabled(),true);
    await page.locator("#newFolderBtn").click();
    await page.locator("#folderParent").selectOption("wms");
    await page.locator("#folderName").fill("窗口动画");
    await page.locator("#folderSubmit").click();
    await page.waitForFunction(()=>!document.querySelector("#folderDialog").open);
    assert.equal(writes[0].path,"wms/窗口动画/.folder.md");
    await page.getByRole("button",{name:/窗口动画/}).first().waitFor({timeout:5000});
    await page.locator("#newBtn").click();
    await page.locator("#articleFolder").selectOption("wms/窗口动画");
    await page.locator("#articleTitle").fill("WindowState 生命周期");
    await page.locator("#newArticleForm button[type=submit]").click();
    await page.waitForFunction(()=>document.querySelector("#currentPath")?.textContent?.includes("WindowState 生命周期"));
    assert.equal(await page.locator("#currentPath").textContent(),"wms/窗口动画/WindowState 生命周期.md");
    await page.locator("#saveBtn").click();
    await page.waitForFunction(()=>document.querySelector("#message")?.textContent?.includes("已提交到 GitHub"));
    assert.equal(writes[1].path,"wms/窗口动画/WindowState 生命周期.md");
    assert.deepEqual(errors,[]);
    console.log("SUCCESS: created nested folder, displayed it, created and saved article with no JS errors");
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

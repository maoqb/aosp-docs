const {chromium}=require("playwright");
const assert=require("node:assert/strict");
(async()=>{
 const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
 try {
  const page=await browser.newPage(),errors=[],requests=[],sha="a".repeat(40);
  let tree=[
   {type:"blob",path:"wms/a/test.md",sha},
   {type:"blob",path:"wms/a/.folder.md",sha},
   {type:"blob",path:"wms/b/.folder.md",sha},
   {type:"blob",path:"wms/assets/a/test/image.svg",sha}
  ];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("dialog",d=>d.accept());
  await page.route(/aosp-notes-api\.maoqb\.workers\.dev\/api\//,async route=>{
   const req=route.request(),url=new URL(req.url());
   const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
   const response=data=>route.fulfill({status:200,headers,body:JSON.stringify(data)});
   if(url.pathname==="/api/tree")return response({tree});
   if(url.pathname==="/api/file"&&req.method()==="GET"){
    const path=url.searchParams.get("path");
    return response({path,sha,content:Buffer.from("# Test\n\nbody","utf8").toString("base64")});
   }
   if(url.pathname==="/api/move"&&req.method()==="POST"){
    const request=JSON.parse(req.postData());
    requests.push(request);
    const source=request.source,target=request.destinationFolder+"/test.md";
    tree=tree.map(e=>e.path===source?{...e,path:target}:e.path==="wms/assets/a/test/image.svg"?{...e,path:"wms/assets/b/test/image.svg"}:e);
    return response({source,target,movedAssets:1,sha,commit:"b".repeat(40)});
   }
   return route.fulfill({status:404,headers,body:'{"error":"not mocked"}'});
  });
  await page.goto((process.env.SMOKE_URL||"http://127.0.0.1:8765/editor/")+"#session="+"1".repeat(64),{waitUntil:"domcontentloaded"});
  const button=page.getByRole("button",{name:"移动笔记 wms/a/test.md"});
  await button.waitFor({timeout:20000});
  await page.locator(".file-entry .file-item").first().click();
  await page.waitForFunction(()=>document.getElementById("currentPath")?.textContent==="wms/a/test.md");
  await button.click();
  await page.locator("#moveTarget").selectOption("wms/b");
  await page.locator("#moveForm button[type=submit]").click();
  await page.waitForFunction(()=>document.getElementById("currentPath")?.textContent==="wms/b/test.md");
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0],{source:"wms/a/test.md",destinationFolder:"wms/b",sha});
  assert.equal(await page.locator("#moveDialog").evaluate(e=>e.open),false);
  assert.equal(await page.getByRole("button",{name:"移动笔记 wms/b/test.md"}).count(),1);
  assert.equal(errors.length,0,"Browser JS errors: "+errors.join("; "));
  console.log("PASS: click move -> select destination -> atomic API -> new article reopens without refresh");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

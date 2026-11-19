const { chromium }=require("playwright");
(async()=>{
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
try{
 const page=await browser.newPage();
 const errors=[],logs=[],failed=[];
 page.on("pageerror",e=>errors.push(String(e)));
 page.on("console",m=>{if(m.type()==="error")logs.push(m.text());});
 page.on("requestfailed",r=>failed.push(r.url()+" => "+r.failure()?.errorText));
 await page.route(/aosp-notes-api\.maoqb\.workers\.dev\/api\//,route=>route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify({tree:[]})}));
 const url=process.env.SMOKE_URL||"https://maoqb.github.io/aosp-docs/editor/";
 const resp=await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForTimeout(5000);
 console.log("HTTP",resp.status(),"TITLE",await page.title());
 console.log("LOGIN",await page.locator("#loginBtn").evaluate(el=>({href:el.href,hidden:el.hidden,rect:el.getBoundingClientRect().toJSON(),atPoint:document.elementFromPoint(el.getBoundingClientRect().x+25,el.getBoundingClientRect().y+12)?.outerHTML.slice(0,250)})));
 console.log("CHERRY",await page.evaluate(()=>({cherry:typeof window.Cherry,editor:!!document.querySelector(".cherry"),recent:document.querySelector("#welcomeRecent")?.textContent,loginVisible:!document.querySelector("#loginBtn").hidden})));
 console.log("PAGE_ERRORS",errors);console.log("CONSOLE_ERRORS",logs.slice(0,6));console.log("FAILED_REQUESTS",failed.slice(0,10));
 await page.evaluate(()=>sessionStorage.setItem("notes-session","abc123"));
 await page.reload({waitUntil:"domcontentloaded"});await page.waitForTimeout(1500);
 console.log("SESSION_UI",await page.evaluate(()=>({loginHidden:document.querySelector("#loginBtn")?.hidden,logoutHidden:document.querySelector("#logoutBtn")?.hidden,status:document.querySelector("#connection")?.innerText})));
 await page.goto(url+"#session="+"a".repeat(64),{waitUntil:"domcontentloaded"});await page.waitForTimeout(2500);
 console.log("CALLBACK_CAPTURE",await page.evaluate(()=>({hash:location.hash,sessionStored:sessionStorage.getItem("notes-session")==="a".repeat(64),loginHidden:document.querySelector("#loginBtn")?.hidden})));
 console.log("POST_CALLBACK_PAGE_ERRORS",errors);
 if(errors.length)throw Error("Browser boot failed: "+errors.join("; "));
 if(!(await page.evaluate(()=>sessionStorage.getItem("notes-session")==="a".repeat(64))))throw Error("OAuth session from callback was not captured");
 await page.screenshot({path:"oauth-smoke.png",fullPage:true});
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});

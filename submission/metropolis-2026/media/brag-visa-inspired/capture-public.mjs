import puppeteer from 'puppeteer-core';
import path from 'node:path';
const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu'],defaultViewport:{width:1280,height:720}});
try{
 const page=await browser.newPage();
 const base='https://pact-protocol-monad.alemzdelight.workers.dev';
 await page.goto(base,{waitUntil:'networkidle2'});await page.screenshot({path:path.join(import.meta.dirname,'assets','landing.png')});
 await page.goto(base+'/docs',{waitUntil:'networkidle2'});await page.screenshot({path:path.join(import.meta.dirname,'assets','docs-intro.png')});
 const links=await page.$$('a');for(const link of links){const text=await link.evaluate(el=>el.textContent?.trim());if(text==='Connect an agent'){await link.click();break;}}
 await new Promise(r=>setTimeout(r,650));await page.screenshot({path:path.join(import.meta.dirname,'assets','docs-connect.png')});
 await page.goto(base+'/explorer',{waitUntil:'networkidle2'});await page.screenshot({path:path.join(import.meta.dirname,'assets','explorer-blank.png')});
 await page.locator('input').fill('1');await page.screenshot({path:path.join(import.meta.dirname,'assets','explorer-input.png')});
 const bs=await page.$$('button');for(const b of bs){const t=await b.evaluate(el=>el.textContent?.trim());if(t?.includes('Inspect record')){await b.click();break;}}
 await new Promise(r=>setTimeout(r,750));await page.evaluate(()=>window.scrollTo(0,650));await new Promise(r=>setTimeout(r,150));await page.screenshot({path:path.join(import.meta.dirname,'assets','explorer-full.png'),fullPage:true});
 console.log('Captured Pact public product flow');
}finally{await browser.close()}

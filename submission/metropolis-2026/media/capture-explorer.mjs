import puppeteer from 'puppeteer-core';
import path from 'node:path';
const browser=await puppeteer.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-gpu'],defaultViewport:{width:1280,height:720}});
try{
 const page=await browser.newPage();
 await page.goto('https://pact-protocol-monad.alemzdelight.workers.dev/explorer',{waitUntil:'networkidle2',timeout:30000});
 await page.screenshot({path:path.join(import.meta.dirname,'explorer-01.png')});
 await page.locator('input').fill('1');
 await page.screenshot({path:path.join(import.meta.dirname,'explorer-02.png')});
 const buttons=await page.$$('button');
 for(const button of buttons){const t=await button.evaluate(el=>el.textContent?.trim());if(t?.includes('Inspect record')){await button.click();break;}}
 await new Promise(r=>setTimeout(r,1500));
 await page.screenshot({path:path.join(import.meta.dirname,'explorer-03.png'),fullPage:false});
 await page.evaluate(()=>window.scrollTo(0,500));
 await new Promise(r=>setTimeout(r,250));
 await page.screenshot({path:path.join(import.meta.dirname,'explorer-04.png')});
 console.log('Captured public Explorer interaction');
}finally{await browser.close();}

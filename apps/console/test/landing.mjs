// Public-page regression: production assets and the real shared policy evaluator.
// This test does not substitute authentication or send upstream requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {preview} from 'vite';

const hosted=process.env.PACT_PUBLIC_TEST_URL;
const server=hosted?undefined:await preview({root:resolve(import.meta.dirname,'..'),configFile:false,
  preview:{host:'127.0.0.1',port:4179,strictPort:true}});
const base=hosted??'http://127.0.0.1:4179';
const profile=await mkdtemp(join(tmpdir(),'pact-landing-test-'));
const chrome=spawn(process.env.CHROME_PATH??'/usr/bin/google-chrome',['--headless','--no-sandbox',
  '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-gpu',
  '--remote-debugging-port=9374',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let chromeError='',ws;
chrome.stderr.on('data',chunk=>chromeError=(chromeError+chunk).slice(-4000));
chrome.on('error',error=>chromeError=error.message);
try {
  let targets;
  for(let i=0;i<150;i++) {
    try {targets=await fetch('http://127.0.0.1:9374/json').then(r=>r.json());break;}catch{}
    if(chrome.exitCode!==null)throw Error(chromeError);
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(targets?.some(t=>t.type==='page'),chromeError);
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let sequence=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<150;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
  const click=async label=>{await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)})`);await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
  const go=async path=>{await call('Page.navigate',{url:base+path});await waitFor(`document.readyState==='complete'&&document.querySelector('h1')`);};
  const screenshot=async name=>{await evaluate('document.fonts.ready');await new Promise(r=>setTimeout(r,500));const data=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/tmp/${name}.png`,Buffer.from(data.data,'base64'));};
  const layout=async label=>assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${label}: horizontal overflow`);
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await go('/');await waitFor(`document.querySelector('.lpHeroPhoto')?.naturalWidth>0`);await layout('Desktop hero');
  await screenshot('pact-saas-desktop');
  // Navigation targets must resolve to implemented page anchors or real routes.
  const badLinks=await evaluate(`[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)).filter(id=>!document.getElementById(id))`);
  assert.deepEqual(badLinks,[]);
  await evaluate(`document.querySelector('#product').scrollIntoView()`);
  for(const [tab,heading] of [['Review','Approval inbox'],['Observe','Request activity'],['Control','Support boundaries'],['Connect','Your agents']]){
    await evaluate(`[...document.querySelectorAll('.lpTourTabs button')].find(b=>b.textContent.endsWith(${JSON.stringify(tab)})).click()`);await waitFor(`document.querySelector('#product-tour-panel').textContent.includes(${JSON.stringify(heading)})`);
  }
  await screenshot('pact-saas-product');
  await evaluate(`document.querySelector('#policy-preview').scrollIntoView()`);
  await click('Read a ticket');await waitFor(`document.querySelector('.lpPolicyResult').classList.contains('allowed')`);
  await click('Delete a ticket');await waitFor(`document.querySelector('.lpPolicyResult').textContent.includes('ACTION_OR_DESTINATION_OUT_OF_BOUNDS')`);
  await click('Request a refund');await waitFor(`document.querySelector('.lpPolicyResult').classList.contains('pending_approval')`);
  await click('Read a ticket');
  await evaluate(`document.querySelector('.lpCheckbox input').click()`);await click('Check policy');
  await waitFor(`document.querySelector('.lpPolicyResult').textContent.includes('RATE_LIMIT_EXCEEDED')`);
  await evaluate(`document.querySelector('.lpPolicyResult summary').click()`);
  await waitFor(`document.querySelector('.lpPolicyResult details').open`);
  await screenshot('pact-saas-policy');
  await click('Read a ticket');
  await evaluate(`(()=>{const e=document.querySelector('.lpRequestFields input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'/admin');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('.lpPolicyResult').classList.contains('unevaluated')`);await click('Check policy');
  await waitFor(`document.querySelector('.lpPolicyResult').textContent.includes('NO_POLICY_RULE_MATCHED')`);
  await evaluate(`document.querySelector('#developers').scrollIntoView()`);
  await click('Python');await waitFor(`document.querySelector('.lpCode pre').textContent.includes('from pact import PactClient')`);
  await click('curl');await waitFor(`document.querySelector('.lpCode pre').textContent.includes('curl --fail-with-body')`);
  await click('MCP');await waitFor(`document.querySelector('.lpCode pre').textContent.includes('pact_proxy_request')`);
  await click('TypeScript');await waitFor(`document.querySelector('.lpCode pre').textContent.includes('PactHttpClient')`);
  await call('Browser.grantPermissions',{origin:base,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await call('Page.bringToFront');
  await evaluate(`document.querySelector('.lpCode .codeToolbar button').click()`);
  await waitFor(`document.querySelector('.lpCode .codeToolbar button').textContent.includes('Copied')`);
  assert.match(await evaluate('navigator.clipboard.readText()'),/PactHttpClient/);
  await evaluate(`document.querySelector('.lpFaq details summary').click()`);assert.equal(await evaluate(`document.querySelector('.lpFaq details').open`),true);
  await evaluate(`document.querySelector('.lpClosing').scrollIntoView()`);await screenshot('pact-saas-footer');
  await evaluate(`document.querySelector('.lpUseCases').scrollIntoView()`);
  await waitFor(`[...document.querySelectorAll('.lpUseCases img')].every(i=>i.complete&&i.naturalWidth>0)`);
  await screenshot('pact-saas-use-cases');
  // Menu must remain usable between desktop and mobile breakpoints.
  for(const width of [1024,768,720,640,390,360]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});
    await evaluate('window.scrollTo(0,0)');await layout(`Viewport ${width}`);
    const accessible=await evaluate(`(()=>{const nav=document.querySelector('.navLinks');const menu=document.querySelector('.mobileMenu');return nav.getClientRects().length>0||menu.getClientRects().length>0;})()`);
    assert.ok(accessible,`No navigation at ${width}`);
    if(width<=800){await evaluate(`document.querySelector('.mobileMenu').click()`);await waitFor(`document.querySelector('.navLinks').classList.contains('navOpen')`);await layout(`Open menu ${width}`);await evaluate(`document.querySelector('.mobileMenu').click()`);}
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await screenshot('pact-saas-mobile');
  await evaluate(`document.querySelector('.mobileMenu').click()`);await waitFor(`document.querySelector('.navLinks').classList.contains('navOpen')`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(`!document.querySelector('.navLinks').classList.contains('navOpen')`);
  await evaluate(`document.querySelector('.mobileMenu').click();document.querySelector('.navLinks a[href="#use-cases"]').click()`);
  await waitFor(`!document.querySelector('.navLinks').classList.contains('navOpen')`);
  await evaluate(`document.querySelector('#policy-preview').scrollIntoView()`);await screenshot('pact-saas-mobile-policy');await layout('Mobile playground');
  await go('/docs/quickstart');await waitFor(`document.querySelector('.docsArticle').textContent.includes('Connect an agent')`);await layout('Docs');await screenshot('pact-docs-quickstart');
  assert.equal(await evaluate(`document.querySelector('.siteFooter')===null`),true);
  await go('/docs/api');await waitFor(`document.querySelector('.docsArticle').textContent.includes('HTTP API reference')`);await layout('API docs');
  await go('/app/verification');await waitFor(`document.body.innerText.includes('Create account or sign in')`);await layout('App sign-in');
  await go('/app/agents');await waitFor(`document.querySelector('.cpPageHead h1')?.textContent==='Agents'`);await layout('Direct agents page');
  assert.equal(await evaluate(`document.querySelector('nav[aria-label="Console navigation"] a[href="/app/policies"]')!==null`),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: landing navigation, real policy evaluation (allow/deny/approval/rate/default deny), product walkthrough, all SDK tabs, copy, FAQ, photography, responsive layouts, docs and Console sign-in route. No upstream requests sent.');
} finally {
  ws?.close();chrome.kill('SIGTERM');
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve));
  await server?.httpServer.close();
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}

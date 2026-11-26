// Offline preset review and export test, using a fresh browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
const baseline=process.env.FOUNDRY_CONTAINER_BASELINE==='1';
const executablePath=process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--disable-webgl']});
const context=await browser.newContext({viewport:{width:1600,height:1000},offline:true,acceptDownloads:true});
const page=await context.newPage();page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=new URL('../test-results/containers/',import.meta.url);await mkdir(output,{recursive:true});
const host=page.locator('#buildings-page');
const idle=()=>page.waitForFunction(()=>{const h=document.querySelector('#buildings-page');return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled;});
try{
  const app=baseline?new URL('../.qa/containers-before/index.html?ui-test#track',import.meta.url):new URL('../dist/index.html?ui-test#track',import.meta.url);
  await page.goto(app.href);await page.waitForFunction(()=>document.querySelector('#app')?.getAttribute('aria-busy')==='false');
  await page.locator('[data-action="mode-buildings"]').first().click();await idle();
  for(const id of ['stall-container','container']){
    await host.locator('[data-bd-preset="'+id+'"]').click();await idle();
    assert.equal(await host.locator('.bd-error').isVisible(),false,id);
    assert.match(await host.locator('[data-bd-fit]').textContent(),/^Fits/,id);
    await host.locator('.bd-centre').screenshot({path:fileURLToPath(new URL((baseline?'before-':'')+id+'.png',output))});
  }
  if(!baseline){
    // The new design remains an editable ordinary building, and is exported from its actual mesh.
    await host.locator('[name="buildingName"]').fill('Container office test');
    await host.locator('[name="container"]').selectOption('frame');await idle();
    await host.locator('[name="height"]').fill('84');await host.locator('[name="height"]').press('Tab');await idle();
    await host.locator('[data-bd="save"]').click();await idle();
    const reopen=host.locator('.bd-saved [data-bd-open]').filter({hasText:'Container office test'});await reopen.waitFor();
    const wait=page.waitForEvent('download');await host.locator('[data-bd="export"]').click();const dl=await wait;
    const files=unzipSync(await readFile(await dl.path()));assert.ok(Object.keys(files).filter(n=>n.endsWith('.stl')).length>10);
    assert.match(strFromU8(files['README.txt']),/Container office test/);assert.match(strFromU8(files['README.txt']),/Container details/);
    await host.locator('[data-bd-preset="garage"]').click();await idle();await reopen.click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('foundry.building'))?.height===84);await idle();
    const b=await page.evaluate(()=>JSON.parse(localStorage.getItem('foundry.building')));assert.equal(b.upper.length,0);assert.equal(b.kind,'garage');assert.equal(b.container,'frame');
    await host.locator('[name="container"]').selectOption('left');await idle();
    assert.equal(await host.locator('.bd-error').isVisible(),false);
  }
  assert.deepEqual(errors,[]);console.log(baseline?'PASS: captured previous container presets.':'PASS: both containers render and fit; shell selection, height edits, kit export and Library reopen work.');
}finally{await browser.close();}

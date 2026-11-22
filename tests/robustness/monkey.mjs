// Random-click run on the built app (dist/index.html) in a throwaway browser
// profile, which starts with the starter Library. It clicks, types, picks
// options, drags in the 3D view and presses keys at random, and records every
// page error, console error, failed request, browser dialog, and dialog that
// will not close on Escape, each with the actions that led to it.
//   node tests/robustness/monkey.mjs [minutes] [seed]
// Report: test-results/monkey-<seed>.json (+ a screenshot per problem).
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { executablePath, prng, removeDir, root, tempDir } from './lib.mjs';

const MINUTES = Number(process.argv[2]) || 10;
const SEED = Number(process.argv[3]) || 1;
const rand = prng(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const artifact = join(root, 'dist', 'index.html');
if (!existsSync(artifact)) throw Error('Build the app first: npm run build');
const out = join(root, 'test-results');
await mkdir(out, { recursive: true });

const profile = await tempDir('monkey');
const context = await chromium.launchPersistentContext(join(profile, 'p'), {
  executablePath,
  headless: true,
  viewport: { width: 1400, height: 880 },
  acceptDownloads: true,
  downloadsPath: join(profile, 'downloads'),
  offline: true,
});
const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(4000);

const trail = [];
const problems = [];
const seen = new Map();
let step = 0;
async function problem(kind, message) {
  // The same message is reported once, with how often it came back.
  const key = kind + '|' + message.replace(/\d+/g, '#').slice(0, 300);
  if (seen.has(key)) {
    seen.get(key).count++;
    return;
  }
  const entry = { kind, message, step, count: 1, last: trail.slice(-40) };
  seen.set(key, entry);
  problems.push(entry);
  try {
    entry.screenshot = 'monkey-' + SEED + '-' + problems.length + '.png';
    await page.screenshot({ path: join(out, entry.screenshot) });
  } catch {
    delete entry.screenshot;
  }
  console.log('! ' + kind + ' at step ' + step + ': ' + message.split('\n')[0]);
}
page.on('pageerror', (e) => problem('page error', e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && problem('console error', m.text()));
page.on('requestfailed', (r) => {
  const url = r.url();
  // Downloads and object URLs revoked after use are not failures.
  if (!/^(blob|data):/.test(url)) problem('failed request', url + ' · ' + r.failure()?.errorText);
});
page.on('dialog', async (d) => {
  trail.push('browser ' + d.type() + ': ' + d.message().slice(0, 120));
  await d.dismiss().catch(() => {});
});
// File pickers would wait for a person: cancel them.
page.on('filechooser', () => trail.push('file picker opened (cancelled)'));
page.on('download', (d) => {
  trail.push('download ' + d.suggestedFilename());
  d.cancel().catch(() => {});
});

await page.goto(pathToFileURL(artifact).href);
await page.waitForTimeout(2500);

const values = ['0', '-1', '1', '12.5', '99999', '1e9', '', 'abc', '3', '200', '-0.0001', '45'];
const keys = ['Escape', 'Enter', 'Tab', 'Delete', 'Control+z', 'Control+y', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'Space'];

// Visible, enabled controls nothing else covers, tagged for this step.
async function targets() {
  return page.evaluate(() => {
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll('[data-monkey]')) el.removeAttribute('data-monkey');
    const all = document.querySelectorAll(
      'button, [role="button"], a[href], summary, input:not([type="file"]):not([type="hidden"]), select, textarea, [data-tab], [data-action], canvas, svg[data-model-guides] circle',
    );
    for (const el of all) {
      if (el.disabled || el.closest('[hidden], [inert]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const x = Math.min(innerWidth - 2, Math.max(1, r.left + r.width / 2)),
        y = Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
      const id = String(++n);
      el.setAttribute('data-monkey', id);
      const tag = el.tagName.toLowerCase();
      out.push({
        id,
        tag,
        type: el.type ?? '',
        x,
        y,
        w: r.width,
        h: r.height,
        label: (el.getAttribute('aria-label') || el.title || el.dataset.action || el.dataset.tab || el.name || el.textContent || tag)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60),
        options: tag === 'select' ? [...el.options].map((o) => o.value) : null,
      });
    }
    return out;
  });
}

const openDialogs = () =>
  page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className || 'dialog'));

const end = Date.now() + MINUTES * 60_000;
let busySince = null;
while (Date.now() < end) {
  step++;
  try {
    const list = await targets();
    const r = rand();
    if (r < 0.62 && list.length) {
      const t = pick(list);
      if (t.tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'color', 'range'].includes(t.type)) {
        const v = pick(values);
        trail.push(`type "${v}" into ${t.label}`);
        await page.locator(`[data-monkey="${t.id}"]`).fill(v, { timeout: 1500 }).catch(() => {});
        await page.keyboard.press(pick(['Tab', 'Enter', 'Tab']));
      } else if (t.tag === 'select' && t.options?.length) {
        const v = pick(t.options);
        trail.push(`choose "${v}" in ${t.label}`);
        await page.locator(`[data-monkey="${t.id}"]`).selectOption(v, { timeout: 1500 }).catch(() => {});
      } else if (t.tag === 'canvas') {
        const dx = (rand() - 0.5) * t.w * 0.4,
          dy = (rand() - 0.5) * t.h * 0.4;
        trail.push(`drag in the 3D view by ${Math.round(dx)}, ${Math.round(dy)}`);
        await page.mouse.move(t.x, t.y);
        await page.mouse.down({ button: pick(['left', 'left', 'middle']) });
        await page.mouse.move(t.x + dx, t.y + dy, { steps: 5 });
        await page.mouse.up({ button: 'left' }).catch(() => {});
        await page.mouse.up({ button: 'middle' }).catch(() => {});
      } else {
        trail.push(`click ${t.tag} "${t.label}"`);
        await page.mouse.click(t.x, t.y, rand() < 0.1 ? { modifiers: ['Shift'] } : undefined);
      }
    } else if (r < 0.8) {
      const k = pick(keys);
      const before = await openDialogs();
      trail.push(`press ${k}`);
      await page.keyboard.press(k);
      if (k === 'Escape' && before.length) {
        await page.waitForTimeout(400);
        const still = await openDialogs();
        if (still.length >= before.length && JSON.stringify(still) === JSON.stringify(before))
          trail.push('(dialog still open after Escape: ' + still.join(', ') + ')');
      }
    } else if (r < 0.88) {
      // A close button, the way a person leaves a dialog.
      const close = list.filter((t) => /close|cancel|×|done/i.test(t.label));
      if (close.length) {
        const t = pick(close);
        trail.push(`click ${t.tag} "${t.label}"`);
        await page.mouse.click(t.x, t.y);
      }
    } else if (r < 0.92) {
      trail.push('scroll');
      await page.mouse.wheel(0, (rand() - 0.5) * 900);
    } else {
      trail.push('wait');
      await page.waitForTimeout(600 + rand() * 1500);
    }
    await page.waitForTimeout(80 + rand() * 250);
    // A calculation that never finishes.
    const status = await page.evaluate(() => document.getElementById('status')?.textContent ?? '');
    if (/calculat|building|preparing/i.test(status)) {
      busySince ??= Date.now();
      if (Date.now() - busySince > 90_000) {
        await problem('stuck', 'Status says "' + status + '" for over 90 s');
        busySince = Date.now();
      }
    } else busySince = null;
    // Something unresponsive: the page has to answer within a few seconds.
    await page.evaluate(() => 1, null, { timeout: 8000 });
  } catch (err) {
    if (/Target (page|closed)|has been closed/.test(err.message)) {
      await problem('page closed', err.message);
      break;
    }
    if (/Timeout/.test(err.message)) await problem('unresponsive', err.message.split('\n')[0]);
  }
  if (trail.length > 400) trail.splice(0, 200);
  if (step % 250 === 0) console.log(`  step ${step}, ${problems.length} problems so far`);
}

const report = { seed: SEED, minutes: MINUTES, steps: step, problems, lastActions: trail.slice(-80) };
await writeFile(join(out, 'monkey-' + SEED + '.json'), JSON.stringify(report, null, 2));
console.log(`Random-click run: ${step} actions in ${MINUTES} min (seed ${SEED}), ${problems.length} distinct problems.`);
for (const p of problems) console.log(`- ${p.kind} ×${p.count} (first at step ${p.step}): ${p.message.split('\n')[0]}`);
await context.close();
await removeDir(profile);

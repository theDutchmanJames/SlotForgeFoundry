// End-to-end test of the shipped file with a clean browser profile and no network.
// Build first. To choose another Chromium browser, set SLOT_FORGE_BROWSER.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { strFromU8, unzipSync } from 'fflate';
import initManifold from 'manifold-3d';
import { parseSTL } from '../src/editor.js';
import { checkSteppedPosts } from './browser/stepped-posts.mjs';
import { checkSolidTools } from './browser/solid-tools.mjs';
import { checkMeshWorkbench } from './browser/mesh-workbench.mjs';
import { checkAssembly } from './browser/assembly.mjs';
import { checkBracket } from './browser/create-bracket.mjs';
import { checkFinishTools } from './browser/create-finishes.mjs';
import { checkModifyHoles } from './browser/modify-holes.mjs';
import { checkHealStretch } from './browser/heal-stretch.mjs';
import { checkWallEdge } from './browser/wall-edge.mjs';
import { checkRoundedCorner } from './browser/rounded-corner.mjs';
import { checkTrackChannel } from './browser/track-channel.mjs';
import { checkScaleCar } from './browser/scale-car.mjs';
import { checkTrackProfileEdges } from './browser/track-profile-edges.mjs';
import { checkBorderApices } from './browser/border-apices.mjs';
import { checkShapedTrack } from './browser/shaped-track.mjs';
import { checkCustomTrack } from './browser/custom-track.mjs';
import { checkSpecialTrackPieces } from './browser/special-track-pieces.mjs';
import { checkDrawFlatCrossing } from './browser/draw-flat-crossing.mjs';
import { checkImportFlatCrossing } from './browser/import-flat-crossing.mjs';
import { checkRampExports } from './browser/flat-crossing-exports.mjs';
import { checkTrackLibrary } from './browser/track-library.mjs';
import { checkStartingGrid, checkPitGrid } from './browser/starting-grid.mjs';
import { checkUndersideRibs } from './browser/underside-ribs.mjs';
import { checkRoadMarkings } from './browser/road-markings.mjs';
import { checkCreationSolids } from './browser/creation-solids.mjs';
import { checkSketchCreation } from './browser/create-sketch.mjs';
import { checkFaceGrid } from './browser/face-grid.mjs';
import { checkViewSelector } from './browser/view-selector.mjs';
import { checkConnectorPlacement } from './browser/connector-placement.mjs';
import { checkSolidMove } from './browser/solid-move.mjs';
import { selectTrackPart } from './browser/part-outline.mjs';
import { checkWorkspaceNavigation } from './browser/workspace-navigation.mjs';
import { checkPlanner } from './browser/planner.mjs';

const artifact = new URL('../dist/index.html', import.meta.url);
const fixture = fileURLToPath(
  new URL('./drawings/circuit-curve-mm.dxf', import.meta.url),
);
if (!existsSync(artifact))
  throw Error(
    'Build the offline app with npm run build before running the browser test.',
  );
const browserPaths = {
  win32: [
    join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft/Edge/Application/msedge.exe',
    ),
    join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Google/Chrome/Application/chrome.exe',
    ),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};
const executablePath =
  process.env.SLOT_FORGE_BROWSER ||
  [...(browserPaths[process.platform] || []), chromium.executablePath()].find(
    (p) => existsSync(p),
  );
if (!executablePath)
  throw Error(
    'Install Chromium or set SLOT_FORGE_BROWSER to the browser executable.',
  );

const testDir = await mkdtemp(join(tmpdir(), 'slotforge-browser-test-'));
const requestedRenderer = process.env.SLOT_FORGE_RENDERER;
const rendererFlags = {
  software: ['--disable-webgl'],
  webgl: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
};
let context;
try {
  context = await chromium.launchPersistentContext(join(testDir, 'profile'), {
    executablePath,
    downloadsPath: join(testDir, 'downloads'),
    headless: true,
    args: rendererFlags[requestedRenderer] ?? [],
    viewport: { width: 1500, height: 940 },
    offline: true,
    acceptDownloads: true,
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(15000);
  // SLOT_FORGE_CPU_SLOWDOWN=4 runs the page four times slower, like a small CI machine.
  const slowdown = Number(process.env.SLOT_FORGE_CPU_SLOWDOWN);
  if (slowdown > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
  }
  const failures = [],
    externalRequests = [],
    consoleErrors = [];
  page.on('pageerror', (e) => failures.push(e.message));
  context.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  context.on('request', (req) => {
    if (/^https?:/.test(req.url())) externalRequests.push(req.url());
  });
  // Foundry ignores clicks while it builds or runs an action (a person waits
  // too). Every locator click therefore waits until Foundry is idle, unless a
  // dialog is open: an action can be waiting for its answer. Slow CI machines
  // otherwise lose clicks at random.
  const whenIdle = () =>
    page.waitForFunction(
      () => {
        if (document.querySelector('dialog[open]')) return true;
        const app = document.querySelector('#app');
        const planner = document.querySelector('#track-planner');
        return (
          !!app &&
          app.getAttribute('aria-busy') !== 'true' &&
          !app.hasAttribute('data-acting') &&
          !(planner && !planner.hidden && planner.hasAttribute('aria-busy'))
        );
      },
      null,
      { timeout: 60000 },
    );
  const Locator = Object.getPrototypeOf(page.locator('body'));
  const plainClick = Locator.click;
  Locator.click = async function (...args) {
    await whenIdle();
    return plainClick.apply(this, args);
  };
  // Guides are drawn a frame or two after the live edit. Reading an outline
  // ('d') that is not drawn yet waits briefly for it instead of returning null.
  const plainAttribute = Locator.getAttribute;
  Locator.getAttribute = async function (name, options) {
    const value = await plainAttribute.call(this, name, options);
    if (name !== 'd' || value !== null) return value;
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      await page.waitForTimeout(100);
      const later = await plainAttribute.call(this, name, options);
      if (later !== null) return later;
    }
    return null;
  };
  const action = (k) => page.locator('[data-action="' + k + '"]').first();
  const tab = (k) => page.locator('[data-tab="' + k + '"]');
  const input = (name) => page.locator('#settings-form [name="' + name + '"]');
  const guide = (id) =>
    page.locator('svg[data-model-guides] g[data-guide="' + id + '"]');
  const live = (state = 'ready') =>
    page.locator('#live-status[data-state="' + state + '"]').waitFor();
  const opCount = (count) =>
    page.waitForFunction(
      (n) => document.querySelectorAll('[data-op]').length === n,
      count,
    );
  async function waitText(selector, text) {
    await page.waitForFunction(
      ([sel, expected]) =>
        document.querySelector(sel)?.textContent.includes(expected),
      [selector, text],
    );
  }
  async function countParts(n) {
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-part]').length === count &&
        document.querySelector('#app').getAttribute('aria-busy') === 'false',
      n,
    );
  }
  async function upload(actionName, files) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      action(actionName).click(),
    ]);
    await chooser.setFiles(files);
  }
  async function openProject(buffer, name) {
    await action('open').click();
    const previous = await page
      .locator('#workspace-nav:not([hidden]) button, #track-sections:not([hidden]) button')
      .first()
      .elementHandle();
    await upload('browse', { name, mimeType: 'application/json', buffer });
    // Reopened projects can have the same title and parts as the prior model.
    // Wait for the rebuilt parts list before sending the next workbench action.
    await page.waitForFunction(
      (part) =>
        !part.isConnected &&
        document.querySelector('#app').getAttribute('aria-busy') === 'false',
      previous,
    );
    await previous.dispose();
  }
  async function download(trigger) {
    const event = page.waitForEvent('download');
    await trigger.click();
    const file = await event;
    assert.equal(await file.failure(), null);
    return {
      name: file.suggestedFilename(),
      bytes: await readFile(await file.path()),
    };
  }
  async function openSection(name) {
    const header = page
      .locator('#settings-form summary')
      .filter({ hasText: name });
    if (!(await header.evaluate((element) => element.parentElement.open))) {
      await header.click();
    }
  }
  async function downloadSelected() {
    await action('export-menu').click();
    return download(action('export-part'));
  }
  async function snap(name) {
    if (process.env.SLOT_FORGE_SCREENSHOTS) {
      await page.screenshot({
        path: join(process.env.SLOT_FORGE_SCREENSHOTS, name + '.png'),
      });
    }
  }
  // Read the presented pixels. This exercises the actual WebGL or Canvas path,
  // including depth ordering, separately from the geometry and SVG tests.
  async function paintDifference(first, second, color = 'red') {
    return page.evaluate(
      async ([a, b, color]) => {
        async function paintMask(png) {
          const image = new Image();
          image.src = 'data:image/png;base64,' + png;
          await image.decode();
          const buffer = document.createElement('canvas');
          buffer.width = image.width;
          buffer.height = image.height;
          const ctx = buffer.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const { data } = ctx.getImageData(0, 0, image.width, image.height);
          const mask = new Uint8Array(image.width * image.height);
          for (let i = 0; i < mask.length; i++) {
            const j = 4 * i,
              r = data[j],
              g = data[j + 1],
              b = data[j + 2];
            mask[i] =
              color === 'white'
                ? r > 251 && g > 251 && b > 251
                : r > 130 && r - g > 65 && r - b > 65 && Math.abs(b - g) < 40;
          }
          return mask;
        }
        const before = await paintMask(a),
          after = await paintMask(b);
        let appeared = 0,
          disappeared = 0;
        for (let i = 0; i < before.length; i++) {
          if (!before[i] && after[i]) appeared++;
          if (before[i] && !after[i]) disappeared++;
        }
        return { appeared, disappeared };
      },
      [first.toString('base64'), second.toString('base64'), color],
    );
  }
  // A slight enlargement should preserve the solid's interior on screen. Read
  // composited screenshots to exercise both the GPU and software canvas paths.
  async function assertSolidAfterScaling(canvas, before) {
    const after = await canvas.screenshot();
    if (process.env.SLOT_FORGE_KEEP_SHOTS) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(new URL('./test-results/', import.meta.url.replace('/tests/', '/')), { recursive: true });
      await writeFile(new URL('../test-results/scale-before.png', import.meta.url), before);
      await writeFile(new URL('../test-results/scale-after.png', import.meta.url), after);
    }
    const { filled, missing } = await page.evaluate(
      async ([original, scaled]) => {
        async function pixels(base64) {
          const img = new Image();
          img.src = 'data:image/png;base64,' + base64;
          await img.decode();
          const buffer = document.createElement('canvas');
          buffer.width = img.width;
          buffer.height = img.height;
          const ctx = buffer.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height);
        }
        const a = await pixels(original),
          b = await pixels(scaled);
        // The model is grey and differs from the viewport background, which
        // is read from a corner so the check works in both themes.
        const bg = [...a.data.slice(8 * 4 * a.width + 32, 8 * 4 * a.width + 35)];
        const isBody = (data, i) =>
          Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 15 &&
          Math.max(data[i], data[i + 1], data[i + 2]) -
            Math.min(data[i], data[i + 1], data[i + 2]) <
            24;
        let filled = 0,
          missing = 0;
        for (let y = Math.round(a.height * 0.15); y < a.height * 0.89; y += 2) {
          for (let x = Math.round(a.width * 0.15); x < a.width * 0.85; x += 2) {
            const i = (y * a.width + x) * 4;
            if (isBody(a.data, i)) {
              filled++;
              if (!isBody(b.data, i)) missing++;
            }
          }
        }
        return { filled, missing };
      },
      [before.toString('base64'), after.toString('base64')],
    );
    assert.ok(
      filled > 5000,
      'the enclosure occupies a measurable part of the viewport',
    );
    assert.ok(
      missing / filled < 0.025,
      'scaling lost ' +
        ((100 * missing) / filled).toFixed(2) +
        '% of the enclosure silhouette',
    );
  }
  try {
    // Foundry opens on Home with the packs from the Library.
    await page.goto(artifact.href);
    await page.locator('#home .home-pack').first().waitFor();
    assert.equal(await page.locator('#home').isVisible(), true);
    assert.ok((await page.locator('#home .home-pack').count()) >= 2);
    assert.equal(await page.locator('[data-action="export-menu"]').isVisible(), false);
    // The rest of the suite starts in Track Set, as before Home existed.
    await page.goto(artifact.href + '?ui-test#track');
    await countParts(3);
    assert.equal(await page.title(), 'SlotForge Foundry');
    const mark = page.locator('.brand .brand-icon');
    const headerIcon = await mark.evaluate(async (img) => {
      await img.decode();
      return img.currentSrc;
    });
    assert.match(headerIcon, /^data:image\/svg\+xml/);
    const tabIcon = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal(decodeURIComponent(tabIcon), decodeURIComponent(headerIcon));
    const renderer = await page
      .locator('#viewport canvas')
      .evaluate((canvas) => (canvas.getContext('2d') ? 'software' : 'webgl'));
    if (requestedRenderer) assert.equal(renderer, requestedRenderer);
    console.log('Viewport renderer:', renderer);
    assert.equal(await page.locator('[data-action="preview"]').count(), 0);
    await guide('curve-radius').waitFor({ state: 'attached' });
    await snap('track');
    await checkPlanner({page,action,download,snap});
    await checkWorkspaceNavigation({
      page, action, tab, input, live, openProject, waitText, snap,
    });
    const projectParts = page.locator('#parts [data-part]');
    await selectTrackPart(projectParts.filter({ hasText: 'Outer border 1' }));
    await waitText('#selected-name', 'Outer border 1');
    const singleBorder = await downloadSelected();
    assert.match(singleBorder.name, /outer.*border.*1\.stl$/i);
    assert.ok(singleBorder.bytes.readUInt32LE(80) > 0);
    assert.equal(
      singleBorder.bytes.length,
      84 + 50 * singleBorder.bytes.readUInt32LE(80),
    );
    await action('export-menu').click();
    assert.equal(
      await page.locator('dialog [data-action="export-kerbs"]').count(),
      0,
    );
    const borderArchive = unzipSync(
      (await download(action('export-borders'))).bytes,
    );
    assert.equal(Object.keys(borderArchive).length, 2);
    assert.ok(
      Object.keys(borderArchive).every((name) => name.endsWith('.stl')),
    );
    assert.ok(
      Object.values(borderArchive).some((bytes) =>
        singleBorder.bytes.equals(Buffer.from(bytes)),
      ),
    );
    await selectTrackPart(projectParts.filter({ hasText: 'Road 1' }));
    await tab('geometry').click();
    console.log(
      '✓ Selected border STL matches its printable segment in the borders-only ZIP',
    );
    const radius = input('radius'),
      resetRadius = page.locator('[data-restore-field="radius"]');
    const savedRadius = await radius.inputValue();
    await radius.fill('375');
    await live();
    assert.equal(await action('save').innerText(), 'Apply & save');
    await resetRadius.click();
    await live('idle');
    assert.equal(await radius.inputValue(), savedRadius);
    await radius.fill('375');
    await live();
    await action('apply').click();
    await live('idle');
    assert.equal(await radius.inputValue(), '375');
    await resetRadius.click();
    await live();
    assert.equal(await radius.inputValue(), savedRadius);
    const savedWhileDrafting = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    );
    assert.equal(savedWhileDrafting.track.params.radius, Number(savedRadius));
    await live('idle');
    console.log(
      '✓ Automatic radius preview, per-field restore before and after Apply, and committed project save',
    );
    await tab('joints').click();
    await input('clipClearance').fill('0.01');
    await live('error');
    await waitText('#live-status', 'Clip gap per side');
    assert.match(await page.locator('#live-status').innerText(), /0[.,]03/);
    await input('clipClearance').fill('0.03');
    await openSection('Tab and socket');
    await input('tabWidth').fill('7');
    await openSection('Road connections');
    await input('joint').selectOption('clips');
    await openSection('Border connections');
    await input('borderMount').selectOption('clips');
    await input('borderJoint').selectOption('clips');
    await live('error');
    const warningCard = page.locator(
      '#live-status[data-state="error"][data-connector-warning]',
    );
    const warningSetting = warningCard.locator(
      '[data-action="show-warning-setting"]',
    );
    const viewWarning = page.getByRole('button', {
      name: 'View warning',
      exact: true,
    });
    await warningSetting.waitFor();
    await viewWarning.waitFor();
    await page
      .getByText('Showing last applied model', { exact: true })
      .waitFor();
    const warning = await warningCard.innerText();
    assert.match(warning, /outside border[^\n]{0,20}start/i);
    assert.match(warning, /double-dovetail draw key/i);
    assert.match(warning, /\b12(?:\.0+)?\s*mm\b/);
    assert.match(warning, /\b19\.36\s*mm\b/);
    assert.match(warning, /\b20(?:\.0+)?\s*mm\b/);
    await action('apply').click();
    await countParts(3);
    await warningSetting.waitFor();
    assert.equal(await page.locator('#notice').isVisible(), false);
    await viewWarning.click();
    assert.ok(
      await warningCard.evaluate((el) => el === document.activeElement),
    );
    await snap('outside-border-clip-warning');
    await warningSetting.click();
    const borderEntry = input('borderEntry');
    assert.equal(await borderEntry.inputValue(), '12');
    assert.ok(
      await borderEntry.evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.type('20');
    assert.equal(await borderEntry.inputValue(), '20');
    await waitText('#live-status', 'finish');
    await warningSetting.click();
    await input('borderExit').fill('20');
    await live();
    await countParts(13);
    assert.equal(await viewWarning.isVisible(), false);
    assert.equal(await warningSetting.isVisible(), false);
    await action('apply').click();
    await live('idle');
    const corrected = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    ).track.params;
    assert.deepEqual(
      [
        corrected.borderEntry,
        corrected.clipClearance,
        corrected.tabWidth,
        corrected.joint,
        corrected.borderMount,
        corrected.borderJoint,
      ],
      [20, 0.03, 7, 'clips', 'clips', 'clips'],
    );
    await action('undo').click();
    await countParts(3);
    console.log(
      '✓ The clip warning identifies the narrow entry and opens its field; correcting it preserves all pending joint settings',
    );
    await tab('geometry').click();
    await selectTrackPart(page.locator('[data-part="border-outer-1"]'));
    assert.equal(await tab('borders').getAttribute('aria-pressed'), 'true');
    // Segment counts now live in the Print section.
    await tab('print').click();
    await openSection('Border segments');
    await input('borderSegments').fill('3');
    await live();
    await countParts(4);
    await selectTrackPart(page.locator('[data-part="border-outer-3"]'));
    await waitText('#selected-name', 'Outer border 3');
    await tab('profile').click();
    assert.equal(await page.locator('#part-count').textContent(), '4');
    assert.equal(
      await page.locator('#live-status').getAttribute('data-state'),
      'ready',
    );
    await selectTrackPart(page.locator('[data-part="border-outer-3"]'));
    assert.equal(await tab('borders').getAttribute('aria-pressed'), 'true');
    await tab('print').click();
    assert.equal(await input('borderSegments').inputValue(), '3');
    await action('restore').click();
    await live('idle');
    await countParts(3);
    await selectTrackPart(page.locator('[data-part="border-outer-1"]'));
    assert.equal(await tab('paint').count(), 0);
    assert.equal(await input('whiteLineRoad').count(), 0);
    assert.equal(await action('export-kerbs').count(), 0);
    // Road and border kerbs share one Kerbs folder under Markings.
    await tab('markings').click();
    await openSection('Kerbs');
    assert.equal(await input('kerbEdge').inputValue(), 'none');
    const trackCanvas = page.locator('#viewport canvas');
    // The hardware under the track is SlotForge red: compare the underside
    // with itself, before and after kerbs, rather than with the top view.
    await action('bottom').click();
    const plainUnderside = await trackCanvas.screenshot();
    await action('top').click();
    const plainBorder = await trackCanvas.screenshot();
    await input('kerbEdge').selectOption('road');
    await live();
    const roadFacing = await trackCanvas.screenshot();
    assert.ok(
      (await paintDifference(plainBorder, roadFacing)).appeared > 180,
      'road-facing paint reaches the composed image',
    );
    await input('kerbEdge').selectOption('free');
    await input('kerbWidth').fill('6');
    await input('kerbLength').fill('14');
    await live();
    const freeEdge = await trackCanvas.screenshot();
    const shifted = await paintDifference(roadFacing, freeEdge);
    assert.ok(
      shifted.appeared > 180 && shifted.disappeared > 180,
      'the markings move when the other edge is selected',
    );
    await action('bottom').click();
    const underside = await trackCanvas.screenshot();
    const fromBelow = await paintDifference(plainUnderside, underside);
    if (fromBelow.appeared >= 100) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
      await writeFile(new URL('../test-results/underside-before.png', import.meta.url), plainUnderside);
      await writeFile(new URL('../test-results/underside-after.png', import.meta.url), underside);
    }
    assert.ok(
      fromBelow.appeared < 100,
      'paint is visible only on the top face (' + fromBelow.appeared + ' red pixels appeared)',
    );
    await action('iso').click();
    await snap('kerbstone-free-edge');
    await action('export-menu').click();
    const borderDownload = await download(action('export-borders'));
    const borderFiles = unzipSync(borderDownload.bytes);
    assert.deepEqual(Object.keys(borderFiles).sort(), [
      'border-outer-1.stl',
      'border-outer-2.stl',
    ]);
    for (const bytes of Object.values(borderFiles)) {
      assert.ok(bytes.length > 84);
      assert.equal(bytes.length, 84 + Buffer.from(bytes).readUInt32LE(80) * 50);
    }
    const decorated = await download(action('save'));
    const params = JSON.parse(decorated.bytes.toString()).track.params;
    assert.deepEqual(
      [params.kerbEdge, params.kerbWidth, params.kerbLength],
      ['free', 6, 14],
    );
    await input('kerbEdge').selectOption('none');
    await live();
    await action('restore').click();
    assert.equal(await input('kerbEdge').inputValue(), 'free');
    await action('open').click();
    await upload('browse', {
      name: 'kerbs.slotfab',
      mimeType: 'application/json',
      buffer: decorated.bytes,
    });
    await countParts(3);
    await tab('markings').click();
    assert.equal(await input('kerbLength').inputValue(), '14');
    await action('top').click();
    assert.ok(
      (await paintDifference(plainBorder, await trackCanvas.screenshot()))
        .appeared > 180,
      'saved markings reopen on the model',
    );
    await action('iso').click();
    console.log(
      '✓ Live kerbstone edge placement, top-face-only paint, printable border STL download, Restore and project round trip',
    );
    await input('kerbEdge').selectOption('road');
    await input('kerbWidth').focus();
    await guide('kerb-road-1').waitFor({ state: 'attached' });
    await action('top').click();
    await live();
    await input('kerbGroove').check();
    await waitText('[data-kerb-section]', '0.5 mm wide × 0.3 mm deep');
    await live();
    await openSection('Line and groove sizes');
    await input('grooveWidth').fill('0.75');
    await input('grooveDepth').fill('0.45');
    await live();
    // Groove sizes sit in "Line and groove sizes" in the same section.
    assert.equal(await input('grooveWidth').inputValue(), '0.75');
    assert.equal(await input('grooveDepth').inputValue(), '0.45');
    await input('grooveDepth').fill('0.55');
    await openSection('Kerbs');
    await waitText('[data-kerb-section]', '0.75 mm wide × 0.55 mm deep');
    await page.locator('[data-restore-field="grooveDepth"]').click();
    await waitText('[data-kerb-section]', '0.75 mm wide × 0.3 mm deep');
    await input('grooveDepth').fill('0.45');
    await live();
    await action('export-menu').click();
    const kerbFiles = unzipSync((await download(action('export-borders'))).bytes);
    for (const bytes of Object.values(kerbFiles)) {
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const triangles = data.getUint32(80, true);
      let kerbFloor = false;
      for (let i = 0; i < triangles && !kerbFloor; i++) {
        const z = 84 + 50 * i + 20;
        kerbFloor = [0, 12, 24].every(
          (offset) => Math.abs(data.getFloat32(z + offset, true) - 11.55) < 1e-4,
        );
      }
      assert.ok(kerbFloor, 'The exported border has a 0.45 mm kerbstone recess');
    }
    await input('kerbGroove').uncheck();
    await live();
    await waitText('[data-kerb-section]', 'Flat paint pattern');
    const beforeLines = await trackCanvas.screenshot();
    await openSection('White lines on the borders');
    await input('whiteLineBorder').selectOption('outer');
    await input('borderLineGroove').check();
    await input('kerbGroove').check();
    await openSection('Line and groove sizes');
    await input('whiteLineWidth').fill('4');
    await openSection('White lines on the road');
    await input('whiteLineRoad').selectOption('both');
    await live();
    await waitText('[data-line-layout]', 'Inside / right · 4 mm on the road');
    await waitText('[data-line-layout]', 'Outside / left · 2 mm on each piece');
    assert.ok(
      (
        await paintDifference(
          beforeLines,
          await trackCanvas.screenshot(),
          'white',
        )
      ).appeared > 250,
      'the white stripes reach the rendered track',
    );
    await input('roadLineGroove').check();
    await input('grooveWidth').fill('0.6');
    await input('grooveDepth').fill('0.4');
    await live();
    await openSection('Kerbs');
    await waitText('[data-kerb-section]', '0.6 mm wide × 0.4 mm deep');
    await action('iso').click();
    await snap('white-line-paint-grooves');
    await selectTrackPart(page.locator('[data-part="road-1"]'));
    await live();
    await action('export-menu').click();
    const groovedRoad = await download(action('export-part'));
    const triangles = groovedRoad.bytes.readUInt32LE(80);
    let grooveFloor = false;
    for (let i = 0; i < triangles; i++) {
      const z = 84 + i * 50 + 20;
      if (
        [0, 12, 24].every(
          (n) => Math.abs(groovedRoad.bytes.readFloatLE(z + n) - 11.6) < 0.0001,
        )
      ) {
        grooveFloor = true;
        break;
      }
    }
    assert.ok(
      grooveFloor,
      'the 0.4 mm paint groove is present in the printable 12 mm road',
    );
    const painted = await download(action('save'));
    const paintParams = JSON.parse(painted.bytes.toString()).track.params;
    assert.deepEqual(
      [
        paintParams.whiteLineRoad,
        paintParams.whiteLineBorder,
        paintParams.whiteLineWidth,
        paintParams.roadLineGroove,
        paintParams.borderLineGroove,
        paintParams.kerbGroove,
        paintParams.grooveWidth,
        paintParams.grooveDepth,
        paintParams.kerbEdge,
      ],
      ['both', 'outer', 4, true, true, true, 0.6, 0.4, 'road'],
    );
    await openSection('Line and groove sizes');
    await input('whiteLineWidth').fill('5');
    await live();
    await page.locator('[data-restore-field="whiteLineWidth"]').click();
    assert.equal(await input('whiteLineWidth').inputValue(), '4');
    await openProject(painted.bytes, 'painted.slotfab');
    await countParts(3);
    await tab('markings').click();
    assert.equal(await input('grooveDepth').inputValue(), '0.4');
    assert.equal(await input('kerbGroove').isChecked(), true);
    console.log(
      '✓ Live paired and road-only white lines, printed groove depth, component-specific grooves and saved settings',
    );
    await openProject(decorated.bytes, 'kerbs.slotfab');
    await tab('joints').click();
    await input('clipType').waitFor();
    await waitText('[data-clip-diagram]', 'Double-dovetail draw key');
    assert.deepEqual(
      await input('clipType')
        .locator('option')
        .evaluateAll((options) => options.map((o) => o.value)),
      ['draw-key', 'carrera-retained'],
    );
    await input('clipType').selectOption('carrera-retained');
    await waitText('[data-clip-diagram]', '60 × 14.8 × 4.5 mm');
    assert.equal(
      await page.locator('[data-clip-diagram] > svg [data-keeper-offset]').count(),
      2,
    );
    assert.match(
      await page.locator('[data-clip-diagram] a').first().getAttribute('href'),
      /1163344/,
    );
    await live();
    if (process.env.SLOT_FORGE_SCREENSHOTS)
      await page.locator('[data-clip-diagram]').screenshot({
        path: join(process.env.SLOT_FORGE_SCREENSHOTS, 'carrera-two-keepers.png'),
        style: '.property-commit { visibility: hidden; }',
      });
    await input('clipType').selectOption('draw-key');
    await waitText('[data-clip-diagram]', '26 × 10 × 6.2 mm');
    await tab('profile').click();
    await input('height').fill('10');
    await live();
    await tab('joints').click();
    await waitText('[data-clip-diagram]', '26 × 10 × 4.2 mm');
    await action('restore').click();
    await waitText('[data-clip-diagram]', '26 × 10 × 6.2 mm');
    const fitGuide = page.locator('[data-clip-diagram]');
    await fitGuide.locator('.retainer-help summary').click();
    assert.equal(await fitGuide.locator('.retainer-steps li').count(), 3);
    if (process.env.SLOT_FORGE_SCREENSHOTS)
      await fitGuide.screenshot({
        path: join(process.env.SLOT_FORGE_SCREENSHOTS, 'draw-key-and-retainer.png'),
        style: '.property-commit { visibility: hidden; }',
      });
    await tab('borders').click();
    console.log(
      '✓ Exactly two clip families, live dovetail height, both Carrera keeper positions and Restore',
    );
    const apex = page.getByRole('slider', { name: 'Outside apex width' });
    const originalWidth = Number(
      await input('outerApexWidth').inputValue(),
    );
    const originalPosition = Number(
      await input('outerApexPercent').inputValue(),
    );
    await apex.hover();
    const handle = await apex.boundingBox();
    const hx = handle.x + handle.width / 2,
      hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 12, hy - 8, { steps: 4 });
    await page.mouse.up();
    assert.ok(
      Number(await input('outerApexWidth').inputValue()) >
        originalWidth,
    );
    assert.ok(
      Number(await input('outerApexPercent').inputValue()) >
        originalPosition,
    );
    await apex.focus();
    await page.keyboard.press('ArrowUp');
    await live();
    await snap('borders');
    await action('restore').click();
    await live('idle');
    await tab('print').click();
    await openSection('Road segments');
    await page.locator('[name="segments"]').fill('2');
    await live();
    await countParts(4);
    await action('restore').click();
    await countParts(3);
    await tab('print').click();
    await openSection('Road segments');
    await page.locator('[name="segments"]').fill('2');
    await live();
    await action('apply').click();
    await live('idle');
    await countParts(4);
    await action('undo').click();
    await countParts(3);
    await action('redo').click();
    await countParts(4);
    await tab('print').click();
    await openSection('Road segments');
    await page.locator('#settings-form [data-action="plate"]').click();
    await page.locator('#plate-form [name="width"]').fill('60');
    await page.locator('#plate-form [name="depth"]').fill('60');
    await waitText('#plate-readout', 'Exceeds plate');
    assert.ok(
      await action('suggest').isVisible(),
      'a smaller draft plate enables segmentation',
    );
    await action('apply-plate').click();
    await waitText('#fit-result', 'over plate');
    await action('undo').click();
    await waitText('#fit-result', 'Fits plate');
    await tab('print').click();
    await openSection('Road segments');
    await page.locator('#settings-form [data-action="plate"]').click();
    await page.locator('#plate-form [name="width"]').fill('85');
    await page.locator('#plate-form [name="depth"]').fill('180');
    await action('suggest').click();
    await waitText('#dialog-content', '85 × 180 mm');
    await action('apply-suggestion').click();
    await waitText('#plate-size', '85 × 180 mm');
    assert.ok(Number(await input('segments').inputValue()) > 2);
    await action('undo').click();
    await waitText('#plate-size', '200 × 200 mm');
    assert.equal(await input('segments').inputValue(), '2');
    console.log(
      '✓ Drag border handles, live segmentation, whole-form restore, undo/redo, and print-plate warnings',
    );

    await upload('import-context', fixture);
    await waitText('#model-title', 'circuit-curve-mm.dxf');
    await countParts(1);
    await tab('profile').click();
    assert.equal(await page.locator('[name="slotWidth"]').inputValue(), '3');
    assert.equal(await page.locator('[name="braidGap"]').inputValue(), '0.7');
    await action('export-menu').click();
    const kit = await download(action('export-kit'));
    const entries = unzipSync(kit.bytes);
    assert.ok(Object.keys(entries).some((k) => k.endsWith('.stl')));
    assert.ok(entries['assembly.svg'] && entries['parts.csv']);
    assert.equal(
      JSON.parse(strFromU8(entries['project.slotfab'])).track.params.kind,
      'import',
    );
    if (await page.locator('dialog').isVisible())
      await action('close-dialog').click();
    console.log('✓ Real Circuit DXF import and build kit download');

    await tab('joints').click();
    assert.equal(await input('tabClearance').inputValue(), '0.15');
    assert.equal(await input('clipClearance').inputValue(), '0.15');
    await waitText('[data-joint-fit]', '6.00 → 6.30 mm');
    assert.equal(await input('clipType').inputValue(), 'draw-key');
    assert.equal(await input('tabThickness').inputValue(), '');
    await waitText('[data-joint-fit]', '2.76 → 3.06 mm');
    await openSection('Tab and socket');
    await input('tabClearance').fill('0.20');
    await waitText('[data-joint-fit]', '6.00 → 6.40 mm');
    await waitText('[data-clip-diagram]', '10.00 → 10.30 mm');
    await input('tabWidth').fill('7');
    await input('tabLength').fill('8');
    await input('tabThickness').fill('3');
    await waitText('[data-joint-fit]', '7.00 → 7.40 mm');
    await waitText('[data-joint-fit]', '8.00 → 8.20 mm');
    await waitText('[data-joint-fit]', '3.00 → 3.40 mm');
    await page.locator('[data-restore-field="tabWidth"]').click();
    await waitText('[data-joint-fit]', '6.00 → 6.40 mm');
    assert.equal(await input('tabLength').inputValue(), '8');
    assert.equal(await input('tabThickness').inputValue(), '3');
    await input('tabWidth').fill('7');
    await input('clipType').selectOption('carrera-retained');
    await waitText('[data-clip-diagram]', '14.80 → 15.10 mm');
    await input('clipClearance').fill('0.10');
    await waitText('[data-clip-diagram]', '14.80 → 15.00 mm');
    await live();
    const standaloneKeeperTool = await download(page.locator('#settings-form [data-action="export-keeper-tool"]'));
    assert.equal(standaloneKeeperTool.name, 'keeper-turning-tool.stl');
    assert.equal(standaloneKeeperTool.bytes.length, 84 + 50 * standaloneKeeperTool.bytes.readUInt32LE(80));
    await openSection('Test prints');
    const samples = unzipSync((await download(action('fit-samples'))).bytes);
    assert.ok(samples['retaining-clip-1.stl']);
    assert.ok(samples['retaining-clip-2.stl']);
    assert.ok(samples['keeper-turning-tool.stl']);
    assert.equal(
      Object.keys(samples).filter((n) => n.endsWith('.stl')).length,
      7,
    );
    assert.ok(
      strFromU8(samples['fit-key.txt']).includes('0.20 | 0.10  (current)'),
    );
    assert.ok(
      strFromU8(samples['fit-key.txt']).includes('7.40 × 8.20 × 3.40 mm'),
    );
    assert.match(
      strFromU8(samples['clip-attribution.txt']),
      /URSUS[\s\S]*1163344[\s\S]*by-sa\/4\.0[\s\S]*Original clip/i,
    );
    assert.match(
      strFromU8(samples['carrera-clip.stl'].subarray(0, 80)),
      /URSUS.*original clip/,
    );
    const tabProject = await download(action('save'));
    const savedFit = JSON.parse(tabProject.bytes.toString()).track.params;
    assert.deepEqual(
      [
        savedFit.tabWidth,
        savedFit.tabLength,
        savedFit.tabThickness,
        savedFit.clipType,
      ],
      [7, 8, 3, 'carrera-retained'],
    );
    await openProject(tabProject.bytes, 'custom-tab-sizes.slotfab');
    await live('idle');
    await waitText('[data-joint-fit]', '3.00 → 3.40 mm');
    assert.equal(await input('clipType').inputValue(), 'carrera-retained');
    await openSection('Tab and socket');
    await input('tabThickness').fill('');
    await waitText('[data-joint-fit]', '2.76 → 3.16 mm');
    const autoFit = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    ).track.params;
    assert.equal(autoFit.tabThickness, undefined);
    await tab('profile').click();
    await input('height').fill('14');
    await live();
    await tab('joints').click();
    await waitText('[data-joint-fit]', '3.22 → 3.62 mm');
    await action('restore').click();
    await waitText('[data-joint-fit]', '2.76 → 3.16 mm');
    assert.equal(await action('test-joint').count(), 0);
    await tab('print').click();
    await openSection('Road segments');
    await input('segments').fill('2');
    await live();
    await tab('joints').click();
    await openSection('Road connections');
    await input('joint').selectOption('both');
    await live();
    await page.locator('[data-part="road-clip-1"]').waitFor({ state: 'attached' });
    await waitText('[data-part="road-clip-1"]', 'Carrera');
    await input('clipType').selectOption('draw-key');
    await live();
    await waitText('[data-part="road-clip-1"]', 'Double-dovetail draw key');
    await selectTrackPart(page.locator('[data-part="road-clip-1-retainer"]'));
    assert.equal(await tab('joints').getAttribute('aria-pressed'), 'true');
    await openSection('Test prints');
    const standardSamples = unzipSync(
      (await download(action('fit-samples'))).bytes,
    );
    assert.ok(standardSamples['retaining-clip.stl']);
    await action('export-menu').click();
    const menuKeeperTool = await download(page.locator('#dialog [data-action="export-keeper-tool"]'));
    assert.equal(menuKeeperTool.name, standaloneKeeperTool.name);
    assert.deepEqual(menuKeeperTool.bytes, standaloneKeeperTool.bytes);
    assert.equal(standardSamples['clip-attribution.txt'], undefined);
    assert.doesNotMatch(
      strFromU8(standardSamples['draw-key.stl'].subarray(0, 80)),
      /URSUS/,
    );
    await action('bottom').click();
    await snap('recessed-draw-clip');
    await page
      .locator('#settings-form summary')
      .filter({ hasText: 'Project clip type' })
      .click();
    await openSection('Tab and socket');
    await page.locator('[data-joint-fit]').scrollIntoViewIfNeeded();
    await snap('tab-and-socket-fit');
    await action('restore').click();
    await countParts(1);
    await action('iso').click();
    console.log(
      '✓ Editable tab and socket dimensions, physical Circuit joints, both retained clip families, separate keeper exports and project round trip',
    );

    await action('mode-editor').click();
    await waitText('#model-title', 'Workshop enclosure');
    await countParts(1);
    const canvas = page.locator('#viewport canvas');
    const size = await canvas.boundingBox();
    const originalEnclosure = await download(action('save'));
    // Section is a view state. Changing the cut must never change a download.
    await action('iso').click();
    const uncutSTL = await downloadSelected();
    const sectionToggle = page.locator(
      '#view-tools [aria-label="Section view"]',
    );
    const sectionPanel = page.locator('#canvas-wrap > .section-controls');
    await sectionToggle.click();
    await sectionPanel.locator('select').selectOption('2');
    await sectionPanel.locator('[type=number]').fill('8');
    await page
      .locator('#canvas-wrap > .section-controls[data-state=ready]')
      .waitFor();
    await snap('universal-section');
    const lowView = await canvas.screenshot();
    await sectionPanel.locator('[type=checkbox]').check();
    await page
      .locator('#canvas-wrap > .section-controls[data-state=ready]')
      .waitFor();
    assert.notDeepEqual(await canvas.screenshot(), lowView);
    assert.deepEqual(
      (await downloadSelected()).bytes,
      uncutSTL.bytes,
    );
    const visibility = page.locator('[data-visible]').first();
    await visibility.click();
    await sectionPanel.getByText('Show a part to inspect it').waitFor();
    assert.ok(await sectionPanel.locator('[type=number]').isDisabled());
    await visibility.click();
    await sectionPanel.getByText('View only').waitFor();
    assert.equal(await sectionPanel.locator('[type=number]').inputValue(), '8');
    await sectionToggle.click();
    assert.ok(await sectionPanel.isHidden());
    await action('top').click();
    const postScale = Math.min(size.width / 82, size.height / 54) / 1.31;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const pickPost = ([x, y], shift) =>
      canvas.click({
        position: {
          x: size.width / 2 + x * 34.35 * postScale,
          y: size.height / 2 - y * 20.35 * postScale,
        },
        modifiers: shift ? ['Shift'] : [],
      });
    await pickPost(corners[0], false);
    await action('whole-face').click();
    await waitText('#surface-note', 'Flat face');
    await pickPost(corners[0], false);
    for (const corner of corners.slice(1)) await pickPost(corner, true);
    const selectedFaces = (n) =>
      page.locator('#selection-count[data-count="' + n + '"]').waitFor();
    await selectedFaces(4);
    await action('bottom').click();
    await canvas.click({
      position: { x: size.width / 2, y: size.height / 2 },
      modifiers: ['Shift'],
    });
    await waitText('#notice', 'same direction');
    await page.locator('#notice').click();
    await selectedFaces(4);
    await action('top').click();
    await pickPost(corners[3], true);
    await selectedFaces(3);
    await action('multi-pick').click();
    await pickPost(corners[3], false);
    await selectedFaces(4);
    await action('multi-pick').click();
    await action('iso').click();
    await snap('four-post-selection');
    await tab('move-face').click();
    await input('faceDistance').fill('-2');
    await live();
    await snap('lower-four-posts');
    await action('apply').click();
    await opCount(1);
    const editedPosts = await download(action('save'));
    const wasm = await initManifold();
    wasm.setup();
    async function verifyPostHeights(expected) {
      const printed = await downloadSelected();
      const solid = parseSTL(wasm, printed.bytes);
      try {
        const height = (x, y) =>
          solid.rayCast([x, y, 20], [x, y, -1])[0]?.position[2];
        for (const [x, y] of corners) {
          assert.ok(
            Math.abs(height(34.35 * x, 20.35 * y) - expected) < 0.002,
            'post top',
          );
          assert.ok(
            Math.abs(height(39.55 * x, 22.6 * y) - 16) < 0.002,
            'wall where the post joins it',
          );
          assert.ok(
            Math.abs(height(36.6 * x, 22.6 * y) - 2) < 0.002,
            'screw hole floor',
          );
        }
        assert.ok(Math.abs(height(0, 26) - 16) < 0.002, 'straight rim');
      } finally {
        solid.delete();
      }
    }
    await verifyPostHeights(14);
    await action('undo').click();
    await opCount(0);
    await verifyPostHeights(16);
    await openProject(editedPosts.bytes, 'four-posts.slotfab');
    await page.locator('[data-op]').first().click();
    assert.equal(await input('faceDistance').inputValue(), '-2');
    await input('faceDistance').fill('-1.5');
    await live();
    const priorEditRow = await page
      .locator('[data-op]')
      .first()
      .elementHandle();
    await action('apply').click();
    await page.waitForFunction(
      (row) =>
        !row.isConnected &&
        document.querySelector('#app').getAttribute('aria-busy') === 'false',
      priorEditRow,
    );
    await priorEditRow.dispose();
    assert.equal(await page.locator('[data-op]').count(), 1);
    await verifyPostHeights(14.5);
    await checkSteppedPosts({
      wasm,
      page,
      canvas,
      action,
      tab,
      input,
      selectedFaces,
      opCount,
      waitText,
      live,
      upload,
      download,
      downloadSelected,
      openProject,
      snap,
    });
    await checkSolidTools({
      wasm,
      page,
      action,
      tab,
      input,
      opCount,
      live,
      upload,
      download,
      downloadSelected,
      openProject,
      waitText,
      snap,
    });
    await checkAssembly({
      wasm,
      page,
      action,
      tab,
      input,
      opCount,
      live,
      upload,
      download,
      downloadSelected,
      openProject,
      waitText,
      snap,
    });
    await checkMeshWorkbench({
      wasm,
      page,
      action,
      opCount,
      upload,
      download,
      downloadSelected,
      openProject,
      waitText,
      snap,
    });
    const creationChecks = {
      wasm,
      page,
      action,
      tab,
      input,
      opCount,
      live,
      upload,
      download,
      downloadSelected,
      openProject,
      openSection,
      waitText,
      snap,
    };
    await checkSketchCreation(creationChecks);
    await checkCreationSolids(creationChecks);
    await checkBracket(creationChecks);
    await checkFinishTools(creationChecks);
    await checkModifyHoles(creationChecks);
    await checkHealStretch(creationChecks);
    await checkWallEdge(creationChecks);
    await checkRoundedCorner(creationChecks);
    await checkFaceGrid(creationChecks);
    await checkViewSelector(creationChecks);
    await checkConnectorPlacement(creationChecks);
    await checkSolidMove(creationChecks);
    await checkTrackChannel(creationChecks);
    await checkScaleCar(creationChecks);
    await checkTrackProfileEdges(creationChecks);
    await checkBorderApices(creationChecks);
    await checkShapedTrack(creationChecks);
    await checkCustomTrack(creationChecks);
    await checkSpecialTrackPieces(creationChecks);
    await checkDrawFlatCrossing(creationChecks);
    await checkImportFlatCrossing(creationChecks);
    await checkRampExports(creationChecks);
    await checkTrackLibrary(creationChecks);
    await checkStartingGrid(creationChecks);
    await checkPitGrid(creationChecks);
    await checkUndersideRibs(creationChecks);
    await checkRoadMarkings(creationChecks);
    await openProject(originalEnclosure.bytes, 'enclosure.slotfab');
    console.log(
      '✓ Shift-click and additive picking lower four screw posts in one reversible edit, preserving wall and hole geometry in the exported STL',
    );
    assert.ok(await page.locator('#face-actions').isHidden());
    await tab('trim-top').click();
    await input('trimAmount').fill('4');
    await live();
    await waitText('#selected-size', '82 × 54 × 12 mm');
    await waitText('#trim-size', '16 → 12 mm');
    await input('trimMode').selectOption('remaining');
    assert.equal(await input('trimAmount').inputValue(), '12');
    await live();
    await guide('trim-plane').waitFor({ state: 'attached' });
    await page.locator('button[data-face-handle]').press('ArrowDown');
    assert.ok(Number(await input('trimAmount').inputValue()) < 12);
    await input('trimAmount').fill('16');
    await waitText('#live-status', 'removes no material');
    assert.ok(await action('apply').isDisabled());
    await input('trimAmount').fill('12');
    await live();
    await action('apply').click();
    await opCount(1);
    const trimmedEnclosure = await download(action('save'));
    const trimEdit = JSON.parse(trimmedEnclosure.bytes).editor.ops[0];
    assert.equal(trimEdit.type, 'trimFace');
    assert.equal(trimEdit.reference, 'top');
    await openProject(trimmedEnclosure.bytes, 'trimmed-enclosure.slotfab');
    await page.locator('[data-op]').first().click();
    assert.equal(await input('trimAmount').inputValue(), '12');
    await input('trimAmount').fill('14');
    await live();
    await action('apply').click();
    await waitText('#selected-size', '82 × 54 × 14 mm');
    await openProject(originalEnclosure.bytes, 'test-enclosure.slotfab');
    await opCount(0);
    await action('top').click();
    const pxPerMm = Math.min(size.width / 82, size.height / 54) / 1.31;
    await canvas.click({
      position: { x: size.width / 2, y: size.height / 2 - 26 * pxPerMm },
    });
    await waitText('#surface-note', 'Flat face');
    assert.equal(await page.locator('[data-op]').count(), 0);
    assert.equal(await action('save').innerText(), 'Save');
    assert.ok(await page.locator('#face-actions').isVisible());
    await tab('trim-face').click();
    await input('trimAmount').fill('3');
    await live();
    await waitText('#selected-size', '82 × 54 × 13 mm');
    await action('iso').click();
    await snap('trim-selected-face');
    await action('top').click();
    await tab('select').click();
    await waitText('#selected-size', '82 × 54 × 16 mm');
    await tab('cut-shape').click();
    await input('profileKind').selectOption('face');
    await input('depth').fill('2');
    await live();
    await waitText('#selected-size', '82 × 54 × 14 mm');
    await tab('select').click();
    await tab('move-face').click();
    assert.equal(await input('faceDistance').inputValue(), '0');
    assert.ok(await action('apply').isDisabled());
    await page.locator('[data-move-sign="1"]').click();
    assert.equal(await input('faceDistance').inputValue(), '1');
    await page.locator('[data-move-sign="-1"]').click();
    assert.equal(await input('faceDistance').inputValue(), '-1');
    await input('faceDistance').fill('0');
    await action('iso').click();
    const faceHandle = page.locator('button[data-face-handle]');
    // Guide positions update when the viewport presents the new camera.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    await faceHandle.hover();
    const handleBox = await faceHandle.boundingBox();
    const handleX = handleBox.x + handleBox.width / 2,
      handleY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX, handleY + 10, { steps: 4 });
    await page.mouse.up();
    assert.ok(
      Number(await input('faceDistance').inputValue()) < 0,
      'dragging the top face down moves it inward',
    );
    await input('faceDistance').fill('-4');
    assert.equal(
      await page.locator('[data-move-sign="-1"]').getAttribute('aria-pressed'),
      'true',
    );
    await live();
    await waitText('#selected-size', '82 × 54 × 12 mm');
    assert.ok(await input('separate').isDisabled());
    await snap('move-face');
    await action('apply').click();
    await opCount(1);
    await waitText('#selected-size', '82 × 54 × 12 mm');
    const shortened = await download(action('save'));
    await action('undo').click();
    await waitText('#selected-size', '82 × 54 × 16 mm');
    await openProject(shortened.bytes, 'shorter-enclosure.slotfab');
    await page.locator('[data-op]').first().click();
    assert.equal(await input('faceDistance').inputValue(), '-4');
    await input('faceDistance').fill('-3');
    await live();
    await action('apply').click();
    await waitText('#selected-size', '82 × 54 × 13 mm');
    await opCount(1);
    await openProject(originalEnclosure.bytes, 'original-enclosure.slotfab');
    await opCount(0);
    console.log(
      '✓ Selecting the rim is neutral; dragging or entering a distance lowers its height; Undo and editable history round-trip',
    );
    await action('top').click();
    await action('measure').click();
    await canvas.click({
      position: { x: size.width / 2 - 12 * pxPerMm, y: size.height / 2 },
    });
    await canvas.click({
      position: { x: size.width / 2 + 12 * pxPerMm, y: size.height / 2 },
    });
    await action('calibrate').click();
    await page.locator('#scale-form input[name="known"]').fill('48');
    await action('apply-calibration').click();
    await opCount(1);
    const calibrated = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    ).editor.ops[0];
    assert.ok(Math.abs(calibrated.scale - 2) < 0.025);
    await action('undo').click();
    await opCount(0);
    await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
    await tab('cut-shape').click();
    await input('profileKind').selectOption('slot');
    await input('shapeHeight').fill('4');
    await input('shapeWidth').fill('3');
    await waitText(
      '#live-status',
      'Slot overall length must be at least its width',
    );
    assert.ok(await action('apply').isDisabled());
    await input('shapeWidth').fill('18');
    await input('depth').fill('1');
    await input('rotation').fill('90');
    await live();
    await guide('profile-tip').waitFor({ state: 'attached' });
    await action('apply').click();
    await opCount(1);
    const slotted = await download(action('save'));
    await openProject(slotted.bytes, 'slotted-floor.slotfab');
    await page.locator('[data-op]').first().click();
    assert.equal(await input('profileKind').inputValue(), 'slot');
    assert.equal(await input('shapeWidth').inputValue(), '18');
    assert.equal(await input('shapeHeight').inputValue(), '4');
    assert.equal(await input('rotation').inputValue(), '90');
    await input('shapeWidth').fill('20');
    await input('shapeHeight').fill('5');
    await live();
    await action('apply').click();
    await input('rotation').waitFor({ state: 'detached' });
    const [revisedSlot] = JSON.parse((await download(action('save'))).bytes)
      .editor.ops;
    assert.equal(revisedSlot.shapeWidth, 20);
    assert.equal(revisedSlot.shapeHeight, 5);
    assert.equal(Math.max(...revisedSlot.loops[0].map(([x]) => x)), 10);
    await openProject(originalEnclosure.bytes, 'original-enclosure.slotfab');
    await opCount(0);
    await action('top').click();
    await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
    await tab('cut-shape').click();
    await upload('import-shape', {
      name: 'recess.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="4mm" height="4mm" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
      ),
    });
    await live();
    assert.equal(await input('operation').inputValue(), 'cut');
    assert.equal(await input('separate').count(), 0);
    assert.equal(await input('extent').inputValue(), 'distance');
    await input('extent').selectOption('through');
    await live();
    assert.ok(await input('depth').isHidden());
    await waitText('[data-guide="profile-tip"]', 'Through part');
    await page.locator('[data-restore-field="extent"]').click();
    await live();
    assert.ok(await input('depth').isVisible());
    await tab('move-face').click();
    await waitText('#surface-note', 'Flat face');
    assert.ok(await input('faceDistance').isVisible());
    await tab('select').click();
    await waitText('#surface-note', 'Flat face');
    console.log(
      '✓ Two picked points lead directly to scale calibration, and an imported cut keeps its direction',
    );
    await tab('transform').click();
    await guide('transform-bounds').waitFor({ state: 'attached' });
    const enclosure = await canvas.screenshot();
    await input('scale').fill('1.01');
    await live();
    await assertSolidAfterScaling(canvas, enclosure);
    await action('apply').click();
    await opCount(1);
    await assertSolidAfterScaling(canvas, enclosure);
    await action('undo').click();
    await opCount(0);
    console.log(
      '✓ A 1% scale change preserves the visible enclosure in live and applied geometry',
    );
    await tab('shape').click();
    await action('top').click();
    await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
    await waitText('#inspector', 'triangles selected');
    await guide('profile-base').waitFor({ state: 'attached' });
    await snap('editor');
    await upload('import-shape', {
      name: 'nameplate.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="5mm" viewBox="0 0 20 5"><rect width="20" height="5"/></svg>',
      ),
    });
    await page.waitForFunction(
      () => document.querySelector('[name="profileKind"]')?.value === 'drawing',
    );
    await page.locator('[name="separate"]').check();
    await live();
    await action('apply').click();
    await countParts(2);
    await action('export-menu').click();
    await page.getByText('Other STL outputs', { exact: true }).click();
    const attachment = await download(action('export-additions'));
    assert.ok(attachment.bytes.readUInt32LE(80) >= 12);
    if (await page.locator('dialog').isVisible())
      await action('close-dialog').click();
    const originalArtwork = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    ).editor.ops[0];
    await page.locator('[data-op]').first().click();
    await action('cancel-op').waitFor();
    await canvas.click({
      position: { x: size.width / 2 + 25, y: size.height / 2 },
    });
    await waitText('#surface-note', 'triangles selected');
    await upload('import-shape', {
      name: 'replacement.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="4mm" height="4mm" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
      ),
    });
    await waitText('#inspector', 'replacement.svg');
    await action('restore').click();
    await waitText('#surface-note', 'Saved placement');
    await waitText('#inspector', 'nameplate.svg');
    await action('apply').click();
    await action('cancel-op').waitFor({ state: 'detached' });
    const restoredArtwork = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    ).editor.ops[0];
    assert.deepEqual(restoredArtwork, originalArtwork);
    // Updating a history entry first restores its previous revision on Undo.
    await action('undo').click();
    await countParts(2);
    await action('undo').click();
    await countParts(1);
    await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
    await tab('tilt').click();
    await waitText('#inspector', 'Flat face selected');
    await guide('tilt-hinge').waitFor({ state: 'attached' });
    await input('faceAngle').fill('-2');
    assert.equal(await input('separate').isDisabled(), true);
    await input('faceAngle').fill('3');
    await input('hingeRotation').fill('17');
    await input('pivotOffset').fill('2.5');
    await input('separate').check();
    await live();
    await countParts(2);
    await guide('tilted-face').waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-op]').count(), 0);
    await action('apply').click();
    await opCount(1);
    await countParts(2);
    const tiltProject = JSON.parse(
      (await download(action('save'))).bytes.toString(),
    );
    const tilt = tiltProject.editor.ops[0];
    assert.equal(tilt.separate, true);
    assert.equal(tilt.hingeRotation, 17);
    assert.equal(tilt.pivotOffset, 2.5);
    await action('export-menu').click();
    const wedge = await download(action('export-part'));
    assert.match(wedge.name, /wedge/i);
    assert.equal(wedge.bytes.length, 84 + 50 * wedge.bytes.readUInt32LE(80));
    await action('undo').click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-op]').length === 0,
    );
    console.log(
      '✓ SVG addition and angled, offset tilt wedge export as independent STLs',
    );
    // Split is one of the two ways of the Cut tool.
    await tab('trim-top').click();
    await tab('split').click();
    await action('iso').click();
    await live();
    await countParts(2);
    const plane = guide('cut-plane').locator('path.guide-line.surface').first();
    await plane.waitFor({ state: 'attached' });
    await guide('donor-0').waitFor({ state: 'attached' });
    const startPlane = await plane.getAttribute('d');
    await input('position').fill('2');
    await live();
    const projectedPlaneMoved = (previous) =>
      page.waitForFunction((last) => {
        const d = document
          .querySelector('[data-guide="cut-plane"] .surface')
          ?.getAttribute('d');
        return d?.startsWith('M') && d !== last;
      }, previous);
    await projectedPlaneMoved(startPlane);
    await snap('split-live');
    // Every projected vertex follows the pointer on a pan. Rotation or zoom
    // changes the distances between vertices, even if the guide also moves.
    const planeCoords = (d) => d.match(/-?[\d.]+/g).map(Number);
    // The moved plane can take a few redraws to arrive: start from where it settles.
    const settled = async () => {
      let last = await plane.getAttribute('d');
      for (let still = 0; still < 5; ) {
        await page.waitForTimeout(100);
        const now = await plane.getAttribute('d');
        still = now === last ? still + 1 : 0;
        last = now;
      }
      return last;
    };
    // Leave the position field first: on Linux a middle click pastes the
    // selection, which would change the cut position during the pan.
    await page.evaluate(() => document.activeElement?.blur());
    const positionBefore = await input('position').inputValue();
    const panStart = await settled();
    const initialCoords = planeCoords(panStart);
    assert.ok(initialCoords.length >= 6);
    // The view can settle over a few frames; wait for the guide to arrive.
    const planeShifted = (dx, dy) =>
      page
        .waitForFunction(
          ([start, dx, dy]) => {
            const d = document.querySelector('[data-guide="cut-plane"] .surface')?.getAttribute('d');
            const c = d?.match(/-?[\d.]+/g)?.map(Number);
            return (
              c?.length === start.length &&
              c.every((v, i) => Math.abs(v - (start[i] + (i % 2 === 0 ? dx : dy))) < 0.25)
            );
          },
          [initialCoords, dx, dy],
          { timeout: 5000 },
        )
        .catch(() => {});
    function assertPlaneShift(path, dx, dy) {
      const coords = planeCoords(path);
      assert.equal(coords.length, initialCoords.length);
      coords.forEach((value, i) => {
        const expected = initialCoords[i] + (i % 2 === 0 ? dx : dy);
        assert.ok(
          Math.abs(value - expected) < 0.25,
          `expected ${expected}, got ${value} (shift ${dx}, ${dy}; start ${initialCoords.join(' ')}; now ${coords.join(' ')})`,
        );
      });
    }
    const panX = Math.round(size.x + size.width / 2);
    const panY = Math.round(size.y + size.height / 2);
    await page.mouse.move(panX, panY);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(panX + 48, panY - 24);
    await page.mouse.up({ button: 'middle' });
    await projectedPlaneMoved(panStart);
    await planeShifted(48, -24);
    assert.equal(await input('position').inputValue(), positionBefore, 'the pan changed the cut position');
    const panned = await plane.getAttribute('d');
    assertPlaneShift(panned, 48, -24);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.move(panX, panY);
    await page.mouse.up();
    await page.keyboard.up('Control');
    await projectedPlaneMoved(panned);
    await planeShifted(0, 0);
    assertPlaneShift(await plane.getAttribute('d'), 0, 0);
    const beforeZoom = await plane.getAttribute('d');
    await page.mouse.wheel(0, -120);
    await projectedPlaneMoved(beforeZoom);
    const edgeLength = ([x0, y0, x1, y1]) => Math.hypot(x1 - x0, y1 - y0);
    assert.ok(
      edgeLength(planeCoords(await plane.getAttribute('d'))) >
        edgeLength(initialCoords),
    );
    console.log(
      '✓ Middle-button pan tracks the pointer, Ctrl-drag pans back, and the wheel zooms',
    );
    const beforeOrbit = await plane.getAttribute('d');
    await page.mouse.move(
      size.x + size.width * 0.45,
      size.y + size.height * 0.55,
    );
    await page.mouse.down();
    await page.mouse.move(
      size.x + size.width * 0.5,
      size.y + size.height * 0.58,
      { steps: 6 },
    );
    await page.mouse.up();
    await projectedPlaneMoved(beforeOrbit);
    await action('restore').click();
    await live('idle');
    await countParts(1);
    await page.locator('[name="position"]').fill('100000');
    await live('error');
    await waitText('#live-status', 'inside the model');
    await countParts(1);
    assert.equal(await page.locator('[data-op]').count(), 0);
    await page.locator('[name="position"]').fill('0');
    await live();
    await action('apply').click();
    await countParts(2);
    await opCount(1);
    assert.equal(await page.locator('[data-op]').count(), 1);
    console.log(
      '✓ Viewport face pick, invalid split recovery, and split/rebuild',
    );

    const projectFile = await download(action('save'));
    const project = JSON.parse(projectFile.bytes.toString());
    assert.equal(project.mode, 'editor');
    assert.equal(project.editor.ops[0].type, 'split');
    assert.equal(project.editor.ops[0].rebuild, true);
    await action('export-menu').click();
    const partButton = page
      .locator('dialog button')
      .filter({ hasText: /selected part/i })
      .first();
    const stl = await download(partButton);
    const facets = stl.bytes.readUInt32LE(80);
    assert.ok(facets > 0);
    assert.equal(stl.bytes.length, 84 + 50 * facets);
    if (await page.locator('dialog').isVisible())
      await action('close-dialog').click();
    await upload('import-context', {
      name: 'roundtrip.stl',
      mimeType: 'application/octet-stream',
      buffer: stl.bytes,
    });
    await waitText('#model-title', 'roundtrip.stl');
    await countParts(1);
    assert.equal(await page.locator('[data-op]').count(), 0);
    await action('open').click();
    await upload('browse', {
      name: 'roundtrip.slotfab',
      mimeType: 'application/json',
      buffer: projectFile.bytes,
    });
    await waitText('#model-title', 'Workshop enclosure');
    await countParts(2);
    assert.equal(await page.locator('[data-op]').count(), 1);
    console.log('✓ Binary STL and editable project round trips');
    // Sloped roof panels meet at 17°. Widening the boundary angle should
    // include the adjacent panel while the original pick remains fixed.
    const roofHeight = 9,
      eaveHeight = 6;
    const section = [
      [-20, 0],
      [20, 0],
      [20, eaveHeight],
      [0, roofHeight],
      [-20, eaveHeight],
    ];
    const pts = [-10, 10].flatMap((y) => section.map(([x, z]) => [x, y, z]));
    const tris = [];
    for (let i = 1; i < 4; i++) tris.push([0, i, i + 1], [5, 6 + i, 5 + i]);
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5;
      tris.push([j, i, i + 5], [j, i + 5, j + 5]);
    }
    const ascii =
      'solid roof\n' +
      tris
        .map(
          (tri) =>
            'facet normal 0 0 0\nouter loop\n' +
            tri.map((i) => 'vertex ' + pts[i].join(' ')).join('\n') +
            '\nendloop\nendfacet',
        )
        .join('\n') +
      '\nendsolid roof';
    await upload('import-context', {
      name: 'folded-roof.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(ascii),
    });
    await waitText('#model-title', 'folded-roof.stl');
    await tab('shape').click();
    await action('top').click();
    await canvas.click({
      position: { x: size.width * 0.4, y: size.height * 0.5 },
    });
    await waitText('#surface-note', 'Flat face');
    const originalSelection = await page.locator('#surface-note').textContent();
    await page
      .locator('#settings-form summary')
      .filter({ hasText: 'Surface selection' })
      .click();
    const angle = input('tolerance');
    await angle.fill('24');
    await waitText('#surface-note', 'Curved region');
    assert.ok(
      await angle.evaluate((el) => el === document.activeElement),
      'repicking preserves numeric focus',
    );
    await page.locator('[data-restore-field="tolerance"]').click();
    await waitText('#surface-note', originalSelection);
    console.log(
      '✓ Boundary angle regroups the original surface immediately and Restore recovers the flat face',
    );
    const markedCurve = structuredClone(savedWhileDrafting);
    markedCurve.name = 'Marked curve';
    Object.assign(markedCurve.track.params, {
      whiteLineRoad: 'both',
      whiteLineWidth: 4,
      whiteLineGroove: true,
      braidFeedSide: 'both',
      braidFeedLane: 1,
      braidFeedLength: 4.3,
    });
    await openProject(
      Buffer.from(JSON.stringify(markedCurve)),
      'curve.slotfab',
    );
    await waitText('#model-title', 'Marked curve');
    await countParts(3);
    await tab('profile').click();
    await action('top').click();
    const stripeImage = await trackCanvas.screenshot();
    const stripes = await page.evaluate(
      async ([base64, stripeFraction]) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + base64;
        await img.decode();
        const buffer = document.createElement('canvas');
        const w = (buffer.width = img.width),
          h = (buffer.height = img.height);
        const ctx = buffer.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        const brightness = (x, y) => {
          const i = 4 * (w * y + x);
          return Math.min(data[i], data[i + 1], data[i + 2]);
        };
        // Learn the road's rendered colour from its broad, flat deck. This
        // works under both lighting paths and lets the test follow the road
        // after a camera refit without assuming fixed screen-space Y bands.
        const shades = new Map();
        for (let y = 0; y < h; y++) {
          const i = 4 * (w * y + Math.floor(w / 2));
          const [r, g, b] = data.subarray(i, i + 3);
          const high = Math.max(r, g, b);
          if (high > 180 || high - Math.min(r, g, b) > 45) continue;
          const rgb = (r << 16) | (g << 8) | b;
          shades.set(rgb, (shades.get(rgb) ?? 0) + 1);
        }
        const [road] = [...shades].sort((a, b) => b[1] - a[1])[0] ?? [];
        if (road === undefined)
          throw Error('The painted bend has no visible road deck.');
        const rgb = [road >> 16, (road >> 8) & 255, road & 255];
        const sides = [0, 1].map(() => ({ samples: 0, dark: 0, missing: 0 }));
        for (let x = Math.ceil(w * 0.32); x < w * 0.68; x++) {
          let top = h,
            bottom = -1;
          for (let y = 0; y < h; y++) {
            const i = 4 * (w * y + x);
            if (rgb.some((c, channel) => Math.abs(c - data[i + channel]) > 6))
              continue;
            top = Math.min(top, y);
            bottom = y;
          }
          // Include the full stripe even if a scratch has deck-coloured pixels.
          const reach = Math.ceil(3 * (bottom - top) * stripeFraction) + 3;
          for (const [side, edge] of [top, bottom].entries()) {
            const stats = sides[side];
            let first = -1,
              last = -1;
            const low = Math.max(0, edge - reach);
            const high = Math.min(h - 1, edge + reach);
            for (let y = low; y <= high; y++) {
              if (brightness(x, y) < 252) continue;
              if (first === -1) first = y;
              last = y;
            }
            // Omit two antialiased boundary pixels at either edge of the band.
            if (last - first < 4) stats.missing++;
            for (let y = first + 2; y <= last - 2; y++) {
              stats.samples++;
              if (brightness(x, y) < 235) stats.dark++;
            }
          }
        }
        return sides;
      },
      [
        stripeImage.toString('base64'),
        markedCurve.track.params.whiteLineWidth /
          markedCurve.track.params.width,
      ],
    );
    for (const stripe of stripes) {
      assert.equal(
        stripe.missing,
        0,
        'the white stripe crosses each sampled road column',
      );
      assert.ok(stripe.samples > 1200, 'the white stripe is visible');
      assert.equal(
        stripe.dark,
        0,
        'interior of the curved white stripe is continuous',
      );
    }
    console.log(
      '✓ Painted bend stays continuous across the underlying mesh triangles',
    );
    await openProject(originalEnclosure.bytes, 'resize-enclosure.slotfab');
    await tab('transform').click();
    await input('rz').fill('90');
    await live();
    await page.getByText('Size by dimension', { exact: true }).click();
    const targetSize = page.locator('[data-size-target]');
    await page.waitForFunction(
      () => Number(document.querySelector('[data-size-target]')?.value) === 54,
    );
    await targetSize.fill('27');
    await live();
    await waitText('#selected-size', '27 × 41 × 8 mm');
    await action('apply').click();
    await opCount(1);
    assert.equal(
      JSON.parse((await download(action('save'))).bytes).editor.ops[0].scale,
      0.5,
    );
    await page.setViewportSize({ width: 780, height: 820 });
    await page.locator('#project-toggle').click();
    assert.equal(
      await page.locator('#project-toggle').getAttribute('aria-expanded'),
      'true',
    );
    assert.ok(await page.locator('#project-panel [data-op]').isVisible());
    await page.keyboard.press('Escape');
    assert.equal(
      await page.locator('#project-toggle').getAttribute('aria-expanded'),
      'false',
    );
    assert.ok(
      await page
        .locator('#project-toggle')
        .evaluate((el) => el === document.activeElement),
    );
    console.log(
      '✓ Proportional target size respects rotation, and the compact project panel exposes history',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#project-toggle').click();
    await tab('trim-top').click();
    await input('trimAmount').waitFor();
    assert.equal(
      await page.locator('#project-toggle').getAttribute('aria-expanded'),
      'false',
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.locator('#project-toggle').click();
    await tab('select').click();
    await action('mode-track').click();
    await tab('borders').click();
    await input('borderSide').waitFor();
    await snap('narrow-track-workspace');
    assert.ok(await action('mode-library').isVisible());
    assert.ok(await action('edit-part').isVisible());
    await action('reveal-selected').click();
    assert.equal(
      await page.locator('#project-toggle').getAttribute('aria-expanded'),
      'true',
    );
    // A pack piece shows its pack rail; other projects the create buttons.
    assert.ok(
      (await page.locator('#pack-rail').isVisible()) ||
        ((await action('new-custom').isVisible()) &&
          (await action('import-context').isVisible())),
    );
    await page.keyboard.press('Escape');
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    console.log(
      '✓ Tools and part settings remain reachable in the narrow layout',
    );
    assert.deepEqual(failures, []);
    assert.deepEqual(externalRequests, []);
    console.log(
      '✓ Offline file app completes workflows without external requests or uncaught page errors',
    );
  } catch (e) {
    console.error(
      'Workbench status:',
      await page
        .locator('#status')
        .textContent({ timeout: 1000 })
        .catch(() => 'not rendered'),
    );
    console.error(
      'Workbench notice:',
      await page
        .locator('#notice')
        .textContent({ timeout: 1000 })
        .catch(() => 'not rendered'),
    );
    console.error('Uncaught errors:', failures);
    console.error('Console errors:', consoleErrors);
    console.error(
      'Live edit:',
      await page
        .locator('#live-status')
        .textContent({ timeout: 1000 })
        .catch(() => 'not rendered'),
    );
    throw e;
  }
} finally {
  if (context) await context.close();
  const owned = await realpath(testDir);
  if (
    dirname(owned) !== (await realpath(tmpdir())) ||
    !/^slotforge-browser-test-[\w-]+$/.test(basename(owned))
  ) {
    throw Error('Unexpected browser test directory. Leaving it in place.');
  }
  await rm(owned, { recursive: true, force: true, maxRetries: 3 });
}

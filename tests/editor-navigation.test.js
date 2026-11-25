// The left column of STL Edit: Split & rebuild has an entry of its own and
// is also a mode of the Cut tool.
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorNavigation } from '../src/inspector.js';

const active = (html) =>
  [...html.matchAll(/data-tab="([^"]+)"[^>]*class="active"/g)].map((m) => m[1]);

test('Split & rebuild has its own entry in the left column', () => {
  const html = editorNavigation({ tab: 'select' });
  assert.match(html, /data-tab="split"[^>]*>.*?<span>Split &amp; rebuild<\/span>/);
  // It comes straight after Cut.
  assert.ok(html.indexOf('data-tab="trim-top"') < html.indexOf('data-tab="split"'));
});

test('only the entry of the open Cut mode lights up', () => {
  assert.deepEqual(active(editorNavigation({ tab: 'split' })), ['split']);
  assert.deepEqual(active(editorNavigation({ tab: 'trim-top' })), ['trim-top']);
  assert.deepEqual(active(editorNavigation({ tab: 'split', measuring: true })), []);
});

test('without a part there is nothing to split', () => {
  assert.doesNotMatch(editorNavigation({ tab: 'primitive', hasParts: false }), /data-tab="split"/);
});

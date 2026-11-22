import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as tick } from 'node:timers/promises';
import { createLivePreview } from '../src/live-preview.js';

test('live input coalesces expensive builds and ignores superseded results and errors', async () => {
  const jobs = [],
    shown = [],
    failures = [];
  const preview = createLivePreview({
    delay: 0,
    build: (trial) =>
      new Promise((resolve, reject) => jobs.push({ trial, resolve, reject })),
    show: (trial, result) => shown.push([trial, result]),
    fail: (e) => failures.push(e.message),
  });
  preview.schedule('1');
  preview.schedule('12');
  await tick(5);
  assert.deepEqual(
    jobs.map((j) => j.trial),
    ['12'],
  );
  preview.schedule('125');
  preview.schedule('125.5');
  await tick(5);
  assert.equal(jobs.length, 1);
  jobs[0].reject(Error('obsolete error'));
  await tick(0);
  assert.deepEqual(
    jobs.map((j) => j.trial),
    ['12', '125.5'],
  );
  jobs[1].resolve('mesh');
  await tick(0);
  assert.deepEqual(shown, [['125.5', 'mesh']]);
  assert.deepEqual(failures, []);
  preview.schedule('invalid');
  await tick(5);
  jobs[2].reject(Error('invalid depth'));
  await tick(0);
  assert.deepEqual(failures, ['invalid depth']);
});

test('restoring a field or leaving a tool invalidates a pending build without presenting it', async () => {
  let complete,
    calls = 0;
  const shown = [];
  const preview = createLivePreview({
    delay: 0,
    build: () => {
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    show: (v) => shown.push(v),
    fail: assert.fail,
  });
  preview.schedule('draft');
  await tick(5);
  preview.schedule('new field value');
  preview.cancel();
  complete('old mesh');
  await tick(5);
  assert.equal(calls, 1);
  assert.deepEqual(shown, []);
});

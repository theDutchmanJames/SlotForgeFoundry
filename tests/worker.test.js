import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerClient } from '../src/worker-client.js';

test('a cancelled operation cannot overwrite the committed model, and the next export restores it', async () => {
  const workers = [],
    requests = [];
  const factory = () => {
    const w = {
      terminate() {
        this.terminated = true;
      },
      postMessage(m) {
        requests.push([this, m]);
      },
    };
    workers.push(w);
    queueMicrotask(() => w.onmessage({ data: { ready: true } }));
    return w;
  };
  const saved = { name: 'saved' };
  const client = createWorkerClient(factory, () => saved);
  const pending = client.call('build', { name: 'unapplied' });
  const rejection = assert.rejects(pending, /cancelled/);
  client.stop();
  await rejection;
  assert.ok(workers[0].terminated);
  const result = client.call('export', { id: 'road-1' });
  const [second, restore] = requests.at(-1);
  assert.equal(restore.method, 'build');
  assert.equal(restore.args, saved);
  workers[0].onerror({ message: 'Delayed error from the terminated worker' });
  assert.ok(!second.terminated);
  second.onmessage({ data: { id: restore.id, value: [] } });
  await new Promise((resolve) => setImmediate(resolve));
  const [, request] = requests.at(-1);
  assert.equal(request.method, 'export');
  second.onmessage({ data: { id: request.id, value: 123 } });
  assert.equal(await result, 123);
  client.stop();
});

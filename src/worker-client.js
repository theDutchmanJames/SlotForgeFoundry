// Terminating a worker is the only way to interrupt a synchronous WASM boolean.
// After a cancellation the next query reconstructs the last accepted project.
export function createWorkerClient(
  factory,
  currentProject,
  onPending = () => {},
) {
  let worker = null,
    nextId = 0,
    needsRestore = false,
    restoring = null,
    bootTimer;
  const requests = new Map();
  // Background jobs (the Track Planner preparing pieces) never show Cancel.
  const waiting = () =>
    [...requests.values()].filter((job) => !job.background).length;
  function stop(
    reason = 'Calculation cancelled. Your last applied model is still available.',
  ) {
    clearTimeout(bootTimer);
    worker?.terminate();
    worker = null;
    needsRestore = true;
    restoring = null;
    for (const job of requests.values()) job.reject(Error(reason));
    requests.clear();
    onPending(0);
  }
  function post(method, args, background = false) {
    if (!worker) {
      const active = (worker = factory());
      bootTimer = setTimeout(
        () => stop('Geometry startup timed out. Retry to start a new worker.'),
        30000,
      );
      worker.onmessage = ({ data }) => {
        if (worker !== active) return;
        if (data.ready) {
          clearTimeout(bootTimer);
          return;
        }
        const job = requests.get(data.id);
        if (!job) return;
        requests.delete(data.id);
        onPending(waiting());
        if (data.error) {
          const error = new Error(data.error);
          if (data.warning) error.warning = data.warning;
          job.reject(error);
        } else job.resolve(data.value);
      };
      worker.onerror = (e) => {
        if (worker === active)
          stop(
            e.message || 'The geometry worker stopped. Retry the operation.',
          );
      };
      worker.onmessageerror = () => {
        if (worker === active)
          stop('The worker response could not be read. Retry the operation.');
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      requests.set(id, { resolve, reject, background });
      onPending(waiting());
      try {
        worker.postMessage({ id, method, args });
      } catch (e) {
        requests.delete(id);
        onPending(waiting());
        reject(e);
      }
    });
  }
  // Methods that take everything they need in their arguments: a new worker
  // can answer them without first rebuilding the open project.
  const stateless = new Set([
    'build',
    'parse',
    'plannerSource',
    'plannerSupports',
    'plannerPrint',
    'keeperToolSTL',
    'buildingParts',
    'buildingKit',
  ]);
  async function call(method, args, { background = false } = {}) {
    if (needsRestore && !stateless.has(method)) {
      const existing = currentProject();
      if (existing) {
        const recovery = (restoring ??= post('build', existing));
        try {
          await recovery;
          if (restoring === recovery) needsRestore = false;
        } finally {
          if (restoring === recovery) restoring = null;
        }
      }
    }
    const value = await post(method, args, background);
    if (method === 'build') needsRestore = false;
    return value;
  }
  // Someone is now waiting for the background work: count it, so Cancel shows.
  function promote() {
    for (const job of requests.values()) job.background = false;
    onPending(waiting());
  }
  return { call, stop, promote };
}

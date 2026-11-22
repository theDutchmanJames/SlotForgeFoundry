// A worker boolean cannot be interrupted between faces. Keep one job in flight
// and coalesce newer inputs so a slow result never replaces a later edit.
export function createLivePreview({ build, show, fail, delay = 160 }) {
  let generation = 0;
  let timer,
    pending,
    running = false;
  function cancel() {
    generation++;
    clearTimeout(timer);
    pending = null;
  }
  async function run() {
    if (running || !pending?.ready) return;
    running = true;
    const job = pending;
    pending = null;
    try {
      const result = await build(job.trial);
      if (job.generation === generation) show(job.trial, result);
    } catch (error) {
      if (job.generation === generation) fail(error);
    } finally {
      running = false;
      if (pending?.ready) void run();
    }
  }
  function schedule(trial) {
    cancel();
    const job = (pending = { trial, generation, ready: false });
    timer = setTimeout(() => {
      job.ready = true;
      void run();
    }, delay);
  }
  return { schedule, cancel };
}

// 活跃时钟：只在运行态累计 wall-clock，支持暂停/恢复。nowFn 可注入（测试/确定性）。
export function createClock(nowFn = () => Date.now(), { startPaused = false } = {}) {
  let running = !startPaused;
  let lastNow = nowFn();
  let accumulated = 0;

  function sync() {
    const now = nowFn();
    if (running) accumulated += now - lastNow;
    lastNow = now;
  }

  return {
    pause() {
      if (!running) return;
      sync();
      running = false;
    },
    resume() {
      if (running) return;
      lastNow = nowFn();
      running = true;
    },
    get ms() {
      sync();
      return Math.max(0, accumulated);
    },
  };
}

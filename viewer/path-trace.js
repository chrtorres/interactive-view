// Times are in simulation seconds. A rewind starts a new segment.
export function createPathTrace({ interval = .12, duration = 12 } = {}) {
  if (!Number.isFinite(interval) || !Number.isFinite(duration) || interval <= 0 || duration < interval) {
    throw new RangeError("Expected finite path timing with 0 < interval <= duration");
  }
  const samples = [];
  let lastTime = -Infinity;
  function clear() {
    samples.length = 0;
    lastTime = -Infinity;
  }
  return {
    clear,
    sample(time, point) {
      if (!Number.isFinite(time) || point.length !== 3 || ![...point].every(Number.isFinite)) {
        throw new TypeError("Expected a finite time and XYZ coordinates");
      }
      if (time < lastTime) clear();
      lastTime = time;
      if (samples.length && time - samples.at(-1).time < interval) return false;
      samples.push({ time, point: [...point] });
      while (time - samples[0].time > duration) samples.shift();
      return true;
    },
    points: () => samples.map(({point}) => [...point]),
  };
}

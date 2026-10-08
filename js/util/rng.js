// 确定性随机工具：mulberry32 + 权重采样。纯函数，无 DOM 依赖。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// 按权重返回一个键；总和 <= 0 时回退等概率；无键返回 null（调用方处理）
export function sampleWeighted(rng, weights) {
  const keys = Object.keys(weights);
  if (keys.length === 0) return null;
  let sum = 0;
  for (const k of keys) sum += Math.max(0, weights[k]);
  let roll = rng();
  if (sum <= 0) {
    return keys[Math.floor(roll * keys.length)];
  }
  roll *= sum;
  let acc = 0;
  for (const k of keys) {
    acc += Math.max(0, weights[k]);
    if (roll < acc) return k;
  }
  return keys[keys.length - 1]; // 浮点兜底
}

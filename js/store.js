// localStorage 存档封装：全异常降级，字段与 DEFAULTS 合并。
import { CONFIG } from "./config.js";

export const DEFAULTS = {
  highScore: 0,
  maxCombo: 0,
  sfxOn: true,
  musicOn: true,
  tutorialCompleted: false,
  tutorialStep: null,
  flags: { shownEnergyTip: false, shownRerollTip: false },
  schemaVersion: CONFIG.save.version,
};

function defaultStorage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // 访问受限环境
  }
  return null;
}

function cloneDefaults() {
  return {
    ...DEFAULTS,
    flags: { ...DEFAULTS.flags },
  };
}

export function loadStore(storage) {
  const s = storage ?? defaultStorage();
  if (!s) return cloneDefaults();
  try {
    const raw = s.getItem(CONFIG.save.key);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return cloneDefaults();
    return {
      ...cloneDefaults(),
      ...parsed,
      flags: { ...cloneDefaults().flags, ...(parsed.flags ?? {}) },
    };
  } catch {
    return cloneDefaults();
  }
}

export function saveStore(store, storage) {
  const s = storage ?? defaultStorage();
  if (!s) return false;
  try {
    s.setItem(CONFIG.save.key, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function recordResult(store, score, maxCombo, storage) {
  const newHighScore = score > store.highScore;
  const newMaxCombo = maxCombo > store.maxCombo;
  if (newHighScore) store.highScore = score;
  if (newMaxCombo) store.maxCombo = maxCombo;
  if (newHighScore || newMaxCombo) saveStore(store, storage);
  return { store, newHighScore, newMaxCombo };
}

// 难度阶段判定与旋钮：novice → normal → hard（hard 不可逆），tutorial 恒 novice 安全默认。
import { CONFIG } from "../config.js";

function cloneWeights(w) {
  return { ...w };
}

function noviceKnobs() {
  return {
    useOpeningPack: true,
    // 新手期也充能（公式不变）：热手玩家前期攒的能量跨阶段继承，更早摸到优质三槽
    energyGainEnabled: true,
    premiumWeights: cloneWeights(CONFIG.supply.premiumBaseWeights),
  };
}

function normalKnobs() {
  return {
    useOpeningPack: false,
    // 正常期受控槽也走缺口选形（池=正常权重），帮助蓄板玩家渡过中期
    controlledGap: true,
    energyGainEnabled: true,
    premiumWeights: cloneWeights(CONFIG.supply.premiumBaseWeights),
  };
}

function lerpWeights(p) {
  const base = CONFIG.supply.premiumBaseWeights;
  const hard = CONFIG.supply.premiumHardWeights;
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const h = hard[k] ?? b;
    const v = b + (h - b) * p;
    // 权重表全是整数，插值中间档保留一位小数即可；测试对 0.5 档断言整数（奇偶权重）
    out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

// 困难期正常池劣化：base → hardNormalWeights 随 p 插值
function lerpNormalWeights(p) {
  const base = CONFIG.supply.normalWeights;
  const hard = CONFIG.supply.hardNormalWeights;
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const h = hard[k] ?? b;
    out[k] = Math.round((b + (h - b) * p) * 100) / 100;
  }
  return out;
}

function hardKnobs(p) {
  return {
    useOpeningPack: false,
    energyGainEnabled: true,
    premiumWeights: lerpWeights(p),
    normalWeights: lerpNormalWeights(p),
  };
}

export function createDifficulty() {
  let hardEntered = false;
  let enterPlaceCount = 0;

  function evaluate({ mode, placeCount, score }) {
    if (mode === "tutorial-scripted") {
      return { phase: "novice", knobs: noviceKnobs() };
    }

    if (!hardEntered && score >= CONFIG.difficulty.hardScore) {
      hardEntered = true;
      enterPlaceCount = placeCount;
    }

    if (hardEntered) {
      // hardP 由手数驱动（与时间解耦，可确定性模拟/测试）
      const p = Math.min(1, Math.max(0,
        (placeCount - enterPlaceCount) / CONFIG.difficulty.hardDurationPlaces));
      return { phase: "hard", knobs: hardKnobs(p) };
    }

    // 分数驱动：新手 < 1000，正常 1000~1999，≥2000 已在上面的 hard 拦截
    if (score < CONFIG.difficulty.noviceScore) {
      return { phase: "novice", knobs: noviceKnobs() };
    }
    return { phase: "normal", knobs: normalKnobs() };
  }

  return { evaluate };
}

// 计分与能量：纯函数，数值取 CONFIG.scoring / CONFIG.energy
import { CONFIG } from "../config.js";

export function placeScore(cellCount) {
  return cellCount * CONFIG.scoring.perPlacedCell;
}

export function nextCombo(combo, lineCount) {
  return lineCount > 0 ? combo + 1 : 0;
}

// multilineBonus：下标即同消线数（0、1 档为 0），越界取末档
function lineBonus(table, lineCount) {
  const i = Math.max(0, Math.min(lineCount, table.length - 1));
  return table[i];
}

// comboMultipliers：下标 = combo-1，越界取末档
function comboMult(table, combo) {
  const i = Math.max(0, Math.min(combo - 1, table.length - 1));
  return table[i];
}

export function clearScore(clearedCells, lineCount, combo) {
  const cfg = CONFIG.scoring;
  const base = clearedCells * cfg.perClearedCell;
  const bonus = lineBonus(cfg.multilineBonus, lineCount);
  const mult = comboMult(cfg.comboMultipliers, combo);
  return Math.round((base + bonus) * mult);
}

// 充能加点 = 连击部分（combo-1）*10 + 多消部分（2线20/3线40/4线+60）
export function energyGain(combo, lineCount = 0) {
  const comboPart = Math.max(0, combo - 1) * 10;
  const tbl = CONFIG.energy.multilineGain;
  const i = Math.max(0, Math.min(lineCount, tbl.length - 1));
  return comboPart + tbl[i];
}

export function addEnergy(energy, gain) {
  return Math.min(CONFIG.energy.max, energy + gain);
}

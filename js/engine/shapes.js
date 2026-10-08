// 形状目录：14 个形状族 × 若干朝向。纯数据 + 工厂，无 DOM 依赖。
import { CONFIG } from "../config.js";

// (dr,dc) 顺时针旋转 90°：(x,y) -> (y,-x)，随后归一化到左上角原点
function rotate90(cells) {
  const rotated = cells.map(([r, c]) => [c, -r]);
  const minR = Math.min(...rotated.map(([r]) => r));
  const minC = Math.min(...rotated.map(([, c]) => c));
  return rotated.map(([r, c]) => [r - minR, c - minC]);
}

function keyOf(cells) {
  return cells
    .map(([r, c]) => `${r},${c}`)
    .sort()
    .join("|");
}

// 从一个或多个基座各生成 rotations 次旋转并去重（多基座用于镜像对，如 S/Z）
function buildOrientations(base, rotations, extraBases = []) {
  const out = [];
  const seen = new Set();
  for (const start of [base, ...extraBases]) {
    let cur = start.map(([r, c]) => [r, c]);
    for (let i = 0; i < rotations; i++) {
      const k = keyOf(cur);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(cur);
      }
      cur = rotate90(cur);
    }
  }
  return out;
}

// 基座定义（第一朝向），旋转数
const DEFS = {
  dot: { base: [[0, 0]], rotations: 1 },
  domino: { base: [[0, 0], [0, 1]], rotations: 2 },
  line3: { base: [[0, 0], [0, 1], [0, 2]], rotations: 2 },
  L3: { base: [[0, 0], [1, 0], [1, 1]], rotations: 4 },
  square2: { base: [[0, 0], [0, 1], [1, 0], [1, 1]], rotations: 1 },
  // S 与 Z 互为镜像：单形旋转仅 2 个不同朝向，双基座（横 S + 横 Z）合 4 种
  SZ: {
    base: [[0, 1], [0, 2], [1, 0], [1, 1]],
    rotations: 2,
    mirrors: [[[0, 0], [0, 1], [1, 1], [1, 2]]],
  },
  line4: { base: [[0, 0], [0, 1], [0, 2], [0, 3]], rotations: 2 },
  L4: { base: [[0, 0], [1, 0], [2, 0], [2, 1]], rotations: 4 },
  T: { base: [[0, 0], [0, 1], [0, 2], [1, 1]], rotations: 4 },
  rect2x3: {
    base: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    rotations: 2,
  },
  line5: { base: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], rotations: 2 },
  L5: { base: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], rotations: 4 },
  plus: {
    base: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    rotations: 1,
  },
  square3: {
    base: [
      [0, 0], [0, 1], [0, 2],
      [1, 0], [1, 1], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ],
    rotations: 1,
  },
};

export const FAMILIES = Object.keys(DEFS);

export const SHAPES = Object.fromEntries(
  FAMILIES.map((f) => [
    f,
    buildOrientations(DEFS[f].base, DEFS[f].rotations, DEFS[f].mirrors ?? []),
  ])
);

export function makePiece(id, family, orient, color) {
  const orients = SHAPES[family];
  if (!orients) throw new Error(`未知形状族: ${family}`);
  if (!Number.isInteger(orient) || orient < 0 || orient >= orients.length) {
    throw new Error(`非法朝向: ${family}#${orient}`);
  }
  return {
    id,
    family,
    orient,
    cells: orients[orient].map(([r, c]) => [r, c]),
    color,
  };
}

// 族内朝向等概率、颜色 1..CONFIG.colors 等概率
export function randomPiece(rng, id, family) {
  const orients = SHAPES[family];
  if (!orients) throw new Error(`未知形状族: ${family}`);
  const orient = Math.floor(rng() * orients.length);
  const color = 1 + Math.floor(rng() * CONFIG.colors);
  return makePiece(id, family, orient, color);
}

// 引导脚本用：朝向/颜色完全指定
export function makeScriptedPiece(family, orient, color, id) {
  return makePiece(id, family, orient, color);
}

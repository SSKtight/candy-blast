// 供给器：批次生成（2 正常 + 1 受控）、去重、兜底、开场包。
// 缺口选形：新手受控槽与充能满三槽共用 chooseGapPiece / refreshPremium / rerollBatch。
import { CONFIG } from "../config.js";
import { sampleWeighted } from "../util/rng.js";
import { SHAPES, randomPiece, makePiece } from "./shapes.js";
import { hasAnyPlacement, legalAnchors } from "./board.js";

let pieceSeq = 0;
function nextId() {
  pieceSeq += 1;
  return `p${pieceSeq}`;
}

// 引导脚本用：完全指定
export function makeScriptedPiece(family, orient, color, id) {
  return makePiece(id ?? nextId(), family, orient, color);
}

function drawDot(rng) {
  return randomPiece(rng, nextId(), "dot");
}

// 保险丝自救等外部场景用：显式造一个 dot
export function makeDot(rng) {
  return drawDot(rng);
}

function drawFrom(rng, weights) {
  const family = sampleWeighted(rng, weights);
  return randomPiece(rng, nextId(), family);
}

// 三连同族（dot 除外）去重：只重抽最近抽取的槽 2
function dedupThird(rng, weights, p0, p1, p2) {
  let retries = 0;
  while (
    retries < CONFIG.supply.dedupMaxRetries
    && p0.family === p1.family
    && p1.family === p2.family
    && p2.family !== "dot"
  ) {
    p2 = drawFrom(rng, weights);
    retries += 1;
  }
  return p2;
}

// knobs: { useOpeningPack, normalWeights? }
// 返回 { pieces:[Piece,Piece,Piece], controlled:'normal' }（premium/single 由 T8/session 追加）
export function createBatch(rng, board, dims, knobs) {
  const normalW = knobs.normalWeights ?? CONFIG.supply.normalWeights;
  const weights = knobs.useOpeningPack
    ? CONFIG.supply.openingWeights
    : normalW;

  let p0;
  let p1;
  if (knobs.useOpeningPack) {
    // 新手期三槽同池（含大块）；去重仍适用
    p0 = drawFrom(rng, weights);
    p1 = drawFrom(rng, weights);
  } else {
    p0 = drawFrom(rng, normalW);
    p1 = drawFrom(rng, normalW);
  }

  let p2;
  const dead0 = !hasAnyPlacement(board, dims, p0);
  const dead1 = !hasAnyPlacement(board, dims, p1);
  if (dead0 && dead1) {
    // 兜底：两正常槽皆无位 → 受控槽强制 1×1（必可放置，防死局）
    p2 = drawDot(rng);
  } else if (knobs.useOpeningPack || knobs.controlledGap) {
    // 受控槽缺口选形（新手期/正常期；枚举最优合法放置反推形状，必有合法位）
    p2 = chooseGapPiece(rng, board, dims, weights);
  } else {
    p2 = drawFrom(rng, weights);
  }

  if (p2.family !== "dot") {
    p2 = dedupThird(rng, weights, p0, p1, p2);
  }

  return { pieces: [p0, p1, p2], controlled: "normal" };
}

export function allSlotsDead(board, dims, pieces) {
  for (const p of pieces) {
    if (p && hasAnyPlacement(board, dims, p)) return false;
  }
  return true;
}

// ---- 缺口关联选形（新手受控槽 / 优质三槽共用） ----

const GAP_CFG = CONFIG.supply.gapScore;

// 缺口放置评分（不修改棋盘，v3.7 选项A比例制）：
// 得分 = 消除行列数之和×lineComplete
//      + 贴合率×fitWeight + 靠墙率×wallWeight
// 贴合率 = 贴已有方块的边数 / 周长边数；靠墙率 = 贴棋盘边界的边数 / 周长边数
// 周长 = 方块暴露在外的边（自身格之间的接触边不计）；三率之和恒为 1，散布自动得低分
export function scoreGapPlacement(board, dims, piece, r, c) {
  const cellSet = new Set(piece.cells.map(([dr, dc]) => `${r + dr},${c + dc}`));
  let wall = 0;
  let fit = 0;
  let air = 0;
  const touchedRows = new Set();
  const touchedCols = new Set();
  for (const [dr, dc] of piece.cells) {
    const rr = r + dr;
    const cc = c + dc;
    touchedRows.add(rr);
    touchedCols.add(cc);
    for (const [nr, nc] of [[rr - 1, cc], [rr + 1, cc], [rr, cc - 1], [rr, cc + 1]]) {
      if (cellSet.has(`${nr},${nc}`)) continue; // 自身接触边不属于周长
      if (nr < 0 || nr >= dims.rows || nc < 0 || nc >= dims.cols) wall++;
      else if (board[nr * dims.cols + nc] !== 0) fit++;
      else air++;
    }
  }
  const perimeter = wall + fit + air; // 形状固定，恒 > 0

  // 补满线数（行/列填满判定，基于落子后状态）
  let lineCount = 0;
  for (const rr of touchedRows) {
    let full = true;
    for (let cc = 0; cc < dims.cols; cc++) {
      if (board[rr * dims.cols + cc] === 0 && !cellSet.has(`${rr},${cc}`)) { full = false; break; }
    }
    if (full) lineCount++;
  }
  for (const cc of touchedCols) {
    let full = true;
    for (let rr = 0; rr < dims.rows; rr++) {
      if (board[rr * dims.cols + cc] === 0 && !cellSet.has(`${rr},${cc}`)) { full = false; break; }
    }
    if (full) lineCount++;
  }

  return lineCount * GAP_CFG.lineComplete
    + (fit / perimeter) * GAP_CFG.fitWeight
    + (wall / perimeter) * GAP_CFG.wallWeight;
}

function pieceFromPlacement(rng, placement) {
  const color = 1 + Math.floor(rng() * CONFIG.colors);
  return makePiece(nextId(), placement.family, placement.orient, color);
}

// 每族枚举一个最佳合法放置（朝向/锚点自由）；exclude 中的族跳过
function familyBestPlacements(board, dims, weights, exclude) {
  const out = [];
  for (const family of Object.keys(weights)) {
    if (!(weights[family] > 0) || !SHAPES[family] || exclude.has(family)) continue;
    let best = null;
    for (let orient = 0; orient < SHAPES[family].length; orient++) {
      const proto = makePiece("proto", family, orient, 1);
      for (const { r, c } of legalAnchors(board, dims, proto)) {
        const score = scoreGapPlacement(board, dims, proto, r, c);
        if (!best || score > best.score) best = { family, orient, r, c, score };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

// 降级：在给定权重族中过滤有合法位的族后按权重抽；再退 normal 池；全无 → dot
function fallbackPiece(rng, board, dims, weights) {
  const viableFrom = (table) => {
    const viable = {};
    for (const family of Object.keys(table)) {
      if (!(table[family] > 0) || !SHAPES[family]) continue;
      for (let orient = 0; orient < SHAPES[family].length; orient++) {
        if (hasAnyPlacement(board, dims, makePiece("q", family, orient, 1))) {
          viable[family] = table[family];
          break;
        }
      }
    }
    return viable;
  };
  let viable = viableFrom(weights);
  if (Object.keys(viable).length === 0 && weights !== CONFIG.supply.normalWeights) {
    viable = viableFrom(CONFIG.supply.normalWeights);
  }
  if (Object.keys(viable).length === 0) return drawDot(rng);
  const family = sampleWeighted(rng, viable);
  return randomPiece(rng, nextId(), family);
}

// 缺口选形：70% 全局最优放置（同分按族权重二次抽）；30% 族均匀后取该族最优
// exclude 用于优质三槽族去重；排除后无候选则自动放宽
export function chooseGapPiece(rng, board, dims, weights, exclude = new Set()) {
  let perFam = familyBestPlacements(board, dims, weights, exclude);
  if (perFam.length === 0) {
    if (exclude.size > 0) {
      perFam = familyBestPlacements(board, dims, weights, new Set());
    }
    if (perFam.length === 0) return fallbackPiece(rng, board, dims, weights);
  }

  let chosen;
  if (rng() < CONFIG.supply.gapBestRatio) {
    const max = Math.max(...perFam.map((p) => p.score));
    const best = perFam.filter((p) => p.score === max);
    let total = 0;
    for (const p of best) total += Math.max(0, weights[p.family] ?? 0);
    if (total <= 0) {
      chosen = best[Math.floor(rng() * best.length)];
    } else {
      const roll = rng() * total;
      let acc = 0;
      chosen = best[best.length - 1];
      for (const p of best) {
        acc += Math.max(0, weights[p.family] ?? 0);
        if (roll < acc) {
          chosen = p;
          break;
        }
      }
    }
  } else {
    chosen = perFam[Math.floor(rng() * perFam.length)];
  }
  return pieceFromPlacement(rng, chosen);
}

// 充能满：三槽全部升级为优质缺口块（族去重；放不下的族自动放宽，兜底 normal→dot）
export function refreshPremium(rng, board, dims, knobs) {
  const weights = knobs.premiumWeights;
  const used = new Set();
  const pieces = [];
  for (let i = 0; i < 3; i++) {
    const p = chooseGapPiece(rng, board, dims, weights, used);
    pieces.push(p);
    used.add(p.family);
  }
  return { pieces, controlled: "premium" };
}

export function rerollBatch(rng, board, dims, knobs) {
  if (knobs.useOpeningPack) {
    const batch = createBatch(rng, board, dims, {
      useOpeningPack: true,
    });
    return { pieces: batch.pieces, controlled: "normal" };
  }
  const normalW = knobs.normalWeights ?? CONFIG.supply.normalWeights;
  return {
    pieces: [
      drawFrom(rng, normalW),
      drawFrom(rng, normalW),
      drawDot(rng),
    ],
    controlled: "single",
  };
}

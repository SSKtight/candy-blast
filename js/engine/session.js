// 会话状态机：唯一权威状态 + 落子原子事务 + 有序事件队列。无 DOM 依赖。
import { CONFIG } from "../config.js";
import { mulberry32 } from "../util/rng.js";
import {
  createBoard,
  cloneBoard,
  canPlaceAt,
  writePiece,
  findFullLines,
  unionCellCount,
  clearLines,
  lineCellIndices,
  fillRatio,
} from "./board.js";
import {
  createBatch as defaultCreateBatch,
  refreshPremium as defaultRefreshPremium,
  rerollBatch as defaultRerollBatch,
  allSlotsDead as boardAllSlotsDead,
  makeDot as supplyMakeDot,
} from "./supply.js";
import { createDifficulty } from "./difficulty.js";
import { createClock } from "./clock.js";
import {
  placeScore,
  nextCombo,
  clearScore,
  energyGain,
  addEnergy,
} from "./scoring.js";

export function createSession(opts = {}) {
  const rng = opts.rng ?? mulberry32((Math.random() * 2 ** 32) >>> 0);
  const nowFn = opts.now ?? (() => Date.now());
  let mode = opts.mode === "tutorial-scripted" ? "tutorial-scripted" : "random";
  const supply = {
    createBatch: opts.supplyImpl?.createBatch ?? defaultCreateBatch,
    refreshPremium: opts.supplyImpl?.refreshPremium ?? defaultRefreshPremium,
    rerollBatch: opts.supplyImpl?.rerollBatch ?? defaultRerollBatch,
  };

  const dims = { ...CONFIG.board };
  let board;
  let phase;
  let tray;
  let controlledMode;
  let score;
  let combo;
  let maxCombo;
  let energy;
  let premiumTriggerCount;
  let placeCount;
  let clearedLines;
  let rerollUsed;
  let rerollGameCount;
  let difficultyPhase;
  let batchKnobs;
  let clock;
  let difficulty;

  function reset({ initialBoard = null } = {}) {
    board = initialBoard ? cloneBoard(initialBoard) : createBoard(dims);
    score = 0;
    combo = 0;
    maxCombo = 0;
    energy = 0;
    premiumTriggerCount = 0;
    placeCount = 0;
    clearedLines = 0;
    rerollUsed = false;
    rerollGameCount = 0;
    difficultyPhase = "novice";
    batchKnobs = null;
    difficulty = createDifficulty();
    controlledMode = "normal";
    clock = createClock(nowFn, { startPaused: mode === "tutorial-scripted" });
    tray = [null, null, null];
    if (mode === "random") {
      phase = "playing";
      issueNewBatch();
    } else {
      phase = "tutorial";
    }
  }

  // 托盘全空时：评估难度 → 冻结本批旋钮 → 生成新批
  function issueNewBatch() {
    const evalRes = difficulty.evaluate({
      mode,
      placeCount,
      score,
      activeMs: clock.ms,
    });
    difficultyPhase = evalRes.phase;
    batchKnobs = evalRes.knobs;
    const batch = supply.createBatch(rng, board, dims, batchKnobs);
    tray = batch.pieces.slice();
    controlledMode = batch.controlled;
    rerollUsed = false;
    return { type: "batchRefreshed", reason: "new", tray: tray.slice() };
  }

  function canInteract() {
    return phase === "playing";
  }

  // 优质批通胀：第 N 次触发后所有充能增益 ÷ rate^N（充满所需总充能 ×rate^N）
  function inflationScale() {
    return Math.pow(CONFIG.energy.premiumInflationRate, premiumTriggerCount);
  }

  function place(slot, r, c) {
    if (phase !== "playing" && phase !== "tutorial") return { ok: false, events: [] };
    if (!Number.isInteger(slot) || slot < 0 || slot >= 3) return { ok: false, events: [] };
    const piece = tray[slot];
    if (!piece) return { ok: false, events: [] };
    if (!canPlaceAt(board, dims, piece, r, c)) return { ok: false, events: [] };

    const boardSnap = cloneBoard(board);
    const traySnap = tray.slice();
    const events = [];
    try {
      events.push({ type: "piecePlaced", slot, piece, r, c });
      writePiece(board, dims, piece, r, c);
      placeCount += 1;

      // 落子分
      const gainedPlace = placeScore(piece.cells.length);
      score += gainedPlace;
      events.push({ type: "scoreChanged", score, gained: gainedPlace, fromClear: false });

      // 满线
      const full = findFullLines(board, dims);
      const lineCount = full.rows.length + full.cols.length;
      if (lineCount > 0) {
        clearedLines += lineCount;
        const clearedCells = unionCellCount(dims, full.rows, full.cols);
        const newCombo = nextCombo(combo, lineCount);
        combo = newCombo;
        maxCombo = Math.max(maxCombo, combo);
        const gainedClear = clearScore(clearedCells, lineCount, combo);
        score += gainedClear;

        events.push({
          type: "linesCleared",
          rows: full.rows.slice(),
          cols: full.cols.slice(),
          cells: lineCellIndices(dims, full.rows, full.cols),
          lineCount,
          clearedCells,
        });
        events.push({ type: "scoreChanged", score, gained: gainedClear, fromClear: true });
        events.push({ type: "comboChanged", combo });

        // 能量：仅 random 且本批旋钮开启（连击 + 多消，经通胀缩放）
        if (mode === "random" && batchKnobs && batchKnobs.energyGainEnabled) {
          const next = addEnergy(energy, energyGain(combo, lineCount) / inflationScale());
          if (next !== energy) {
            energy = next;
            events.push({ type: "energyChanged", energy });
          }
        }

        clearLines(board, dims, full.rows, full.cols);
      } else if (combo !== 0) {
        combo = 0;
        events.push({ type: "comboChanged", combo });
      }

      // 高压保底充能：无消除且棋盘填充度 ≥ 阈值时每手 +pressureGain（与消除充能互斥，经通胀缩放）
      if (mode === "random" && batchKnobs && batchKnobs.energyGainEnabled
        && lineCount === 0 && fillRatio(board, dims) >= CONFIG.energy.pressureThreshold) {
        const next = addEnergy(energy, CONFIG.energy.pressureGain / inflationScale());
        if (next !== energy) {
          energy = next;
          events.push({ type: "energyChanged", energy });
        }
      }

      tray[slot] = null;
      const phaseBefore = phase;
      let replaced = false;

      // 充能满 → 优质替换全部剩余槽（触发计数 +1，后续充能增益通胀衰减）
      if (mode === "random" && energy >= CONFIG.energy.max) {
        const batch = supply.refreshPremium(rng, board, dims, batchKnobs);
        tray = batch.pieces.slice();
        controlledMode = batch.controlled;
        energy = 0;
        premiumTriggerCount += 1;
        rerollUsed = false;
        events.push({ type: "energyChanged", energy });
        events.push({ type: "batchRefreshed", reason: "premium", tray: tray.slice() });
        replaced = true;
      }

      // 托盘全空 → 新批（tutorial 模式由 loadTutorialStep 喂下一步，不自动生成）
      if (!replaced && mode === "random" && tray.every((p) => p === null)) {
        events.push(issueNewBatch());
      }

      // 终局判定（仅 random）；保险丝：能量足够时自动扣费换 dot 续命
      if (mode === "random") {
        const remaining = tray.filter((p) => p !== null);
        if (remaining.length === 0 || boardAllSlotsDead(board, dims, remaining)) {
          if (!tryAutoRescue(events)) {
            phase = "over";
            clock.pause();
            events.push({ type: "gameOver", score, maxCombo, placeCount, clearedLines });
          }
        }
      }

      if (phase !== phaseBefore) events.push({ type: "phaseChanged", phase });
      return { ok: true, events };
    } catch (err) {
      // 事务回滚
      board = boardSnap;
      tray = traySnap;
      console.error("[session] place 事务异常，已回滚：", err);
      return { ok: false, events: [] };
    }
  }

  // 死局保险丝：能量 ≥ rescueCost 时扣费换三槽 dot 续命；返回是否续命成功
  function tryAutoRescue(events) {
    const cost = CONFIG.energy.rescueCost ?? 0;
    if (cost <= 0 || energy < cost) return false;
    energy -= cost;
    tray = [supplyMakeDot(rng), supplyMakeDot(rng), supplyMakeDot(rng)];
    controlledMode = "single";
    events.push({ type: "energyChanged", energy });
    events.push({ type: "rescued", cost, tray: tray.slice() });
    return true;
  }

  function reroll() {
    if (phase !== "playing") return { ok: false, events: [] };
    if (rerollUsed) return { ok: false, events: [] };
    // 每局次数上限（默认 Infinity 不限）
    if (rerollGameCount >= (CONFIG.reroll?.maxPerGame ?? Infinity)) return { ok: false, events: [] };

    const boardSnap = cloneBoard(board);
    const traySnap = tray.slice();
    try {
      const batch = supply.rerollBatch(rng, board, dims, batchKnobs ?? {
        useOpeningPack: false,
        premiumWeights: CONFIG.supply.premiumBaseWeights,
      });
      tray = batch.pieces.slice();
      controlledMode = batch.controlled;
      const energyCleared = energy !== 0;
      // 重抽清能量（按 rerollKeepRatio 保留，默认全清）
      energy = Math.floor(energy * (CONFIG.energy.rerollKeepRatio ?? 0));
      rerollUsed = true;
      rerollGameCount += 1;
      const events = [{ type: "rerolled", tray: tray.slice() }];
      // 能量变化同步通知 HUD：条立即刷新（原实现缺事件，要等下次落子才刷新）
      if (energyCleared) events.push({ type: "energyChanged", energy });

      const remaining = tray.filter((p) => p !== null);
      const phaseBefore = phase;
      if (boardAllSlotsDead(board, dims, remaining)) {
        if (!tryAutoRescue(events)) {
          phase = "over";
          clock.pause();
          events.push({ type: "gameOver", score, maxCombo, placeCount, clearedLines });
        }
      }
      if (phase !== phaseBefore) events.push({ type: "phaseChanged", phase });
      return { ok: true, events };
    } catch (err) {
      board = boardSnap;
      tray = traySnap;
      console.error("[session] reroll 异常，已回滚：", err);
      return { ok: false, events: [] };
    }
  }

  function pause() {
    if (phase !== "playing") return { ok: false, events: [] };
    phase = "paused";
    clock.pause();
    return { ok: true, events: [{ type: "phaseChanged", phase }] };
  }

  function resume() {
    if (phase !== "paused") return { ok: false, events: [] };
    phase = "playing";
    clock.resume();
    return { ok: true, events: [{ type: "phaseChanged", phase }] };
  }

  function restart() {
    mode = "random"; // restart 后不回 tutorial
    reset();
  }

  // 引导脚本装载：写棋盘与 tray，phase 维持 tutorial
  function loadTutorialStep(step) {
    board = createBoard(dims);
    for (const { r, c, color } of step.cells) {
      board[r * dims.cols + c] = color;
    }
    tray = [step.pieces[0] ?? null, step.pieces[1] ?? null, step.pieces[2] ?? null];
    controlledMode = "normal";
    combo = 0;
  }

  // 引导结束：转入正式 random 局，空盘新手首批
  function finishTutorial() {
    mode = "random";
    reset();
  }

  reset({ initialBoard: opts.initialBoard ?? null });

  return {
    getState: () => ({
      phase,
      board,
      dims,
      tray,
      controlledMode,
      score,
      combo,
      maxCombo,
      energy,
      placeCount,
      clearedLines,
      rerollUsed,
      rerollGameCount,
      difficultyPhase,
      mode,
    }),
    canInteract,
    place,
    reroll,
    pause,
    resume,
    restart,
    loadTutorialStep,
    finishTutorial,
    // 演示录制专用：直接修改内部状态（不影响游戏逻辑）
    _debug: {
      setEnergy(v) { energy = v; },
      setScore(v) { score = v; },
      setCombo(v) { combo = v; },
      setMaxCombo(v) { maxCombo = v; },
      setPlaceCount(v) { placeCount = v; },
      setClearedLines(v) { clearedLines = v; },
      setBoardCells(cells) {
        board = createBoard(dims);
        for (const { r, c, color } of cells) board[r * dims.cols + c] = color;
      },
      setTray(pieces) { tray = pieces; },
      setPhase(p) { phase = p; },
      setDifficultyPhase(p) { difficultyPhase = p; },
      setRerollUsed(v) { rerollUsed = v; },
    },
  };
}

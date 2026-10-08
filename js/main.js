// T13：动画编排、输入锁、暂停/结束弹窗。T14 接音频，T16 覆写鉴权/引导/tips。
import { CONFIG } from "./config.js";
import { mulberry32 } from "./util/rng.js";
import { createSession } from "./engine/session.js";
import { cloneBoard, writePiece } from "./engine/board.js";
import { loadStore, saveStore, recordResult } from "./store.js";
import { createBoardView } from "./render/boardView.js";
import { createTrayView } from "./render/trayView.js";
import { createHudView } from "./render/hudView.js";
import { createModals } from "./render/modals.js";
import { attachDrag } from "./input/drag.js";
import { createSound } from "./audio/sound.js";
import { createGuide } from "./tutorial/guide.js";

// 鉴权：登录页 doLogin 成功后写会话标记；缺失则回登录页（标记只活在当前会话）
let authed = false;
try {
  authed = !!sessionStorage.getItem(CONFIG.save.authSessionKey);
} catch {
  authed = false;
}
if (!authed) {
  location.replace("index.html");
  // 页面卸载前冻结本模块执行，避免游戏短暂初始化/闪现
  await new Promise(() => {});
}

const store = loadStore();

const session = createSession({
  rng: mulberry32(Date.now() >>> 0),
  mode: store.tutorialCompleted ? "random" : "tutorial-scripted",
});

const appEl = document.getElementById("app");
const liveEl = document.getElementById("live");
const btnSettings = document.getElementById("btn-settings");

const boardView = createBoardView(document.getElementById("board"), CONFIG.board);
const trayView = createTrayView(document.getElementById("tray"));
const hudView = createHudView();
const modals = createModals(document.getElementById("modal-root"));
const sound = createSound(store);

hudView.setHigh(store.highScore);
hudView.setSfx(store.sfxOn);
hudView.setMusic(store.musicOn);

let inputLock = false;
let paused = false;
let dragging = false;
let recordThisGame = false; // 本局是否曾刷新最高分/最高连击（终局号角依据）
let highAtStart = store.highScore; // 本局开始时的历史最高（结算页"超越 X 分"依据）

// 破纪录实时落盘（终局前崩溃也保留最佳成绩）
function persistBest(score, maxCombo) {
  let changed = false;
  if (score > store.highScore) {
    store.highScore = score;
    changed = true;
  }
  if (maxCombo > store.maxCombo) {
    store.maxCombo = maxCombo;
    changed = true;
  }
  if (changed) {
    recordThisGame = true;
    saveStore(store);
    hudView.setHigh(store.highScore);
  }
}

const LINE_NAMES = ["", "单线", "双线", "三线", "四线", "五线", "六线", "七线", "八线", "九线"];

function announce(text) {
  liveEl.textContent = text;
}

// 暂停感知的等待：以 rAF 对齐帧节奏；另挂 setTimeout 兜底——
// 后台标签/无合成环境 rAF 可能长期不触发，暂停期间兜底时钟也暂停。
function delay(ms) {
  return new Promise((resolve) => {
    let remaining = ms;
    let last = performance.now();
    let rafId = 0;
    let timerId = 0;
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      resolve();
    }
    function tick(now) {
      const dt = now - last;
      last = now;
      if (paused) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      remaining -= dt;
      if (remaining <= 0) finish();
      else rafId = requestAnimationFrame(tick);
    }
    // 兜底：rAF 失活时最迟在 ms+150 后推进（暂停期间不断顺延）
    function fallback() {
      if (done) return;
      if (paused) {
        timerId = setTimeout(fallback, 200);
        return;
      }
      finish();
    }
    rafId = requestAnimationFrame(tick);
    timerId = setTimeout(fallback, ms + 150);
  });
}

function renderStatic() {
  const s = session.getState();
  boardView.setGameOverDim(s.phase === "over");
  boardView.render(s.board);
  trayView.render(s);
  hudView.render(s);
  hudView.setEnergy(s.energy, false);
  updateControls();
}

function updateControls() {
  const s = session.getState();
  // 打开设置时本地 paused 为 true，即使处于 tutorial 阶段（session.pause 不生效）也要降亮
  const isPaused = paused || s.phase === "paused";
  trayView.setRerollEnabled(
    !s.rerollUsed &&
    (s.rerollGameCount ?? 0) < (CONFIG.reroll?.maxPerGame ?? Infinity) &&
    s.phase === "playing" && !inputLock
  );
  appEl.classList.toggle("is-paused", isPaused);
}

// ---------- 事件编排 ----------
async function playEvents(events, boardSnap, placed) {
  const A = CONFIG.anim;
  let anchorEl = boardView.cellEl(placed.r, placed.c);

  for (const ev of events) {
    switch (ev.type) {
      case "piecePlaced": {
        // 用落子后、消除前的快照播吸入
        boardView.render(boardSnap);
        const indices = ev.piece.cells.map(([dr, dc]) =>
          (ev.r + dr) * CONFIG.board.cols + (ev.c + dc)
        );
        boardView.popPlace(indices);
        sound.play("place");
        anchorEl = boardView.cellEl(ev.r, ev.c);
        await delay(A.placeMs);
        break;
      }
      case "scoreChanged": {
        hudView.animateScore(ev.score);
        if (ev.fromClear) {
          const s = session.getState();
          const cls = ev.lineCount >= 2 ? "g-multiline" : "";
          const name = LINE_NAMES[ev.lineCount] ?? `${ev.lineCount}线`;
          const head = ev.lineCount >= 2 ? `${name}！+${ev.gained}` : `+${ev.gained}`;
          const tail = s.combo >= 2 ? ` 连击×${s.combo}` : "";
          hudView.floatText(anchorEl, head + tail, cls);
        }
        break;
      }
      case "linesCleared": {
        // 快照仍含被消格：波浪扫消（行左→右、列上→下逐格收缩），粒子同步迸出，之后渲染终态
        const waveMs = boardView.waveClear(ev.rows, ev.cols);
        if (ev.lineCount >= 2) {
          sound.play("multiClear", { lineCount: ev.lineCount });
          sound.vibrate(ev.lineCount === 2 ? "multiline2" : "multiline3Plus");
        } else {
          sound.play("singleClear");
        }
        announce(`消除 ${ev.lineCount} 行`);
        await delay(waveMs);
        boardView.render(session.getState().board);
        break;
      }
      case "comboChanged": {
        // HUD 已无连击徽章，连击只保留音效/震动/播报
        if (ev.combo >= 2) {
          sound.play("combo", { combo: ev.combo });
          sound.vibrate(ev.combo <= 3 ? "comboLow" : "comboHigh");
          announce(`连击 ${ev.combo}`);
        }
        break;
      }
      case "energyChanged": {
        hudView.setEnergy(ev.energy, ev.energy >= CONFIG.energy.max);
        if (ev.energy >= CONFIG.energy.max) announce("充能满，优质块来了");
        else if (!store.flags.shownEnergyTip && ev.energy >= CONFIG.energy.max * 0.8) {
          // 首次到 80%：非阻塞 Toast 预告，触发时刻保持纯净（方案 D）
          store.flags.shownEnergyTip = true;
          saveStore(store);
          modals.showToast("⚡ 能量快满了！满后送来皇冠大块～");
          announce("能量快满了");
        }
        break;
      }
      case "batchRefreshed": {
        trayView.render(session.getState());
        if (ev.reason === "premium") {
          sound.play("premium");
          sound.vibrate("premium");
          trayView.setRerollEnabled(false);
          await delay(A.barMs + 200);
          updateControls();
          // 触发时刻不打断：教学已在能量首次到 80% 时以 Toast 预告（energyChanged 分支）
        }
        break;
      }
      case "rerolled": {
        trayView.render(session.getState());
        sound.play("reroll");
        announce("已重抽");
        break;
      }
      case "rescued": {
        // 死局保险丝触发：托盘已换三 dot，刷新并提示
        trayView.render(session.getState());
        sound.play("premium");
        sound.vibrate("premium");
        announce("保险丝！能量换三条命");
        break;
      }
      case "gameOver": {
        sound.play("gameOver");
        boardView.render(session.getState().board);
        boardView.setGameOverDim(true);
        await delay(500);
        recordResult(store, ev.score, ev.maxCombo); // 终局兜底落盘（破纪录可能已实时写入）
        saveStore(store);
        hudView.setHigh(store.highScore);
        if (recordThisGame) sound.play("recordFanfare");
        const isScoreRecord = ev.score > highAtStart;
        modals.showGameOver({
          score: ev.score,
          highScore: store.highScore,
          placedCount: ev.placeCount,
          clearedLines: ev.clearedLines,
          isRecord: isScoreRecord,
          beatBy: ev.score - highAtStart,
          onRestart: doRestart,
          onQuit: doQuit,
        });
        announce("游戏结束");
        break;
      }
      case "phaseChanged": {
        updateControls();
        break;
      }
    }
  }
}

// scoreChanged 不带 lineCount，补到事件上更方便编排
function enrich(events) {
  let lastLineCount = 0;
  for (const ev of events) {
    if (ev.type === "linesCleared") lastLineCount = ev.lineCount;
    if (ev.type === "scoreChanged" && ev.fromClear) ev.lineCount = lastLineCount;
  }
  return events;
}

async function handlePlace(slot, r, c) {
  const phase0 = session.getState().phase;
  if (inputLock || (phase0 !== "playing" && phase0 !== "tutorial")) return;
  // 新手引导：非发光落点直接弹回，不进引擎结算
  if (guide && guide.active()) {
    const verdict = guide.intercept(slot, r, c);
    if (!verdict.allow) {
      guide.flashWrong(verdict.text);
      return;
    }
  }
  const preBoard = cloneBoard(session.getState().board);
  const res = session.place(slot, r, c);
  if (!res.ok) return;
  // 落子后、消除前的快照 = 放置前棋盘 + 本块
  const placedEv = res.events.find((e) => e.type === "piecePlaced");
  const snap = cloneBoard(preBoard);
  writePiece(snap, CONFIG.board, placedEv.piece, placedEv.r, placedEv.c);
  inputLock = true;
  // 放置即反馈：立刻把被放走的块从槽里淡出（不等消除动画结束）
  trayView.render(session.getState());
  updateControls();
  try {
    await playEvents(enrich(res.events), snap, { r, c });
    if (guide && guide.active()) {
      // 消除动画后校验 wait 并载入下一步（指读步保留棋盘）
      await guide.onGameEvent(res.events);
    }
    const phaseNow = session.getState().phase;
    if (phaseNow === "playing" || phaseNow === "tutorial") {
      const s = session.getState();
      boardView.render(s.board);
      trayView.render(s);
      hudView.setEnergy(s.energy, false);
      if (phaseNow === "playing") persistBest(s.score, s.maxCombo);
    }
  } finally {
    inputLock = false;
    updateControls();
  }
}

async function handleReroll() {
  if (inputLock || !session.canInteract()) return;
  const res = session.reroll();
  if (!res.ok) return;
  inputLock = true;
  updateControls();
  try {
    await playEvents(res.events, null, { r: 0, c: 0 });
  } finally {
    inputLock = false;
    updateControls();
  }
}

// ---------- 暂停 / 设置 ----------
// 打开设置即视为暂停：冻结棋盘、降亮、压低 BGM。
function openSettings() {
  const phase = session.getState().phase;
  if (phase === "playing") session.pause();
  paused = true;
  sound.setPaused(true);
  updateControls();
  modals.showSettings({
    sfxOn: store.sfxOn,
    musicOn: store.musicOn,
    version: CONFIG.app.version,
    onSfx: toggleSfx,
    onMusic: toggleMusic,
    onQuit: handleSettingsQuit,
    onReplayGuide: replayGuide,
    onClose: closeSettings,
  });
}

// 关闭设置即恢复游戏。
function closeSettings() {
  const phase = session.getState().phase;
  if (phase === "paused") session.resume();
  paused = false;
  sound.setPaused(false);
  modals.close();
  updateControls();
}

// 设置内「返回登录页」：先弹确认，确认则退出，取消则回到设置。
async function handleSettingsQuit() {
  const ok = await modals.showConfirm({
    title: "返回登录页？",
    text: "未保存的进度将会丢失，确定要返回吗？",
    confirmText: "返回",
    cancelText: "取消",
  });
  if (ok) {
    doQuit();
  } else {
    openSettings(); // 会话仍处于暂停态，仅重开设置面板
  }
}

// 重新观看引导：清引导进度后重载，自动从第一章开始
function replayGuide() {
  paused = false;
  sound.setPaused(false);
  store.tutorialCompleted = false;
  store.tutorialStep = null;
  saveStore(store);
  location.reload();
}

function togglePause() {
  const phase = session.getState().phase;
  if (phase === "playing") openSettings();
  else if (phase === "paused") closeSettings();
}

function doRestart() {
  paused = false;
  sound.setPaused(false);
  inputLock = false;
  recordThisGame = false;
  highAtStart = store.highScore;
  session.restart();
  modals.close();
  boardView.setGameOverDim(false);
  renderStatic();
  announce("新的一局开始");
}

function doQuit() {
  try {
    sessionStorage.removeItem(CONFIG.save.authSessionKey);
  } catch {
    /* 忽略 */
  }
  location.href = "index.html";
}

// 一次性气泡：首次进入正式局时，在重抽按钮旁提示（flag 持久化，仅弹一次）
function maybeShowRerollTip() {
  if (store.flags.shownRerollTip) return;
  const anchor = document.getElementById("reroll-tip");
  if (!anchor) return;
  store.flags.shownRerollTip = true;
  saveStore(store);
  const bubble = document.createElement("div");
  bubble.className = "g-reroll-tip";
  const text = document.createElement("div");
  text.textContent = "三块都放不下了？点重抽可换一批（每批限一次），能量满时还会来优质块！";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "g-modal-btn";
  btn.textContent = "知道啦";
  btn.addEventListener("click", () => bubble.remove()); // uiTap 由文档 capture 委托统一播放
  bubble.append(text, btn);
  anchor.appendChild(bubble);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    sound.suspend();
    if (session.getState().phase === "playing") openSettings();
  } else {
    sound.resume();
  }
});

// 首次指针交互解锁 AudioContext（浏览器自动播放策略）
window.addEventListener("pointerdown", () => sound.unlock(), { capture: true, once: true });

// UI 点击音（设置/重抽/弹窗按钮）
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest?.(".g-modal-btn, #btn-settings, #btn-reroll")) sound.play("uiTap");
  },
  true
);

// ---------- 装配 ----------
attachDrag({
  getState: () => session.getState(),
  canInteract: () =>
    !inputLock &&
    (session.canInteract() || session.getState().phase === "tutorial"),
  boardView,
  trayView,
  onPlace: handlePlace,
  onBlocked: () => sound.play("placeFail"),
  onValidHover: () => sound.play("hover"),
  onReroll: handleReroll,
  onPause: togglePause,
  onDragState: (active) => {
    dragging = active;
    btnSettings.disabled = active;
    if (active) sound.play("pickup");
  },
});

trayView.on("reroll", handleReroll);

// 音效开关：设置面板使用
function toggleSfx(on) {
  // 关闭前先拨一声，让用户听到关闭的是音效
  if (on) sound.setSfxOn(true);
  sound.play("toggle");
  if (!on) sound.setSfxOn(false);
  store.sfxOn = on;
  saveStore(store);
  hudView.setSfx(on);
}

// BGM 开关：设置面板使用
function toggleMusic(on) {
  store.musicOn = on;
  saveStore(store);
  sound.setMusicOn(on);
  sound.play("toggle");
  hudView.setMusic(on);
}

// 设置按钮：打开设置（同时暂停游戏）。快捷键 P 同样触发。
btnSettings.addEventListener("click", openSettings);

// 新手引导：未完成则以教程模式启动；走完 finishTutorial 转正式随机局
let guide = null;
if (!store.tutorialCompleted) {
  guide = createGuide({
    session,
    views: { boardView, trayView, hudView, modals },
    sound,
    store,
  });
  guide.onExit = () => {
    highAtStart = store.highScore; // 教程不计分，正式首局以当前最高为基准
    renderStatic();
    announce("引导完成，开始你的第一局吧！");
    setTimeout(maybeShowRerollTip, 800);
  };
  guide.start();
} else {
  renderStatic();
  setTimeout(maybeShowRerollTip, 800);
}

// 调试/验收句柄（手工验收构造局面用，非游戏功能入口）
window.__game = {
  session,
  boardView,
  trayView,
  hudView,
  modals,
  guide,
  restart: doRestart,
  resume: closeSettings,
  pause: openSettings,
  place: handlePlace,
  reroll: handleReroll,
  openSettings,
  closeSettings,
  rawPlace: (slot, r, c) => session.place(slot, r, c),
  rawReroll: () => session.reroll(),
  locked: () => inputLock,
  isPaused: () => paused,
  sound,
  debug: session._debug,
};

// 新手引导引擎（spec §10.2）：无压暗遮罩，聚焦处强高光描边 + 指读气泡 + 唯一发光落点。
// 放置拦截：main 在调 session.place 前先问 intercept()；落子事件交 onGameEvent 推进。
import { CONFIG } from "../config.js";
import { saveStore } from "../store.js";
import { TUTORIAL_SCRIPT } from "./script.js";
import { makeScriptedPiece } from "../engine/supply.js";

const DIM_MS = CONFIG.anim.clearMs + 220; // 消除动画播完再切下一步

function rafThenTimeout(fn) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(go); // 正常环境：等一帧让布局/落子渲染完成
  setTimeout(go, 180); // 无合成/后台标签兜底
}

export function createGuide({ session, views, sound, store }) {
  const { boardView, trayView, hudView } = views;
  const root = document.getElementById("app");

  const flat = [];
  for (const chapter of TUTORIAL_SCRIPT.chapters) {
    for (const step of chapter.steps) flat.push({ chapter, step });
  }

  let cur = 0;
  let destroyed = false;
  let welcomePlayed = false;
  let wrongTimer = 0;
  let nodes = { spots: [], bubble: null }; // spots: [{el, kind:'focus'|'slot'}]
  let anchorEl = null; // 注意：不能放进 nodes——removeOverlay 会 remove 节点
  let onExit = null;

  function active() {
    return !destroyed;
  }

  function current() {
    return flat[cur];
  }

  function persist() {
    store.tutorialStep = destroyed ? null : current().step.id;
    saveStore(store);
  }

  function buildPieces(step) {
    return step.tray.map((p, i) =>
      makeScriptedPiece(p.family, p.orient, p.color, `tut-${step.id}-${i}`)
    );
  }

  // ---------- 高光框与气泡 ----------
  function removeOverlay() {
    for (const s of nodes.spots) s.el?.remove();
    nodes.bubble?.remove();
    nodes = { spots: [], bubble: null };
    anchorEl = null;
  }

  function makeSpotEl(kind) {
    const el = document.createElement("div");
    el.className = "g-guide-spot";
    document.body.appendChild(el);
    nodes.spots.push({ el, kind });
    return el;
  }

  function resolveAnchor(anchor) {
    if (typeof anchor === "string") {
      if (anchor === "board") return boardView.el;
      if (anchor === "hud-score") return document.getElementById("score");
      const m = /^slot-(\d+)$/.exec(anchor);
      if (m) return trayView.slotEl(Number(m[1]));
      return null;
    }
    if (anchor && typeof anchor === "object") return boardView.cellEl(anchor.r, anchor.c);
    return null;
  }

  function unionRect(els) {
    const r0 = els[0].getBoundingClientRect();
    let { top, left, right, bottom } = r0;
    for (const el of els.slice(1)) {
      const r = el.getBoundingClientRect();
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return { top, left, width: right - left, height: bottom - top };
  }

  // 本步需要强高光的区域：落子步=棋盘发光格；槽步=槽位；
  // 无落点的指读步=气泡指向的锚点元素（如分数区）
  function focusRect(step) {
    const sp = step.spotlight;
    if (sp.type === "dropZone" || sp.type === "cells") {
      const els = sp.cells.map(([r, c]) => boardView.cellEl(r, c));
      return { rect: unionRect(els), hot: sp.type === "dropZone" };
    }
    if (sp.type === "slot") {
      return { rect: trayView.slotEl(step.wait.slot ?? 0).getBoundingClientRect(), hot: true };
    }
    const anchor = resolveAnchor(step.prompt.anchor);
    if (anchor) return { rect: anchor.getBoundingClientRect(), hot: true };
    return null;
  }

  function positionBubble() {
    if (!nodes.bubble || !anchorEl) return;
    const b = nodes.bubble.getBoundingClientRect();
    const a = anchorEl.getBoundingClientRect();
    const bw = b.width || 240;
    const bh = b.height || 80;
    let left = Math.max(8, Math.min(window.innerWidth - bw - 8, a.left + a.width / 2 - bw / 2));
    let top = a.top - bh - 12;
    if (top < 8) top = a.bottom + 12;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - bh - 8);
    nodes.bubble.style.left = `${left}px`;
    nodes.bubble.style.top = `${top}px`;
  }

  // 单个高光框定位到目标矩形（外扩 pad）
  function placeSpotEl(el, rect, pad = 6) {
    if (!rect) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.left = `${rect.left - pad}px`;
    el.style.top = `${rect.top - pad}px`;
    el.style.width = `${rect.width + pad * 2}px`;
    el.style.height = `${rect.height + pad * 2}px`;
  }

  // 高光框跟随当前步的聚焦区域（resize 时重算）：落点框 + 来源槽位框
  function positionSpots() {
    const { step } = current();
    for (const s of nodes.spots) {
      if (s.kind === "focus") {
        placeSpotEl(s.el, focusRect(step)?.rect ?? null);
      } else if (s.kind === "slot") {
        placeSpotEl(s.el, trayView.slotEl(step.wait.slot ?? 0)?.getBoundingClientRect() ?? null);
      }
    }
  }

  function reposition() {
    positionSpots();
    positionBubble();
  }

  function showOverlay() {
    removeOverlay();
    const { step } = current();

    // 不压暗其余界面：落点处强高光呼吸框
    const lit = focusRect(step);
    if (lit) makeSpotEl("focus");
    // 落子步：待拖方块所在槽位也加高光（"按住下方亮起来的方块"）
    if (step.wait.event === "place" && step.wait.slot != null) {
      makeSpotEl("slot");
    }

    const bubble = document.createElement("div");
    bubble.className = "g-guide-bubble";
    const text = document.createElement("p");
    text.className = "g-guide-text";
    text.textContent = step.prompt.text;
    bubble.appendChild(text);
    if (step.wait.event === "tap") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "g-modal-btn g-guide-btn";
      btn.textContent = "知道了";
      btn.addEventListener("click", () => {
        sound.play("uiTap");
        advance();
      });
      bubble.appendChild(btn);
    }
    document.body.appendChild(bubble);

    nodes.bubble = bubble; // spots 已由 makeSpotEl 注册进 nodes.spots
    anchorEl = resolveAnchor(step.prompt.anchor) ?? document.getElementById("hud");
    rafThenTimeout(reposition);
  }

  function flashWrong(text) {
    if (!nodes.bubble) return;
    const p = nodes.bubble.querySelector(".g-guide-text");
    clearTimeout(wrongTimer);
    p.textContent = text;
    nodes.bubble.classList.add("guide-bubble-wrong");
    sound.play("placeFail");
    wrongTimer = setTimeout(() => {
      if (!destroyed && nodes.bubble) {
        nodes.bubble.classList.remove("guide-bubble-wrong");
        p.textContent = current().step.prompt.text;
      }
    }, 1100);
  }

  // ---------- 流程 ----------
  function applyStep(loadSnapshot) {
    const { chapter, step } = current();
    if (loadSnapshot) {
      session.loadTutorialStep({
        cells: chapter.board,
        pieces: buildPieces(step),
      });
    }
    const s = session.getState();
    boardView.render(s.board);
    trayView.render(s);
    hudView.render(s);
    showOverlay();
    rafThenTimeout(reposition);
  }

  function finish() {
    destroyed = true;
    removeOverlay();
    root.classList.remove("in-tutorial");
    window.removeEventListener("resize", reposition);
    store.tutorialCompleted = true;
    store.tutorialStep = null;
    saveStore(store);
    session.finishTutorial();
    onExit?.();
  }

  function advance() {
    cur += 1;
    if (cur >= flat.length) {
      finish();
      return;
    }
    persist();
    // 指读步（无托盘）保留当前棋盘；其余步载入章预设 + 新托盘
    applyStep(current().step.tray.length > 0);
  }

  // main 在 session.place 前调用：不合法引导动作直接弹回，不结算
  function intercept(slot, r, c) {
    if (destroyed) return { allow: true };
    const { step } = current();
    if (step.wait.event !== "place") return { allow: false, text: step.wrong?.text ?? "" };
    const a = step.spotlight.anchor;
    if (step.wait.slot !== slot || a.r !== r || a.c !== c) {
      return { allow: false, text: step.wrong?.text ?? "" };
    }
    return { allow: true };
  }

  // main 在成功落子后调用：校验 wait 条件 → 播完动画 → 推进
  async function onGameEvent(events) {
    if (destroyed) return;
    const { step } = current();
    if (step.wait.event !== "place") return;
    const placed = events.find((e) => e.type === "piecePlaced");
    const cleared = events.find((e) => e.type === "linesCleared");
    const slotOk = placed && placed.slot === step.wait.slot;
    const linesOk = step.wait.clearedLines
      ? cleared && cleared.lineCount === step.wait.clearedLines
      : true;
    if (!slotOk || !linesOk) {
      // 自检测试保证不发生；兜底只提示不推进
      flashWrong(step.wrong?.text ?? "");
      return;
    }
    persist();
    await new Promise((resolve) => setTimeout(resolve, DIM_MS));
    if (destroyed) return;
    advance();
  }

  function start() {
    const saved = store.tutorialStep;
    const idx = flat.findIndex(({ step }) => step.id === saved);
    cur = idx >= 0 ? idx : 0;
    root.classList.add("in-tutorial");
    window.addEventListener("resize", reposition);
    applyStep(true); // 进入/恢复统一载入当前步所属章开场棋盘
    if (!welcomePlayed) {
      welcomePlayed = true;
      sound.play("tutorialWelcome");
    }
  }

  function destroy() {
    destroyed = true;
    removeOverlay();
    root.classList.remove("in-tutorial");
    window.removeEventListener("resize", reposition);
  }

  function stepInfo() {
    return destroyed ? null : { index: cur, id: current().step.id, phase: session.getState().phase };
  }

  return { start, destroy, intercept, onGameEvent, flashWrong, active, stepInfo, set onExit(fn) { onExit = fn; } };
}

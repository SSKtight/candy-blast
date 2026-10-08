// 托盘渲染：三槽（槽 2 为受控槽）。重抽按钮置底（#btn-reroll）。
import { hasAnyPlacement } from "../engine/board.js";

const GAP = 2; // 块内格间距（px），与 .g-piece 的 gap 保持一致
const SLOT_PAD = 6; // 块与槽边缘的最小留白（px）——须大于槽 outline 宽度，否则 line5 会贴到受控槽虚线框
// 托盘格单位：以全形状库最大包围盒维度（line5 横向 = 5）在槽内拟合。
// 只取决于槽位宽度，不随当前批次/剩余块变化——放下方块后尺寸恒定；
// 槽位宽度仅随窗口/旋转变化（响应式），三槽吃满整行。
const MAX_DIM = 5;

function pieceDims(piece) {
  let rows = 1;
  let cols = 1;
  for (const [r, c] of piece.cells) {
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}

// 构造与棋盘格同风格的小块元素；unit 为单格边长（px），保证格子为正方形、不拉伸
// slotStaggerMs：槽间入场交错（逐格组装时加到每格延迟上）
function buildPieceEl(piece, unit, slotStaggerMs = 0) {
  const { rows, cols } = pieceDims(piece);
  const el = document.createElement("div");
  el.className = "g-piece";
  el.dataset.pieceId = String(piece.id);
  el.style.gridTemplateColumns = `repeat(${cols}, ${unit}px)`;
  el.style.gridTemplateRows = `repeat(${rows}, ${unit}px)`;
  el.style.width = `${cols * unit + (cols - 1) * GAP}px`;
  el.style.height = `${rows * unit + (rows - 1) * GAP}px`;
  const filled = new Set(piece.cells.map(([r, c]) => r * cols + c));
  let filledIdx = 0;
  for (let i = 0; i < rows * cols; i++) {
    const cell = document.createElement("div");
    if (filled.has(i)) {
      cell.className = "g-piece-cell";
      cell.style.setProperty("--cell-color", `var(--candy-${piece.color})`);
      // 逐格组装：按行优先顺序每格 60ms 依次冒泡（仅 g-pop-in 时生效）
      cell.style.setProperty("--cell-d", `${slotStaggerMs + filledIdx * 60}ms`);
      filledIdx++;
    }
    cell.style.gridRow = `${Math.floor(i / cols) + 1}`;
    cell.style.gridColumn = `${(i % cols) + 1}`;
    el.appendChild(cell);
  }
  return el;
}

export function createTrayView(rootEl) {
  const slots = [0, 1, 2].map((i) => rootEl.querySelector(`.g-slot[data-i="${i}"]`));
  const crowns = slots.map((slot) => slot?.querySelector(".g-slot-crown") ?? null);
  const rerollBtn = document.getElementById("btn-reroll");
  const rerollCbs = new Set();

  let lastState = null;
  let lastRenderKey = null; // 托盘渲染指纹：同 id 序列/尺寸/受控模式时跳过重渲染，保住进行中的入场动画

  rerollBtn?.addEventListener("click", () => {
    if (rerollBtn.disabled) return;
    for (const cb of rerollCbs) cb();
  });

  // 由槽位宽度按最大形状维度拟合（跨批次恒定，窄屏自然收缩）
  function fixedUnit() {
    const w = slots[0]?.clientWidth ?? 0;
    if (!w) return 0;
    return Math.max(0, (w - SLOT_PAD * 2 - (MAX_DIM - 1) * GAP) / MAX_DIM);
  }

  function render(state) {
    const unit = fixedUnit();
    const ids = state.tray.map((p) => (p ? p.id : 0));
    // 托盘无实质变化（同 id 序列、同尺寸、同模式）时跳过重建——避免把刚挂上的入场动画二次渲染销毁
    const renderKey = ids.join(",") + "|" + unit.toFixed(2) + "|" + state.controlledMode;
    if (renderKey === lastRenderKey) return;
    // 上一批块的 id 集合：识别"新出现的块"才播入场动画
    const prevIds = new Set((lastState ? lastState.tray : []).filter(Boolean).map((p) => p.id));
    lastRenderKey = renderKey;
    lastState = state;
    for (let i = 0; i < 3; i++) {
      const slot = slots[i];
      const piece = state.tray[i];
      // 槽内旧块将被清掉且新状态该槽无块 → 抽成淡出克隆（立刻响应放置，又不生硬闪没）
      const oldPieceEl = slot.querySelector(".g-piece");
      let ghost = null;
      if (oldPieceEl && !piece) {
        ghost = oldPieceEl.cloneNode(true);
        ghost.classList.add("g-piece-out-ghost");
        ghost.style.position = "absolute";
        ghost.style.inset = "0";
        ghost.style.margin = "auto";
        ghost.style.pointerEvents = "none";
      }
      slot.innerHTML = "";
      if (ghost) {
        slot.appendChild(ghost);
        setTimeout(() => ghost.remove(), 180);
      }
      const isPremium = state.controlledMode === "premium";
      // 死块置灰：当前棋盘无任何合法落点（drag.js 同步拦截拿起）
      const isDead = !!piece && !hasAnyPlacement(state.board, state.dims, piece);
      slot.classList.toggle("is-dead", isDead);
      if (isDead) slot.setAttribute("aria-disabled", "true");
      else slot.removeAttribute("aria-disabled");
      slot.classList.toggle("is-premium", isPremium);
      if (crowns[i]) {
        crowns[i].hidden = !isPremium;
        slot.appendChild(crowns[i]);
      }
      if (piece && unit > 0) {
        const el = buildPieceEl(piece, unit, i * 70);
        // 新出现的块（id 不在上一批）播逐格组装入场；resize/暂停恢复等 id 不变则跳过
        if (!prevIds.has(piece.id)) {
          el.classList.add("g-pop-in");
        }
        slot.appendChild(el);
        slot.tabIndex = 0;
        slot.setAttribute("role", "button");
        slot.setAttribute("aria-label", `形状槽 ${i + 1}`);
      } else if (piece) {
        // 布局尚未就绪（unit=0）：先占位，ResizeObserver 触发后重渲染
        slot.tabIndex = 0;
        slot.setAttribute("role", "button");
        slot.setAttribute("aria-label", `形状槽 ${i + 1}`);
      } else {
        // 方块被放走/批被换：槽内旧块快速淡出（复用 g-piece-out），而非瞬间消失
        slot.tabIndex = -1;
        slot.removeAttribute("role");
        slot.removeAttribute("aria-label");
      }
    }
  }

  function setRerollEnabled(v) {
    if (rerollBtn) rerollBtn.disabled = !v;
  }

  function slotEl(i) {
    return slots[i];
  }

  function on(evt, cb) {
    if (evt === "reroll") rerollCbs.add(cb);
  }

  // 槽尺寸变化（旋转/窗口缩放）时用同一状态重排，保持格单位正确
  const ro = new ResizeObserver(() => {
    if (lastState) render(lastState, { animate: false });
  });
  if (slots[0]) ro.observe(slots[0]);

  return { render, setRerollEnabled, on, slotEl };
}

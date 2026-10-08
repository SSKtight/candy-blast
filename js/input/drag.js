// Pointer Events 拖拽 + 键盘可达操作。
import { canPlaceAt, legalAnchors, hasAnyPlacement } from "../engine/board.js";

function pieceDims(piece) {
  let rows = 1;
  let cols = 1;
  for (const [r, c] of piece.cells) {
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
  }
  return { rows, cols };
}

// 锚点格：填充格中最靠下（r 最大）的一行里、最靠左（c 最小）的那一个
function anchorCellOf(piece) {
  let dr = piece.cells[0][0];
  let dc = piece.cells[0][1];
  for (const [r, c] of piece.cells) {
    if (r > dr || (r === dr && c < dc)) {
      dr = r;
      dc = c;
    }
  }
  return { dr, dc };
}

function buildClone(piece, cell) {
  const { rows, cols } = pieceDims(piece);
  const gap = 2;
  const el = document.createElement("div");
  el.className = "g-piece g-drag-clone";
  el.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
  el.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;
  el.style.gap = `${gap}px`;
  el.style.width = `${cols * cell + (cols - 1) * gap}px`;
  el.style.height = `${rows * cell + (rows - 1) * gap}px`;
  const filled = new Set(piece.cells.map(([r, c]) => r * cols + c));
  for (let i = 0; i < rows * cols; i++) {
    const d = document.createElement("div");
    if (filled.has(i)) {
      d.className = "g-piece-cell";
      d.style.setProperty("--cell-color", `var(--candy-${piece.color})`);
    }
    el.appendChild(d);
  }
  return el;
}

export function attachDrag(opts) {
  const { getState, canInteract, boardView, trayView, onPlace, onBlocked, onValidHover, onReroll, onPause, onDragState } = opts;

  let drag = null; // 指针拖拽令牌
  let kb = null; // 键盘模式 {slot, piece, anchor, valid}
  let rafId = 0;

  // ---------- 幽灵预览 ----------
  function preview(piece, anchor) {
    const state = getState();
    const valid = canPlaceAt(state.board, state.dims, piece, anchor.r, anchor.c);
    const offsets = piece.cells.map(([dr, dc]) => [anchor.r + dr, anchor.c + dc]);
    boardView.showGhost(offsets, piece.color);
    if (!valid) boardView.clearGhost();
    return valid;
  }

  function clearPreview() {
    boardView.clearGhost();
    boardView.setKbCursor(null);
  }

  function focusSomeFilled(preferSlot) {
    const state = getState();
    const order = [preferSlot, 0, 1, 2].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) {
      if (state.tray[i]) {
        trayView.slotEl(i)?.focus();
        return;
      }
    }
  }

  // ---------- 指针拖拽 ----------
  function onPointerDown(e) {
    if (drag || e.pointerType === "mouse" && e.button !== 0) return;
    if (!canInteract()) return;
    const slotEl = e.currentTarget;
    const i = Number(slotEl.dataset.i);
    const state = getState();
    const piece = state.tray[i];
    if (!piece) return;
    // 死块不可拖拽：槽位已置灰（trayView.is-dead），指针按下直接忽略
    if (!hasAnyPlacement(state.board, state.dims, piece)) return;

    e.preventDefault();
    try {
      slotEl.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持 capture，降级用 window 监听 */
    }

    const pieceEl = slotEl.querySelector(".g-piece");

    const cell = boardView.cellSize;
    const { dr: anchorDr, dc: anchorDc } = anchorCellOf(piece);
    const gap = 2;
    // 锚点格中心相对克隆体左上角的偏移（克隆体按棋盘格大小 1:1 绘制）
    const ox = anchorDc * (cell + gap) + cell / 2;
    const oy = anchorDr * (cell + gap) + cell / 2;

    const clone = buildClone(piece, cell);
    // 拿起瞬间即让最左下锚点格对准指针，缩放也围绕该点，锚点不漂移
    clone.style.transformOrigin = `${ox}px ${oy}px`;
    clone.style.left = `${e.clientX - ox}px`;
    clone.style.top = `${e.clientY - oy}px`;
    document.body.appendChild(clone);
    pieceEl.classList.add("g-dragging");

    drag = {
      slot: i,
      slotEl,
      pieceEl,
      piece,
      pointerId: e.pointerId,
      clone,
      anchorDr,
      anchorDc,
      ox,
      oy,
      x: e.clientX,
      y: e.clientY,
      valid: false,
      wasValid: false,
    };
    onDragState?.(true);
  }

  function updateDrag() {
    rafId = 0;
    if (!drag) return;
    // 锚点格中心始终咬住指针
    drag.clone.style.left = `${drag.x - drag.ox}px`;
    drag.clone.style.top = `${drag.y - drag.oy}px`;
    const cell = boardView.cellFromClientXy(drag.x, drag.y, 0.5);
    if (!cell) {
      // 完全离开棋盘（含容差区）：只静幽灵，不抖动、不响失败音——
      // 跟随指针的克隆体不应有任何额外位移
      drag.wasValid = false;
      drag.valid = false;
      boardView.clearGhost();
      return;
    }
    // 指针命中格 = 锚点格；放置基准 = 命中格回退锚点偏移
    const anchor = { r: cell.r - drag.anchorDr, c: cell.c - drag.anchorDc };
    drag.valid = preview(drag.piece, anchor);
    drag.anchor = anchor;
    if (!drag.valid && drag.wasValid) onBlocked?.();
    if (drag.valid && !drag.wasValid) onValidHover?.();
    drag.wasValid = drag.valid;
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(updateDrag);
  }

  function finishDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    onDragState?.(false);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    clearPreview();
    d.clone.remove();
    d.pieceEl.classList.remove("g-dragging");
    if (!cancelled && d.valid && d.anchor && canInteract()) {
      onPlace(d.slot, d.anchor.r, d.anchor.c);
    }
    // 非法/离盘松手：方块原位恢复即可，不做抖动反馈
  }

  function onPointerUp(e) {
    finishDrag(e, false);
  }
  function onPointerCancel(e) {
    finishDrag(e, true);
  }

  function cancelDragOnResize() {
    if (!drag) return;
    const d = drag;
    drag = null;
    onDragState?.(false);
    if (rafId) cancelAnimationFrame(rafId);
    clearPreview();
    d.clone.remove();
    d.pieceEl.classList.remove("g-dragging");
  }

  // ---------- 键盘 ----------
  function beginKb(i) {
    if (!canInteract()) return;
    const state = getState();
    const piece = state.tray[i];
    if (!piece) return false;
    const anchors = legalAnchors(state.board, state.dims, piece);
    // 死块不可拿起：无合法落点时直接拒绝进入键盘模式
    if (anchors.length === 0) return false;
    kb = {
      slot: i,
      piece,
      anchor: anchors[0],
      valid: true,
    };
    renderKb();
    return true;
  }

  function renderKb() {
    kb.valid = preview(kb.piece, kb.anchor);
    if (kb.valid) boardView.setKbCursor(kb.anchor.r, kb.anchor.c);
    else boardView.setKbCursor(null);
  }

  function endKb(placed) {
    const slot = kb.slot;
    kb = null;
    clearPreview();
    if (placed) requestAnimationFrame(() => focusSomeFilled(slot));
    else trayView.slotEl(slot)?.focus();
  }

  function onSlotKeydown(e) {
    const i = Number(e.currentTarget.dataset.i);
    if ((e.key === "Enter" || e.key === " ") && !kb) {
      if (beginKb(i)) e.preventDefault();
      return;
    }
    if (!kb || kb.slot !== i) return;
    let handled = true;
    switch (e.key) {
      case "ArrowUp": kb.anchor.r -= 1; break;
      case "ArrowDown": kb.anchor.r += 1; break;
      case "ArrowLeft": kb.anchor.c -= 1; break;
      case "ArrowRight": kb.anchor.c += 1; break;
      case "Enter":
      case " ":
        if (kb.valid && canInteract()) {
          const { r, c } = kb.anchor;
          endKb(true);
          onPlace(i, r, c);
        }
        e.preventDefault();
        return;
      case "Escape":
        endKb(false);
        e.preventDefault();
        return;
      default:
        handled = false;
    }
    if (handled) {
      renderKb();
      e.preventDefault();
    }
  }

  function onDocKeydown(e) {
    if (document.querySelector(".g-modal-mask")) return; // 弹窗打开时快捷键不穿透
    if (e.key === "r" || e.key === "R") {
      if (canInteract()) onReroll?.();
    } else if (e.key === "p" || e.key === "P") {
      onPause?.();
    }
  }

  // ---------- 绑定 ----------
  const slotEls = [0, 1, 2].map((i) => trayView.slotEl(i));
  for (const el of slotEls) {
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("keydown", onSlotKeydown);
  }
  window.addEventListener("resize", cancelDragOnResize);
  document.addEventListener("keydown", onDocKeydown);

  function destroy() {
    cancelDragOnResize();
    for (const el of slotEls) {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("keydown", onSlotKeydown);
    }
    window.removeEventListener("resize", cancelDragOnResize);
    document.removeEventListener("keydown", onDocKeydown);
  }

  return { destroy };
}

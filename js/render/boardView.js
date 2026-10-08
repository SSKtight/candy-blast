// 棋盘渲染：81 格 CSS Grid，Uint8Array → CSS 糖果色；幽灵预览与命中检测。
export function createBoardView(rootEl, dims) {
  rootEl.innerHTML = "";
  const cells = [];
  for (let i = 0; i < dims.rows * dims.cols; i++) {
    const el = document.createElement("div");
    el.className = "g-cell";
    el.dataset.idx = String(i);
    rootEl.appendChild(el);
    cells.push(el);
  }

  let cellSize = 0;
  let locked = false;
  let lastBoard = null; // 最近一次渲染的棋盘，供幽灵预览跳过已填充格
  const ghostIdx = new Set(); // 当前加了幽灵样式的格索引，清理时只动这些格

  function idxOf(r, c) {
    return r * dims.cols + c;
  }

  function render(board) {
    lastBoard = board;
    for (let i = 0; i < cells.length; i++) {
      const v = board[i];
      const el = cells[i];
      if (v > 0) {
        el.className = "g-cell g-filled";
        el.style.setProperty("--cell-color", `var(--candy-${v})`);
      } else {
        el.className = "g-cell";
        el.style.removeProperty("--cell-color");
      }
    }
    ghostIdx.clear();
  }

  function clearGhost() {
    for (const i of ghostIdx) {
      cells[i].classList.remove("g-ghost");
      // 空格本无 --cell-color，移除幽灵时一并清掉，避免残留
      cells[i].style.removeProperty("--cell-color");
    }
    ghostIdx.clear();
  }

  // cells: [r,c][]; color: 1..6。只在空格上画幽灵，绝不改动已填充格
  function showGhost(offsets, color) {
    clearGhost();
    for (const [r, c] of offsets) {
      if (r < 0 || r >= dims.rows || c < 0 || c >= dims.cols) continue;
      const i = idxOf(r, c);
      if (lastBoard && lastBoard[i] > 0) continue; // 已有方块：保持原色，不加预览
      const el = cells[i];
      el.style.setProperty("--cell-color", `var(--candy-${color})`);
      el.classList.add("g-ghost");
      ghostIdx.add(i);
    }
  }

  // 落子吸入
  function popPlace(indices) {
    for (const i of indices) {
      const el = cells[i];
      el.classList.remove("g-place-pop");
      void el.offsetWidth;
      el.classList.add("g-place-pop");
      setTimeout(() => el.classList.remove("g-place-pop"), 140);
    }
  }

  // 波浪扫消：整行从左到右、整列从上到下逐格 stagger 收缩消失，粒子在格子消失瞬间同步迸出。
  // 调用时棋盘须仍显示含被消格的快照。返回动画总时长(ms)，供外层 await 后再清盘。
  function waveClear(rows, cols) {
    const STEP = 18; // ms/格，波浪逐格间隔
    const ANIM = 200; // ms，单格消失动画时长（对应 CSS g-wave-clear 0.2s）
    let maxDelay = 0;
    const apply = (i, orderIdx) => {
      const el = cells[i];
      if (!lastBoard || lastBoard[i] <= 0) return; // 空格跳过
      if (el.classList.contains("g-wave-clear")) return; // 行列交叉格只处理一次
      const d = orderIdx * STEP;
      maxDelay = Math.max(maxDelay, d);
      el.style.setProperty("--wave-delay", `${d}ms`);
      el.classList.add("g-wave-clear");
      const colorVar = el.style.getPropertyValue("--cell-color") || "var(--candy-4)";
      for (let k = 0; k < 4; k++) {
        const dot = document.createElement("span");
        dot.className = "g-particle";
        const ang = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 20;
        dot.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
        dot.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
        dot.style.background = colorVar;
        dot.style.animationDelay = `${d}ms`; // 与格子消失同步
        el.appendChild(dot);
        setTimeout(() => dot.remove(), d + 300);
      }
    };
    for (const r of rows) for (let c = 0; c < dims.cols; c++) apply(idxOf(r, c), c); // 行：左→右
    for (const c of cols) for (let r = 0; r < dims.rows; r++) apply(idxOf(r, c), r); // 列：上→下
    return maxDelay + ANIM + 40;
  }

  // 终局：轻震 + 变暗
  function setGameOverDim(on) {
    rootEl.classList.toggle("g-over", on);
    if (on) {
      rootEl.classList.remove("g-board-shake");
      void rootEl.offsetWidth;
      rootEl.classList.add("g-board-shake");
      setTimeout(() => rootEl.classList.remove("g-board-shake"), 420);
    }
  }

  function setLocked(v) {
    locked = v;
    rootEl.style.pointerEvents = v ? "none" : "";
  }

  function cellEl(r, c) {
    return cells[idxOf(r, c)];
  }

  function setKbCursor(r, c) {
    for (const el of cells) el.classList.remove("g-kb-cursor");
    if (r == null) return;
    cells[idxOf(r, c)].classList.add("g-kb-cursor");
  }

  // padCells：棋盘外扩的命中容差（单位：格），超出一点点仍吸附到边行/边列
  function cellFromClientXy(x, y, padCells = 0) {
    const rect = rootEl.getBoundingClientRect();
    const pad = padCells * (rect.width / dims.cols);
    if (
      x < rect.left - pad || x > rect.right + pad ||
      y < rect.top - pad || y > rect.bottom + pad
    ) return null;
    const c = Math.min(dims.cols - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * dims.cols)));
    const r = Math.min(dims.rows - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * dims.rows)));
    return { r, c };
  }

  function resize() {
    cellSize = rootEl.clientWidth / dims.cols;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(rootEl);
  resize();

  return {
    el: rootEl,
    dims,
    get cellSize() {
      return cellSize;
    },
    render,
    showGhost,
    clearGhost,
    popPlace,
    waveClear,
    setGameOverDim,
    setLocked,
    setKbCursor,
    cellEl,
    cellFromClientXy,
    resize,
  };
}

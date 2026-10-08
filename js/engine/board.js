// 棋盘：扁平整型数组上的纯计算。无 DOM 依赖。

export function createBoard(dims) {
  return new Uint8Array(dims.rows * dims.cols);
}

export function cloneBoard(board) {
  return new Uint8Array(board);
}

// piece 以 (r,c) 为左上角时，所有格是否都在界内且为空
export function canPlaceAt(board, dims, piece, r, c) {
  for (const [dr, dc] of piece.cells) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr < 0 || rr >= dims.rows || cc < 0 || cc >= dims.cols) return false;
    if (board[rr * dims.cols + cc] !== 0) return false;
  }
  return true;
}

export function legalAnchors(board, dims, piece) {
  const out = [];
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) {
      if (canPlaceAt(board, dims, piece, r, c)) out.push({ r, c });
    }
  }
  return out;
}

export function hasAnyPlacement(board, dims, piece) {
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) {
      if (canPlaceAt(board, dims, piece, r, c)) return true;
    }
  }
  return false;
}

// 棋盘填充度（0~1）：已占格 / 总格
export function fillRatio(board, dims) {
  let filled = 0;
  for (let i = 0; i < board.length; i++) if (board[i] !== 0) filled++;
  return filled / (dims.rows * dims.cols);
}

// 调用方需先用 canPlaceAt 校验
export function writePiece(board, dims, piece, r, c) {
  for (const [dr, dc] of piece.cells) {
    board[(r + dr) * dims.cols + (c + dc)] = piece.color;
  }
}

export function findFullLines(board, dims) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < dims.rows; r++) {
    let full = true;
    const base = r * dims.cols;
    for (let c = 0; c < dims.cols; c++) {
      if (board[base + c] === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(r);
  }
  for (let c = 0; c < dims.cols; c++) {
    let full = true;
    for (let r = 0; r < dims.rows; r++) {
      if (board[r * dims.cols + c] === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

// 满行∪满列的格数（行列交叉点只计一次）
export function unionCellCount(dims, fullRows, fullCols) {
  return fullRows.length * dims.cols
    + fullCols.length * dims.rows
    - fullRows.length * fullCols.length;
}

// 清除满行满列，返回清除格数
export function clearLines(board, dims, fullRows, fullCols) {
  const rowSet = new Set(fullRows);
  const colSet = new Set(fullCols);
  let n = 0;
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) {
      if (rowSet.has(r) || colSet.has(c)) {
        const i = r * dims.cols + c;
        if (board[i] !== 0) {
          board[i] = 0;
          n++;
        }
      }
    }
  }
  return n;
}

// 满线覆盖到的全部下标（供表现层消除动画）
export function lineCellIndices(dims, fullRows, fullCols) {
  const rowSet = new Set(fullRows);
  const colSet = new Set(fullCols);
  const out = [];
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) {
      if (rowSet.has(r) || colSet.has(c)) out.push(r * dims.cols + c);
    }
  }
  return out;
}

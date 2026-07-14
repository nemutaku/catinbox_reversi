(() => {
  const E = 0, B = 1, W = -1;
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const copy = board => board.map(row => row.slice());
  const emptyObservedBoard = () => Array.from({ length: 8 }, () => Array(8).fill(false));
  const normalizeObservedBoard = value => Array.isArray(value)
    ? value.map(row => Array.isArray(row) ? row.map(Boolean) : Array(8).fill(false))
    : emptyObservedBoard();

  function flips(board, r, c, player) {
    if (board[r][c] !== E) return [];
    let out = [];
    for (const [dr, dc] of dirs) {
      let x = r + dr, y = c + dc, line = [];
      while (inside(x, y) && board[x][y] === -player) {
        line.push([x, y]);
        x += dr;
        y += dc;
      }
      if (line.length && inside(x, y) && board[x][y] === player) out = out.concat(line);
    }
    return out;
  }

  function moves(board, player) {
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const f = flips(board, r, c, player);
      if (f.length) out.push({ r, c, f });
    }
    return out;
  }

  function count(board, player) {
    return board.flat().filter(value => value === player).length;
  }

  function applyMove(board, probBoard, observedBoard, move, player, probability = 80) {
    const nextBoard = copy(board);
    const nextProbBoard = copy(probBoard);
    const nextObservedBoard = copy(observedBoard);
    nextBoard[move.r][move.c] = player;
    nextProbBoard[move.r][move.c] = probability;
    nextObservedBoard[move.r][move.c] = false;
    for (const [r, c] of move.f) {
      nextBoard[r][c] = player;
      nextProbBoard[r][c] = probability;
      nextObservedBoard[r][c] = false;
    }
    return { board: nextBoard, probBoard: nextProbBoard, observedBoard: nextObservedBoard };
  }

  function applyObservationRoll(board, probBoard, observedBoard, random = Math.random) {
    let colorChanged = 0;
    let probabilityChanged = false;
    const events = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c] === E) continue;
      const beforeColor = board[r][c];
      const probability = probBoard[r][c];
      const wasObserved = Boolean(observedBoard[r][c]);
      let changedColor = false;
      if (random() < (100 - probability) / 100) {
        board[r][c] = -board[r][c];
        colorChanged++;
        changedColor = true;
      }
      if (probability !== 100) probabilityChanged = true;
      probBoard[r][c] = 100;
      observedBoard[r][c] = true;
      events.push({
        r,
        c,
        beforeColor,
        afterColor: board[r][c],
        wasObserved,
        colorChanged: changedColor,
        probabilityChanged: probability !== 100
      });
    }
    return { colorChanged, probabilityChanged, events };
  }

  window.OthelloRules = {
    constants: { E, B, W },
    copy,
    emptyObservedBoard,
    normalizeObservedBoard,
    flips,
    moves,
    count,
    applyMove,
    applyObservationRoll
  };
})();

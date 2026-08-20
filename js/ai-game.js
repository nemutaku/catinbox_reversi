(() => {
  const playerColorKey = 'othelloAiPlayerColor';
  const difficultyKey = 'othelloAiDifficulty';
  const corners = new Set(['0,0', '0,7', '7,0', '7,7']);
  const xSquares = new Set(['1,1', '1,6', '6,1', '6,6']);
  const cSquares = new Set(['0,1', '1,0', '0,6', '1,7', '6,0', '7,1', '6,7', '7,6']);
  const dangerCornerMap = {
    '0,1': [[0, 0]],
    '1,0': [[0, 0]],
    '1,1': [[0, 0]],
    '0,6': [[0, 7]],
    '1,7': [[0, 7]],
    '1,6': [[0, 7]],
    '6,0': [[7, 0]],
    '7,1': [[7, 0]],
    '6,1': [[7, 0]],
    '6,7': [[7, 7]],
    '7,6': [[7, 7]],
    '6,6': [[7, 7]]
  };
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const openingBookSource = window.quantumOthelloOpeningBook || { policy: {}, lines: [] };

  function loadPlayerColor() {
    return localStorage.getItem(playerColorKey) === 'white' ? 'white' : 'black';
  }

  function savePlayerColor(color) {
    localStorage.setItem(playerColorKey, color);
  }

  function loadDifficulty() {
    const value = localStorage.getItem(difficultyKey);
    return ['easy', 'normal', 'hard'].includes(value) ? value : 'easy';
  }

  function saveDifficulty(difficulty) {
    localStorage.setItem(difficultyKey, difficulty);
  }

  function getPlayerColor() {
    return loadPlayerColor();
  }

  function getDifficulty() {
    return loadDifficulty();
  }

  function clampProbability(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(100, Math.max(0, Math.round(number)));
  }

  function specialProbability(state, key, fallback) {
    const probabilities = state.rules?.specialProbabilities || {};
    return clampProbability(probabilities[key] ?? probabilities[String(key)], fallback);
  }

  function specialUseLimit(state, key) {
    const limits = state.rules?.specialUseLimits || {};
    const value = Number(limits[key] ?? limits[String(key)]);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 2;
  }

  function normalProbability(state) {
    return clampProbability(state.rules?.normalProbability, 80);
  }

  function zeroSpecialProbability(state) {
    return specialProbability(state, 0, 0);
  }

  function highSpecialProbability(state) {
    return specialProbability(state, 100, 100);
  }

  function zeroTacticalFactorForProbability(probability) {
    if (probability > 30) return 0;
    return Math.max(0, (30 - probability) / 30);
  }

  function highConfidenceFactorForProbability(probability) {
    if (probability < 70) return 0;
    return Math.max(0, (probability - 70) / 30);
  }

  function zeroTacticalFactor(state) {
    return zeroTacticalFactorForProbability(zeroSpecialProbability(state));
  }

  function highConfidenceFactor(state) {
    return highConfidenceFactorForProbability(highSpecialProbability(state));
  }

  function bestZeroStrategyOption(state) {
    const normalFactor = zeroTacticalFactorForProbability(normalProbability(state));
    const specialFactor = state.specialRemaining?.[0] > 0 ? zeroTacticalFactor(state) : 0;
    if (normalFactor <= 0 && specialFactor <= 0) return null;
    if (normalFactor >= specialFactor) return { probability: null, factor: normalFactor };
    return { probability: 0, factor: specialFactor };
  }

  function bestHighStrategyOption(state) {
    const normalFactor = highConfidenceFactorForProbability(normalProbability(state));
    const specialFactor = state.specialRemaining?.[100] > 0 ? highConfidenceFactor(state) : 0;
    if (normalFactor <= 0 && specialFactor <= 0) return null;
    if (normalFactor >= specialFactor) return { probability: null, factor: normalFactor };
    return { probability: 100, factor: specialFactor };
  }

  function aiColorValue() {
    return getPlayerColor() === 'white' ? 1 : -1;
  }

  function updateAiResourcePanel(state) {
    if (!state) return;
    const aiColor = aiColorValue();
    const specialUsed = state.specialUsed?.[aiColor] || {};
    const observeLeft = state.observeUsesLeft?.[aiColor] ?? 0;
    const special100 = Math.max(0, specialUseLimit(state, 100) - Number(specialUsed[100] || 0));
    const special0 = Math.max(0, specialUseLimit(state, 0) - Number(specialUsed[0] || 0));
    const special100El = document.querySelector('#aiSpecial100');
    const special0El = document.querySelector('#aiSpecial0');
    const observeEl = document.querySelector('#aiObserveLeft');
    if (special100El) special100El.textContent = `あと${special100}回`;
    if (special0El) special0El.textContent = `あと${special0}回`;
    if (observeEl) observeEl.textContent = `あと${observeLeft}回`;
  }

  function occupiedCount(state) {
    return state.board.flat().filter(Boolean).length;
  }

  function gamePhase(state) {
    const occupied = occupiedCount(state);
    if (occupied < 20) return 'opening';
    if (occupied < 44) return 'middle';
    return 'endgame';
  }

  function uncertainCount(state) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (state.board[r][c] && state.probBoard[r][c] !== 100) total++;
    }
    return total;
  }

  function countColor(state, color) {
    return state.board.flat().filter(value => value === color).length;
  }

  function countColorInBoard(board, color) {
    return board.flat().filter(value => value === color).length;
  }

  function cellStayRate(probBoard, r, c) {
    return clampProbability(probBoard?.[r]?.[c], 100) / 100;
  }

  function expectedColorValue(board, probBoard, r, c, color) {
    if (!board[r][c]) return 0;
    const stayRate = cellStayRate(probBoard, r, c);
    return board[r][c] === color ? stayRate : 1 - stayRate;
  }

  function expectedColorCount(board, probBoard, color) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      total += expectedColorValue(board, probBoard, r, c, color);
    }
    return total;
  }

  function expectedCornerCount(board, probBoard, color) {
    return [[0, 0], [0, 7], [7, 0], [7, 7]]
      .reduce((sum, [r, c]) => sum + expectedColorValue(board, probBoard, r, c, color), 0);
  }

  function expectedFrontierCount(board, probBoard, color) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (!board[r][c]) continue;
      if (!dirs.some(([dr, dc]) => inside(r + dr, c + dc) && !board[r + dr][c + dc])) continue;
      total += expectedColorValue(board, probBoard, r, c, color);
    }
    return total;
  }

  function emptyCountInBoard(board) {
    return board.flat().filter(value => !value).length;
  }

  function inside(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  function copyBoard(board) {
    return board.map(row => row.slice());
  }

  function flipsFor(board, r, c, color) {
    if (board[r][c]) return [];
    let out = [];
    for (const [dr, dc] of dirs) {
      let x = r + dr;
      let y = c + dc;
      const line = [];
      while (inside(x, y) && board[x][y] === -color) {
        line.push([x, y]);
        x += dr;
        y += dc;
      }
      if (line.length && inside(x, y) && board[x][y] === color) out = out.concat(line);
    }
    return out;
  }

  function legalMovesFor(board, color) {
    const moves = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const f = flipsFor(board, r, c, color);
      if (f.length) moves.push({ r, c, f });
    }
    return moves;
  }

  function applyMove(board, move, color) {
    const next = copyBoard(board);
    next[move.r][move.c] = color;
    for (const [r, c] of move.f) next[r][c] = color;
    return next;
  }

  function applyMoveWithProbability(board, probBoard, move, color, probability) {
    const nextBoard = applyMove(board, move, color);
    const nextProbBoard = copyBoard(probBoard);
    nextProbBoard[move.r][move.c] = probability;
    for (const [r, c] of move.f) nextProbBoard[r][c] = probability;
    return { board: nextBoard, probBoard: nextProbBoard };
  }

  function boardsEqual(a, b) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
    return true;
  }

  function coordToPoint(coord) {
    return { r: Number(coord.slice(1)) - 1, c: coord.charCodeAt(0) - 65 };
  }

  function pointToCoord(point) {
    return `${String.fromCharCode(65 + point.c)}${point.r + 1}`;
  }

  function transformPoint(point, transform) {
    const { r, c } = point;
    if (transform === 'rot180') return { r: 7 - r, c: 7 - c };
    if (transform === 'diag') return { r: c, c: r };
    if (transform === 'antiDiag') return { r: 7 - c, c: 7 - r };
    return point;
  }

  function transformSequence(sequence, transform) {
    return sequence.map(coord => pointToCoord(transformPoint(coordToPoint(coord), transform)));
  }

  function initialBoard() {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[3][3] = -1;
    board[3][4] = 1;
    board[4][3] = 1;
    board[4][4] = -1;
    return board;
  }

  function legalOpeningPrefix(sequence) {
    let board = initialBoard();
    let color = 1;
    const legalPrefix = [];
    for (const coord of sequence) {
      const point = coordToPoint(coord);
      const move = legalMovesFor(board, color).find(item => item.r === point.r && item.c === point.c);
      if (!move) break;
      legalPrefix.push(coord);
      board = applyMove(board, move, color);
      color = -color;
    }
    return legalPrefix;
  }

  function boardAfterOpeningPrefix(sequence, ply) {
    let board = initialBoard();
    let color = 1;
    for (let i = 0; i < ply; i++) {
      const point = coordToPoint(sequence[i]);
      const move = legalMovesFor(board, color).find(item => item.r === point.r && item.c === point.c);
      if (!move) return null;
      board = applyMove(board, move, color);
      color = -color;
    }
    return board;
  }

  function createOpeningBook() {
    const transforms = openingBookSource.policy?.transforms?.length
      ? openingBookSource.policy.transforms
      : ['identity'];
    const seen = new Set();
    const book = [];
    for (const line of openingBookSource.lines || []) {
      if (!Array.isArray(line.moves) || !line.moves.length) continue;
      for (const transform of transforms) {
        const sequence = legalOpeningPrefix(transformSequence(line.moves, transform));
        const key = sequence.join(' ');
        if (!sequence.length || seen.has(key)) continue;
        seen.add(key);
        book.push({
          id: line.id || key,
          family: line.family || 'custom',
          label: line.label || line.id || key,
          weight: Number(line.weight) || 100,
          transform,
          sequence
        });
      }
    }
    return book;
  }

  const openingBook = createOpeningBook();

  function cornerCount(board, color) {
    return [[0, 0], [0, 7], [7, 0], [7, 7]].filter(([r, c]) => board[r][c] === color).length;
  }

  function legalCornerCount(board, color) {
    return legalMovesFor(board, color).filter(move => corners.has(`${move.r},${move.c}`)).length;
  }

  function cornerOwnedAfterMove(state, move) {
    return corners.has(`${move.r},${move.c}`);
  }

  function hasEmptyAdjacentCorner(board, move) {
    const adjacentCorners = dangerCornerMap[`${move.r},${move.c}`] || [];
    return adjacentCorners.some(([r, c]) => !board[r][c]);
  }

  function immediateCornerGiveaway(board, playerColor) {
    return legalMovesFor(board, playerColor).some(move => corners.has(`${move.r},${move.c}`));
  }

  function frontierCount(board, color) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (board[r][c] !== color) continue;
      if (dirs.some(([dr, dc]) => inside(r + dr, c + dc) && !board[r + dr][c + dc])) total++;
    }
    return total;
  }

  function isFrontierCell(board, r, c) {
    return dirs.some(([dr, dc]) => inside(r + dr, c + dc) && !board[r + dr][c + dc]);
  }

  function cornerStabilityScore(state, move, probability = normalProbability(state)) {
    if (!cornerOwnedAfterMove(state, move)) return 0;
    const next = applyMoveWithProbability(state.board, state.probBoard, move, state.aiColor, probability);
    const nextBoard = next.board;
    const cornerConfidence = expectedColorValue(nextBoard, next.probBoard, move.r, move.c, state.aiColor);
    const exposedFlips = move.f.filter(([r, c]) => isFrontierCell(nextBoard, r, c)).length;
    const edgeDirs = [];
    if (move.r === 0) edgeDirs.push([0, move.c === 0 ? 1 : -1]);
    if (move.r === 7) edgeDirs.push([0, move.c === 0 ? 1 : -1]);
    if (move.c === 0) edgeDirs.push([move.r === 0 ? 1 : -1, 0]);
    if (move.c === 7) edgeDirs.push([move.r === 0 ? 1 : -1, 0]);
    const connectedEdges = edgeDirs.map(([dr, dc]) => {
      let r = move.r + dr;
      let c = move.c + dc;
      let length = 0;
      while (inside(r, c) && nextBoard[r][c] === state.aiColor) {
        length++;
        r += dr;
        c += dc;
      }
      return length;
    });
    const connectedEdgeStones = connectedEdges.reduce((sum, length) => sum + length, 0);
    const longestEdge = Math.max(0, ...connectedEdges);
    const connectedBonus = connectedEdgeStones * 18 + longestEdge * 14;
    const stableShapeBonus = longestEdge >= 4 ? 90 : longestEdge >= 3 ? 50 : longestEdge >= 2 ? 20 : 0;
    const rawScore = connectedBonus + stableShapeBonus - exposedFlips * 34 - Math.max(0, move.f.length - 2) * 8;
    return rawScore * (0.35 + cornerConfidence * 0.65);
  }

  function isGoodCornerMove(state, move, difficulty) {
    if (!cornerOwnedAfterMove(state, move)) return false;
    const stability = cornerStabilityScore(state, move);
    if (difficulty === 'hard') return stability >= -10 || move.f.length <= 2;
    return stability >= -25 || move.f.length <= 3;
  }

  function moveCells(move) {
    return [[move.r, move.c], ...move.f];
  }

  function hasDiagonalFlip(move) {
    return move.f.some(([r, c]) => Math.abs(r - move.r) === Math.abs(c - move.c));
  }

  function boardAfterZeroObservation(state, move) {
    const next = applyMove(state.board, move, state.aiColor);
    for (const [r, c] of moveCells(move)) next[r][c] = state.playerColor;
    return next;
  }

  function strategicZeroScore(state, move, difficulty) {
    if (!['normal', 'hard'].includes(difficulty)) return -Infinity;
    if (state.observeUsesLeft[state.aiColor] <= 0) return -Infinity;
    const zeroOption = bestZeroStrategyOption(state);
    if (!zeroOption) return -Infinity;
    const zeroFactor = zeroOption.factor;
    if (cornerOwnedAfterMove(state, move)) return -Infinity;

    const phase = gamePhase(state);
    if (phase === 'opening') return -Infinity;

    const key = `${move.r},${move.c}`;
    const nearEmptyCorner = hasEmptyAdjacentCorner(state.board, move);
    const normalBoard = applyMove(state.board, move, state.aiColor);
    if (immediateCornerGiveaway(normalBoard, state.playerColor)) return -Infinity;
    const observedBoard = boardAfterZeroObservation(state, move);
    const currentCornerMoves = legalCornerCount(state.board, state.aiColor);
    const cornerGain = legalCornerCount(observedBoard, state.aiColor) - currentCornerMoves;
    const frontierTargets = moveCells(move).filter(([r, c]) => isFrontierCell(normalBoard, r, c)).length;

    let score = move.f.length * 7 + frontierTargets * 6;
    if (xSquares.has(key) && nearEmptyCorner && hasDiagonalFlip(move)) score += difficulty === 'hard' ? 95 : 70;
    if (cSquares.has(key) && nearEmptyCorner) score += difficulty === 'hard' ? 45 : 30;
    if (cornerGain > 0) score += cornerGain * (difficulty === 'hard' ? 90 : 65);
    if (frontierTargets >= 3) score += difficulty === 'hard' ? 22 : 14;
    if (phase === 'endgame') score += 10;
    if (difficulty === 'normal') score *= 0.9;
    return score * (0.35 + zeroFactor * 0.65);
  }

  function strategicZeroMove(state, difficulty) {
    if (!bestZeroStrategyOption(state)) return null;
    const threshold = difficulty === 'hard' ? 88 : 112;
    const candidates = state.legalMoves
      .map(move => ({ move, score: strategicZeroScore(state, move, difficulty) }))
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, difficulty === 'hard' ? 3 : 2);
    if (!candidates.length) return null;
    const weighted = candidates.map((item, index) => ({
      move: item.move,
      weight: Math.max(1, item.score - threshold + (candidates.length - index) * 8)
    }));
    return pickWeighted(weighted);
  }

  function strategicCornerMove(state, difficulty) {
    if (!['normal', 'hard'].includes(difficulty)) return null;
    const candidates = state.legalMoves
      .filter(move => isGoodCornerMove(state, move, difficulty))
      .map(move => ({
        move,
        score: positionalScore(state, move, difficulty) + cornerStabilityScore(state, move)
      }))
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;
    const bestScore = candidates[0].score;
    const goodMoves = candidates.filter(item => item.score >= bestScore - 24).slice(0, 2);
    return pickWeighted(goodMoves.map(item => ({
      move: item.move,
      weight: Math.max(1, item.score - (bestScore - 24))
    })));
  }

  function observationCornerScore(state) {
    const baseCornerMoves = legalCornerCount(state.board, state.aiColor);
    let score = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (!state.board[r][c] || state.probBoard[r][c] === 100) continue;

      const variant = copyBoard(state.board);
      const flipChance = state.board[r][c] === state.aiColor
        ? 1 - cellStayRate(state.probBoard, r, c)
        : cellStayRate(state.probBoard, r, c);
      if (flipChance <= 0) continue;
      if (state.board[r][c] === state.aiColor) {
        variant[r][c] = state.playerColor;
      } else if (state.board[r][c] === state.playerColor) {
        variant[r][c] = state.aiColor;
      } else {
        continue;
      }

      const cornerGain = legalCornerCount(variant, state.aiColor) - baseCornerMoves;
      if (cornerGain <= 0) continue;
      const key = `${r},${c}`;
      score += cornerGain * 65 * flipChance;
      if (cSquares.has(key)) score += 18 * flipChance;
      if (xSquares.has(key)) score += 28 * flipChance;
      if (isFrontierCell(state.board, r, c)) score += 8 * flipChance;
    }
    return score;
  }

  function projectedForcedObservationBoard(state) {
    const projected = copyBoard(state.board);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (!projected[r][c] || cellStayRate(state.probBoard, r, c) > 0.35) continue;
      projected[r][c] = -projected[r][c];
    }
    return projected;
  }

  function observationCornerDangerScore(state) {
    const projected = projectedForcedObservationBoard(state);
    const playerCornerGain = legalCornerCount(projected, state.playerColor) - legalCornerCount(state.board, state.playerColor);
    if (playerCornerGain <= 0) return 0;
    const playerCornerMoves = legalMovesFor(projected, state.playerColor).filter(move => corners.has(`${move.r},${move.c}`));
    const flipPressure = playerCornerMoves.reduce((sum, move) => sum + move.f.length, 0);
    return playerCornerGain * 90 + flipPressure * 8;
  }

  function shouldTacticalObserve(state, difficulty) {
    if (!state.canObserve || gamePhase(state) === 'opening') return false;
    const cornerChance = observationCornerScore(state);
    const cornerDanger = observationCornerDangerScore(state);
    if (cornerDanger >= 70) return false;
    if (difficulty === 'hard') return cornerChance >= 70;
    if (difficulty === 'normal') return cornerChance >= 90 && Math.random() < 0.7;
    return false;
  }

  function isRiskyMove(state, move, difficulty) {
    if (!['normal', 'hard'].includes(difficulty)) return false;
    const key = `${move.r},${move.c}`;
    const nextBoard = applyMove(state.board, move, state.aiColor);
    const nearEmptyCorner = hasEmptyAdjacentCorner(state.board, move);
    const givesCorner = immediateCornerGiveaway(nextBoard, state.playerColor) && !corners.has(key);
    if (difficulty === 'hard') {
      if ((cSquares.has(key) || xSquares.has(key)) && nearEmptyCorner) return true;
      return givesCorner;
    }
    if (cSquares.has(key) && nearEmptyCorner && givesCorner) return true;
    return xSquares.has(key) && nearEmptyCorner && givesCorner;
  }

  function positionalScore(state, move, difficulty, probability = normalProbability(state)) {
    const key = `${move.r},${move.c}`;
    let score = move.f.length * (difficulty === 'hard' ? 7 : 4);
    const next = applyMoveWithProbability(state.board, state.probBoard, move, state.aiColor, probability);
    const nextBoard = next.board;
    const ownershipConfidence = expectedColorValue(nextBoard, next.probBoard, move.r, move.c, state.aiColor);
    if (corners.has(key)) score += (difficulty === 'hard' ? 90 : 50) * ownershipConfidence;
    if (move.r === 0 || move.r === 7 || move.c === 0 || move.c === 7) score += (difficulty === 'hard' ? 12 : 6) * ownershipConfidence;
    if (difficulty === 'normal' || difficulty === 'hard') {
      const nearEmptyCorner = hasEmptyAdjacentCorner(state.board, move);
      if (xSquares.has(key)) score -= difficulty === 'hard'
        ? (nearEmptyCorner ? 120 : 35)
        : (nearEmptyCorner ? 60 : 18);
      if (cSquares.has(key)) score -= difficulty === 'hard'
        ? (nearEmptyCorner ? 95 : 18)
        : (nearEmptyCorner ? 48 : 10);
      if (immediateCornerGiveaway(nextBoard, state.playerColor)) {
        const dangerMultiplier = 0.45 + ownershipConfidence * 0.55;
        score -= (difficulty === 'hard' ? 160 : 85) * dangerMultiplier;
      }
      const frontierDelta = expectedFrontierCount(nextBoard, next.probBoard, state.aiColor) - expectedFrontierCount(state.board, state.probBoard, state.aiColor);
      score -= Math.max(0, frontierDelta) * (difficulty === 'hard' ? 8 : 4);
      if (corners.has(key)) score += cornerStabilityScore(state, move, probability) * (difficulty === 'hard' ? 1.4 : 1);
    }
    const playerMoveCount = legalMovesFor(nextBoard, state.playerColor).length;
    const aiMoveCount = legalMovesFor(nextBoard, state.aiColor).length;
    const playerWeight = difficulty === 'hard' ? 11 : difficulty === 'normal' ? 7 : 3;
    const aiWeight = difficulty === 'hard' ? 5 : difficulty === 'normal' ? 3 : 1;
    score += aiMoveCount * aiWeight;
    score -= playerMoveCount * playerWeight;
    if (playerMoveCount === 0) score += difficulty === 'hard' ? 45 : 22;
    return score;
  }

  function moveOutcome(state, move) {
    const nextBoard = applyMove(state.board, move, state.aiColor);
    const playerMoveCount = legalMovesFor(nextBoard, state.playerColor).length;
    const aiMoveCount = legalMovesFor(nextBoard, state.aiColor).length;
    return {
      playerMoveCount,
      aiMoveCount,
      forcesPass: playerMoveCount === 0,
      score: positionalScore(state, move, getDifficulty())
    };
  }

  function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function pickWeighted(items) {
    const totalWeight = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (totalWeight <= 0) return pickRandom(items).move;
    let roll = Math.random() * totalWeight;
    for (const item of items) {
      roll -= Math.max(0, item.weight);
      if (roll <= 0) return item.move;
    }
    return items[items.length - 1].move;
  }

  function pickWeightedItem(items) {
    const totalWeight = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (totalWeight <= 0) return pickRandom(items);
    let roll = Math.random() * totalWeight;
    for (const item of items) {
      roll -= Math.max(0, item.weight);
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function expectedAiCountAfterObservation(board, probBoard, aiColor) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const color = board[r][c];
      if (!color) continue;
      const stayRate = clampProbability(probBoard?.[r]?.[c], 100) / 100;
      total += color === aiColor ? stayRate : 1 - stayRate;
    }
    return total;
  }

  function moveProbabilityOptionsForSearch(state) {
    const options = [{ probability: null, actualProbability: normalProbability(state) }];
    if (state.specialRemaining?.[0] > 0 && zeroTacticalFactor(state) > 0) {
      options.push({ probability: 0, actualProbability: zeroSpecialProbability(state) });
    }
    if (state.specialRemaining?.[100] > 0 && highConfidenceFactor(state) > 0) {
      options.push({ probability: 100, actualProbability: highSpecialProbability(state) });
    }
    return options;
  }

  function weightedLegalMove(state, weightsByCoord) {
    const weighted = state.legalMoves
      .map(move => ({ move, weight: weightsByCoord[pointToCoord(move)] || 0 }))
      .filter(item => item.weight > 0 && !isRiskyMove(state, item.move, getDifficulty()));
    return weighted.length ? pickWeighted(weighted) : null;
  }

  function openingTransformForFirstMove(state, canonicalFirst = 'F5') {
    const canonicalPoint = coordToPoint(canonicalFirst);
    const transforms = openingBookSource.policy?.transforms?.length
      ? openingBookSource.policy.transforms
      : ['identity'];
    return transforms.find(transform => {
      const point = transformPoint(canonicalPoint, transform);
      return state.board[point.r]?.[point.c] === state.playerColor;
    }) || null;
  }

  function transformedWeights(weightsByCanonicalCoord, transform) {
    return Object.fromEntries(Object.entries(weightsByCanonicalCoord).map(([coord, weight]) => {
      return [pointToCoord(transformPoint(coordToPoint(coord), transform)), weight];
    }));
  }

  function earlyPreferenceMove(state, difficulty) {
    if (!['normal', 'hard'].includes(difficulty)) return null;
    if (occupiedCount(state) !== 5) return null;
    if (state.playerColor !== 1 || state.aiColor !== -1) return null;
    const transform = openingTransformForFirstMove(state);
    if (!transform) return null;
    return weightedLegalMove(state, transformedWeights({
      D6: 47,
      F6: 47,
      F4: 6
    }, transform));
  }

  function openingLimit(difficulty) {
    if (difficulty === 'normal') return Number(openingBookSource.policy?.normalMaxPly) || 5;
    if (difficulty === 'hard') return Number(openingBookSource.policy?.hardMaxPly) || 10;
    return 0;
  }

  function openingBookMove(state, difficulty) {
    const ply = occupiedCount(state) - 4;
    if (ply < 0 || ply >= openingLimit(difficulty)) return null;
    const goodMoveBand = Number(openingBookSource.policy?.goodMoveBand) || 18;
    const candidates = openingBook
      .filter(line => line.sequence.length > ply)
      .filter(line => {
        const prefixBoard = boardAfterOpeningPrefix(line.sequence, ply);
        return prefixBoard && boardsEqual(prefixBoard, state.board);
      })
      .map(line => ({ coord: line.sequence[ply], weight: line.weight }))
      .filter(item => item.coord);
    if (!candidates.length) return null;

    const safeMoves = state.legalMoves.filter(move => !isRiskyMove(state, move, difficulty));
    const legalPool = safeMoves.length ? safeMoves : state.legalMoves;
    const ranked = legalPool
      .map(move => {
        const coord = pointToCoord(move);
        const matches = candidates.filter(item => item.coord === coord);
        const bookWeight = matches.reduce((sum, item) => sum + item.weight, 0);
        const bookBonusScale = ply <= 1 ? 0.09 : 0.025;
        const bookBonus = bookWeight > 0 ? 8 + bookWeight * bookBonusScale : 0;
        return {
          move,
          bookWeight,
          score: positionalScore(state, move, difficulty) + bookBonus
        };
      })
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;

    const bestScore = ranked[0].score;
    let goodMoves = ranked
      .filter(item => item.score >= bestScore - goodMoveBand)
      .slice(0, difficulty === 'hard' ? 4 : 5);
    if (goodMoves.length < 2 && ranked[1] && ranked[1].score >= bestScore - goodMoveBand * 1.8) {
      goodMoves = [ranked[0], ranked[1]];
    }

    return pickWeighted(goodMoves.map((item, index) => ({
      move: item.move,
      weight: Math.max(1, 12 + item.bookWeight * (ply <= 1 ? 0.9 : 0.35) + (goodMoves.length - index) * 4)
    })));
  }

  function boardScore(board, probBoard, aiColor, playerColor, difficulty, objective) {
    const aiStones = expectedColorCount(board, probBoard, aiColor);
    if (objective === 'stoneCount') return expectedAiCountAfterObservation(board, probBoard, aiColor) * 10;

    const playerStones = expectedColorCount(board, probBoard, playerColor);
    const aiMoves = legalMovesFor(board, aiColor).length;
    const playerMoves = legalMovesFor(board, playerColor).length;
    const cornerWeight = difficulty === 'hard' ? 45 : difficulty === 'normal' ? 30 : 16;
    const playerCornerMoves = legalMovesFor(board, playerColor).filter(move => corners.has(`${move.r},${move.c}`)).length;
    const frontierPenalty = difficulty === 'hard'
      ? expectedFrontierCount(board, probBoard, aiColor) * 2
      : difficulty === 'normal'
        ? expectedFrontierCount(board, probBoard, aiColor)
        : 0;
    return (aiStones - playerStones) * 2
      + (aiMoves - playerMoves) * (difficulty === 'hard' ? 8 : difficulty === 'normal' ? 5 : 2)
      + (expectedCornerCount(board, probBoard, aiColor) - expectedCornerCount(board, probBoard, playerColor)) * cornerWeight
      - playerCornerMoves * (difficulty === 'hard' ? 90 : 35)
      - frontierPenalty;
  }

  function searchScore(board, probBoard, currentColor, depth, aiColor, playerColor, difficulty, objective, defaultProbability) {
    const legal = legalMovesFor(board, currentColor);
    const opponent = -currentColor;
    const opponentLegal = legalMovesFor(board, opponent);
    if (depth <= 0 || emptyCountInBoard(board) === 0 || (!legal.length && !opponentLegal.length)) {
      return boardScore(board, probBoard, aiColor, playerColor, difficulty, objective);
    }
    if (!legal.length) return searchScore(board, probBoard, opponent, depth, aiColor, playerColor, difficulty, objective, defaultProbability);

    const scores = legal.map(move => {
      const next = applyMoveWithProbability(board, probBoard, move, currentColor, defaultProbability);
      return searchScore(next.board, next.probBoard, opponent, depth - 1, aiColor, playerColor, difficulty, objective, defaultProbability);
    });
    return currentColor === aiColor ? Math.max(...scores) : Math.min(...scores);
  }

  function searchPlan(state, difficulty) {
    const empty = emptyCountInBoard(state.board);
    const baseDepth = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
    let depth = baseDepth;
    let objective = 'balanced';

    if (difficulty === 'normal' && empty <= 3) {
      depth = Math.min(3, empty);
      objective = 'stoneCount';
    }
    if (difficulty === 'hard' && empty <= 5) {
      depth = Math.min(5, empty);
      objective = 'stoneCount';
    }
    return { depth, objective };
  }

  function rankedMoves(state, difficulty) {
    const plan = searchPlan(state, difficulty);
    const moves = [...state.legalMoves];
    const saferMoves = ['normal', 'hard'].includes(difficulty)
      ? moves.filter(move => !isRiskyMove(state, move, difficulty))
      : moves;
    const candidates = saferMoves.length ? saferMoves : moves;
    const defaultProbability = normalProbability(state);
    const probabilityOptions = moveProbabilityOptionsForSearch(state);
    return candidates
      .flatMap(move => probabilityOptions.map(option => {
        const next = applyMoveWithProbability(state.board, state.probBoard, move, state.aiColor, option.actualProbability);
        const search = searchScore(next.board, next.probBoard, state.playerColor, plan.depth - 1, state.aiColor, state.playerColor, difficulty, plan.objective, defaultProbability);
        const tieBreaker = plan.objective === 'stoneCount'
          ? move.f.length * 0.05 + (option.probability === null ? 0 : 0.01)
          : positionalScore(state, move, difficulty, option.actualProbability) * 0.35;
        const unstableCornerPenalty = cornerOwnedAfterMove(state, move)
          ? Math.max(0, -cornerStabilityScore(state, move, option.actualProbability)) * (difficulty === 'hard' ? 1.2 : 0.8)
          : 0;
        return { move, probability: option.probability, score: search + tieBreaker - unstableCornerPenalty, objective: plan.objective };
      }))
      .sort((a, b) => b.score - a.score);
  }

  function bestMoveChoice(state, difficulty) {
    const ranked = rankedMoves(state, difficulty);
    if (difficulty === 'easy') return pickRandom(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))));

    const bestScore = ranked[0].score;
    const scoreBand = ranked[0].objective === 'stoneCount'
      ? (difficulty === 'hard' ? 3 : 5)
      : (difficulty === 'hard' ? 10 : 16);
    const poolLimit = difficulty === 'hard' ? 3 : 4;
    const goodMoves = ranked
      .filter(item => item.score >= bestScore - scoreBand)
      .slice(0, poolLimit);
    if (goodMoves.length <= 1) return ranked[0];
    const weighted = goodMoves.map((item, index) => ({
      ...item,
      weight: Math.max(1, Math.pow(goodMoves.length - index, difficulty === 'hard' ? 2 : 1.7))
    }));
    return pickWeightedItem(weighted);
  }

  function bestMove(state, difficulty) {
    return bestMoveChoice(state, difficulty).move;
  }

  function chooseProbability(state, move, difficulty) {
    if (!move) return null;
    const phase = gamePhase(state);
    const outcome = moveOutcome(state, move);
    const highOption = bestHighStrategyOption(state);
    const highFactor = highOption?.factor || 0;
    if (highOption && highFactor > 0) {
      if (isGoodCornerMove(state, move, difficulty) && highFactor >= 0.45) return highOption.probability;
      if (phase === 'opening') return null;
      if (difficulty === 'hard' && phase === 'middle' && state.specialRemaining[100] <= 1 && highOption.probability === 100 && !outcome.forcesPass) return null;
      const hardScoreThreshold = 62 + (1 - highFactor) * 28;
      const normalFlipThreshold = highFactor >= 0.75 ? 5 : 6;
      if (difficulty === 'hard' && (outcome.forcesPass || outcome.score >= hardScoreThreshold || (phase === 'endgame' && move.f.length >= 3 && highFactor >= 0.45))) return highOption.probability;
      if (difficulty === 'normal' && phase !== 'opening' && highFactor >= 0.45 && (outcome.forcesPass || move.f.length >= normalFlipThreshold || (phase === 'endgame' && move.f.length >= 3))) return highOption.probability;
    }
    const zeroOption = bestZeroStrategyOption(state);
    const zeroFactor = zeroOption?.factor || 0;
    if (difficulty === 'easy' && phase !== 'opening' && zeroFactor >= 0.65 && Math.random() < 0.12 * zeroFactor) return zeroOption.probability;
    return null;
  }

  function shouldObserve(state, difficulty) {
    if (!state.canObserve) return false;
    const uncertain = uncertainCount(state);
    if (uncertain <= 0) return false;
    const phase = gamePhase(state);
    if (phase === 'opening') return false;

    const cornerChance = observationCornerScore(state);
    const cornerDanger = observationCornerDangerScore(state);
    if (cornerDanger >= 70) return false;
    if (difficulty === 'hard' && cornerChance >= 70) return true;
    if (difficulty === 'normal' && cornerChance >= 90 && Math.random() < 0.7) return true;

    if (difficulty === 'easy') return phase === 'endgame' && uncertain >= 8 && Math.random() < 0.16;

    const aiCount = expectedColorCount(state.board, state.probBoard, state.aiColor);
    const playerCount = expectedColorCount(state.board, state.probBoard, state.playerColor);
    const behind = aiCount < playerCount;
    const occupied = occupiedCount(state);
    if (difficulty === 'normal') return phase !== 'opening' && uncertain >= 9 && behind && Math.random() < (phase === 'endgame' ? 0.5 : 0.28);
    if (phase === 'middle' && state.observeUsesLeft[state.aiColor] <= 1 && occupied < 36) return false;
    return uncertain >= 7 && (behind || occupied >= 46);
  }

  function chooseAiAction(state) {
    if (!state.isAiTurn || state.gameOver) return null;
    if (!state.legalMoves.length) return null;

    const difficulty = getDifficulty();
    const preferredMove = earlyPreferenceMove(state, difficulty);
    if (preferredMove) return { type: 'move', move: preferredMove };
    const bookMove = openingBookMove(state, difficulty);
    if (bookMove) return { type: 'move', move: bookMove };
    if (shouldTacticalObserve(state, difficulty)) return { type: 'observe' };

    const cornerMove = strategicCornerMove(state, difficulty);
    if (cornerMove) {
      const probability = chooseProbability(state, cornerMove, difficulty);
      return probability === null ? { type: 'move', move: cornerMove } : { type: 'move', move: cornerMove, probability };
    }

    const zeroMove = strategicZeroMove(state, difficulty);
    if (zeroMove) {
      const zeroOption = bestZeroStrategyOption(state);
      return zeroOption?.probability === null
        ? { type: 'move', move: zeroMove }
        : { type: 'move', move: zeroMove, probability: zeroOption.probability };
    }

    if (shouldObserve(state, difficulty)) return { type: 'observe' };

    const choice = bestMoveChoice(state, difficulty);
    if (choice.probability !== undefined) {
      return choice.probability === null
        ? { type: 'move', move: choice.move }
        : { type: 'move', move: choice.move, probability: choice.probability };
    }
    const probability = chooseProbability(state, choice.move, difficulty);
    return probability === null ? { type: 'move', move: choice.move } : { type: 'move', move: choice.move, probability };
  }

  window.quantumOthelloConfig = {
    mode: 'ai',
    optionsFrom: 'ai',
    stateScope: 'ai',
    newGamePath: 'ai-setup.html',
    rules: window.OthelloCustomSettings?.loadRules?.('ai') || null,
    getPlayerColor,
    getDifficulty,
    chooseAiAction,
    onRender: updateAiResourcePanel
  };

  const colorInputs = [...document.querySelectorAll('input[name="playerColor"]')];
  const difficultyInputs = [...document.querySelectorAll('input[name="aiDifficulty"]')];

  function syncRadioGroup(inputs, value) {
    inputs.forEach(input => {
      input.checked = input.value === value;
    });
  }

  function setupPlayerColorControls() {
    syncRadioGroup(colorInputs, loadPlayerColor());
    colorInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        savePlayerColor(input.value);
        updateAiResourcePanel(window.quantumOthelloAi?.game.getState());
        window.quantumOthelloAi?.game.render();
      });
    });
  }

  function setupDifficultyControls() {
    syncRadioGroup(difficultyInputs, loadDifficulty());
    difficultyInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) saveDifficulty(input.value);
      });
    });
  }

  function onGameReady(event) {
    window.quantumOthelloAi = {
      getPlayerColor,
      getDifficulty,
      chooseAiAction,
      game: event.detail
    };
    updateAiResourcePanel(event.detail.getState());
  }

  setupPlayerColorControls();
  setupDifficultyControls();
  document.addEventListener('quantum-othello:ready', onGameReady);
})();








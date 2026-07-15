(() => {
  const rules = window.OthelloRules;
  const { E, B, W } = rules.constants;
  const { copy, emptyObservedBoard, normalizeObservedBoard, moves, applyMove } = rules;
  const gameConfig = {
    mode: 'local',
    optionsFrom: 'local',
    stateScope: 'local',
    ...(window.quantumOthelloConfig || {})
  };
  const stateScopeName = gameConfig.stateScope.charAt(0).toUpperCase() + gameConfig.stateScope.slice(1);
  const specialUseLimit = 2;
  const boardEl = document.querySelector('#board');
  const audio = window.OthelloAudio.createMatchAudioController();
  const { sounds } = audio;
  const storage = window.OthelloGameStorage.createGameStorage({
    stateScopeName,
    constants: { B, W },
    copy,
    normalizeObservedBoard
  });
  const reviewControls = window.OthelloGameView.createReviewControls();
  const elements = {
    gameScreen: document.querySelector('#gameScreen'),
    boardWrap: document.querySelector('.board-wrap'),
    blackScore: document.querySelector('#blackScore'),
    whiteScore: document.querySelector('#whiteScore'),
    turn: document.querySelector('#turn'),
    message: document.querySelector('#message'),
    undo: document.querySelector('#undo'),
    observe: document.querySelector('#observe'),
    special100: document.querySelector('#special100'),
    special0: document.querySelector('#special0'),
    faceToFace: document.querySelector('#faceToFace'),
    optionsButton: document.querySelector('#optionsButton'),
    modeSelectButton: document.querySelector('#modeSelectButton'),
    newGame: document.querySelector('#newGame')
  };

  let board, probBoard, observedBoard, turn, lastMove = null, undoStack = [], positionHistory = [], reviewIndex = null, gameOver = false, finalObservationRunning = false;
  let selectedSpecial = null;
  let specialUsed;
  let faceToFace = false;
  let observeUsesLeft;
  let aiTurnTimer = null;
  let observingShaking = false;
  let observationPops = {};
  let externalObservationPreviewRunning = false;

  const snapshot = () => ({ board: copy(board), probBoard: copy(probBoard), observedBoard: copy(observedBoard), turn });
  const specialUseCount = (probability, player = turn) => {
    const value = specialUsed?.[player]?.[probability];
    if (value === true) return 1;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };
  const copySpecialUsed = () => ({
    [B]: { 100: specialUseCount(100, B), 0: specialUseCount(0, B) },
    [W]: { 100: specialUseCount(100, W), 0: specialUseCount(0, W) }
  });
  const copyObserveUsesLeft = () => ({ [B]: observeUsesLeft[B], [W]: observeUsesLeft[W] });
  const moveProbability = () => selectedSpecial ?? 80;
  const stoneName = p => p === B ? '黒' : '白';
  const playerColorValue = () => gameConfig.getPlayerColor?.() === 'white' ? W : B;
  const aiColorValue = () => -playerColorValue();
  const isAiMode = () => gameConfig.mode === 'ai';
  const isAiTurn = () => isAiMode() && turn === aiColorValue() && !gameOver && !finalObservationRunning;
  const isOnlineMode = () => gameConfig.mode === 'online';
  const isOnlineRemoteTurn = () => isOnlineMode() && turn !== playerColorValue() && !gameOver && !finalObservationRunning;
  const isOnlineClockExpired = () => isOnlineMode() && gameConfig.isClockExpired?.(turn);
  const canUseLocalControls = () => !isOnlineMode() || (!isOnlineRemoteTurn() && !isOnlineClockExpired());
  const colorName = color => color === B ? 'black' : 'white';
  const observationPopImage = event => `assets/images/cat_pop_${colorName(event.beforeColor)}box_${colorName(event.afterColor)}cat.png`;
  let applyingRemoteState = false;

  function saveGameState() {
    if (isOnlineMode()) return;
    if (!board || !probBoard || !observedBoard || !specialUsed || !observeUsesLeft) return;
    storage.save({
      board,
      probBoard,
      observedBoard,
      turn,
      lastMove,
      undoStack,
      positionHistory,
      reviewIndex,
      gameOver,
      selectedSpecial,
      specialUsed,
      faceToFace,
      observeUsesLeft
    });
  }

  function clearGameState() {
    if (isOnlineMode()) return;
    storage.clear();
  }

  function shouldRestoreGameState() {
    if (isOnlineMode()) return false;
    return storage.shouldRestore();
  }

  function restoreGameState() {
    const state = storage.read();
    if (!state) return false;
    board = state.board;
    probBoard = state.probBoard;
    observedBoard = state.observedBoard;
    turn = state.turn;
    lastMove = state.lastMove;
    undoStack = state.undoStack;
    positionHistory = state.positionHistory;
    gameOver = state.gameOver;
    reviewIndex = gameOver ? state.reviewIndex : null;
    selectedSpecial = state.selectedSpecial;
    specialUsed = state.specialUsed;
    observeUsesLeft = state.observeUsesLeft;
    faceToFace = state.faceToFace;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    if (!positionHistory.length) positionHistory = [snapshot()];
    if (reviewIndex !== null) reviewIndex = Math.min(Math.max(reviewIndex, 0), positionHistory.length - 1);
    render();
    return true;
  }

  function count(p, b = board) {
    return rules.count(b, p);
  }

  function status(text) {
    if (elements.message) elements.message.textContent = text;
  }

  function renderFaceToFaceControl() {
    const button = elements.faceToFace;
    if (!button) return;
    button.textContent = `向かい合ってプレイ: ${faceToFace ? 'ON' : 'OFF'}`;
    button.setAttribute('aria-pressed', String(faceToFace));
    button.classList.toggle('active', faceToFace);
    elements.gameScreen.classList.toggle('face-flipped', faceToFace && turn === W && !gameOver);
  }

  function renderObserveControl() {
    const button = elements.observe;
    const remaining = observeUsesLeft ? observeUsesLeft[turn] : 0;
    button.textContent = `オープン！\n(残り使用回数：${remaining}回)`;
    button.disabled = gameOver || remaining <= 0;
  }

  function toggleFaceToFace() {
    faceToFace = !faceToFace;
    render();
  }

  function specialAvailable(probability, player = turn) {
    return specialUsed && specialUseCount(probability, player) < specialUseLimit;
  }

  function renderSpecialControls(reviewing = false) {
    for (const probability of [100, 0]) {
      const button = elements[`special${probability}`];
      const remaining = Math.max(0, specialUseLimit - specialUseCount(probability));
      button.textContent = `${probability}%ボックス\n(残り使用回数：${remaining}回)`;
      const available = !reviewing && !gameOver && specialAvailable(probability);
      button.disabled = !available;
      button.classList.toggle('selected', selectedSpecial === probability && available);
    }
    if (selectedSpecial !== null && !specialAvailable(selectedSpecial)) selectedSpecial = null;
  }

  function selectSpecial(probability) {
    if (!canUseLocalControls()) return;
    if (!specialAvailable(probability)) return;
    selectedSpecial = selectedSpecial === probability ? null : probability;
    render();
  }

  function render() {
    const reviewing = gameOver && reviewIndex !== null;
    const shownBoard = reviewing ? positionHistory[reviewIndex].board : board;
    const shownProb = reviewing ? positionHistory[reviewIndex].probBoard : probBoard;
    const shownObserved = reviewing ? positionHistory[reviewIndex].observedBoard : observedBoard;
    const shownTurn = reviewing ? (positionHistory[reviewIndex].turn ?? turn) : turn;
    const aiThinking = isAiTurn();
    const remoteTurn = isOnlineRemoteTurn();
    const clockExpired = isOnlineClockExpired();
    const legal = !reviewing && !gameOver && !finalObservationRunning && !aiThinking && !remoteTurn && !clockExpired ? moves(board, turn) : [];
    const shakingKeys = new Set();
    if (observingShaking && !reviewing) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (board[r][c] !== E && !observedBoard[r][c]) shakingKeys.add(`${r},${c}`);
      }
    }

    window.OthelloGameView.renderBoard({
      boardEl,
      constants: { B },
      shownBoard,
      shownProb,
      shownObserved,
      legalMoves: legal,
      reviewing,
      gameOver,
      finalObservationRunning,
      aiThinking,
      lastMove,
      shakingKeys,
      popAnimations: reviewing ? {} : observationPops,
      onCellClick: playMove
    });

    elements.blackScore.textContent = count(B, shownBoard);
    elements.whiteScore.textContent = count(W, shownBoard);
    const blackCount = elements.blackScore.closest('.count');
    const whiteCount = elements.whiteScore.closest('.count');
    blackCount.classList.toggle('current-turn', (reviewing || !gameOver) && shownTurn === B);
    whiteCount.classList.toggle('current-turn', (reviewing || !gameOver) && shownTurn === W);
    const turnLabel = elements.turn;
    if (turnLabel) turnLabel.textContent = reviewing ? `局面 ${reviewIndex}手目を表示` : gameOver ? '対局終了' : `${stoneName(turn)}の番です`;
    if (elements.undo) elements.undo.disabled = !hasUndoTarget() || aiThinking || remoteTurn || isOnlineMode();
    if (elements.newGame) elements.newGame.disabled = isOnlineMode();
    renderObserveControl();
    elements.observe.disabled = reviewing || gameOver || finalObservationRunning || aiThinking || remoteTurn || clockExpired || observeUsesLeft[turn] <= 0;
    renderSpecialControls(reviewing || finalObservationRunning || aiThinking || remoteTurn || clockExpired);
    renderFaceToFaceControl();
    window.OthelloGameView.updateReviewControls(reviewControls, {
      gameOver,
      finalObservationRunning,
      reviewIndex,
      historyLength: positionHistory.length
    });
    if (gameConfig.onRender) gameConfig.onRender(getGameState());
    scheduleAiTurn();
  }

  function defaultAiAction(state) {
    if (!state.legalMoves.length) return null;
    return { type: 'move', move: state.legalMoves[Math.floor(Math.random() * state.legalMoves.length)] };
  }

  function specialRemaining(probability, player = turn) {
    return Math.max(0, specialUseLimit - specialUseCount(probability, player));
  }

  function canUseSpecial(probability, player = turn) {
    return specialRemaining(probability, player) > 0;
  }

  function hasUndoTarget() {
    if (!undoStack.length) return false;
    if (!isAiMode()) return true;
    return undoStack.some(state => state.turn === playerColorValue());
  }

  function applyAiAction(action) {
    if (!isAiTurn() || !action) return;
    if (action.type === 'observe' && observeUsesLeft[turn] > 0) {
      observe();
      return;
    }

    const legal = moves(board, turn);
    const move = action.move || legal.find(item => item.r === action.r && item.c === action.c) || legal[0];
    if (!move) return;

    if ((action.probability === 100 || action.probability === 0) && canUseSpecial(action.probability)) {
      selectedSpecial = action.probability;
    }
    playMove(move.r, move.c);
  }

  function scheduleAiTurn() {
    if (!isAiTurn()) {
      if (aiTurnTimer) clearTimeout(aiTurnTimer);
      aiTurnTimer = null;
      return;
    }
    if (aiTurnTimer) return;
    aiTurnTimer = setTimeout(() => {
      aiTurnTimer = null;
      if (!isAiTurn()) return;
      const state = getGameState();
      const helpers = { constants: { E, B, W } };
      const action = gameConfig.chooseAiAction?.(state, helpers) || defaultAiAction(state);
      applyAiAction(action);
    }, 650);
  }

  function finish() {
    if (gameOver || finalObservationRunning) return;
    gameOver = true;
    finalObservationRunning = true;
    reviewIndex = null;
    notifyStateChange('final-observe-start');
    status('最後のオープン中です。');
    runObservationSequence('ラストオープン！', (changed) => {
      positionHistory.push(snapshot());
      reviewIndex = null;
      const black = count(B), white = count(W);
      const result = black === white ? '引き分けです。' : black > white ? `黒の勝ち。${black} 対 ${white}` : `白の勝ち。${black} 対 ${white}`;
      status(`最後のオープンで ${changed} 個のボックスから違う猫が出ました。${result}`);
      notifyStateChange('final-observe');
    });
  }
  function advance() {
    const legal = moves(board, turn);
    if (!legal.length) {
      if (!moves(board, -turn).length) return finish();
      const passed = turn;
      turn = -turn;
      if (positionHistory.length) positionHistory[positionHistory.length - 1].turn = turn;
      status(`${stoneName(passed)}は置けないため、${stoneName(turn)}の番です。`);
    } else {
      status(`${stoneName(turn)}のボックスを置いてください。`);
    }
    render();
  }

  function playMove(r, c) {
    if (!canUseLocalControls()) return;
    const m = moves(board, turn).find(x => x.r === r && x.c === c);
    if (!m) return;
    audio.playSound(sounds.stonePlace);
    const probability = moveProbability();
    undoStack.push({ board: copy(board), probBoard: copy(probBoard), observedBoard: copy(observedBoard), turn, positionHistoryLength: positionHistory.length, lastMove: lastMove && { ...lastMove }, specialUsed: copySpecialUsed(), selectedSpecial, observeUsesLeft: copyObserveUsesLeft() });
    const nextState = applyMove(board, probBoard, observedBoard, m, turn, probability);
    board = nextState.board;
    probBoard = nextState.probBoard;
    observedBoard = nextState.observedBoard;
    if (selectedSpecial !== null) {
      specialUsed[turn][selectedSpecial] = specialUseCount(selectedSpecial) + 1;
      selectedSpecial = null;
    }
    lastMove = { r: m.r, c: m.c };
    turn = -turn;
    positionHistory.push(snapshot());
    advance();
    notifyStateChange('move');
  }

  function applyObservationRoll() {
    return rules.applyObservationRoll(board, probBoard, observedBoard);
  }

  function runObservationSequence(label, afterRoll) {
    const boardWrap = elements.boardWrap;
    audio.playSound(sounds.observeStart, 0.75);
    observingShaking = true;
    observationPops = {};
    boardWrap.dataset.observeLabel = label;
    boardWrap.classList.add('final-observing');
    render();
    setTimeout(() => {
      boardWrap.classList.remove('final-observing');
      delete boardWrap.dataset.observeLabel;
      observingShaking = false;
      const result = applyObservationRoll();
      observationPops = Object.fromEntries(
        (result.events || [])
          .filter(event => !event.wasObserved)
          .map(event => [`${event.r},${event.c}`, observationPopImage(event)])
      );
      if (result.colorChanged > 0 || result.probabilityChanged) audio.playSound(sounds.observeChange, 0.8);
      render();
      afterRoll(result.colorChanged);
      finalObservationRunning = true;
      render();
      setTimeout(() => {
        observationPops = {};
        finalObservationRunning = false;
        if (gameOver) reviewIndex = positionHistory.length - 1;
        render();
      }, 980);
    }, 900);
  }

  function playExternalObservationAnimation(label = 'オープン！') {
    if (externalObservationPreviewRunning) return;
    const boardWrap = elements.boardWrap;
    externalObservationPreviewRunning = true;
    finalObservationRunning = true;
    observingShaking = true;
    observationPops = {};
    boardWrap.dataset.observeLabel = label;
    boardWrap.classList.add('final-observing');
    audio.playSound(sounds.observeStart, 0.75);
    render();
    setTimeout(() => {
      boardWrap.classList.remove('final-observing');
      delete boardWrap.dataset.observeLabel;
      observingShaking = false;
      render();
    }, 900);
    setTimeout(() => {
      finalObservationRunning = false;
      externalObservationPreviewRunning = false;
      render();
    }, 2600);
  }

  function observationPopImagesBetween(beforeBoard, beforeObserved, afterBoard, afterObserved) {
    const pops = {};
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (beforeBoard?.[r]?.[c] === E || beforeObserved?.[r]?.[c] || !afterObserved?.[r]?.[c]) continue;
      pops[`${r},${c}`] = observationPopImage({
        beforeColor: beforeBoard[r][c],
        afterColor: afterBoard[r][c]
      });
    }
    return pops;
  }

  function applyExternalObservationState(state, label = 'オープン！') {
    const boardWrap = elements.boardWrap;
    const beforeBoard = copy(board);
    const beforeObserved = normalizeObservedBoard(observedBoard);
    const nextBoard = copy(state.board);
    const nextProbBoard = copy(state.probBoard);
    const nextObservedBoard = normalizeObservedBoard(state.observedBoard);
    applyingRemoteState = true;
    gameOver = false;
    reviewIndex = null;
    finalObservationRunning = true;
    observingShaking = true;
    observationPops = {};
    boardWrap.dataset.observeLabel = label;
    boardWrap.classList.add('final-observing');
    audio.playSound(sounds.observeStart, 0.75);
    render();
    setTimeout(() => {
      boardWrap.classList.remove('final-observing');
      delete boardWrap.dataset.observeLabel;
      observingShaking = false;
      applyExternalState(state, { skipRender: true });
      finalObservationRunning = true;
      reviewIndex = null;
      observationPops = observationPopImagesBetween(beforeBoard, beforeObserved, nextBoard, nextObservedBoard);
      if (Object.keys(observationPops).length > 0) audio.playSound(sounds.observeChange, 0.8);
      render();
      setTimeout(() => {
        observationPops = {};
        finalObservationRunning = false;
        if (gameOver) reviewIndex = positionHistory.length - 1;
        render();
        applyingRemoteState = false;
      }, 980);
    }, 900);
  }

  function applyExternalObservationResult(state) {
    const beforeBoard = copy(board);
    const beforeObserved = normalizeObservedBoard(observedBoard);
    const nextBoard = copy(state.board);
    const nextObservedBoard = normalizeObservedBoard(state.observedBoard);
    applyingRemoteState = true;
    applyExternalState(state, { skipRender: true });
    finalObservationRunning = true;
    reviewIndex = null;
    observationPops = observationPopImagesBetween(beforeBoard, beforeObserved, nextBoard, nextObservedBoard);
    if (Object.keys(observationPops).length > 0) audio.playSound(sounds.observeChange, 0.8);
    render();
    setTimeout(() => {
      observationPops = {};
      finalObservationRunning = false;
      if (gameOver) reviewIndex = positionHistory.length - 1;
      render();
      applyingRemoteState = false;
    }, 980);
  }

  function observe() {
    if (!canUseLocalControls()) return;
    if (gameOver || finalObservationRunning || observeUsesLeft[turn] <= 0) return;
    undoStack.push({ board: copy(board), probBoard: copy(probBoard), observedBoard: copy(observedBoard), turn, positionHistoryLength: positionHistory.length, lastMove: lastMove && { ...lastMove }, specialUsed: copySpecialUsed(), selectedSpecial, observeUsesLeft: copyObserveUsesLeft() });
    observeUsesLeft[turn]--;
    finalObservationRunning = true;
    notifyStateChange('observe-start');
    status('オープン中です。');
    runObservationSequence('オープン！', (changed) => {
      finalObservationRunning = false;
      positionHistory.push(snapshot());
      status(changed ? `オープンにより ${changed} 個のボックスから違う猫が出ました。` : 'オープンしましたが、出てきた猫は変わりませんでした。');
      advance();
      notifyStateChange('observe');
    });
  }

  function undo() {
    let state = undoStack.pop();
    if (isAiMode()) {
      while (state && state.turn !== playerColorValue()) state = undoStack.pop();
    }
    if (!state) return;
    if (aiTurnTimer) {
      clearTimeout(aiTurnTimer);
      aiTurnTimer = null;
    }
    board = copy(state.board);
    probBoard = copy(state.probBoard);
    observedBoard = normalizeObservedBoard(state.observedBoard);
    turn = state.turn;
    positionHistory = positionHistory.slice(0, state.positionHistoryLength);
    reviewIndex = null;
    lastMove = state.lastMove && { ...state.lastMove };
    specialUsed = state.specialUsed;
    selectedSpecial = state.selectedSpecial;
    observeUsesLeft = state.observeUsesLeft;
    gameOver = false;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    status('一手戻しました。');
    render();
  }

  function start() {
    if (isOnlineMode() && board && !canUseLocalControls()) return;
    clearGameState();
    lastMove = null;
    selectedSpecial = null;
    observeUsesLeft = { [B]: 2, [W]: 2 };
    specialUsed = {
      [B]: { 100: 0, 0: 0 },
      [W]: { 100: 0, 0: 0 }
    };
    undoStack = [];
    positionHistory = [];
    reviewIndex = null;
    gameOver = false;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    board = Array.from({ length: 8 }, () => Array(8).fill(E));
    probBoard = Array.from({ length: 8 }, () => Array(8).fill(80));
    observedBoard = emptyObservedBoard();
    board[3][3] = W;
    board[3][4] = B;
    board[4][3] = B;
    board[4][4] = W;
    probBoard[3][3] = 100;
    probBoard[3][4] = 100;
    probBoard[4][3] = 100;
    probBoard[4][4] = 100;
    observedBoard[3][3] = true;
    observedBoard[3][4] = true;
    observedBoard[4][3] = true;
    observedBoard[4][4] = true;
    turn = B;
    positionHistory = [snapshot()];
    advance();
    notifyStateChange('start');
  }

  function notifyStateChange(reason) {
    if (applyingRemoteState || !gameConfig.onStateChange) return;
    gameConfig.onStateChange(getGameState(), reason);
  }

  function applyExternalState(state, options = {}) {
    if (!state || !Array.isArray(state.board) || !Array.isArray(state.probBoard)) return;
    if (options.animateObservation) {
      applyExternalObservationState(state, options.label);
      return;
    }
    if (options.popObservationOnly) {
      applyExternalObservationResult(state);
      return;
    }
    applyingRemoteState = true;
    board = copy(state.board);
    probBoard = copy(state.probBoard);
    observedBoard = normalizeObservedBoard(state.observedBoard);
    turn = state.turn === W ? W : B;
    lastMove = state.lastMove ? { ...state.lastMove } : null;
    specialUsed = state.specialUsed || {
      [B]: { 100: 0, 0: 0 },
      [W]: { 100: 0, 0: 0 }
    };
    observeUsesLeft = state.observeUsesLeft || { [B]: 2, [W]: 2 };
    selectedSpecial = null;
    undoStack = [];
    positionHistory = Array.isArray(state.positionHistory) && state.positionHistory.length ? state.positionHistory.map(item => ({
      board: copy(item.board),
      probBoard: copy(item.probBoard),
      observedBoard: normalizeObservedBoard(item.observedBoard),
      turn: item.turn === W ? W : B
    })) : [snapshot()];
    gameOver = Boolean(state.gameOver);
    reviewIndex = gameOver ? positionHistory.length - 1 : null;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    if (!options.skipRender) render();
    if (!options.skipRender) applyingRemoteState = false;
  }

  function getGameState() {
    const legalMoves = gameOver || finalObservationRunning ? [] : moves(board, turn);
    return {
      mode: gameConfig.mode,
      board: copy(board),
      probBoard: copy(probBoard),
      observedBoard: copy(observedBoard),
      turn,
      lastMove: lastMove ? { ...lastMove } : null,
      playerColor: playerColorValue(),
      aiColor: aiColorValue(),
      isAiTurn: isAiTurn(),
      gameOver,
      legalMoves,
      selectedSpecial,
      specialUsed: copySpecialUsed(),
      specialRemaining: {
        100: specialRemaining(100, turn),
        0: specialRemaining(0, turn)
      },
      observeUsesLeft: copyObserveUsesLeft(),
      positionHistory: positionHistory.map(item => ({
        board: copy(item.board),
        probBoard: copy(item.probBoard),
        observedBoard: normalizeObservedBoard(item.observedBoard),
        turn: item.turn === W ? W : B
      })),
      canObserve: observeUsesLeft[turn] > 0,
      counts: {
        black: count(B),
        white: count(W)
      }
    };
  }

  window.quantumOthelloGame = {
    constants: { E, B, W },
    getState: getGameState,
    applyExternalState,
    playExternalObservationAnimation,
    start,
    render
  };

  if (elements.newGame) elements.newGame.onclick = start;
  if (elements.undo) elements.undo.onclick = undo;
  elements.observe.onclick = observe;
  elements.special100.onclick = () => selectSpecial(100);
  elements.special0.onclick = () => selectSpecial(0);
  const faceToFaceButton = elements.faceToFace;
  if (faceToFaceButton) faceToFaceButton.onclick = toggleFaceToFace;
  if (elements.optionsButton) elements.optionsButton.onclick = () => {
    saveGameState();
    if (window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1') {
      window.parent.postMessage({
        type: 'othello:navigate',
        path: `options.html?from=${encodeURIComponent(gameConfig.optionsFrom)}`,
        click: false
      }, '*');
      return;
    }
    audio.saveBgmState();
    audio.primeNextPage();
    location.href = `options.html?from=${encodeURIComponent(gameConfig.optionsFrom)}`;
  };
  if (elements.modeSelectButton) elements.modeSelectButton.onclick = () => {
    clearGameState();
    if (window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1') {
      window.parent.postMessage({ type: 'othello:navigate', path: 'mode-select.html', click: false }, '*');
      return;
    }
    audio.clearBgmState();
    audio.primeNextPage();
    audio.pauseBgm();
    location.href = 'mode-select.html';
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('button.action')) audio.playSound(sounds.uiClick, 0.55);
  });
  window.addEventListener('storage', audio.syncBgmSettings);
  reviewControls.start.onclick = () => { if (gameOver) { reviewIndex = 0; render(); } };
  reviewControls.prev.onclick = () => { if (gameOver && reviewIndex > 0) { reviewIndex--; render(); } };
  reviewControls.next.onclick = () => { if (gameOver && reviewIndex < positionHistory.length - 1) { reviewIndex++; render(); } };
  reviewControls.end.onclick = () => { if (gameOver) { reviewIndex = positionHistory.length - 1; render(); } };
  if (!shouldRestoreGameState() || !restoreGameState()) start();
  audio.startBgmAfterPageTransition();
  document.dispatchEvent(new CustomEvent('quantum-othello:ready', { detail: window.quantumOthelloGame }));
})();

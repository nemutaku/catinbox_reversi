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
  const clampInteger = (value, min, max, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  };
  const initialPieceTypes = new Set(['cat', 'box', 'special0', 'special100']);
  function normalizeInitialSetup(source = {}) {
    const cells = Array.isArray(source.cells) ? source.cells : [];
    return {
      cells: cells.map(cell => ({
        r: clampInteger(cell?.r, 0, 7, 0),
        c: clampInteger(cell?.c, 0, 7, 0),
        color: cell?.color === 'white' ? 'white' : 'black',
        type: initialPieceTypes.has(cell?.type) ? cell.type : 'cat'
      }))
    };
  }
  function normalizeGameRules(source = {}) {
    source = source || {};
    const specialProbabilities = source.specialProbabilities || {};
    const specialUseLimits = source.specialUseLimits || {};
    return {
      normalProbability: clampInteger(source.normalProbability, 0, 100, 80),
      specialProbabilities: {
        0: clampInteger(specialProbabilities[0] ?? specialProbabilities["0"] ?? source.special0Probability, 0, 100, 0),
        100: clampInteger(specialProbabilities[100] ?? specialProbabilities["100"] ?? source.special100Probability, 0, 100, 100)
      },
      specialUseLimits: {
        0: clampInteger(specialUseLimits[0] ?? specialUseLimits["0"] ?? source.special0Uses, 0, 50, 2),
        100: clampInteger(specialUseLimits[100] ?? specialUseLimits["100"] ?? source.special100Uses, 0, 50, 2)
      },
      observeUseLimit: clampInteger(source.observeUseLimit ?? source.observeUses, 0, 50, 2),
      initialSetup: source.initialSetup ? normalizeInitialSetup(source.initialSetup) : null
    };
  }
  const gameRules = normalizeGameRules(gameConfig.rules);
  const specialUseLimitFor = probability => gameRules.specialUseLimits[probability] ?? 2;
  const specialProbabilityFor = probability => gameRules.specialProbabilities[probability] ?? probability;
  const emptyProbLabelBoard = () => Array.from({ length: 8 }, () => Array(8).fill(''));
  const copyProbLabelBoard = source => Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      const value = source?.[r]?.[c];
      return value === undefined || value === null ? '' : String(value);
    })
  );
  const setProbLabel = (r, c, label) => {
    if (!probLabelBoard?.[r]) return;
    probLabelBoard[r][c] = label;
  };
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
    result: document.querySelector('#gameResult'),
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

  function normalizeActionLayout() {
    const actionRow = document.querySelector('.special-actions');
    if (!actionRow || !elements.observe) return;
    if (elements.observe.parentElement !== actionRow) {
      actionRow.insertBefore(elements.observe, actionRow.firstElementChild);
    }
    const oldObserveRow = document.querySelector('.observe-actions');
    if (oldObserveRow && oldObserveRow.children.length === 0) oldObserveRow.remove();
  }
  normalizeActionLayout();

  let board, probBoard, probLabelBoard, observedBoard, turn, lastMove = null, undoStack = [], positionHistory = [], reviewIndex = null, gameOver = false, finalObservationRunning = false, gameResult = null, lastOpenWinRates = null;
  let selectedSpecial = null;
  let specialUsed;
  let faceToFace = false;
  let observeUsesLeft;
  let initialAdvanceRunning = false;
  let aiTurnTimer = null;
  let observingShaking = false;
  let observationPops = {};
  let externalObservationPreviewRunning = false;

  const snapshot = () => ({ board: copy(board), probBoard: copy(probBoard), probLabelBoard: copyProbLabelBoard(probLabelBoard), observedBoard: copy(observedBoard), turn });
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
  const moveProbability = () => selectedSpecial === null ? gameRules.normalProbability : specialProbabilityFor(selectedSpecial);
  function applyInitialPiece(cell) {
    const r = clampInteger(cell?.r, 0, 7, 0);
    const c = clampInteger(cell?.c, 0, 7, 0);
    const piece = cell?.color === 'white' ? W : B;
    const type = initialPieceTypes.has(cell?.type) ? cell.type : 'cat';
    board[r][c] = piece;
    if (type === 'cat') {
      probBoard[r][c] = 100;
      observedBoard[r][c] = true;
      setProbLabel(r, c, '');
      return;
    }
    observedBoard[r][c] = false;
    if (type === 'special0') {
      const probability = specialProbabilityFor(0);
      probBoard[r][c] = probability;
      setProbLabel(r, c, String(probability));
      return;
    }
    if (type === 'special100') {
      const probability = specialProbabilityFor(100);
      probBoard[r][c] = probability;
      setProbLabel(r, c, String(probability));
      return;
    }
    probBoard[r][c] = gameRules.normalProbability;
    setProbLabel(r, c, '');
  }
function applyInitialSetup() {
  const cells = gameRules.initialSetup
    ? gameRules.initialSetup.cells
    : [
          { r: 3, c: 3, color: 'white', type: 'cat' },
          { r: 3, c: 4, color: 'black', type: 'cat' },
          { r: 4, c: 3, color: 'black', type: 'cat' },
          { r: 4, c: 4, color: 'white', type: 'cat' }
        ];
    for (const cell of cells) applyInitialPiece(cell);
  }
  const stoneName = p => p === B ? '黒' : '白';
  const playerColorValue = () => gameConfig.getPlayerColor?.() === 'white' ? W : B;
  const aiColorValue = () => -playerColorValue();
  const isAiMode = () => gameConfig.mode === 'ai';
  const isAiTurn = () => isAiMode() && turn === aiColorValue() && !gameOver && !finalObservationRunning;
  const isOnlineMode = () => gameConfig.mode === 'online';
  const isOnlineRemoteTurn = () => isOnlineMode() && turn !== playerColorValue() && !gameOver && !finalObservationRunning;
  const isOnlineClockExpired = () => isOnlineMode() && gameConfig.isClockExpired?.(turn);
  const canUseLocalControls = () => !isOnlineMode() || (!isOnlineRemoteTurn() && !isOnlineClockExpired());
  const actionDisplayPlayer = () => (isAiMode() || isOnlineMode()) ? playerColorValue() : turn;
  const hasOpenableBox = (targetBoard = board, targetObservedBoard = observedBoard) => {
    if (!targetBoard || !targetObservedBoard) return false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (targetBoard[r]?.[c] !== E && !targetObservedBoard[r]?.[c]) return true;
      }
    }
    return false;
  };
  const colorName = color => color === B ? 'black' : 'white';
  const observationPopImage = event => `assets/images/cat_pop_${colorName(event.beforeColor)}box_${colorName(event.afterColor)}cat.png`;
  function preloadObservationPopImages() {
    ['black', 'white'].forEach(beforeColor => {
      ['black', 'white'].forEach(afterColor => {
        const image = new Image();
        image.src = `assets/images/cat_pop_${beforeColor}box_${afterColor}cat.png`;
      });
    });
  }
  preloadObservationPopImages();
  function ensureResultElement() {
    if (elements.result) return elements.result;
    const score = elements.blackScore?.closest('.score');
    if (!score) return null;
    const result = document.createElement('p');
    result.id = 'gameResult';
    result.className = 'game-result';
    result.setAttribute('aria-live', 'polite');
    score.insertAdjacentElement('beforebegin', result);
    elements.result = result;
    return result;
  }

  function ensureWinRateDialog() {
    let dialog = document.querySelector('#lastOpenWinRateDialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'lastOpenWinRateDialog';
    dialog.className = 'win-rate-dialog';
    dialog.hidden = true;
    dialog.innerHTML = `
      <section class="win-rate-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="lastOpenWinRateTitle">
        <h2 id="lastOpenWinRateTitle">ラストオープン前の勝率</h2>
        <div class="win-rate-dialog-body" id="lastOpenWinRateBody"></div>
        <button id="lastOpenWinRateClose" class="action" type="button">閉じる</button>
      </section>
    `;
    document.body.appendChild(dialog);
    const closeButton = dialog.querySelector('#lastOpenWinRateClose');
    closeButton?.addEventListener('click', hideLastOpenWinRateDialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) hideLastOpenWinRateDialog();
    });
    return dialog;
  }

  function ensureWinRateButton() {
    let button = document.querySelector('#lastOpenWinRateButton');
    if (button) return button;
    const result = ensureResultElement();
    if (!result) return null;
    button = document.createElement('button');
    button.id = 'lastOpenWinRateButton';
    button.className = 'action secondary win-rate-button';
    button.type = 'button';
    button.textContent = 'ラストオープン前の勝率を確認する';
    button.hidden = true;
    button.addEventListener('click', showLastOpenWinRateDialog);
    result.insertAdjacentElement('afterend', button);
    return button;
  }

  function normalizeWinRates(value) {
    if (!value || typeof value !== 'object') return null;
    const black = Number(value.black);
    const white = Number(value.white);
    const draw = Number(value.draw);
    if (![black, white, draw].every(Number.isFinite)) return null;
    return {
      black: Math.min(100, Math.max(0, black)),
      white: Math.min(100, Math.max(0, white)),
      draw: Math.min(100, Math.max(0, draw)),
      occupied: Number.isFinite(Number(value.occupied)) ? Number(value.occupied) : 0
    };
  }

  function probabilityToBlack(cell, probability, observed) {
    if (observed) return cell === B ? 1 : 0;
    const sameColorRate = Math.min(100, Math.max(0, Number(probability))) / 100;
    return cell === B ? sameColorRate : 1 - sameColorRate;
  }

  function calculateLastOpenWinRates(targetBoard = board, targetProbBoard = probBoard, targetObservedBoard = observedBoard) {
    const blackProbabilities = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const cell = targetBoard?.[r]?.[c];
      if (cell === E || cell === undefined) continue;
      blackProbabilities.push(probabilityToBlack(cell, targetProbBoard?.[r]?.[c], Boolean(targetObservedBoard?.[r]?.[c])));
    }
    const occupied = blackProbabilities.length;
    if (!occupied) return { black: 0, white: 0, draw: 100, occupied: 0 };
    let dp = [1];
    for (const p of blackProbabilities) {
      const next = Array(dp.length + 1).fill(0);
      for (let k = 0; k < dp.length; k++) {
        next[k] += dp[k] * (1 - p);
        next[k + 1] += dp[k] * p;
      }
      dp = next;
    }
    let black = 0;
    let white = 0;
    let draw = 0;
    const half = occupied / 2;
    dp.forEach((chance, blackCount) => {
      if (blackCount > half) black += chance;
      else if (blackCount < half) white += chance;
      else draw += chance;
    });
    return {
      black: black * 100,
      white: white * 100,
      draw: draw * 100,
      occupied
    };
  }

  function formatWinRate(value) {
    const percent = Math.min(100, Math.max(0, Number(value) || 0));
    if (percent <= 0) return '0%';
    if (percent >= 100) return '100%';
    if (percent >= 99.9) return '99.9%以上';
    if (percent <= 0.1) return '0.1%以下';
    return `${(Math.round(percent * 10) / 10).toFixed(1)}%`;
  }

  function roundedWinRateLabels(rates) {
    const roundedDisplay = value => {
      const percent = Math.min(100, Math.max(0, Number(value) || 0));
      return {
        value: Math.round(percent * 10) / 10,
        label: formatWinRate(percent)
      };
    };
    const black = roundedDisplay(rates.black);
    const white = roundedDisplay(rates.white);
    const drawPercent = Math.min(100, Math.max(0, Number(rates.draw) || 0));
    const canDraw = Number(rates.occupied) % 2 === 0;
    if (canDraw && drawPercent > 0 && drawPercent <= 0.1 && black.value + white.value >= 100) {
      return {
        black: black.label,
        white: white.label,
        draw: '0.1%以下'
      };
    }
    const rawDraw = Math.max(0, Math.min(100, 100 - black.value - white.value));
    const draw = {
      value: Math.round(rawDraw * 10) / 10,
      label: formatWinRate(rawDraw)
    };
    if (draw.value !== rawDraw && rawDraw > 0.1 && rawDraw < 99.9) {
      return {
        black: black.label,
        white: white.label,
        draw: `${draw.value.toFixed(1)}%`
      };
    }
    return {
      black: black.label,
      white: white.label,
      draw: draw.label
    };
  }

  function showLastOpenWinRateDialog() {
    const rates = normalizeWinRates(lastOpenWinRates);
    if (!rates) return;
    const dialog = ensureWinRateDialog();
    const body = dialog.querySelector('#lastOpenWinRateBody');
    if (body) {
      const labels = roundedWinRateLabels(rates);
      body.innerHTML = `
        <p>ラストオープン前のはこが開いた場合の勝率です。</p>
        <dl class="win-rate-list">
          <div><dt>黒の勝ち</dt><dd>${labels.black}</dd></div>
          <div><dt>白の勝ち</dt><dd>${labels.white}</dd></div>
          <div><dt>引き分け</dt><dd>${labels.draw}</dd></div>
        </dl>
      `;
    }
    dialog.hidden = false;
    dialog.querySelector('#lastOpenWinRateClose')?.focus();
  }

  function hideLastOpenWinRateDialog() {
    const dialog = document.querySelector('#lastOpenWinRateDialog');
    if (dialog) dialog.hidden = true;
    document.querySelector('#lastOpenWinRateButton')?.focus();
  }

  function buildGameResultText() {
    if (!gameOver || finalObservationRunning) return '';
    if (gameResult?.type === 'resign') {
      return `${stoneName(gameResult.winner)}の勝ち(投了)`;
    }
    if (gameResult?.type === 'disconnect') {
      return `${stoneName(gameResult.winner)}の勝ち(接続切れ)`;
    }
    if (gameResult?.type === 'timeout') {
      return `${stoneName(gameResult.winner)}の勝ち(時間切れ)`;
    }
    const black = count(B);
    const white = count(W);
    if (black === white) return '引き分け';
    const winner = black > white ? B : W;
    const diff = Math.abs(black - white);
    return `${stoneName(winner)}の勝ち(${diff}ねこ差)`;
  }

  function renderGameResult() {
    const result = ensureResultElement();
    if (!result) return;
    const text = buildGameResultText();
    result.textContent = text;
    result.hidden = !text;
    const winRateButton = ensureWinRateButton();
    if (winRateButton) winRateButton.hidden = !text || finalObservationRunning || !normalizeWinRates(lastOpenWinRates);
  }
  let applyingRemoteState = false;

  function saveGameState() {
    if (isOnlineMode()) return;
    if (!board || !probBoard || !observedBoard || !specialUsed || !observeUsesLeft) return;
    storage.save({
      board,
      probBoard,
      probLabelBoard,
      observedBoard,
      turn,
      lastMove,
      undoStack,
      positionHistory,
      reviewIndex,
      gameOver,
      gameResult,
      lastOpenWinRates,
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
    probLabelBoard = copyProbLabelBoard(state.probLabelBoard);
    observedBoard = state.observedBoard;
    turn = state.turn;
    lastMove = state.lastMove;
    undoStack = state.undoStack;
    positionHistory = state.positionHistory;
    gameOver = state.gameOver;
    gameResult = state.gameResult || null;
    lastOpenWinRates = normalizeWinRates(state.lastOpenWinRates);
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
    const displayPlayer = actionDisplayPlayer();
    const remaining = observeUsesLeft ? observeUsesLeft[displayPlayer] : 0;
    const openable = hasOpenableBox();
    button.textContent = `オープン！\n(あと${remaining}回)`;
    button.disabled = gameOver || remaining <= 0 || !openable;
  }

  function toggleFaceToFace() {
    faceToFace = !faceToFace;
    render();
  }

  function specialAvailable(probability, player = turn) {
    return specialUsed && specialUseCount(probability, player) < specialUseLimitFor(probability);
  }

  function renderSpecialControls(reviewing = false) {
    const displayPlayer = actionDisplayPlayer();
    for (const probability of [100, 0]) {
      const button = elements[`special${probability}`];
      const remaining = Math.max(0, specialUseLimitFor(probability) - specialUseCount(probability, displayPlayer));
      button.textContent = `${specialProbabilityFor(probability)}%はこ\n(あと${remaining}回)`;
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
    const shownProbLabels = reviewing ? copyProbLabelBoard(positionHistory[reviewIndex].probLabelBoard) : probLabelBoard;
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
      shownProbLabels,
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
    elements.observe.disabled = reviewing || gameOver || finalObservationRunning || aiThinking || remoteTurn || clockExpired || observeUsesLeft[turn] <= 0 || !hasOpenableBox();
    renderSpecialControls(reviewing || finalObservationRunning || aiThinking || remoteTurn || clockExpired);
    renderFaceToFaceControl();
    renderGameResult();
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
    return Math.max(0, specialUseLimitFor(probability) - specialUseCount(probability, player));
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
    if (gameOver || finalObservationRunning) return true;
    if (isOnlineMode() && initialAdvanceRunning && gameConfig.canFinalizeInitialGame?.() === false) return false;
    if (!hasOpenableBox()) {
      gameOver = true;
      finalObservationRunning = false;
      lastOpenWinRates = null;
      reviewIndex = positionHistory.length ? positionHistory.length - 1 : null;
      const black = count(B), white = count(W);
      const result = black === white ? '引き分けです。' : black > white ? `黒の勝ち。${black} 対 ${white}` : `白の勝ち。${black} 対 ${white}`;
      status(result);
      render();
      notifyStateChange('game-over');
      return true;
    }
    gameOver = true;
    finalObservationRunning = true;
    lastOpenWinRates = calculateLastOpenWinRates();
    reviewIndex = null;
    notifyStateChange('final-observe-start');
    status('最後のオープン中です。');
    runObservationSequence('ラスト\nオープン！', (changed) => {
      positionHistory.push(snapshot());
      reviewIndex = null;
      const black = count(B), white = count(W);
      const result = black === white ? '引き分けです。' : black > white ? `黒の勝ち。${black} 対 ${white}` : `白の勝ち。${black} 対 ${white}`;
      status(`最後のオープンで ${changed} 個のはこから違う猫が出ました。${result}`);
      notifyStateChange('final-observe');
    });
    return true;
  }

  function endByResignation(loser, options = {}) {
    if (gameOver) return;
    const safeLoser = loser === W ? W : B;
    const winner = -safeLoser;
    gameOver = true;
    gameResult = { type: 'resign', loser: safeLoser, winner };
    lastOpenWinRates = null;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    selectedSpecial = null;
    reviewIndex = positionHistory.length ? positionHistory.length - 1 : null;
    status(`${safeLoser === B ? '\u9ed2' : '\u767d'}\u304c\u6295\u4e86\u3057\u307e\u3057\u305f\u3002${winner === B ? '\u9ed2' : '\u767d'}\u306e\u52dd\u3061\u3067\u3059\u3002`);
    render();
    if (options.notify !== false) notifyStateChange('resign');
  }

  function advance() {
    const legal = moves(board, turn);
    if (!legal.length) {
      if (!moves(board, -turn).length) {
        if (!finish()) render();
        return;
      }
      const passed = turn;
      turn = -turn;
      if (positionHistory.length) positionHistory[positionHistory.length - 1].turn = turn;
      status(`${stoneName(passed)}は置けないため、${stoneName(turn)}の番です。`);
    } else {
      status(`${stoneName(turn)}のはこを置いてください。`);
    }
    render();
  }

  function playMove(r, c) {
    if (!canUseLocalControls()) return;
    const m = moves(board, turn).find(x => x.r === r && x.c === c);
    if (!m) return;
    audio.playSound(sounds.stonePlace);
    const probability = moveProbability();
    const usedSpecial = selectedSpecial;
    const probabilityLabel = usedSpecial === null ? '' : String(probability);
    undoStack.push({ board: copy(board), probBoard: copy(probBoard), probLabelBoard: copyProbLabelBoard(probLabelBoard), observedBoard: copy(observedBoard), turn, positionHistoryLength: positionHistory.length, lastMove: lastMove && { ...lastMove }, specialUsed: copySpecialUsed(), selectedSpecial, observeUsesLeft: copyObserveUsesLeft() });
    const nextState = applyMove(board, probBoard, observedBoard, m, turn, probability);
    board = nextState.board;
    probBoard = nextState.probBoard;
    setProbLabel(m.r, m.c, probabilityLabel);
    for (const [flippedR, flippedC] of m.f) {
      setProbLabel(flippedR, flippedC, probabilityLabel);
    }
    observedBoard = nextState.observedBoard;
    if (usedSpecial !== null) {
      specialUsed[turn][usedSpecial] = specialUseCount(usedSpecial) + 1;
      selectedSpecial = null;
    }
    lastMove = { r: m.r, c: m.c };
    turn = -turn;
    positionHistory.push(snapshot());
    const terminalAfterMove = !moves(board, turn).length && !moves(board, -turn).length;
    if (terminalAfterMove) notifyStateChange('move');
    advance();
    if (!finalObservationRunning) render();
    if (!terminalAfterMove && (!gameOver || !finalObservationRunning)) notifyStateChange('move');
  }

  function applyObservationRoll() {
    return rules.applyObservationRoll(board, probBoard, observedBoard);
  }

  function hasNewObservationPop(result) {
    return (result.events || []).some(event => !event.wasObserved);
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
      if (hasNewObservationPop(result)) audio.playSound(sounds.observeChange, 0.8);
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
    }, 1100);
  }

  function playExternalObservationAnimation(label = 'オープン！') {
    if (externalObservationPreviewRunning) return;
    const boardWrap = elements.boardWrap;
    externalObservationPreviewRunning = true;
    finalObservationRunning = true;
    reviewIndex = null;
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
    }, 1100);
    setTimeout(() => {
      finalObservationRunning = false;
      externalObservationPreviewRunning = false;
      render();
    }, 2800);
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
    gameResult = null;
    lastOpenWinRates = null;
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
    }, 1100);
  }

  function applyExternalObservationResult(state) {
    const beforeBoard = copy(board);
    const beforeObserved = normalizeObservedBoard(observedBoard);
    const nextBoard = copy(state.board);
    const nextObservedBoard = normalizeObservedBoard(state.observedBoard);
    applyingRemoteState = true;
    applyExternalState(state, { skipRender: true, suppressReview: true });
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
    if (gameOver || finalObservationRunning || observeUsesLeft[turn] <= 0 || !hasOpenableBox()) return;
    undoStack.push({ board: copy(board), probBoard: copy(probBoard), probLabelBoard: copyProbLabelBoard(probLabelBoard), observedBoard: copy(observedBoard), turn, positionHistoryLength: positionHistory.length, lastMove: lastMove && { ...lastMove }, specialUsed: copySpecialUsed(), selectedSpecial, observeUsesLeft: copyObserveUsesLeft() });
    observeUsesLeft[turn]--;
    finalObservationRunning = true;
    notifyStateChange('observe-start');
    status('オープン中です。');
    runObservationSequence('オープン！', (changed) => {
      finalObservationRunning = false;
      positionHistory.push(snapshot());
      status(changed ? `オープンにより ${changed} 個のはこから違う猫が出ました。` : 'オープンしましたが、出てきた猫は変わりませんでした。');
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
    probLabelBoard = copyProbLabelBoard(state.probLabelBoard);
    observedBoard = normalizeObservedBoard(state.observedBoard);
    turn = state.turn;
    positionHistory = positionHistory.slice(0, state.positionHistoryLength);
    reviewIndex = null;
    lastMove = state.lastMove && { ...state.lastMove };
    specialUsed = state.specialUsed;
    selectedSpecial = state.selectedSpecial;
    observeUsesLeft = state.observeUsesLeft;
    gameOver = false;
    gameResult = null;
    lastOpenWinRates = null;
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
    observeUsesLeft = { [B]: gameRules.observeUseLimit, [W]: gameRules.observeUseLimit };
    specialUsed = {
      [B]: { 100: 0, 0: 0 },
      [W]: { 100: 0, 0: 0 }
    };
    undoStack = [];
    positionHistory = [];
    reviewIndex = null;
    gameOver = false;
    gameResult = null;
    finalObservationRunning = false;
    observingShaking = false;
    observationPops = {};
    board = Array.from({ length: 8 }, () => Array(8).fill(E));
    probBoard = Array.from({ length: 8 }, () => Array(8).fill(gameRules.normalProbability));
    probLabelBoard = emptyProbLabelBoard();
    observedBoard = emptyObservedBoard();
    applyInitialSetup();
    turn = B;
    positionHistory = [snapshot()];
    initialAdvanceRunning = true;
    try {
      advance();
    } finally {
      initialAdvanceRunning = false;
    }
    if (!gameOver && !finalObservationRunning) notifyStateChange('start');
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
    if (options.playPlaceSound) audio.playSound(sounds.stonePlace);
    board = copy(state.board);
    probBoard = copy(state.probBoard);
    probLabelBoard = copyProbLabelBoard(state.probLabelBoard);
    observedBoard = normalizeObservedBoard(state.observedBoard);
    turn = state.turn === W ? W : B;
    lastMove = state.lastMove ? { ...state.lastMove } : null;
    specialUsed = state.specialUsed || {
      [B]: { 100: 0, 0: 0 },
      [W]: { 100: 0, 0: 0 }
    };
    observeUsesLeft = state.observeUsesLeft || { [B]: gameRules.observeUseLimit, [W]: gameRules.observeUseLimit };
    selectedSpecial = null;
    undoStack = [];
    positionHistory = Array.isArray(state.positionHistory) && state.positionHistory.length ? state.positionHistory.map(item => ({
      board: copy(item.board),
      probBoard: copy(item.probBoard),
      probLabelBoard: copyProbLabelBoard(item.probLabelBoard),
      observedBoard: normalizeObservedBoard(item.observedBoard),
      turn: item.turn === W ? W : B,
      clock: item.clock || null
    })) : [snapshot()];
    gameOver = Boolean(state.gameOver);
    gameResult = state.gameResult || null;
    lastOpenWinRates = normalizeWinRates(state.lastOpenWinRates);
    if (gameOver && !options.suppressReview) {
      const requestedReviewIndex = Number.isInteger(options.initialReviewIndex)
        ? options.initialReviewIndex
        : positionHistory.length - 1;
      reviewIndex = Math.min(Math.max(requestedReviewIndex, 0), positionHistory.length - 1);
    } else {
      reviewIndex = null;
    }
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
      rules: gameRules,
      board: copy(board),
      probBoard: copy(probBoard),
      probLabelBoard: copyProbLabelBoard(probLabelBoard),
      observedBoard: copy(observedBoard),
      turn,
      lastMove: lastMove ? { ...lastMove } : null,
      playerColor: playerColorValue(),
      aiColor: aiColorValue(),
      isAiTurn: isAiTurn(),
      gameOver,
      gameResult,
      finalObservationRunning,
      lastOpenWinRates,
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
        probLabelBoard: copyProbLabelBoard(item.probLabelBoard),
        observedBoard: normalizeObservedBoard(item.observedBoard),
        turn: item.turn === W ? W : B,
        clock: item.clock || null
      })),
      reviewing: gameOver && reviewIndex !== null,
      reviewIndex,
      reviewClock: gameOver && reviewIndex !== null ? (positionHistory[reviewIndex]?.clock || null) : null,
      canObserve: observeUsesLeft[turn] > 0 && hasOpenableBox(),
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
    endByResignation,
    start,
    render
  };

  function navigateTo(path, { clearState = false, pauseBgm = false } = {}) {
    if (clearState) clearGameState();
    if (window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1') {
      window.parent.postMessage({ type: 'othello:navigate', path, click: false }, '*');
      return;
    }
    if (pauseBgm) {
      audio.clearBgmState();
      audio.primeNextPage();
      audio.pauseBgm();
    }
    location.href = path;
  }

  if (elements.newGame) elements.newGame.onclick = () => {
    if (gameConfig.newGamePath) {
      navigateTo(gameConfig.newGamePath, { clearState: true });
      return;
    }
    start();
  };
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
    const backPath = gameConfig.mode === 'local' ? 'local-select.html' : 'mode-select.html';
    navigateTo(backPath, { clearState: true, pauseBgm: true });
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('button.action')) audio.playSound(sounds.uiClick, 0.55);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideLastOpenWinRateDialog();
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





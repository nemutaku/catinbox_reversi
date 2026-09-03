(() => {
  function createGameStorage({ stateScopeName, constants, copy, normalizeObservedBoard }) {
    const { B, W } = constants;
    const gameStateKey = `othello${stateScopeName}GameState`;
    const restoreGameFlagKey = `othelloRestore${stateScopeName}Game`;

    function normalizeState(state) {
      if (!state || !Array.isArray(state.board) || !Array.isArray(state.probBoard)) return null;
      const normalizeProbLabelBoard = source => Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => {
          const value = source?.[r]?.[c];
          return value === undefined || value === null ? '' : String(value);
        })
      );
      const normalizeWinRates = source => {
        if (!source || typeof source !== 'object') return null;
        const black = Number(source.black);
        const white = Number(source.white);
        const draw = Number(source.draw);
        if (![black, white, draw].every(Number.isFinite)) return null;
        return { black, white, draw };
      };
      return {
        board: copy(state.board),
        probBoard: copy(state.probBoard),
        probLabelBoard: normalizeProbLabelBoard(state.probLabelBoard),
        observedBoard: normalizeObservedBoard(state.observedBoard),
        turn: state.turn === W ? W : B,
        lastMove: state.lastMove ? { ...state.lastMove } : null,
        undoStack: Array.isArray(state.undoStack) ? state.undoStack : [],
        positionHistory: Array.isArray(state.positionHistory) ? state.positionHistory.map(item => ({
          board: copy(item.board),
          probBoard: copy(item.probBoard),
          probLabelBoard: normalizeProbLabelBoard(item.probLabelBoard),
          observedBoard: normalizeObservedBoard(item.observedBoard),
          turn: item.turn === W ? W : B
        })) : [],
        reviewIndex: Number.isInteger(state.reviewIndex) ? state.reviewIndex : null,
        gameOver: Boolean(state.gameOver),
        gameResult: state.gameResult || null,
        lastOpenWinRates: normalizeWinRates(state.lastOpenWinRates),
        selectedSpecial: state.selectedSpecial === 100 || state.selectedSpecial === 0 ? state.selectedSpecial : null,
        specialUsed: state.specialUsed || {
          [B]: { 100: 0, 0: 0 },
          [W]: { 100: 0, 0: 0 }
        },
        faceToFace: Boolean(state.faceToFace),
        observeUsesLeft: state.observeUsesLeft || { [B]: 2, [W]: 2 }
      };
    }

    function read() {
      try {
        return normalizeState(JSON.parse(sessionStorage.getItem(gameStateKey) || 'null'));
      } catch {
        return null;
      }
    }

    return {
      save(state) {
        sessionStorage.setItem(gameStateKey, JSON.stringify(state));
      },
      clear() {
        sessionStorage.removeItem(gameStateKey);
        sessionStorage.removeItem(restoreGameFlagKey);
      },
      shouldRestore() {
        const shouldRestore = sessionStorage.getItem(restoreGameFlagKey) === '1';
        sessionStorage.removeItem(restoreGameFlagKey);
        return shouldRestore;
      },
      read
    };
  }

  window.OthelloGameStorage = { createGameStorage };
})();

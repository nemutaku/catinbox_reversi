(() => {
  function createReviewControls() {
    const root = document.createElement('div');
    root.className = 'review-actions';
    root.hidden = true;
    root.innerHTML = '<button id="reviewStart" class="action secondary" type="button" aria-label="対局開始時">|&lt;</button><button id="reviewPrev" class="action secondary" type="button" aria-label="一手戻る">&lt;</button><button id="reviewNext" class="action secondary" type="button" aria-label="一手進む">&gt;</button><button id="reviewEnd" class="action secondary" type="button" aria-label="終局時">&gt;|</button>';
    document.querySelector('.special-actions').before(root);
    return {
      root,
      start: document.querySelector('#reviewStart'),
      prev: document.querySelector('#reviewPrev'),
      next: document.querySelector('#reviewNext'),
      end: document.querySelector('#reviewEnd')
    };
  }

  function renderBoard({
    boardEl,
    constants,
    shownBoard,
    shownProb,
    shownObserved,
    legalMoves,
    reviewing,
    gameOver,
    finalObservationRunning,
    aiThinking,
    lastMove,
    shakingKeys = new Set(),
    popAnimations = {},
    onCellClick
  }) {
    const { B } = constants;
    const legalSet = new Set(legalMoves.map(move => `${move.r},${move.c}`));
    boardEl.replaceChildren();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const value = shownBoard[r][c];
      const isLegal = legalSet.has(`${r},${c}`);
      const cell = document.createElement('button');
      cell.className = 'cell' + (!value && isLegal ? ' hint' : '');
      cell.disabled = reviewing || gameOver || finalObservationRunning || aiThinking || !isLegal;
      cell.setAttribute('aria-label', `${String.fromCharCode(65 + c)}${r + 1}`);
      if (value) {
        const key = `${r},${c}`;
        const disc = document.createElement('span');
        disc.className = 'disc ' + (value === B ? 'black' : 'white') + (!reviewing && lastMove && lastMove.r === r && lastMove.c === c ? ' last-move' : '');
        disc.classList.toggle('observed', Boolean(shownObserved?.[r]?.[c]));
        disc.classList.toggle('observing-shake', shakingKeys.has(key));
        if (popAnimations[key]) {
          disc.classList.add('observing-pop');
          disc.style.backgroundImage = `url("${popAnimations[key]}")`;
        }
        disc.dataset.prob = shownProb[r][c];
        cell.append(disc);
      }
      cell.onclick = () => onCellClick(r, c);
      boardEl.append(cell);
    }
  }

  function updateReviewControls(controls, { gameOver, finalObservationRunning, reviewIndex, historyLength }) {
    controls.root.hidden = !gameOver || finalObservationRunning;
    controls.start.disabled = !gameOver || reviewIndex <= 0;
    controls.prev.disabled = !gameOver || reviewIndex <= 0;
    controls.next.disabled = !gameOver || reviewIndex >= historyLength - 1;
    controls.end.disabled = !gameOver || reviewIndex >= historyLength - 1;
  }

  window.OthelloGameView = {
    createReviewControls,
    renderBoard,
    updateReviewControls
  };
})();

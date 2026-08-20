(() => {
  const setupKey = "catinboxCustomInitialSetup";
  const boardEl = document.querySelector("#initialBoard");
  const colorEl = document.querySelector("#initialColor");
  const pieceEl = document.querySelector("#initialPiece");
  const resetButton = document.querySelector("#initialReset");
  const backButton = document.querySelector("#initialBack");
  const saveButton = document.querySelector("#initialSave");
  const audio = window.OthelloAudio?.createMatchAudioController?.();
  const initialPieceTypes = new Set(["cat", "box", "special0", "special100"]);
  const returnPathByFrom = {
    friend: "online.html?mode=friend",
    ai: "ai-setup.html",
    local: "local-custom.html"
  };
  const query = new URLSearchParams(location.search);
  const returnPath = returnPathByFrom[query.get("from")]
    || sessionStorage.getItem("catinboxInitialBoardReturnPath")
    || "online.html?mode=friend";
  let cells = createDefaultCells();

  function playClickSe() {
    audio?.playSound?.(window.OthelloAudio.sounds.uiClick, 0.55);
  }

  function navigate(path) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "othello:navigate", path, click: false }, "*");
    } else {
      location.href = path;
    }
  }

  function createEmptyCells() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  function createDefaultCells() {
    const next = createEmptyCells();
    next[3][3] = { color: "white", type: "cat" };
    next[3][4] = { color: "black", type: "cat" };
    next[4][3] = { color: "black", type: "cat" };
    next[4][4] = { color: "white", type: "cat" };
    return next;
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeSetup(source = {}) {
    const sourceCells = Array.isArray(source.cells) ? source.cells : [];
    return {
      cells: sourceCells.map(cell => ({
        r: clampInteger(cell?.r, 0, 7, 0),
        c: clampInteger(cell?.c, 0, 7, 0),
        color: cell?.color === "white" ? "white" : "black",
        type: initialPieceTypes.has(cell?.type) ? cell.type : "cat"
      }))
    };
  }

  function setupToCells(source) {
    const next = createEmptyCells();
    for (const cell of normalizeSetup(source).cells) {
      next[cell.r][cell.c] = { color: cell.color, type: cell.type };
    }
    return next;
  }

  function cellsToSetup() {
    const setupCells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = cells[r]?.[c];
        if (!piece) continue;
        setupCells.push({ r, c, color: piece.color, type: piece.type });
      }
    }
    return normalizeSetup({ cells: setupCells });
  }

  function readSetup() {
    try {
      return JSON.parse(sessionStorage.getItem(setupKey) || "null");
    } catch {
      return null;
    }
  }

  function saveSetup() {
    const setup = cellsToSetup();
    if (window.OthelloCustomSettings?.saveInitialSetup) {
      window.OthelloCustomSettings.saveInitialSetup(returnPath, setup);
    } else {
      sessionStorage.setItem(setupKey, JSON.stringify(setup));
    }
  }

  function pieceImage(piece) {
    if (!piece) return "";
    const prefix = piece.color === "white" ? "white" : "black";
    return piece.type === "cat"
      ? `assets/images/${prefix}cat_normal.png`
      : `assets/images/${prefix}box_normal.png`;
  }

  function pieceLabel(piece) {
    if (!piece) return "";
    if (piece.type === "cat") return "ねこ";
    if (piece.type === "special0") return "0%";
    if (piece.type === "special100") return "100%";
    return "通常";
  }

  function render() {
    if (!boardEl) return;
    boardEl.replaceChildren();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = cells[r]?.[c];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "initial-board-cell";
        button.dataset.row = String(r);
        button.dataset.col = String(c);
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", `${String.fromCharCode(65 + c)}${r + 1}`);
        if (piece) {
          button.classList.add(piece.color, piece.type);
          const img = document.createElement("img");
          img.src = pieceImage(piece);
          img.alt = "";
          const label = document.createElement("span");
          label.textContent = pieceLabel(piece);
          button.append(img, label);
        }
        boardEl.append(button);
      }
    }
  }

  function setCell(row, col) {
    const type = pieceEl?.value || "cat";
    if (type === "empty") {
      cells[row][col] = null;
    } else {
      cells[row][col] = {
        color: colorEl?.value === "white" ? "white" : "black",
        type: initialPieceTypes.has(type) ? type : "cat"
      };
    }
    render();
  }

  const saved = readSetup();
  if (saved) cells = setupToCells(saved);
  render();

  boardEl?.addEventListener("click", event => {
    const cell = event.target.closest(".initial-board-cell");
    if (!cell) return;
    playClickSe();
    setCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });

  resetButton?.addEventListener("click", () => {
    playClickSe();
    cells = createDefaultCells();
    render();
  });

  backButton?.addEventListener("click", () => {
    playClickSe();
    navigate(returnPath);
  });

  saveButton?.addEventListener("click", () => {
    playClickSe();
    saveSetup();
    navigate(returnPath);
  });
})();

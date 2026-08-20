(() => {
  const statusEl = document.querySelector("#onlineStatus");
  const roomCodeEl = document.querySelector("#roomCode");
  const roomInfoEl = document.querySelector("#roomInfo");
  const joinCodeEl = document.querySelector("#joinCode");
  const nicknameEl = document.querySelector("#nickname");
  const createRoomButton = document.querySelector("#createRoom");
  const joinRoomButton = document.querySelector("#joinRoom");
  const friendRoomPanel = document.querySelector("#friendRoomPanel");
  const randomRoomPanel = document.querySelector("#randomRoomPanel");
  const cancelRandomButton = document.querySelector("#cancelRandomMatch");
  const onlineLeadEl = document.querySelector("#onlineLead");
  const resumeRoomButton = document.querySelector("#resumeRoom");
  const modeSelectButton = document.querySelector("#modeSelectButton");
  const matchPreviewEl = document.querySelector("#matchPreview");
  const matchBlackNameEl = document.querySelector("#matchBlackName");
  const matchWhiteNameEl = document.querySelector("#matchWhiteName");
  const matchYourTurnEl = document.querySelector("#matchYourTurn");
  const customMatchEnabledEl = document.querySelector("#customMatchEnabled");
  const customMatchSettingsEl = document.querySelector("#customMatchSettings");
  const customSelfColorEl = document.querySelector("#customSelfColor");
  const customNormalProbabilityEl = document.querySelector("#customNormalProbability");
  const customSpecial0ProbabilityEl = document.querySelector("#customSpecial0Probability");
  const customSpecial0UsesEl = document.querySelector("#customSpecial0Uses");
  const customSpecial100ProbabilityEl = document.querySelector("#customSpecial100Probability");
  const customSpecial100UsesEl = document.querySelector("#customSpecial100Uses");
  const customObserveUsesEl = document.querySelector("#customObserveUses");
  const customInitialSetupButton = document.querySelector("#customInitialSetupButton");
  const customInitialColorEl = document.querySelector("#customInitialColor");
  const customInitialPieceEl = document.querySelector("#customInitialPiece");
  const customInitialBoardEl = document.querySelector("#customInitialBoard");
  const customInitialResetButton = document.querySelector("#customInitialReset");
  const customMatchResetButton = document.querySelector("#customMatchReset");
  const guestIdKey = "catinboxOnlineGuestId";
  const nicknameKey = "catinboxOnlineNickname";
  const titleKey = "catinboxPlayerTitle";
  const sessionKey = "othelloOnlineSession";
  const persistentSessionKey = "othelloOnlineLastSession";
  const customMatchDraftKey = "catinboxCustomMatchDraft";
  const customInitialSetupKey = "catinboxCustomInitialSetup";
  const audio = window.OthelloAudio?.createMatchAudioController?.();
  const allowedTitles = new Set(["新米ねこ", "アマチュアねこ", "ボスねこ"]);
  const query = new URLSearchParams(location.search);
  const matchMode = query.get("mode") === "random" ? "random" : "friend";
  const customMatchDefaults = {
    hostColor: "random",
    normalProbability: 80,
    special0Probability: 0,
    special0Uses: 2,
    special100Probability: 100,
    special100Uses: 2,
    observeUseLimit: 2
  };
  const initialPieceTypes = new Set(["cat", "box", "special0", "special100"]);

  let currentUser = null;
  let unsubscribeRoom = null;
  let auth = null;
  let db = null;
  let authFallbackReady = false;
  let navigatedToGame = false;
  let activePlayerId = null;
  let ownedWaitingRoomCode = "";
  let currentProfile = null;
  let randomMatchStarted = false;
  let customInitialCells = createDefaultInitialCells();

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function playClickSe() {
    audio?.playSound?.(window.OthelloAudio.sounds.uiClick, 0.55);
  }

  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function getGuestId() {
    let guestId = localStorage.getItem(guestIdKey);
    if (!guestId) {
      guestId = `guest-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;
      localStorage.setItem(guestIdKey, guestId);
    }
    return guestId;
  }

  function getPlayerId() {
    if (!activePlayerId) activePlayerId = currentUser?.uid || getGuestId();
    return activePlayerId;
  }

  async function getOnlineProfile() {
    if (currentProfile?.playerId) return currentProfile;
    if (window.CatProfile?.loadProfile) {
      currentProfile = await window.CatProfile.loadProfile();
      if (currentProfile?.playerId) {
        activePlayerId = currentProfile.playerId;
        currentUser = auth?.currentUser || currentUser;
        return currentProfile;
      }
    }

    currentProfile = {
      playerId: getPlayerId(),
      name: getNickname(),
      title: getPlayerTitle(),
      offline: true
    };
    return currentProfile;
  }

  function readPersistentSession() {
    try {
      return JSON.parse(localStorage.getItem(persistentSessionKey) || "null");
    } catch {
      return null;
    }
  }

  function writeOnlineSession(session) {
    const serialized = JSON.stringify(session);
    sessionStorage.setItem(sessionKey, serialized);
    localStorage.setItem(persistentSessionKey, serialized);
    updateResumeButton();
  }

  function clearPersistentSession() {
    localStorage.removeItem(persistentSessionKey);
    updateResumeButton();
  }

  function updateResumeButton() {
    if (!resumeRoomButton) return;
    const saved = readPersistentSession();
    resumeRoomButton.hidden = !saved?.roomCode || !saved?.playerId || !saved?.playerColor;
  }

  function userError(message) {
    const error = new Error(message);
    error.userMessage = message;
    return error;
  }

  function sanitizeNickname(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 12);
  }

  function resolveNickname(value, fallback = "") {
    const inputName = sanitizeNickname(value);
    return inputName || fallback;
  }

  function getNickname() {
    const storedName = sanitizeNickname(localStorage.getItem(nicknameKey));
    const savedName = storedName;
    const name = resolveNickname(nicknameEl?.value, savedName) || "ねこさん";
    localStorage.setItem(nicknameKey, name);
    if (nicknameEl) nicknameEl.value = name;
    return name;
  }

  function getPlayerTitle() {
    const title = localStorage.getItem(titleKey);
    return allowedTitles.has(title) ? title : "新米ねこ";
  }

  function setNicknameValueFromStorage() {
    if (!nicknameEl) return;
    const savedName = sanitizeNickname(localStorage.getItem(nicknameKey));
    nicknameEl.value = savedName;
  }

  function canUseOnline() {
    return Boolean(db && activePlayerId && (currentUser || authFallbackReady));
  }

  function isFinishedRoom(room) {
    return room?.status === "finished"
      || Boolean(room?.gameState?.gameOver)
      || Boolean(room?.gameState?.gameResult);
  }

  function randomizePlayers(hostId, guestId) {
    const hostIsBlack = Math.random() < 0.5;
    return {
      black: hostIsBlack ? hostId : guestId,
      white: hostIsBlack ? guestId : hostId
    };
  }

  function assignPlayers(hostId, guestId, hostColor = "random") {
    if (hostColor === "black") return { black: hostId, white: guestId };
    if (hostColor === "white") return { black: guestId, white: hostId };
    return randomizePlayers(hostId, guestId);
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function createEmptyInitialCells() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  function createDefaultInitialCells() {
    const cells = createEmptyInitialCells();
    cells[3][3] = { color: "white", type: "cat" };
    cells[3][4] = { color: "black", type: "cat" };
    cells[4][3] = { color: "black", type: "cat" };
    cells[4][4] = { color: "white", type: "cat" };
    return cells;
  }

  function normalizeInitialSetup(source = {}) {
    const cells = Array.isArray(source.cells) ? source.cells : [];
    return {
      cells: cells.map(cell => ({
        r: clampInteger(cell?.r, 0, 7, 0),
        c: clampInteger(cell?.c, 0, 7, 0),
        color: cell?.color === "white" ? "white" : "black",
        type: initialPieceTypes.has(cell?.type) ? cell.type : "cat"
      }))
    };
  }

  function initialSetupToCells(source) {
    const setup = normalizeInitialSetup(source || {});
    const cells = createEmptyInitialCells();
    for (const cell of setup.cells) {
      cells[cell.r][cell.c] = { color: cell.color, type: cell.type };
    }
    return cells;
  }

  function readJsonStorage(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  function loadCustomInitialSetup() {
    return readJsonStorage(customInitialSetupKey);
  }

  function saveCustomInitialSetup() {
    writeJsonStorage(customInitialSetupKey, collectInitialSetup());
  }

  function collectInitialSetup() {
    const cells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = customInitialCells[r]?.[c];
        if (!piece) continue;
        cells.push({ r, c, color: piece.color, type: piece.type });
      }
    }
    return normalizeInitialSetup({ cells });
  }

  function initialPieceImage(piece) {
    if (!piece) return "";
    const prefix = piece.color === "white" ? "white" : "black";
    return piece.type === "cat"
      ? `assets/images/${prefix}cat_normal.png`
      : `assets/images/${prefix}box_normal.png`;
  }

  function initialPieceLabel(piece) {
    if (!piece) return "";
    if (piece.type === "cat") return "ねこ";
    if (piece.type === "special0") return "0%";
    if (piece.type === "special100") return "100%";
    return "通常";
  }

  function renderCustomInitialBoard() {
    if (!customInitialBoardEl) return;
    customInitialBoardEl.replaceChildren();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = customInitialCells[r]?.[c];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "custom-initial-cell";
        button.dataset.row = String(r);
        button.dataset.col = String(c);
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", `${String.fromCharCode(65 + c)}${r + 1}`);
        if (piece) {
          button.classList.add(piece.color, piece.type);
          const img = document.createElement("img");
          img.src = initialPieceImage(piece);
          img.alt = "";
          const label = document.createElement("span");
          label.textContent = initialPieceLabel(piece);
          button.append(img, label);
        }
        customInitialBoardEl.append(button);
      }
    }
  }

  function setCustomInitialCell(row, col) {
    const type = customInitialPieceEl?.value || "cat";
    if (type === "empty") {
      customInitialCells[row][col] = null;
    } else {
      customInitialCells[row][col] = {
        color: customInitialColorEl?.value === "white" ? "white" : "black",
        type: initialPieceTypes.has(type) ? type : "cat"
      };
    }
    renderCustomInitialBoard();
  }

  function normalizeMatchRules(source = {}) {
    const specialProbabilities = source.specialProbabilities || {};
    const specialUseLimits = source.specialUseLimits || {};
    const hostColor = ["black", "white", "random"].includes(source.hostColor)
      ? source.hostColor
      : customMatchDefaults.hostColor;
    return {
      hostColor,
      normalProbability: clampInteger(source.normalProbability, 0, 100, customMatchDefaults.normalProbability),
      specialProbabilities: {
        0: clampInteger(specialProbabilities[0] ?? specialProbabilities["0"] ?? source.special0Probability, 0, 100, customMatchDefaults.special0Probability),
        100: clampInteger(specialProbabilities[100] ?? specialProbabilities["100"] ?? source.special100Probability, 0, 100, customMatchDefaults.special100Probability)
      },
      specialUseLimits: {
        0: clampInteger(specialUseLimits[0] ?? specialUseLimits["0"] ?? source.special0Uses, 0, 50, customMatchDefaults.special0Uses),
        100: clampInteger(specialUseLimits[100] ?? specialUseLimits["100"] ?? source.special100Uses, 0, 50, customMatchDefaults.special100Uses)
      },
      observeUseLimit: clampInteger(source.observeUseLimit ?? source.observeUses, 0, 50, customMatchDefaults.observeUseLimit),
      initialSetup: source.initialSetup ? normalizeInitialSetup(source.initialSetup) : null
    };
  }

  function setCustomMatchDefaults({ persistInitialSetup = false } = {}) {
    if (customSelfColorEl) customSelfColorEl.value = customMatchDefaults.hostColor;
    if (customNormalProbabilityEl) customNormalProbabilityEl.value = String(customMatchDefaults.normalProbability);
    if (customSpecial0ProbabilityEl) customSpecial0ProbabilityEl.value = String(customMatchDefaults.special0Probability);
    if (customSpecial0UsesEl) customSpecial0UsesEl.value = String(customMatchDefaults.special0Uses);
    if (customSpecial100ProbabilityEl) customSpecial100ProbabilityEl.value = String(customMatchDefaults.special100Probability);
    if (customSpecial100UsesEl) customSpecial100UsesEl.value = String(customMatchDefaults.special100Uses);
    if (customObserveUsesEl) customObserveUsesEl.value = String(customMatchDefaults.observeUseLimit);
    customInitialCells = createDefaultInitialCells();
    renderCustomInitialBoard();
    if (persistInitialSetup) saveCustomInitialSetup();
  }

  function clampCustomNumberInput(input, min, max, fallback) {
    if (!input) return;
    input.value = String(clampInteger(input.value, min, max, fallback));
  }

  function clampCustomMatchInputs() {
    clampCustomNumberInput(customNormalProbabilityEl, 0, 100, customMatchDefaults.normalProbability);
    clampCustomNumberInput(customSpecial0ProbabilityEl, 0, 100, customMatchDefaults.special0Probability);
    clampCustomNumberInput(customSpecial0UsesEl, 0, 50, customMatchDefaults.special0Uses);
    clampCustomNumberInput(customSpecial100ProbabilityEl, 0, 100, customMatchDefaults.special100Probability);
    clampCustomNumberInput(customSpecial100UsesEl, 0, 50, customMatchDefaults.special100Uses);
    clampCustomNumberInput(customObserveUsesEl, 0, 50, customMatchDefaults.observeUseLimit);
  }

  function saveCustomMatchDraft() {
    clampCustomMatchInputs();
    writeJsonStorage(customMatchDraftKey, {
      enabled: Boolean(customMatchEnabledEl?.checked),
      rules: {
        hostColor: customSelfColorEl?.value || customMatchDefaults.hostColor,
        normalProbability: customNormalProbabilityEl?.value,
        specialProbabilities: {
          0: customSpecial0ProbabilityEl?.value,
          100: customSpecial100ProbabilityEl?.value
        },
        specialUseLimits: {
          0: customSpecial0UsesEl?.value,
          100: customSpecial100UsesEl?.value
        },
        observeUseLimit: customObserveUsesEl?.value,
        initialSetup: collectInitialSetup()
      }
    });
    saveCustomInitialSetup();
  }

  function restoreCustomMatchDraft() {
    const savedInitialSetup = loadCustomInitialSetup();
    const hasSavedInitialSetup = Boolean(savedInitialSetup);
    if (savedInitialSetup) {
      customInitialCells = initialSetupToCells(savedInitialSetup);
      renderCustomInitialBoard();
    }
    const draft = readJsonStorage(customMatchDraftKey);
    if (!draft) return;
    const rules = normalizeMatchRules(draft.rules || {});
    if (customMatchEnabledEl) customMatchEnabledEl.checked = Boolean(draft.enabled);
    if (customSelfColorEl) customSelfColorEl.value = rules.hostColor;
    if (customNormalProbabilityEl) customNormalProbabilityEl.value = String(rules.normalProbability);
    if (customSpecial0ProbabilityEl) customSpecial0ProbabilityEl.value = String(rules.specialProbabilities[0]);
    if (customSpecial0UsesEl) customSpecial0UsesEl.value = String(rules.specialUseLimits[0]);
    if (customSpecial100ProbabilityEl) customSpecial100ProbabilityEl.value = String(rules.specialProbabilities[100]);
    if (customSpecial100UsesEl) customSpecial100UsesEl.value = String(rules.specialUseLimits[100]);
    if (customObserveUsesEl) customObserveUsesEl.value = String(rules.observeUseLimit);
    if (!hasSavedInitialSetup && rules.initialSetup) {
      customInitialCells = initialSetupToCells(rules.initialSetup);
      renderCustomInitialBoard();
      saveCustomInitialSetup();
    }
  }

  function bindCustomNumberClipping() {
    [
      [customNormalProbabilityEl, 0, 100, customMatchDefaults.normalProbability],
      [customSpecial0ProbabilityEl, 0, 100, customMatchDefaults.special0Probability],
      [customSpecial0UsesEl, 0, 50, customMatchDefaults.special0Uses],
      [customSpecial100ProbabilityEl, 0, 100, customMatchDefaults.special100Probability],
      [customSpecial100UsesEl, 0, 50, customMatchDefaults.special100Uses],
      [customObserveUsesEl, 0, 50, customMatchDefaults.observeUseLimit]
    ].forEach(([input, min, max, fallback]) => {
      if (!input) return;
      const clamp = () => clampCustomNumberInput(input, min, max, fallback);
      input.addEventListener("change", clamp);
      input.addEventListener("blur", clamp);
    });
  }

  function updateCustomMatchVisibility() {
    if (!customMatchSettingsEl) return;
    customMatchSettingsEl.hidden = !customMatchEnabledEl?.checked;
  }

  function collectCustomMatchRules() {
    if (!customMatchEnabledEl?.checked) return null;
    clampCustomMatchInputs();
    return normalizeMatchRules({
      hostColor: customSelfColorEl?.value || "random",
      normalProbability: customNormalProbabilityEl?.value,
      specialProbabilities: {
        0: customSpecial0ProbabilityEl?.value,
        100: customSpecial100ProbabilityEl?.value
      },
      specialUseLimits: {
        0: customSpecial0UsesEl?.value,
        100: customSpecial100UsesEl?.value
      },
      observeUseLimit: customObserveUsesEl?.value,
      initialSetup: collectInitialSetup()
    });
  }

  function playerColorName(color) {
    return color === "black" ? "黒" : "白";
  }

  function applyPlayerTitle(element, title) {
    if (!element) return;
    element.textContent = allowedTitles.has(title) ? title : "新米ねこ";
  }

  function showMatchPreview(players, playerNames = {}, playerTitles = {}) {
    const playerId = getPlayerId();
    const playerColor = players.black === playerId ? "black" : "white";
    const blackName = playerNames.black || "黒のねこ";
    const whiteName = playerNames.white || "白のねこ";
    if (matchBlackNameEl) matchBlackNameEl.textContent = blackName;
    if (matchWhiteNameEl) matchWhiteNameEl.textContent = whiteName;
    applyPlayerTitle(document.querySelector("#matchBlackTitle"), playerTitles.black);
    applyPlayerTitle(document.querySelector("#matchWhiteTitle"), playerTitles.white);
    if (matchYourTurnEl) matchYourTurnEl.textContent = `あなたは${playerColorName(playerColor)}です。`;
    if (matchPreviewEl) matchPreviewEl.hidden = false;
    if (cancelRandomButton) cancelRandomButton.hidden = true;
    if (modeSelectButton) modeSelectButton.hidden = true;
    if (resumeRoomButton) resumeRoomButton.hidden = true;
  }

  function roomPlayerCount(room) {
    if (room?.host || room?.guest) {
      return [room.host, room.guest].filter(Boolean).length;
    }
    return Object.values(room?.players || {}).filter(Boolean).length;
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function isShellFrame() {
    return window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1";
  }

  function navigate(path) {
    if (isShellFrame()) {
      window.parent.postMessage({ type: "othello:navigate", path, click: false }, "*");
      setTimeout(() => {
        if (location.href.includes("online.html")) {
          window.top.location.href = path;
        }
      }, 2500);
      return;
    }
    location.href = path;
  }

  function onlineSelectPath() {
    return "online-select.html";
  }

  function configureMatchModeUi() {
    const isRandom = matchMode === "random";
    if (isRandom) {
      if (friendRoomPanel) friendRoomPanel.remove();
      if (roomInfoEl) roomInfoEl.remove();
    } else {
      if (friendRoomPanel) friendRoomPanel.hidden = false;
      if (roomInfoEl) roomInfoEl.hidden = false;
    }
    if (randomRoomPanel) randomRoomPanel.hidden = !isRandom;
    if (cancelRandomButton) cancelRandomButton.hidden = !isRandom;
    if (onlineLeadEl) {
      onlineLeadEl.textContent = isRandom
        ? "対局相手を自動で探します。"
        : "友人とのオンライン対局を準備します。";
    }
    if (modeSelectButton) {
      modeSelectButton.textContent = "対局選択へ戻る";
      modeSelectButton.hidden = isRandom;
    }
  }

  function watchRoom(roomCode) {
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = db.collection("rooms").doc(roomCode).onSnapshot(snapshot => {
      if (!snapshot.exists) {
        setStatus("部屋が見つかりませんでした。", true);
        return;
      }
      const room = snapshot.data();
      const playerCount = roomPlayerCount(room);
      if (roomCodeEl) roomCodeEl.textContent = roomCode;
      if (ownedWaitingRoomCode === roomCode && room.status !== "waiting") {
        ownedWaitingRoomCode = "";
      }
      if (room.status === "matched") {
        if (cancelRandomButton) cancelRandomButton.disabled = true;
        showMatchPreview(room.players || {}, room.playerNames || {}, room.playerTitles || {});
        setStatus("対局相手が見つかりました。まもなく開始します。");
      } else if (room.matchType === "random") {
        setStatus(`対局相手を探しています。参加人数: ${playerCount}/2`);
      } else {
        setStatus(`部屋 ${roomCode} に接続中です。参加人数: ${playerCount}/2`);
      }
      if (room.status === "matched" || Object.values(room.players || {}).filter(Boolean).length >= 2) {
        if (ownedWaitingRoomCode === roomCode) ownedWaitingRoomCode = "";
        enterOnlineGame(roomCode, room.players || {}, room.playerNames || {}, room.playerTitles || {}, room.matchRules || null);
      }
    }, error => {
      setStatus("部屋情報の更新に失敗しました。通信環境を確認してください。", true);
    });
  }

  function enterOnlineGame(roomCode, players, playerNames = {}, playerTitles = {}, matchRules = null) {
    if (navigatedToGame) return;
    const playerId = getPlayerId();
    const playerColor = players.black === playerId ? "black" : "white";
    navigatedToGame = true;
    showMatchPreview(players, playerNames, playerTitles);
    writeOnlineSession({
      roomCode,
      playerId,
      playerColor,
      playerNames,
      playerTitles,
      matchRules
    });
    setStatus("対局相手と手番を確認しています。");
    setTimeout(() => navigate("othello-online.html"), 2600);
  }

  async function resumePreviousRoom() {
    const saved = readPersistentSession();
    if (!saved?.roomCode || !saved?.playerId || !saved?.playerColor) {
      setStatus("戻れる対局がありません。", true);
      updateResumeButton();
      return;
    }
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
      return;
    }

    activePlayerId = saved.playerId;
    if (resumeRoomButton) resumeRoomButton.disabled = true;
    try {
      const snapshot = await db.collection("rooms").doc(saved.roomCode).get();
      if (!snapshot.exists) {
        clearPersistentSession();
        setStatus("前回の対局は見つかりませんでした。", true);
        return;
      }
      const room = snapshot.data();
      const players = room.players || {};
      const isParticipant = players.black === saved.playerId || players.white === saved.playerId;
      if (!isParticipant || isFinishedRoom(room)) {
        clearPersistentSession();
        setStatus("前回の対局は終了しているため、戻れません。", true);
        return;
      }

      const playerColor = players.black === saved.playerId ? "black" : "white";
      writeOnlineSession({
        ...saved,
        playerColor,
        playerNames: room.playerNames || saved.playerNames || {},
        playerTitles: room.playerTitles || saved.playerTitles || {},
        matchRules: room.matchRules || saved.matchRules || null
      });
      setStatus("前回の対局へ戻ります。");
      navigate("othello-online.html");
    } catch (error) {
      setStatus("前回の対局情報を確認できませんでした。通信環境を確認してください。", true);
    } finally {
      if (resumeRoomButton) resumeRoomButton.disabled = false;
    }
  }

  async function createWaitingRoom(profile, { random = false } = {}) {
    const playerId = profile.playerId;
    const nickname = profile.name;
    const title = profile.title;
    const matchRules = random ? null : collectCustomMatchRules();
    let roomCode = generateRoomCode();
    let roomRef = db.collection("rooms").doc(roomCode);
    while ((await roomRef.get()).exists) {
      roomCode = generateRoomCode();
      roomRef = db.collection("rooms").doc(roomCode);
    }

    await roomRef.set({
      roomCode,
      matchType: random ? "random" : "friend",
      matchRules,
      status: "waiting",
      host: playerId,
      guest: null,
      players: {
        black: null,
        white: null
      },
      playerNames: {
        host: nickname,
        guest: "",
        black: "",
        white: ""
      },
      playerTitles: {
        host: title,
        guest: "",
        black: "",
        white: ""
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    ownedWaitingRoomCode = roomCode;
    if (roomCodeEl) roomCodeEl.textContent = roomCode;
    setStatus(random
      ? "対局相手を探しています。参加人数: 1/2"
      : `部屋 ${roomCode} を作りました。参加人数: 1/2`);
    watchRoom(roomCode);
    return roomCode;
  }

  async function createRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
      return;
    }

    if (createRoomButton) createRoomButton.disabled = true;
    let roomCreated = false;
    try {
      const profile = await getOnlineProfile();
      if (!profile?.playerId || profile.offline) {
        throw userError("オンライン接続に失敗しました。通信環境を確認して、もう一度お試しください。");
      }
      await createWaitingRoom(profile);
      roomCreated = true;
    } catch (error) {
      setStatus(error.userMessage || "部屋の作成に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    } finally {
      if (!roomCreated && createRoomButton) {
        createRoomButton.disabled = false;
      }
    }
  }

  async function deleteOwnedWaitingRoom() {
    if (!ownedWaitingRoomCode || !db) return false;

    const roomCode = ownedWaitingRoomCode;
    const playerId = getPlayerId();
    const roomRef = db.collection("rooms").doc(roomCode);
    const deleted = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists) return false;

      const room = snapshot.data();
      const players = room.players || {};
      const isOwner = room.host === playerId;
      const isWaiting = room.status === "waiting";
      const hasGuest = Boolean(room.guest);
      const hasAssignedPlayers = Object.values(players).some(Boolean);
      const hasGameStarted = Boolean(room.gameState);
      if (!isOwner || !isWaiting || hasGuest || hasAssignedPlayers || hasGameStarted) {
        return false;
      }

      transaction.delete(roomRef);
      return true;
    });

    if (deleted && ownedWaitingRoomCode === roomCode) {
      ownedWaitingRoomCode = "";
    }
    return deleted;
  }

  async function returnToModeSelect() {
    if (navigatedToGame) return;
    if (!ownedWaitingRoomCode) {
      navigate(onlineSelectPath());
      return;
    }

    if (modeSelectButton) modeSelectButton.disabled = true;
    try {
      const roomCode = ownedWaitingRoomCode;
      const deleted = await deleteOwnedWaitingRoom();
      if (deleted) {
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        navigate(onlineSelectPath());
        return;
      }

      const snapshot = roomCode ? await db.collection("rooms").doc(roomCode).get() : null;
      if (!snapshot || !snapshot.exists || isFinishedRoom(snapshot.data())) {
        ownedWaitingRoomCode = "";
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        navigate(onlineSelectPath());
        return;
      }

      const room = snapshot.data();
      const matched = room.status === "matched" || Object.values(room.players || {}).filter(Boolean).length >= 2;
      if (matched) {
        ownedWaitingRoomCode = "";
        enterOnlineGame(roomCode, room.players || {}, room.playerNames || {}, room.playerTitles || {}, room.matchRules || null);
        return;
      }

      if (modeSelectButton) modeSelectButton.disabled = false;
      setStatus("部屋の状態が変わったため、対局選択へ戻れませんでした。もう一度お試しください。", true);
    } catch (error) {
      if (modeSelectButton) modeSelectButton.disabled = false;
      setStatus("待機中の部屋を削除できませんでした。通信環境を確認して、もう一度お試しください。", true);
    }
  }

  async function joinRoomByCode(roomCode, profile, { random = false } = {}) {
    const playerId = profile.playerId;
    const nickname = profile.name;
    const title = profile.title;
    const roomRef = db.collection("rooms").doc(roomCode);
    let nextPlayers = null;
    let nextPlayerNames = null;
    let nextPlayerTitles = null;
    let nextMatchRules = null;
    let nextStatus = "waiting";

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(roomRef);
      if (!snapshot.exists) throw userError("その部屋IDは見つかりませんでした。");

      const room = snapshot.data();
      const players = room.players || {};
      nextMatchRules = room.matchRules || null;
      const roomMatchType = room.matchType || "friend";
      const isExistingParticipant = players.black === playerId || players.white === playerId;
      if (isFinishedRoom(room)) throw userError("その部屋IDは見つかりませんでした。");
      if (random && roomMatchType !== "random") throw userError("この部屋には参加できません。");
      if (!random && roomMatchType === "random") throw userError("その部屋IDは見つかりませんでした。");
      if (room.status !== "waiting" && !isExistingParticipant) {
        throw userError(random ? "この部屋には参加できません。" : "その部屋IDは見つかりませんでした。");
      }
      if (players.black && players.white && players.black !== playerId && players.white !== playerId) {
        throw userError("この部屋はすでに満室です。");
      }

      const hostId = room.host || players.black;
      if (!hostId) throw userError("この部屋の情報が壊れています。別の部屋IDを使ってください。");
      if (hostId === playerId) {
        throw userError(random ? "自分の待機部屋です。" : "自分で作った部屋には参加できません。相手に部屋IDを伝えてください。");
      }

      nextPlayers = players.black && players.white
        ? players
        : assignPlayers(hostId, playerId, random ? "random" : nextMatchRules?.hostColor);
      const mySlot = nextPlayers.black === playerId ? "black" : "white";
      const hostSlot = nextPlayers.black === hostId ? "black" : "white";
      const hostName = room.playerNames?.host
        || (players.black === hostId ? room.playerNames?.black : room.playerNames?.white)
        || "ねこさん";
      const hostTitle = room.playerTitles?.host
        || (players.black === hostId ? room.playerTitles?.black : room.playerTitles?.white)
        || "新米ねこ";
      nextPlayerNames = {
        host: hostName,
        guest: nickname,
        [hostSlot]: hostName,
        [mySlot]: nickname
      };
      nextPlayerTitles = {
        host: hostTitle,
        guest: title,
        [hostSlot]: hostTitle,
        [mySlot]: title
      };
      nextStatus = nextPlayers.black && nextPlayers.white ? "matched" : "waiting";
      const updatePayload = {
        guest: playerId,
        players: nextPlayers,
        playerNames: nextPlayerNames,
        playerTitles: nextPlayerTitles,
        status: nextStatus,
        updatedAt: serverTimestamp()
      };
      if (nextStatus === "matched") {
        updatePayload.startedAt = room.startedAt || serverTimestamp();
      }
      transaction.update(roomRef, updatePayload);
    });

    if (nextStatus === "matched") {
      enterOnlineGame(roomCode, nextPlayers, nextPlayerNames, nextPlayerTitles, nextMatchRules);
    }
    watchRoom(roomCode);
    return nextStatus === "matched";
  }

  async function joinRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
      return;
    }

    const roomCode = joinCodeEl?.value.trim().toUpperCase();
    if (!roomCode) {
      setStatus("部屋IDを入力してください。", true);
      return;
    }

    if (joinRoomButton) joinRoomButton.disabled = true;
    try {
      const profile = await getOnlineProfile();
      if (!profile?.playerId || profile.offline) {
        throw userError("オンライン接続に失敗しました。通信環境を確認して、もう一度お試しください。");
      }
      await joinRoomByCode(roomCode, profile);
    } catch (error) {
      setStatus(error.userMessage || "部屋への参加に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    } finally {
      if (joinRoomButton) joinRoomButton.disabled = false;
    }
  }

  async function tryJoinRandomRoom(profile) {
    const snapshot = await db.collection("rooms")
      .where("matchType", "==", "random")
      .where("status", "==", "waiting")
      .limit(16)
      .get();

    for (const doc of snapshot.docs) {
      const room = doc.data();
      if (room.status !== "waiting" || room.host === profile.playerId || isFinishedRoom(room)) continue;
      try {
        await joinRoomByCode(doc.id, profile, { random: true });
        return true;
      } catch (error) {
        if (!error.userMessage) throw error;
      }
    }
    return false;
  }

  async function startRandomMatch() {
    if (randomMatchStarted || navigatedToGame) return;
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
      return;
    }

    randomMatchStarted = true;
    if (cancelRandomButton) {
      cancelRandomButton.hidden = false;
      cancelRandomButton.disabled = false;
    }
    setStatus("対局相手を探しています。");
    try {
      const profile = await getOnlineProfile();
      if (!profile?.playerId || profile.offline) {
        throw userError("オンライン接続に失敗しました。通信環境を確認して、もう一度お試しください。");
      }
      const joined = await tryJoinRandomRoom(profile);
      if (!joined && !navigatedToGame) {
        await createWaitingRoom(profile, { random: true });
      }
    } catch (error) {
      randomMatchStarted = false;
      if (cancelRandomButton) cancelRandomButton.disabled = false;
      setStatus(error.userMessage || "ランダム対局の準備に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    }
  }

  async function cancelRandomMatch() {
    if (navigatedToGame) return;
    if (cancelRandomButton) cancelRandomButton.disabled = true;

    try {
      if (!ownedWaitingRoomCode) {
        navigate(onlineSelectPath());
        return;
      }

      const roomCode = ownedWaitingRoomCode;
      const deleted = await deleteOwnedWaitingRoom();
      if (deleted) {
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        navigate(onlineSelectPath());
        return;
      }

      const snapshot = await db.collection("rooms").doc(roomCode).get();
      if (!snapshot.exists || isFinishedRoom(snapshot.data())) {
        ownedWaitingRoomCode = "";
        navigate(onlineSelectPath());
        return;
      }

      const room = snapshot.data();
      const matched = room.status === "matched" || Object.values(room.players || {}).filter(Boolean).length >= 2;
      if (matched) {
        ownedWaitingRoomCode = "";
        enterOnlineGame(roomCode, room.players || {}, room.playerNames || {}, room.playerTitles || {}, room.matchRules || null);
        return;
      }

      setStatus("キャンセルできませんでした。もう一度お試しください。", true);
      if (cancelRandomButton) cancelRandomButton.disabled = false;
    } catch (error) {
      setStatus("キャンセルに失敗しました。通信環境を確認して、もう一度お試しください。", true);
      if (cancelRandomButton) cancelRandomButton.disabled = false;
    }
  }

  function enableAuthFallback() {
    if (currentUser || authFallbackReady) return;
    authFallbackReady = true;
    setStatus("接続確認に時間がかかっています。少し待ってからもう一度お試しください。");
  }

  async function bootFirebase() {
    setTimeout(enableAuthFallback, 2500);

    try {
      if (!window.firebase || !window.OthelloFirebaseConfig) {
        setStatus("オンライン機能の読み込みに失敗しました。通信環境を確認して、もう一度お試しください。", true);
        return;
      }

      const app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.OthelloFirebaseConfig);
      auth = firebase.auth(app);
      db = firebase.firestore(app);
      try {
        db.settings({
          experimentalForceLongPolling: true,
          merge: true
        });
      } catch {
        // Firestore settings can only be applied before the first operation.
      }

      auth.onAuthStateChanged(user => {
        currentUser = user;
        if (user && !activePlayerId) activePlayerId = user.uid;
      });

      currentProfile = await getOnlineProfile();
      if (!currentProfile?.playerId || currentProfile.offline) {
        authFallbackReady = true;
        setStatus("オンライン接続に失敗しました。通信環境を確認して、もう一度お試しください。", true);
        return;
      }

      if (matchMode === "random") {
        startRandomMatch();
      } else {
        setStatus("オンライン対局の準備ができました。");
      }
    } catch (error) {
      authFallbackReady = true;
      setStatus("オンライン機能の準備に失敗しました。ページを再読み込みして、もう一度お試しください。", true);
    }
  }

  configureMatchModeUi();
  setCustomMatchDefaults();
  restoreCustomMatchDraft();
  bindCustomNumberClipping();
  updateCustomMatchVisibility();
  setNicknameValueFromStorage();
  if (nicknameEl) {
    nicknameEl.addEventListener("change", () => {
      try {
        getNickname();
        if (statusEl.classList.contains("error") && statusEl.textContent === "このニックネームは使用できません") {
          setStatus("オンライン対局の準備ができました。");
        }
      } catch (error) {
        setStatus(error.userMessage || "ニックネームを確認してください。", true);
      }
    });
  }

  if (createRoomButton) createRoomButton.addEventListener("click", createRoom);
  if (joinRoomButton) joinRoomButton.addEventListener("click", joinRoom);
  if (resumeRoomButton) resumeRoomButton.addEventListener("click", resumePreviousRoom);
  if (modeSelectButton) modeSelectButton.addEventListener("click", returnToModeSelect);
  if (cancelRandomButton) cancelRandomButton.addEventListener("click", cancelRandomMatch);
  if (customMatchEnabledEl) customMatchEnabledEl.addEventListener("change", updateCustomMatchVisibility);
  if (customInitialSetupButton) {
    customInitialSetupButton.addEventListener("click", () => {
      saveCustomMatchDraft();
      navigate("initial-board.html");
    });
  }
  if (customMatchResetButton) {
    customMatchResetButton.addEventListener("click", () => {
      setCustomMatchDefaults({ persistInitialSetup: true });
      saveCustomMatchDraft();
      updateCustomMatchVisibility();
    });
  }
  document.addEventListener("click", event => {
    if (event.target.closest("button")) playClickSe();
  });
  if (joinCodeEl) {
    joinCodeEl.addEventListener("input", () => {
      joinCodeEl.value = joinCodeEl.value.toUpperCase();
    });
  }

  setStatus("オンラインに接続しています...");
  updateResumeButton();
  bootFirebase();
})();





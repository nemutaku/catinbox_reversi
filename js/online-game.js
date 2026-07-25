(() => {
  const sessionKey = "othelloOnlineSession";
  const persistentSessionKey = "othelloOnlineLastSession";
  const matchTimeMs = 5 * 60 * 1000;
  const presenceHealthyIntervalMs = 30 * 1000;
  const presenceRetryIntervalMs = 10 * 1000;
  const presenceWarningMs = presenceHealthyIntervalMs;
  const presenceTimeoutMs = 60 * 1000;
  const clockTickIntervalMs = 250;
  const clockPlayers = [1, -1];

  function readSession() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    } catch {
      return null;
    }
  }

  const session = readSession();
  let db = null;
  let roomRef = null;
  let movesRef = null;
  let unsubscribeRoom = null;
  let unsubscribeMoves = null;
  let gameApi = null;
  let ready = false;
  let latestVersion = 0;
  let publishing = false;
  let remoteObservationPreviewUntil = 0;
  let latestClock = null;
  let clockInterval = null;
  let presenceInterval = null;
  let presenceIntervalDelay = presenceHealthyIntervalMs;
  let presenceStartedAt = Date.now();
  const presenceLastSeenAt = { black: 0, white: 0 };
  const presenceVersionKeys = { black: "", white: "" };
  let latestRoomData = null;
  let timeoutPublishing = false;
  let timeoutPublished = false;
  let disconnectPublishing = false;
  let lastRenderedExpiredPlayer = null;
  let remoteHistory = [];
  let movesListenerReady = false;
  let publishedHistoryLength = 0;
  const resignButton = document.querySelector("#onlineResign");
  const backToRoomButton = document.querySelector("#onlineBackToRoom");
  const resignConfirm = document.querySelector("#resignConfirm");
  const confirmResignButton = document.querySelector("#confirmResign");
  const cancelResignButton = document.querySelector("#cancelResign");

  function setStatus(message, isError = false) {
    const statusEl = document.querySelector("#onlineGameStatus");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function playerColorValue() {
    return session?.playerColor === "white" ? -1 : 1;
  }

  function playerName(player) {
    return player === 1 ? "黒" : "白";
  }

  function sanitizeName(value, fallback) {
    const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 12);
    return name || fallback;
  }

  function playerTitle(name) {
    if (name === "眠澤") return "作者";
    if (name === "フジナッツ健") return "公認指導員";
    return "新米ねこ";
  }

  function applyPlayerTitle(elementId, name) {
    const titleEl = document.querySelector(elementId);
    if (!titleEl) return;
    const title = playerTitle(name);
    titleEl.textContent = title;
    titleEl.classList.toggle("creator", title === "作者");
    titleEl.classList.toggle("instructor", title === "公認指導員");
  }

  function updatePlayerNames(playerNames = session?.playerNames || {}) {
    const blackName = sanitizeName(playerNames.black, "黒のねこ");
    const whiteName = sanitizeName(playerNames.white, "白のねこ");
    const blackEl = document.querySelector("#onlineBlackName");
    const whiteEl = document.querySelector("#onlineWhiteName");
    if (blackEl) blackEl.textContent = blackName;
    if (whiteEl) whiteEl.textContent = whiteName;
    applyPlayerTitle("#onlineBlackTitle", blackName);
    applyPlayerTitle("#onlineWhiteTitle", whiteName);
    if (session) session.playerNames = { black: blackName, white: whiteName };
  }

  function updateDisconnectNotice(disconnectedColor = null) {
    const blackNotice = document.querySelector("#onlineBlackDisconnect");
    const whiteNotice = document.querySelector("#onlineWhiteDisconnect");
    if (blackNotice) blackNotice.hidden = disconnectedColor !== "black";
    if (whiteNotice) whiteNotice.hidden = disconnectedColor !== "white";
  }

  function resultMessage(result) {
    if (!result) return "";
    if (result.type === "resign") {
      return `${playerName(result.loser)}が投了しました。${playerName(result.winner)}の勝ちです。`;
    }
    if (result.type === "disconnect") {
      return `${playerName(result.loser)}の接続が切れました。${playerName(result.winner)}の勝ちです。`;
    }
    if (result.type === "timeout") {
      return `${playerName(result.loser)}の時間が切れました。${playerName(result.winner)}の勝ちです。`;
    }
    return "";
  }

  function gameEnded(gameState = null) {
    const clock = currentClock();
    return Boolean(gameState?.gameOver || gameState?.gameResult || gameApi?.getState?.().gameOver || clock.timedOut !== null);
  }

  function updateOnlineActionButtons(gameState = null) {
    const ended = gameEnded(gameState);
    if (resignButton) {
      resignButton.hidden = ended;
      resignButton.disabled = ended || !ready || !roomRef;
    }
    if (backToRoomButton) backToRoomButton.hidden = !ended;
  }

  function showResignConfirm() {
    if (!gameApi || gameApi.getState().gameOver || !resignConfirm) return;
    resignConfirm.hidden = false;
    confirmResignButton?.focus();
  }

  function hideResignConfirm() {
    if (!resignConfirm || resignConfirm.hidden) return;
    resignConfirm.hidden = true;
    resignButton?.focus();
  }

  function navigateToRoomScreen() {
    sessionStorage.removeItem(sessionKey);
    localStorage.removeItem(persistentSessionKey);
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      window.parent.postMessage({ type: "othello:navigate", path: "online.html", click: false }, "*");
      return;
    }
    location.href = "online.html";
  }

  function resign() {
    if (!gameApi || gameApi.getState().gameOver) return;
    hideResignConfirm();
    gameApi.endByResignation?.(playerColorValue());
    updateOnlineActionButtons(gameApi.getState());
  }

  function formatTime(ms) {
    const safeMs = Math.max(0, Math.ceil(ms));
    const totalSeconds = Math.ceil(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function defaultClock(turn = -1) {
    return {
      remaining: { "-1": matchTimeMs, "1": matchTimeMs },
      active: turn,
      updatedAt: Date.now(),
      paused: false,
      timedOut: null
    };
  }

  function normalizeClock(clock, turn = -1, now = Date.now()) {
    const base = defaultClock(turn);
    const source = clock || {};
    const remaining = {};
    clockPlayers.forEach(player => {
      const value = Number(source.remaining?.[player] ?? source.remaining?.[String(player)]);
      remaining[String(player)] = Number.isFinite(value) ? Math.max(0, value) : matchTimeMs;
    });
    return {
      remaining,
      active: clockPlayers.includes(Number(source.active)) ? Number(source.active) : turn,
      updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : now,
      paused: Boolean(source.paused),
      timedOut: clockPlayers.includes(Number(source.timedOut)) ? Number(source.timedOut) : null
    };
  }

  function clockAt(clock, now = Date.now()) {
    const normalized = normalizeClock(clock, -1, now);
    if (!normalized.paused && normalized.timedOut === null && clockPlayers.includes(normalized.active)) {
      const elapsed = Math.max(0, now - normalized.updatedAt);
      const key = String(normalized.active);
      normalized.remaining[key] = Math.max(0, normalized.remaining[key] - elapsed);
      normalized.updatedAt = now;
      if (normalized.remaining[key] <= 0) normalized.timedOut = normalized.active;
    }
    return normalized;
  }

  function prepareClockForPublish(state, reason, now = Date.now()) {
    const current = reason === "start"
      ? defaultClock(state.turn)
      : clockAt(latestClock || defaultClock(state.turn), now);

    if (reason === "observe-start" || reason === "final-observe-start") {
      current.paused = true;
      current.active = state.turn;
    } else if (state.gameOver || current.timedOut !== null) {
      current.paused = true;
      current.active = state.turn;
    } else {
      current.paused = false;
      current.active = state.turn;
    }

    current.updatedAt = now;
    return current;
  }

  function currentClock() {
    return clockAt(latestClock || defaultClock(gameApi?.getState?.().turn ?? -1));
  }

  function isClockExpired(player) {
    const clock = currentClock();
    return clock.timedOut === player || clock.remaining[String(player)] <= 0;
  }

  function reviewClockForState(state) {
    if (!state?.reviewing) return null;
    const historyTurn = state.positionHistory?.[state.reviewIndex]?.turn ?? state.turn;
    if (state.reviewClock) return normalizeClock(state.reviewClock, historyTurn);
    if (state.reviewIndex === 0) return defaultClock(historyTurn);
    return null;
  }

  function updateClockPanel() {
    const state = gameApi?.getState?.();
    const reviewClock = reviewClockForState(state);
    const clock = reviewClock || currentClock();
    const blackEl = document.querySelector("#onlineBlackClock");
    const whiteEl = document.querySelector("#onlineWhiteClock");
    const blackItem = document.querySelector("[data-clock-player='black']");
    const whiteItem = document.querySelector("[data-clock-player='white']");
    if (blackEl) blackEl.textContent = formatTime(clock.remaining["1"]);
    if (whiteEl) whiteEl.textContent = formatTime(clock.remaining["-1"]);
    if (blackItem) blackItem.classList.toggle("active", clock.active === 1 && !clock.paused && clock.timedOut === null);
    if (whiteItem) whiteItem.classList.toggle("active", clock.active === -1 && !clock.paused && clock.timedOut === null);
    if (reviewClock) return;

    const expiredPlayer = clock.timedOut ?? (clock.remaining[String(clock.active)] <= 0 ? clock.active : null);
    if (expiredPlayer !== lastRenderedExpiredPlayer) {
      lastRenderedExpiredPlayer = expiredPlayer;
      gameApi?.render?.();
    }
    updateOnlineActionButtons(gameApi?.getState?.());
    if (expiredPlayer !== null) publishTimeout(expiredPlayer, clock);
  }

  function startClockTicker() {
    if (clockInterval) return;
    updateClockPanel();
    clockInterval = setInterval(updateClockPanel, clockTickIntervalMs);
  }

  function updateOnlineResourcePanel(state) {
    if (!state) return;
    const opponent = -playerColorValue();
    const specialUsed = state.specialUsed?.[opponent] || {};
    const special100 = Math.max(0, 2 - Number(specialUsed[100] || 0));
    const special0 = Math.max(0, 2 - Number(specialUsed[0] || 0));
    const observeLeft = state.observeUsesLeft?.[opponent] ?? 0;
    const special100El = document.querySelector("#onlineOpponentSpecial100");
    const special0El = document.querySelector("#onlineOpponentSpecial0");
    const observeEl = document.querySelector("#onlineOpponentObserveLeft");
    if (special100El) special100El.textContent = `あと${special100}回`;
    if (special0El) special0El.textContent = `あと${special0}回`;
    if (observeEl) observeEl.textContent = `あと${observeLeft}回`;
    updateClockPanel();
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function opponentPlayerValue() {
    return -playerColorValue();
  }

  function clearPersistentSession() {
    localStorage.removeItem(persistentSessionKey);
  }

  function stopPresenceTicker() {
    if (!presenceInterval) return;
    clearInterval(presenceInterval);
    presenceInterval = null;
  }

  function schedulePresenceTicker(delay = presenceHealthyIntervalMs) {
    if (presenceInterval) clearInterval(presenceInterval);
    presenceIntervalDelay = delay;
    presenceInterval = setInterval(() => {
      updatePresence();
      checkOpponentPresence();
    }, delay);
  }

  function setPresenceIntervalDelay(delay) {
    if (presenceIntervalDelay === delay && presenceInterval) return;
    schedulePresenceTicker(delay);
  }

  function presenceTimestampKey(value) {
    if (!value) return "";
    if (typeof value.toMillis === "function") return String(value.toMillis());
    if (typeof value.seconds === "number") return `${value.seconds}:${value.nanoseconds || 0}`;
    if (typeof value === "number") return String(value);
    return "";
  }

  function trackPresence(room) {
    const now = Date.now();
    ["black", "white"].forEach(colorKey => {
      const entry = room?.presence?.[colorKey];
      const timestampKey = presenceTimestampKey(entry?.updatedAt);
      const versionKey = entry?.playerId && timestampKey ? `${entry.playerId}:${timestampKey}` : "";
      if (!versionKey || presenceVersionKeys[colorKey] === versionKey) return;
      presenceVersionKeys[colorKey] = versionKey;
      presenceLastSeenAt[colorKey] = now;
    });
  }

  async function updatePresence() {
    if (!ready || !roomRef || !session || gameEnded(latestRoomData?.gameState)) return;
    const colorKey = session.playerColor === "white" ? "white" : "black";
    try {
      await roomRef.update({
        [`presence.${colorKey}`]: {
          playerId: session.playerId,
          updatedAt: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      });
    } catch {
      // Snapshot errors are reported by the room listener.
    }
  }

  function startPresenceTicker() {
    if (presenceInterval) return;
    presenceStartedAt = Date.now();
    presenceLastSeenAt.black = 0;
    presenceLastSeenAt.white = 0;
    presenceVersionKeys.black = "";
    presenceVersionKeys.white = "";
    updatePresence();
    checkOpponentPresence();
    schedulePresenceTicker(presenceHealthyIntervalMs);
  }

  function refreshPresenceNow() {
    if (!ready || !roomRef || !session || gameEnded(latestRoomData?.gameState)) return;
    updatePresence();
    checkOpponentPresence();
  }

  function checkOpponentPresence() {
    if (!ready || !roomRef || !latestRoomData || disconnectPublishing) return;
    if (gameEnded(latestRoomData.gameState)) {
      updateDisconnectNotice(null);
      return;
    }
    const players = latestRoomData.players || {};
    if (!players.black || !players.white) return;

    const myColorKey = session.playerColor === "white" ? "white" : "black";
    const opponentColorKey = myColorKey === "black" ? "white" : "black";
    const lastSeenAt = presenceLastSeenAt[opponentColorKey] || presenceStartedAt;
    const elapsedMs = Date.now() - lastSeenAt;
    if (elapsedMs < presenceWarningMs) {
      updateDisconnectNotice(null);
      setPresenceIntervalDelay(presenceHealthyIntervalMs);
      return;
    }

    updateDisconnectNotice(opponentColorKey);
    setPresenceIntervalDelay(presenceRetryIntervalMs);
    if (elapsedMs < presenceTimeoutMs) return;

    publishDisconnectWin();
  }

  function encodeGrid(grid = []) {
    return grid.map(row => row.join(","));
  }

  function decodeNumberGrid(rows = []) {
    return rows.map(row => String(row).split(",").map(Number));
  }

  function decodeBooleanGrid(rows = []) {
    return rows.map(row => String(row).split(",").map(value => value === "true" || value === "1"));
  }

  function encodeHistory(history = []) {
    return history.map(item => ({
      board: encodeGrid(item.board),
      probBoard: encodeGrid(item.probBoard),
      observedBoard: encodeGrid(item.observedBoard.map(row => row.map(value => value ? 1 : 0))),
      turn: item.turn,
      clock: item.clock || null
    }));
  }

  function encodeHistoryItem(item) {
    return encodeHistory([item])[0];
  }

  function decodeHistory(history = []) {
    return history.map(item => ({
      board: decodeNumberGrid(item.board),
      probBoard: decodeNumberGrid(item.probBoard),
      observedBoard: decodeBooleanGrid(item.observedBoard),
      turn: item.turn,
      clock: item.clock || null
    }));
  }

  function decodeHistoryItem(item) {
    return decodeHistory([item])[0];
  }

  function sortedRemoteHistory() {
    return remoteHistory
      .filter(item => item && Array.isArray(item.board))
      .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
      .map(({ index, reason, version, ...item }) => item);
  }

  function historyForState(gameState) {
    const subcollectionHistory = sortedRemoteHistory();
    if (subcollectionHistory.length) return subcollectionHistory;
    return decodeHistory(gameState?.positionHistory || []);
  }

  function addClockToLatestHistory(state, clock) {
    const history = Array.isArray(state.positionHistory) ? state.positionHistory : [];
    if (!history.length) return history;
    return history.map((item, index) => {
      if (index === 0 && !item.clock) return { ...item, clock: defaultClock(item.turn) };
      if (index === history.length - 1) return { ...item, clock };
      return item;
    });
  }

  function sanitizeState(state) {
    return {
      board: encodeGrid(state.board),
      probBoard: encodeGrid(state.probBoard),
      observedBoard: encodeGrid(state.observedBoard.map(row => row.map(value => value ? 1 : 0))),
      turn: state.turn,
      lastMove: state.lastMove || null,
      specialUsed: state.specialUsed,
      observeUsesLeft: state.observeUsesLeft,
      historyLength: Array.isArray(state.positionHistory) ? state.positionHistory.length : 0,
      gameOver: Boolean(state.gameOver),
      gameResult: state.gameResult || null
    };
  }

  function restoreState(gameState) {
    return {
      board: decodeNumberGrid(gameState.board),
      probBoard: decodeNumberGrid(gameState.probBoard),
      observedBoard: decodeBooleanGrid(gameState.observedBoard),
      turn: gameState.turn,
      lastMove: gameState.lastMove || null,
      specialUsed: gameState.specialUsed,
      observeUsesLeft: gameState.observeUsesLeft,
      positionHistory: historyForState(gameState),
      gameOver: Boolean(gameState.gameOver),
      gameResult: gameState.gameResult || null
    };
  }

  function restoreStateWithTimeoutFallback(gameState) {
    const restored = restoreState(gameState);
    const restoredClock = clockAt(gameState?.clock);
    if (restored.gameResult || restoredClock.timedOut === null) return restored;

    const loser = restoredClock.timedOut;
    const endedClock = {
      ...restoredClock,
      paused: true
    };
    return {
      ...restored,
      gameOver: true,
      gameResult: {
        type: "timeout",
        loser,
        winner: -loser
      },
      positionHistory: addClockToLatestHistory(restored, endedClock)
    };
  }

  function collectNewHistoryEntries(history, reason, version) {
    const startIndex = Math.max(remoteHistory.length, publishedHistoryLength);
    return history.slice(startIndex).map((item, offset) => ({
      index: startIndex + offset,
      reason,
      version,
      item
    }));
  }

  function writeStateBatch(statePayload, history, reason, version) {
    const batch = db.batch();
    batch.update(roomRef, {
      gameState: statePayload,
      updatedAt: serverTimestamp()
    });

    collectNewHistoryEntries(history, reason, version).forEach(entry => {
      const doc = movesRef.doc(String(entry.index).padStart(3, "0"));
      batch.set(doc, {
        index: entry.index,
        reason: entry.reason,
        version: entry.version,
        ...encodeHistoryItem(entry.item),
        createdAt: serverTimestamp()
      });
    });

    return batch.commit().then(() => {
      publishedHistoryLength = Math.max(publishedHistoryLength, history.length);
    });
  }

  function applyMovesSnapshot(snapshot) {
    const nextHistory = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const item = decodeHistoryItem(data);
      if (!item || !Array.isArray(item.board)) return;
      nextHistory.push({
        ...item,
        index: Number(data.index),
        reason: data.reason || "",
        version: Number(data.version) || 0
      });
    });
    remoteHistory = nextHistory.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    movesListenerReady = true;
    publishedHistoryLength = Math.max(publishedHistoryLength, remoteHistory.length);

    const expectedLength = Number(latestRoomData?.gameState?.historyLength || 0);
    if (
      latestRoomData?.gameState
      && gameEnded(latestRoomData.gameState)
      && expectedLength > 0
      && remoteHistory.length >= expectedLength
      && !externalObservationPreviewRunning
    ) {
      gameApi?.applyExternalState?.(restoreStateWithTimeoutFallback(latestRoomData.gameState));
      updateClockPanel();
    }
  }

  function startMovesListener() {
    if (!movesRef || unsubscribeMoves) return;
    unsubscribeMoves = movesRef.orderBy("index").onSnapshot(applyMovesSnapshot, () => {
      setStatus("履歴情報の更新に失敗しました。通信環境を確認してください。", true);
    });
  }

  async function publishState(state, reason) {
    if (!ready || !roomRef || publishing) return;
    if (reason === "start" && session.playerColor !== "black") return;

    publishing = true;
    try {
      const version = Math.max(Date.now(), latestVersion + 1);
      latestVersion = version;
      latestClock = prepareClockForPublish(state, reason);
      const stateWithClockHistory = {
        ...state,
        positionHistory: addClockToLatestHistory(state, latestClock)
      };
      await writeStateBatch({
        ...sanitizeState(stateWithClockHistory),
        clock: latestClock,
        version,
        updatedBy: session.playerId,
        reason
      }, stateWithClockHistory.positionHistory, reason, version);
      if (state.gameOver || state.gameResult) {
        clearPersistentSession();
        stopPresenceTicker();
      }
      updateClockPanel();
    } catch (error) {
      setStatus("対局情報の送信に失敗しました。通信環境を確認してください。", true);
    } finally {
      publishing = false;
    }
  }

  async function publishTimeout(player, clock) {
    if (!ready || !db || !roomRef || timeoutPublishing || timeoutPublished || !gameApi) return;
    if (clock.timedOut !== player) return;
    const state = gameApi.getState();
    if (state.gameOver || state.gameResult) return;

    timeoutPublishing = true;
    try {
      const loser = player;
      const winner = -player;
      let endedStateForLocal = null;
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(roomRef);
        if (!snapshot.exists) return;

        const room = snapshot.data();
        const gameState = room.gameState;
        if (room.status === "finished" || gameState?.gameOver || gameState?.gameResult) return;

        const baseState = gameState ? restoreState(gameState) : state;
        const endedClock = {
          ...clockAt(gameState?.clock || clock),
          paused: true,
          timedOut: loser,
          updatedAt: Date.now()
        };
        const endedState = {
          ...baseState,
          gameOver: true,
          gameResult: { type: "timeout", loser, winner },
          positionHistory: addClockToLatestHistory(baseState, endedClock)
        };
        endedStateForLocal = endedState;
        const version = Math.max(Date.now(), (Number(gameState?.version) || latestVersion) + 1);
        const statePayload = {
          ...sanitizeState(endedState),
          clock: endedClock,
          version,
          updatedBy: session.playerId,
          reason: "timeout"
        };
        transaction.update(roomRef, {
          status: "finished",
          gameState: statePayload,
          updatedAt: serverTimestamp()
        });
        const newHistoryEntries = collectNewHistoryEntries(endedState.positionHistory, "timeout", version);
        newHistoryEntries.forEach(entry => {
          transaction.set(movesRef.doc(String(entry.index).padStart(3, "0")), {
            index: entry.index,
            reason: entry.reason,
            version: entry.version,
            ...encodeHistoryItem(entry.item),
            createdAt: serverTimestamp()
          });
        });
        if (!newHistoryEntries.length && endedState.positionHistory.length) {
          const lastIndex = endedState.positionHistory.length - 1;
          transaction.set(movesRef.doc(String(lastIndex).padStart(3, "0")), {
            index: lastIndex,
            reason: "timeout",
            version,
            ...encodeHistoryItem(endedState.positionHistory[lastIndex]),
            createdAt: serverTimestamp()
          }, { merge: true });
        }
        latestVersion = version;
        latestClock = endedClock;
      });
      timeoutPublished = true;
      clearPersistentSession();
      stopPresenceTicker();
      publishedHistoryLength = Math.max(publishedHistoryLength, gameApi.getState().positionHistory?.length || 0);
      if (endedStateForLocal) {
        gameApi.applyExternalState(endedStateForLocal);
        updateClockPanel();
      } else {
        gameApi.render();
      }
    } catch (error) {
      setStatus("時間切れ情報の送信に失敗しました。通信環境を確認してください。", true);
    } finally {
      timeoutPublishing = false;
    }
  }

  async function publishDisconnectWin() {
    if (!ready || !db || !roomRef || !gameApi || disconnectPublishing) return;
    disconnectPublishing = true;
    let endedStateForLocal = null;
    try {
      const loser = opponentPlayerValue();
      const winner = playerColorValue();
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(roomRef);
        if (!snapshot.exists) return;

        const room = snapshot.data();
        const gameState = room.gameState;
        if (room.status === "finished" || gameState?.gameOver || gameState?.gameResult || gameState?.clock?.timedOut != null) return;

        const baseState = gameState ? restoreState(gameState) : gameApi.getState();
        const endedClock = {
          ...normalizeClock(gameState?.clock, baseState.turn),
          paused: true,
          updatedAt: Date.now()
        };
        const endedState = {
          ...baseState,
          gameOver: true,
          gameResult: { type: "disconnect", loser, winner },
          positionHistory: addClockToLatestHistory(baseState, endedClock)
        };
        endedStateForLocal = endedState;
        const version = Math.max(Date.now(), (Number(gameState?.version) || 0) + 1);
        const statePayload = {
          ...sanitizeState(endedState),
          clock: endedClock,
          version,
          updatedBy: session.playerId,
          reason: "disconnect"
        };
        transaction.update(roomRef, {
          status: "finished",
          gameState: statePayload,
          updatedAt: serverTimestamp()
        });
        const newHistoryEntries = collectNewHistoryEntries(endedState.positionHistory, "disconnect", version);
        newHistoryEntries.forEach(entry => {
          transaction.set(movesRef.doc(String(entry.index).padStart(3, "0")), {
            index: entry.index,
            reason: entry.reason,
            version: entry.version,
            ...encodeHistoryItem(entry.item),
            createdAt: serverTimestamp()
          });
        });
        if (!newHistoryEntries.length && endedState.positionHistory.length) {
          const lastIndex = endedState.positionHistory.length - 1;
          transaction.set(movesRef.doc(String(lastIndex).padStart(3, "0")), {
            index: lastIndex,
            reason: "disconnect",
            version,
            ...encodeHistoryItem(endedState.positionHistory[lastIndex]),
            createdAt: serverTimestamp()
          }, { merge: true });
        }
      });
      clearPersistentSession();
      stopPresenceTicker();
      publishedHistoryLength = Math.max(publishedHistoryLength, gameApi.getState().positionHistory?.length || 0);
      if (endedStateForLocal) {
        gameApi.applyExternalState(endedStateForLocal);
        updateClockPanel();
      }
    } catch (error) {
      setStatus("接続切れ情報の送信に失敗しました。通信環境を確認してください。", true);
    } finally {
      disconnectPublishing = false;
    }
  }

  function applyRoomSnapshot(snapshot) {
    if (!snapshot.exists || !gameApi) return;
    const room = snapshot.data();
    latestRoomData = room;
    trackPresence(room);
    const gameState = room.gameState;
    updatePlayerNames(room.playerNames || {});

    if (!gameState) {
      setStatus(`${session.roomCode} に接続中です。初期盤面を待っています。`);
      if (session.playerColor === "black") publishState(gameApi.getState(), "start");
      checkOpponentPresence();
      return;
    }

    latestClock = normalizeClock(gameState.clock, gameState.turn);
    updateClockPanel();
    updateOnlineActionButtons(gameState);

    const version = Number(gameState.version) || 0;
    const turnName = gameState.turn === gameApi.constants.B ? "黒" : "白";
    const myTurn = (session.playerColor === "black" && gameState.turn === gameApi.constants.B)
      || (session.playerColor === "white" && gameState.turn === gameApi.constants.W);
    const visibleClock = currentClock();
    const resignedMessage = resultMessage(gameState.gameResult);
    updateDisconnectNotice(null);
    if (resignedMessage) {
      setStatus(`${session.roomCode} に接続中です。${resignedMessage}`);
    } else if (visibleClock.timedOut !== null) {
      setStatus(`${session.roomCode} に接続中です。${playerName(visibleClock.timedOut)}の時間切れです。`);
    } else {
      setStatus(`${session.roomCode} に接続中です。${turnName}番${myTurn ? "（あなたの番）" : "（相手の番）"}`);
    }
    if (gameEnded(gameState)) {
      clearPersistentSession();
      stopPresenceTicker();
    } else {
      checkOpponentPresence();
    }

    const forceTimeoutState = visibleClock.timedOut !== null || gameState.gameResult?.type === "timeout";
    if (forceTimeoutState) {
      const localState = gameApi.getState();
      if (!localState.gameOver || localState.gameResult?.type !== "timeout") {
        gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState));
        updateClockPanel();
      }
      latestVersion = Math.max(latestVersion, version);
      return;
    }

    if (version <= latestVersion) return;
    latestVersion = version;
    if (gameState.updatedBy !== session.playerId || gameState.reason === "disconnect") {
      const reason = gameState.reason || "";
      if (reason === "observe-start" || reason === "final-observe-start") {
        remoteObservationPreviewUntil = Date.now() + 2800;
        if (reason === "final-observe-start") {
          gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), {
            playPlaceSound: true,
            suppressReview: true
          });
        }
        gameApi.playExternalObservationAnimation(reason === "final-observe-start" ? "ラスト\nオープン！" : "オープン！");
        return;
      }
      const animateObservation = reason === "observe" || reason === "final-observe";
      const skipObservationAnimation = animateObservation && Date.now() < remoteObservationPreviewUntil;
      gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), {
        animateObservation: animateObservation && !skipObservationAnimation,
        popObservationOnly: animateObservation && skipObservationAnimation,
        playPlaceSound: reason === "move",
        label: reason === "final-observe" ? "ラスト\nオープン！" : "オープン！"
      });
    }
  }

  function bootFirebase() {
    if (!session) {
      setStatus("オンライン対局の部屋情報がありません。ロビーから入り直してください。", true);
      return;
    }
    if (!window.firebase || !window.OthelloFirebaseConfig) {
      setStatus("オンライン機能の読み込みに失敗しました。通信環境を確認してください。", true);
      return;
    }
    const app = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(window.OthelloFirebaseConfig);
    db = firebase.firestore(app);
    try {
      db.settings({
        experimentalForceLongPolling: true,
        merge: true
      });
    } catch {
      // Firestore settings can only be applied before the first operation.
    }
    roomRef = db.collection("rooms").doc(session.roomCode);
    movesRef = roomRef.collection("moves");
  }

  window.quantumOthelloConfig = {
    mode: "online",
    optionsFrom: "online",
    stateScope: "online",
    getPlayerColor: () => session?.playerColor || "black",
    isClockExpired,
    onStateChange: publishState,
    onRender: updateOnlineResourcePanel
  };

  if (resignButton) resignButton.addEventListener("click", showResignConfirm);
  if (confirmResignButton) confirmResignButton.addEventListener("click", resign);
  if (cancelResignButton) cancelResignButton.addEventListener("click", hideResignConfirm);
  if (resignConfirm) {
    resignConfirm.addEventListener("click", event => {
      if (event.target === resignConfirm) hideResignConfirm();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hideResignConfirm();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPresenceNow();
  });
  window.addEventListener("focus", refreshPresenceNow);
  window.addEventListener("pageshow", refreshPresenceNow);
  if (backToRoomButton) backToRoomButton.addEventListener("click", navigateToRoomScreen);

  document.addEventListener("quantum-othello:ready", event => {
    gameApi = event.detail;
    latestClock = defaultClock(gameApi.getState().turn);
    bootFirebase();
    if (!roomRef) return;
    ready = true;
    updatePlayerNames();
    setStatus(`${session.roomCode} に接続中です。`);
    updateOnlineActionButtons(gameApi.getState());
    startClockTicker();
    startPresenceTicker();
    startMovesListener();
    unsubscribeRoom = roomRef.onSnapshot(applyRoomSnapshot, error => {
      setStatus("部屋情報の更新に失敗しました。通信環境を確認してください。", true);
    });
  });

  window.addEventListener("beforeunload", () => {
    if (clockInterval) clearInterval(clockInterval);
    stopPresenceTicker();
    if (unsubscribeRoom) unsubscribeRoom();
    if (unsubscribeMoves) unsubscribeMoves();
  });
})();






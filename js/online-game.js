(() => {
  const sessionKey = "othelloOnlineSession";
  const matchTimeMs = 5 * 60 * 1000;
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
  let unsubscribeRoom = null;
  let gameApi = null;
  let ready = false;
  let latestVersion = 0;
  let publishing = false;
  let remoteObservationPreviewUntil = 0;
  let latestClock = null;
  let clockInterval = null;
  let timeoutPublishing = false;
  let lastRenderedExpiredPlayer = null;

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

  function updateClockPanel() {
    const clock = currentClock();
    const blackEl = document.querySelector("#onlineBlackClock");
    const whiteEl = document.querySelector("#onlineWhiteClock");
    const noteEl = document.querySelector("#onlineClockNote");
    const blackItem = document.querySelector("[data-clock-player='black']");
    const whiteItem = document.querySelector("[data-clock-player='white']");
    if (blackEl) blackEl.textContent = formatTime(clock.remaining["1"]);
    if (whiteEl) whiteEl.textContent = formatTime(clock.remaining["-1"]);
    if (blackItem) blackItem.classList.toggle("active", clock.active === 1 && !clock.paused && clock.timedOut === null);
    if (whiteItem) whiteItem.classList.toggle("active", clock.active === -1 && !clock.paused && clock.timedOut === null);
    if (noteEl) {
      if (clock.timedOut !== null) {
        noteEl.textContent = `${playerName(clock.timedOut)}の時間切れです。`;
      } else if (clock.paused) {
        noteEl.textContent = "オープン中のため時計停止中";
      } else {
        noteEl.textContent = `${playerName(clock.active)}の時計が進行中`;
      }
    }

    const expiredPlayer = clock.timedOut ?? (clock.remaining[String(clock.active)] <= 0 ? clock.active : null);
    if (expiredPlayer !== lastRenderedExpiredPlayer) {
      lastRenderedExpiredPlayer = expiredPlayer;
      gameApi?.render?.();
    }
    if (expiredPlayer !== null) publishTimeout(expiredPlayer, clock);
  }

  function startClockTicker() {
    if (clockInterval) return;
    updateClockPanel();
    clockInterval = setInterval(updateClockPanel, 250);
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
    if (special100El) special100El.textContent = `${special100}回`;
    if (special0El) special0El.textContent = `${special0}回`;
    if (observeEl) observeEl.textContent = `${observeLeft}回`;
    updateClockPanel();
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
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
      turn: item.turn
    }));
  }

  function decodeHistory(history = []) {
    return history.map(item => ({
      board: decodeNumberGrid(item.board),
      probBoard: decodeNumberGrid(item.probBoard),
      observedBoard: decodeBooleanGrid(item.observedBoard),
      turn: item.turn
    }));
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
      positionHistory: encodeHistory(state.positionHistory),
      gameOver: Boolean(state.gameOver)
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
      positionHistory: decodeHistory(gameState.positionHistory),
      gameOver: Boolean(gameState.gameOver)
    };
  }

  async function publishState(state, reason) {
    if (!ready || !roomRef || publishing) return;
    if (reason === "start" && session.playerColor !== "black") return;

    publishing = true;
    try {
      const version = Math.max(Date.now(), latestVersion + 1);
      latestVersion = version;
      latestClock = prepareClockForPublish(state, reason);
      await roomRef.update({
        gameState: {
          ...sanitizeState(state),
          clock: latestClock,
          version,
          updatedBy: session.playerId,
          reason
        },
        updatedAt: serverTimestamp()
      });
      updateClockPanel();
    } catch (error) {
      setStatus(`同期に失敗しました: ${error.message}`, true);
    } finally {
      publishing = false;
    }
  }

  async function publishTimeout(player, clock) {
    if (!ready || !roomRef || timeoutPublishing || !gameApi) return;
    if (clock.timedOut !== player) return;
    const state = gameApi.getState();
    if (state.gameOver) return;

    timeoutPublishing = true;
    try {
      const version = Math.max(Date.now(), latestVersion + 1);
      latestVersion = version;
      latestClock = { ...clock, paused: true, timedOut: player, updatedAt: Date.now() };
      await roomRef.update({
        "gameState.clock": latestClock,
        "gameState.version": version,
        "gameState.updatedBy": session.playerId,
        "gameState.reason": "timeout",
        updatedAt: serverTimestamp()
      });
      gameApi.render();
    } catch (error) {
      setStatus(`時間切れの同期に失敗しました: ${error.message}`, true);
    } finally {
      timeoutPublishing = false;
    }
  }

  function applyRoomSnapshot(snapshot) {
    if (!snapshot.exists || !gameApi) return;
    const room = snapshot.data();
    const gameState = room.gameState;

    if (!gameState) {
      setStatus(`${session.roomCode} に接続中です。初期盤面を待っています。`);
      if (session.playerColor === "black") publishState(gameApi.getState(), "start");
      return;
    }

    latestClock = normalizeClock(gameState.clock, gameState.turn);
    updateClockPanel();

    const version = Number(gameState.version) || 0;
    const turnName = gameState.turn === gameApi.constants.B ? "黒" : "白";
    const myTurn = (session.playerColor === "black" && gameState.turn === gameApi.constants.B)
      || (session.playerColor === "white" && gameState.turn === gameApi.constants.W);
    const visibleClock = currentClock();
    if (visibleClock.timedOut !== null) {
      setStatus(`${session.roomCode} に接続中です。${playerName(visibleClock.timedOut)}の時間切れです。`);
    } else {
      setStatus(`${session.roomCode} に接続中です。${turnName}番${myTurn ? "（あなたの番）" : "（相手の番）"}`);
    }

    if (version <= latestVersion) return;
    latestVersion = version;
    if (gameState.updatedBy !== session.playerId) {
      const reason = gameState.reason || "";
      if (reason === "observe-start" || reason === "final-observe-start") {
        remoteObservationPreviewUntil = Date.now() + 2600;
        gameApi.playExternalObservationAnimation(reason === "final-observe-start" ? "ラストオープン！" : "オープン！");
        return;
      }
      const animateObservation = reason === "observe" || reason === "final-observe";
      const skipObservationAnimation = animateObservation && Date.now() < remoteObservationPreviewUntil;
      gameApi.applyExternalState(restoreState(gameState), {
        animateObservation: animateObservation && !skipObservationAnimation,
        popObservationOnly: animateObservation && skipObservationAnimation,
        label: reason === "final-observe" ? "ラストオープン！" : "オープン！"
      });
    }
  }

  function bootFirebase() {
    if (!session) {
      setStatus("オンライン対局の部屋情報がありません。ロビーから入り直してください。", true);
      return;
    }
    if (!window.firebase || !window.OthelloFirebaseConfig) {
      setStatus("Firebase SDK の読み込みに失敗しました。", true);
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

  document.addEventListener("quantum-othello:ready", event => {
    gameApi = event.detail;
    latestClock = defaultClock(gameApi.getState().turn);
    bootFirebase();
    if (!roomRef) return;
    ready = true;
    setStatus(`${session.roomCode} に接続中です。`);
    startClockTicker();
    unsubscribeRoom = roomRef.onSnapshot(applyRoomSnapshot, error => {
      setStatus(`部屋の監視に失敗しました: ${error.message}`, true);
    });
  });

  window.addEventListener("beforeunload", () => {
    if (clockInterval) clearInterval(clockInterval);
    if (unsubscribeRoom) unsubscribeRoom();
  });
})();

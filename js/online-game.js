(() => {
  const sessionKey = "othelloOnlineSession";

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

  function setStatus(message, isError = false) {
    const statusEl = document.querySelector("#onlineGameStatus");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
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
      await roomRef.update({
        gameState: {
          ...sanitizeState(state),
          version,
          updatedBy: session.playerId,
          reason
        },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      setStatus(`同期に失敗しました: ${error.message}`, true);
    } finally {
      publishing = false;
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

    const version = Number(gameState.version) || 0;
    const turnName = gameState.turn === gameApi.constants.B ? "黒" : "白";
    const myTurn = (session.playerColor === "black" && gameState.turn === gameApi.constants.B)
      || (session.playerColor === "white" && gameState.turn === gameApi.constants.W);
    setStatus(`${session.roomCode} に接続中です。${turnName}番${myTurn ? "（あなたの番）" : "（相手の番）"}`);

    if (version <= latestVersion) return;
    latestVersion = version;
    if (gameState.updatedBy !== session.playerId) {
      gameApi.applyExternalState(restoreState(gameState));
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
    onStateChange: publishState
  };

  document.addEventListener("quantum-othello:ready", event => {
    gameApi = event.detail;
    bootFirebase();
    if (!roomRef) return;
    ready = true;
    setStatus(`${session.roomCode} に接続中です。`);
    unsubscribeRoom = roomRef.onSnapshot(applyRoomSnapshot, error => {
      setStatus(`部屋の監視に失敗しました: ${error.message}`, true);
    });
  });

  window.addEventListener("beforeunload", () => {
    if (unsubscribeRoom) unsubscribeRoom();
  });
})();

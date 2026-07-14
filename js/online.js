(() => {
  const statusEl = document.querySelector("#onlineStatus");
  const roomCodeEl = document.querySelector("#roomCode");
  const joinCodeEl = document.querySelector("#joinCode");
  const createRoomButton = document.querySelector("#createRoom");
  const joinRoomButton = document.querySelector("#joinRoom");
  const modeSelectButton = document.querySelector("#modeSelectButton");
  const guestIdKey = "catinboxOnlineGuestId";

  let currentUser = null;
  let unsubscribeRoom = null;
  let auth = null;
  let db = null;
  let authFallbackReady = false;

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
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
    return currentUser?.uid || getGuestId();
  }

  function canUseOnline() {
    return Boolean(db && (currentUser || authFallbackReady));
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function watchRoom(roomCode) {
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = db.collection("rooms").doc(roomCode).onSnapshot(snapshot => {
      if (!snapshot.exists) {
        setStatus("部屋が見つかりませんでした。", true);
        return;
      }
      const room = snapshot.data();
      const playerCount = Object.values(room.players || {}).filter(Boolean).length;
      roomCodeEl.textContent = roomCode;
      setStatus(`部屋 ${roomCode} に接続中です。参加人数: ${playerCount}/2`);
    }, error => {
      setStatus(`Firestore の監視に失敗しました: ${error.message}`, true);
    });
  }

  async function createRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン準備中です。数秒待ってからもう一度押してください。");
      return;
    }

    createRoomButton.disabled = true;
    try {
      const playerId = getPlayerId();
      let roomCode = generateRoomCode();
      let roomRef = db.collection("rooms").doc(roomCode);
      while ((await roomRef.get()).exists) {
        roomCode = generateRoomCode();
        roomRef = db.collection("rooms").doc(roomCode);
      }

      await roomRef.set({
        roomCode,
        status: "waiting",
        players: {
          black: playerId,
          white: null
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      watchRoom(roomCode);
    } catch (error) {
      setStatus(`部屋の作成に失敗しました: ${error.message}`, true);
    } finally {
      createRoomButton.disabled = false;
    }
  }

  async function joinRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン準備中です。数秒待ってからもう一度押してください。");
      return;
    }

    const roomCode = joinCodeEl.value.trim().toUpperCase();
    if (!roomCode) {
      setStatus("部屋IDを入力してください。", true);
      return;
    }

    joinRoomButton.disabled = true;
    try {
      const playerId = getPlayerId();
      const roomRef = db.collection("rooms").doc(roomCode);
      const snapshot = await roomRef.get();
      if (!snapshot.exists) {
        setStatus("その部屋IDは見つかりませんでした。", true);
        return;
      }
      const room = snapshot.data();
      const players = room.players || {};
      if (players.black && players.white && players.black !== playerId && players.white !== playerId) {
        setStatus("この部屋はすでに満室です。", true);
        return;
      }

      const nextPlayers = {
        black: players.black || playerId,
        white: players.white || (players.black === playerId ? null : playerId)
      };
      const status = nextPlayers.black && nextPlayers.white ? "playing" : "waiting";
      await roomRef.update({
        players: nextPlayers,
        status,
        updatedAt: serverTimestamp()
      });
      watchRoom(roomCode);
    } catch (error) {
      setStatus(`部屋への参加に失敗しました: ${error.message}`, true);
    } finally {
      joinRoomButton.disabled = false;
    }
  }

  function navigateToModeSelect() {
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      window.parent.postMessage({ type: "othello:navigate", path: "mode-select.html", click: false }, "*");
      return;
    }
    location.href = "mode-select.html";
  }

  function enableAuthFallback() {
    if (currentUser || authFallbackReady) return;
    authFallbackReady = true;
    setStatus("匿名ログインの応答が遅いため、仮IDで部屋作成を試せます。");
  }

  function bootFirebase() {
    setTimeout(enableAuthFallback, 2500);

    try {
      if (!window.firebase || !window.OthelloFirebaseConfig) {
        setStatus("Firebase SDK の読み込みに失敗しました。通信またはキャッシュを確認してください。", true);
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
        if (user) setStatus("オンライン対局の準備ができました。");
      });

      auth.signInAnonymously().catch(error => {
        authFallbackReady = true;
        setStatus(`匿名ログインに失敗しました。仮IDで接続を試します: ${error.message}`, true);
      });
    } catch (error) {
      authFallbackReady = true;
      setStatus(`Firebase 初期化に失敗しました。仮IDで接続を試します: ${error.message}`, true);
    }
  }

  createRoomButton.addEventListener("click", createRoom);
  joinRoomButton.addEventListener("click", joinRoom);
  modeSelectButton.addEventListener("click", navigateToModeSelect);
  joinCodeEl.addEventListener("input", () => {
    joinCodeEl.value = joinCodeEl.value.toUpperCase();
  });

  setStatus("Firebase に接続しています...");
  bootFirebase();
})();

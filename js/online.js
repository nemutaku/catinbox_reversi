(() => {
  const statusEl = document.querySelector("#onlineStatus");
  const roomCodeEl = document.querySelector("#roomCode");
  const joinCodeEl = document.querySelector("#joinCode");
  const nicknameEl = document.querySelector("#nickname");
  const createRoomButton = document.querySelector("#createRoom");
  const joinRoomButton = document.querySelector("#joinRoom");
  const resumeRoomButton = document.querySelector("#resumeRoom");
  const modeSelectButton = document.querySelector("#modeSelectButton");
  const matchPreviewEl = document.querySelector("#matchPreview");
  const matchBlackNameEl = document.querySelector("#matchBlackName");
  const matchWhiteNameEl = document.querySelector("#matchWhiteName");
  const matchYourTurnEl = document.querySelector("#matchYourTurn");
  const guestIdKey = "catinboxOnlineGuestId";
  const nicknameKey = "catinboxOnlineNickname";
  const reservedNicknameKey = "catinboxOnlineReservedNickname";
  const reservedNickname = "眠澤";
  const reservedNicknameCode = "Nemutaku1152";
  const instructorNickname = "フジナッツ健";
  const instructorNicknameCode = "tri_S9";
  const sessionKey = "othelloOnlineSession";
  const persistentSessionKey = "othelloOnlineLastSession";
  const audio = window.OthelloAudio?.createMatchAudioController?.();

  let currentUser = null;
  let unsubscribeRoom = null;
  let auth = null;
  let db = null;
  let authFallbackReady = false;
  let navigatedToGame = false;
  let activePlayerId = null;
  let ownedWaitingRoomCode = "";

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

  function canUseReservedNickname() {
    return localStorage.getItem(reservedNicknameKey) === "true";
  }

  function resolveNickname(value, fallback = "") {
    const inputName = sanitizeNickname(value);
    if (inputName === reservedNicknameCode) {
      localStorage.setItem(reservedNicknameKey, "true");
      return reservedNickname;
    }
    if (inputName === instructorNicknameCode) {
      return instructorNickname;
    }
    if (inputName === reservedNickname && !canUseReservedNickname()) {
      throw userError("このニックネームは使用できません");
    }
    return inputName || fallback;
  }

  function getNickname() {
    const storedName = sanitizeNickname(localStorage.getItem(nicknameKey));
    const savedName = storedName === reservedNickname && !canUseReservedNickname() ? "" : storedName;
    const name = resolveNickname(nicknameEl?.value, savedName) || "ねこさん";
    localStorage.setItem(nicknameKey, name);
    if (nicknameEl) nicknameEl.value = name;
    return name;
  }

  function setNicknameValueFromStorage() {
    if (!nicknameEl) return;
    const savedName = sanitizeNickname(localStorage.getItem(nicknameKey));
    nicknameEl.value = savedName === reservedNickname && !canUseReservedNickname() ? "" : savedName;
  }

  function canUseOnline() {
    return Boolean(db && (currentUser || authFallbackReady));
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

  function playerColorName(color) {
    return color === "black" ? "黒" : "白";
  }

  function playerTitle(name) {
    if (name === reservedNickname) return "作者";
    if (name === instructorNickname) return "公認指導員";
    return "新米ねこ";
  }

  function applyPlayerTitle(element, name) {
    if (!element) return;
    const title = playerTitle(name);
    element.textContent = title;
    element.classList.toggle("creator", title === "作者");
    element.classList.toggle("instructor", title === "公認指導員");
  }

  function showMatchPreview(players, playerNames = {}) {
    const playerId = getPlayerId();
    const playerColor = players.black === playerId ? "black" : "white";
    const blackName = playerNames.black || "黒のねこ";
    const whiteName = playerNames.white || "白のねこ";
    if (matchBlackNameEl) matchBlackNameEl.textContent = blackName;
    if (matchWhiteNameEl) matchWhiteNameEl.textContent = whiteName;
    applyPlayerTitle(document.querySelector("#matchBlackTitle"), blackName);
    applyPlayerTitle(document.querySelector("#matchWhiteTitle"), whiteName);
    if (matchYourTurnEl) matchYourTurnEl.textContent = `あなたは${playerColorName(playerColor)}です。`;
    if (matchPreviewEl) matchPreviewEl.hidden = false;
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

  function watchRoom(roomCode) {
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = db.collection("rooms").doc(roomCode).onSnapshot(snapshot => {
      if (!snapshot.exists) {
        setStatus("部屋が見つかりませんでした。", true);
        return;
      }
      const room = snapshot.data();
      const playerCount = roomPlayerCount(room);
      roomCodeEl.textContent = roomCode;
      if (ownedWaitingRoomCode === roomCode && room.status !== "waiting") {
        ownedWaitingRoomCode = "";
      }
      if (room.status === "matched") {
        showMatchPreview(room.players || {}, room.playerNames || {});
        setStatus("対局相手が見つかりました。まもなく開始します。");
      } else {
        setStatus(`部屋 ${roomCode} に接続中です。参加人数: ${playerCount}/2`);
      }
      if (room.status === "matched" || Object.values(room.players || {}).filter(Boolean).length >= 2) {
        if (ownedWaitingRoomCode === roomCode) ownedWaitingRoomCode = "";
        enterOnlineGame(roomCode, room.players || {}, room.playerNames || {});
      }
    }, error => {
      setStatus("部屋情報の更新に失敗しました。通信環境を確認してください。", true);
    });
  }

  function enterOnlineGame(roomCode, players, playerNames = {}) {
    if (navigatedToGame) return;
    const playerId = getPlayerId();
    const playerColor = players.black === playerId ? "black" : "white";
    navigatedToGame = true;
    showMatchPreview(players, playerNames);
    writeOnlineSession({
      roomCode,
      playerId,
      playerColor,
      playerNames
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
        playerNames: room.playerNames || saved.playerNames || {}
      });
      setStatus("前回の対局へ戻ります。");
      navigate("othello-online.html");
    } catch (error) {
      setStatus("前回の対局情報を確認できませんでした。通信環境を確認してください。", true);
    } finally {
      if (resumeRoomButton) resumeRoomButton.disabled = false;
    }
  }

  async function createRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
      return;
    }

    createRoomButton.disabled = true;
    let roomCreated = false;
    try {
      const playerId = getPlayerId();
      const nickname = getNickname();
      let roomCode = generateRoomCode();
      let roomRef = db.collection("rooms").doc(roomCode);
      while ((await roomRef.get()).exists) {
        roomCode = generateRoomCode();
        roomRef = db.collection("rooms").doc(roomCode);
      }

      await roomRef.set({
        roomCode,
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      roomCreated = true;
      ownedWaitingRoomCode = roomCode;
      roomCodeEl.textContent = roomCode;
      setStatus(`部屋 ${roomCode} を作りました。参加人数: 1/2`);
      watchRoom(roomCode);
    } catch (error) {
      setStatus(error.userMessage || "部屋の作成に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    } finally {
      if (!roomCreated) {
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
    if (!ownedWaitingRoomCode) {
      navigate("mode-select.html");
      return;
    }

    modeSelectButton.disabled = true;
    try {
      const roomCode = ownedWaitingRoomCode;
      const deleted = await deleteOwnedWaitingRoom();
      if (deleted) {
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        navigate("mode-select.html");
        return;
      }

      const snapshot = roomCode ? await db.collection("rooms").doc(roomCode).get() : null;
      if (!snapshot || !snapshot.exists || isFinishedRoom(snapshot.data())) {
        ownedWaitingRoomCode = "";
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        navigate("mode-select.html");
        return;
      }

      const room = snapshot.data();
      const matched = room.status === "matched" || Object.values(room.players || {}).filter(Boolean).length >= 2;
      if (matched) {
        ownedWaitingRoomCode = "";
        enterOnlineGame(roomCode, room.players || {}, room.playerNames || {});
        return;
      }

      modeSelectButton.disabled = false;
      setStatus("部屋の状態が変わったため、モード選択へ戻れませんでした。もう一度お試しください。", true);
    } catch (error) {
      modeSelectButton.disabled = false;
      setStatus("待機中の部屋を削除できませんでした。通信環境を確認して、もう一度お試しください。", true);
    }
  }

  async function joinRoom() {
    if (!canUseOnline()) {
      setStatus("オンライン接続を準備しています。少し待ってからもう一度お試しください。");
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
      const nickname = getNickname();
      const roomRef = db.collection("rooms").doc(roomCode);
      let nextPlayers = null;
      let nextPlayerNames = null;
      let nextStatus = "waiting";

      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(roomRef);
        if (!snapshot.exists) throw userError("その部屋IDは見つかりませんでした。");

        const room = snapshot.data();
        const players = room.players || {};
        if (isFinishedRoom(room)) throw userError("その部屋IDは見つかりませんでした。");
        if (players.black && players.white && players.black !== playerId && players.white !== playerId) {
          throw userError("この部屋はすでに満室です。");
        }

        const hostId = room.host || players.black;
        if (!hostId) throw userError("この部屋の情報が壊れています。別の部屋IDを使ってください。");
        if (hostId === playerId) throw userError("自分で作った部屋には参加できません。相手に部屋IDを伝えてください。");

        nextPlayers = players.black && players.white
          ? players
          : randomizePlayers(hostId, playerId);
        const mySlot = nextPlayers.black === playerId ? "black" : "white";
        const hostSlot = nextPlayers.black === hostId ? "black" : "white";
        const hostName = room.playerNames?.host
          || (players.black === hostId ? room.playerNames?.black : room.playerNames?.white)
          || "ねこさん";
        nextPlayerNames = {
          host: hostName,
          guest: nickname,
          [hostSlot]: hostName,
          [mySlot]: nickname
        };
        nextStatus = nextPlayers.black && nextPlayers.white ? "matched" : "waiting";
        transaction.update(roomRef, {
          guest: playerId,
          players: nextPlayers,
          playerNames: nextPlayerNames,
          status: nextStatus,
          updatedAt: serverTimestamp()
        });
      });
      if (nextStatus === "matched") {
        enterOnlineGame(roomCode, nextPlayers, nextPlayerNames);
      }
      watchRoom(roomCode);
    } catch (error) {
      setStatus(error.userMessage || "部屋への参加に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    } finally {
      joinRoomButton.disabled = false;
    }
  }

  function enableAuthFallback() {
    if (currentUser || authFallbackReady) return;
    authFallbackReady = true;
    setStatus("接続確認に時間がかかっています。少し待ってからもう一度お試しください。");
  }

  function bootFirebase() {
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
        if (user) setStatus("オンライン対局の準備ができました。");
      });

      auth.signInAnonymously().catch(error => {
        authFallbackReady = true;
        setStatus("オンライン接続に失敗しました。通信環境を確認して、もう一度お試しください。", true);
      });
    } catch (error) {
      authFallbackReady = true;
      setStatus("オンライン機能の準備に失敗しました。ページを再読み込みして、もう一度お試しください。", true);
    }
  }

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

  createRoomButton.addEventListener("click", createRoom);
  joinRoomButton.addEventListener("click", joinRoom);
  if (resumeRoomButton) resumeRoomButton.addEventListener("click", resumePreviousRoom);
  modeSelectButton.addEventListener("click", returnToModeSelect);
  document.addEventListener("click", event => {
    if (event.target.closest("button")) playClickSe();
  });
  joinCodeEl.addEventListener("input", () => {
    joinCodeEl.value = joinCodeEl.value.toUpperCase();
  });

  setStatus("オンラインに接続しています...");
  updateResumeButton();
  bootFirebase();
})();





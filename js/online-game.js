(() => {
  const sessionKey = "othelloOnlineSession";
  const persistentSessionKey = "othelloOnlineLastSession";
  const matchHistoryKey = "catinboxMatchHistory";
  const defaultMatchTimeMs = 5 * 60 * 1000;
  const presenceHealthyIntervalMs = 30 * 1000;
  const presenceRetryIntervalMs = 10 * 1000;
  const presenceWarningMs = presenceHealthyIntervalMs;
  const presenceTimeoutMs = 60 * 1000;
  const clockTickIntervalMs = 250;
  const clockDisplayGraceMs = 300;
  const clockPlayers = [1, -1];

  function readSession() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    } catch {
      return null;
    }
  }

  const session = readSession();
  function normalizeMatchTimeMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return defaultMatchTimeMs;
    return Math.min(20 * 60 * 1000, Math.max(30 * 1000, Math.round(number)));
  }
  const matchTimeMs = normalizeMatchTimeMs(session?.matchRules?.matchTimeMs ?? Number(session?.matchRules?.matchTimeSeconds) * 1000);
  const isReviewSession = () => session?.reviewReturnPath === "mypage.html";
  let reviewScreenRevealed = false;
  let reviewScreenReadyNotified = false;
  if (isReviewSession()) {
    document.documentElement.classList.add("review-loading");
    const reviewLoadingStyle = document.createElement("style");
    reviewLoadingStyle.textContent = [
      "html.review-loading body{background:#050806!important;}",
      "html.review-loading body>*{visibility:hidden!important;}",
      "html.review-revealing body::before{content:\"\";position:fixed;inset:0;z-index:9999;background:#050806;pointer-events:none;animation:reviewFadeIn .9s ease-in-out forwards;}",
      "@keyframes reviewFadeIn{from{opacity:1}to{opacity:0}}"
    ].join("");
    document.head.appendChild(reviewLoadingStyle);
  }
  function notifyReviewScreenReady() {
    if (!isReviewSession() || reviewScreenReadyNotified) return;
    reviewScreenReadyNotified = true;
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      window.parent.postMessage({ type: "othello:screen-ready", path: "othello-online.html" }, "*");
    }
  }
  function revealReviewScreen() {
    if (!isReviewSession() || reviewScreenRevealed) return;
    reviewScreenRevealed = true;
    document.documentElement.classList.remove("review-loading");
    document.documentElement.classList.add("review-revealing");
    notifyReviewScreenReady();
    window.setTimeout(() => {
      document.documentElement.classList.remove("review-revealing");
    }, 950);
  }
  let db = null;
  let roomRef = null;
  let movesRef = null;
  let unsubscribeRoom = null;
  let unsubscribeMoves = null;
  let gameApi = null;
  let ready = false;
  let latestVersion = 0;
  let publishing = false;
  let pendingPublish = null;
  let remoteObservationPreviewUntil = 0;
  let remoteObservationLabelUntil = 0;
  let delayedObservationTimer = null;
  let latestClock = null;
  let clockInterval = null;
  let presenceInterval = null;
  let presenceIntervalDelay = presenceHealthyIntervalMs;
  let presenceStartedAt = Date.now();
  const presenceLastSeenAt = { black: 0, white: 0 };
  const presenceVersionKeys = { black: "", white: "" };
  let latestRoomData = null;
  let latestPawPointRecord = null;
  let pawPointDialogTimer = null;
  let timeoutPublishing = false;
  let timeoutPublished = false;
  let disconnectPublishing = false;
  let lastRenderedExpiredPlayer = null;
  let remoteHistory = [];
  let movesListenerReady = false;
  let publishedHistoryLength = 0;
  const publishedHistoryIndexes = new Set();
  let serverClockAnchorMs = null;
  let localClockAnchorMs = null;
  let savedMatchHistoryKey = "";
  let titleCatalog = [];
  const resignButton = document.querySelector("#onlineResign");
  const pawPointResultButton = document.querySelector("#pawPointResultButton");
  const backToRoomButton = document.querySelector("#onlineBackToRoom");
  const resignConfirm = document.querySelector("#resignConfirm");
  const confirmResignButton = document.querySelector("#confirmResign");
  const cancelResignButton = document.querySelector("#cancelResign");
  const opponentClockSlot = document.querySelector("#onlineOpponentClockSlot");
  const playerClockSlot = document.querySelector("#onlinePlayerClockSlot");
  const blackClockItem = document.querySelector('[data-clock-player="black"]');
  const whiteClockItem = document.querySelector('[data-clock-player="white"]');
  const blackScoreItem = document.querySelector(".black-score");
  const whiteScoreItem = document.querySelector(".white-score");

  function prepareClockScoreBox(clockItem, scoreItem) {
    if (!clockItem || !scoreItem) return;
    scoreItem.classList.add("clock-score-box");
    scoreItem.querySelector(".clock-score-color")?.remove();
    const pieceBox = clockItem.querySelector(".clock-piece-box");
    const icons = scoreItem.querySelector(".score-icons");
    const movedIcons = pieceBox?.querySelector(".score-icons");
    const scoreValue = scoreItem.querySelector("b");
    if (!icons && movedIcons) {
      if (scoreValue) scoreItem.insertBefore(movedIcons, scoreValue);
      else scoreItem.appendChild(movedIcons);
    }
    pieceBox?.remove();
  }

  function prepareInlineClockItem(clockItem, scoreItem) {
    if (!clockItem) return;
    prepareClockScoreBox(clockItem, scoreItem);
    if (clockItem.querySelector(".clock-time-box")) {
      if (scoreItem && scoreItem.parentElement !== clockItem) clockItem.appendChild(scoreItem);
      return;
    }
    const colorLabel = clockItem.querySelector("span");
    const title = clockItem.querySelector(".player-title-badge");
    const name = clockItem.querySelector(".online-player-name");
    const time = clockItem.querySelector("b");
    const disconnect = clockItem.querySelector(".disconnect-notice");
    const identityBox = document.createElement("div");
    const timeBox = document.createElement("div");
    identityBox.className = "clock-identity-box";
    timeBox.className = "clock-time-box";
    if (title) identityBox.appendChild(title);
    if (name) identityBox.appendChild(name);
    if (time) timeBox.appendChild(time);
    clockItem.replaceChildren();
    if (colorLabel) clockItem.appendChild(colorLabel);
    clockItem.appendChild(timeBox);
    clockItem.appendChild(identityBox);
    if (scoreItem) clockItem.appendChild(scoreItem);
    if (disconnect) clockItem.appendChild(disconnect);
  }

  function arrangeClockItems() {
    if (!opponentClockSlot || !playerClockSlot || !blackClockItem || !whiteClockItem) return;
    prepareInlineClockItem(blackClockItem, blackScoreItem);
    prepareInlineClockItem(whiteClockItem, whiteScoreItem);
    const playerItem = session?.playerColor === "white" ? whiteClockItem : blackClockItem;
    const opponentItem = playerItem === blackClockItem ? whiteClockItem : blackClockItem;
    opponentClockSlot.appendChild(opponentItem);
    playerClockSlot.appendChild(playerItem);
  }

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

  function normalizePlayerTitle(value) {
    return String(value || "新米ねこ").trim().slice(0, 16) || "新米ねこ";
  }

  function titleByName(title) {
    const normalized = String(title || "").trim();
    return titleCatalog.find(item => item.name === normalized) || null;
  }

  function applyTitleRarityBackground(element, title) {
    if (!element) return;
    const matchedTitle = titleByName(title);
    if (!matchedTitle) {
      element.classList.remove("title-rarity-bg");
      delete element.dataset.rarity;
      return;
    }
    const rarity = window.CatProfile?.normalizeTitleRarity
      ? window.CatProfile.normalizeTitleRarity(matchedTitle.rarity, matchedTitle.type)
      : matchedTitle.rarity ?? (matchedTitle.type === "special" ? 0 : 1);
    element.dataset.rarity = String(rarity);
    element.classList.add("title-rarity-bg");
  }

  function normalizeWinRates(source) {
    if (!source || typeof source !== "object") return null;
    const black = Number(source.black);
    const white = Number(source.white);
    const draw = Number(source.draw);
    if (![black, white, draw].every(Number.isFinite)) return null;
    return { black, white, draw };
  }

  function titleForColor(colorKey) {
    const titles = latestRoomData?.playerTitles || session?.playerTitles || {};
    return normalizePlayerTitle(titles[colorKey]);
  }

  function applyPlayerTitle(elementId, colorKey) {
    const titleEl = document.querySelector(elementId);
    if (!titleEl) return;
    const title = titleForColor(colorKey);
    titleEl.textContent = title;
    applyTitleRarityBackground(titleEl, title);
  }

  function updatePlayerNames(playerNames = session?.playerNames || {}) {
    const blackName = sanitizeName(playerNames.black, "黒のねこ");
    const whiteName = sanitizeName(playerNames.white, "白のねこ");
    const blackEl = document.querySelector("#onlineBlackName");
    const whiteEl = document.querySelector("#onlineWhiteName");
    if (blackEl) blackEl.textContent = blackName;
    if (whiteEl) whiteEl.textContent = whiteName;
    applyPlayerTitle("#onlineBlackTitle", "black");
    applyPlayerTitle("#onlineWhiteTitle", "white");
    if (session) session.playerNames = { black: blackName, white: whiteName };
    if (session) session.playerTitles = {
      black: titleForColor("black"),
      white: titleForColor("white")
    };
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

  function readLocalMatchHistory() {
    try {
      const history = JSON.parse(localStorage.getItem(matchHistoryKey) || "[]");
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  function saveLocalMatchHistory(record) {
    const nextHistory = [
      record,
      ...readLocalMatchHistory().filter(item => item?.roomCode !== record.roomCode)
    ].slice(0, 20);
    localStorage.setItem(matchHistoryKey, JSON.stringify(nextHistory));
  }

  function countBoardCats(board = []) {
    let black = 0;
    let white = 0;
    board.forEach(row => row.forEach(value => {
      if (value === 1) black += 1;
      if (value === -1) white += 1;
    }));
    return { black, white };
  }

  function resultSummary(gameState, counts) {
    const result = gameState?.gameResult;
    const winner = result?.winner ?? (counts.black > counts.white ? 1 : counts.white > counts.black ? -1 : 0);
    if (!winner) return "引き分け";
    if (result?.type === "resign") return `${playerName(winner)}の勝ち(投了)`;
    if (result?.type === "disconnect") return `${playerName(winner)}の勝ち(接続切れ)`;
    if (result?.type === "timeout") return `${playerName(winner)}の勝ち(時間切れ)`;
    return `${playerName(winner)}の勝ち(${Math.abs(counts.black - counts.white)}ねこ差)`;
  }

  function formatSignedPoint(value) {
    const point = Math.trunc(Number(value) || 0);
    return point > 0 ? `+${point}` : String(point);
  }

  function ensurePawPointDialog() {
    let dialog = document.querySelector("#pawPointDialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "pawPointDialog";
    dialog.className = "win-rate-dialog";
    dialog.hidden = true;
    dialog.innerHTML = `
      <section class="win-rate-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="pawPointDialogTitle">
        <h2 id="pawPointDialogTitle">肉球ポイント</h2>
        <div class="win-rate-dialog-body" id="pawPointDialogBody"></div>
        <button id="pawPointDialogClose" class="action secondary" type="button">閉じる</button>
      </section>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector("#pawPointDialogClose")?.addEventListener("click", hidePawPointDialog);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) hidePawPointDialog();
    });
    return dialog;
  }

  function showPawPointDialog(record = latestPawPointRecord) {
    const pawPoints = record?.pawPoints || window.CatProfile?.calculatePawPoints?.(record);
    if (!record || !pawPoints || record.matchType !== "random") return;
    const dialog = ensurePawPointDialog();
    const body = dialog.querySelector("#pawPointDialogBody");
    const detailItems = pawPoints.breakdown.map(item => {
      const valueText = item.kind === "multiply" ? `×${item.value}` : formatSignedPoint(item.value);
      return `<li><span>${item.label}</span><b>${valueText}</b></li>`;
    }).join("");
    const totalText = formatSignedPoint(pawPoints.total);
    body.innerHTML = `
      <p class="paw-point-total"><strong>${totalText}P</strong> 変動しました。</p>
      <ul class="paw-point-list">${detailItems}</ul>
    `;
    dialog.hidden = false;
    dialog.querySelector("#pawPointDialogClose")?.focus();
  }

  function hidePawPointDialog() {
    const dialog = document.querySelector("#pawPointDialog");
    if (dialog) dialog.hidden = true;
  }

  function schedulePawPointDialogAfterResult(record) {
    if (pawPointDialogTimer) window.clearTimeout(pawPointDialogTimer);
    const startedAt = Date.now();
    const waitForResult = () => {
      const result = document.querySelector("#gameResult");
      const resultVisible = result && !result.hidden && result.textContent.trim();
      if (resultVisible) {
        pawPointDialogTimer = window.setTimeout(() => {
          pawPointDialogTimer = null;
          showPawPointDialog(record);
        }, 500);
        return;
      }
      if (Date.now() - startedAt >= 2000) {
        pawPointDialogTimer = null;
        showPawPointDialog(record);
        return;
      }
      pawPointDialogTimer = window.setTimeout(waitForResult, 50);
    };
    pawPointDialogTimer = window.setTimeout(waitForResult, 0);
  }

  function renderPawPointResult(record) {
    const button = document.querySelector("#pawPointResultButton");
    if (!button) return;
    const pawPoints = window.CatProfile?.calculatePawPoints?.(record);
    if (!pawPoints || record.matchType !== "random") {
      latestPawPointRecord = null;
      if (pawPointDialogTimer) {
        window.clearTimeout(pawPointDialogTimer);
        pawPointDialogTimer = null;
      }
      button.hidden = true;
      return;
    }
    latestPawPointRecord = { ...record, pawPoints };
    button.hidden = false;
    button.textContent = "肉球ポイントを確認する";
    schedulePawPointDialogAfterResult(latestPawPointRecord);
  }

  async function saveMatchHistory(gameState) {
    if (!gameState?.gameOver && !gameState?.gameResult) return;
    if (!session?.roomCode || !session?.playerId || !session?.playerColor) return;
    const key = `${session.roomCode}:${gameState.version || 0}:${gameState.gameResult?.type || "score"}`;
    if (savedMatchHistoryKey === key) return;

    const board = decodeNumberGrid(gameState.board || []);
    const counts = countBoardCats(board);
    const playerNames = latestRoomData?.playerNames || session.playerNames || {};
    const playerTitles = latestRoomData?.playerTitles || session.playerTitles || {};
    const finishedAtMs = Date.now();
    const startedAtSource = isUsableDateSource(latestRoomData?.startedAt)
      ? latestRoomData.startedAt
      : latestRoomData?.createdAt || finishedAtMs;
    const record = {
      roomCode: session.roomCode,
      matchType: latestRoomData?.matchType || session.matchType || "friend",
      playerId: session.playerId,
      playerColor: session.playerColor,
      playerNames,
      playerTitles,
      startedAt: formatDateTimeText(startedAtSource, finishedAtMs),
      finishedAt: formatDateTimeText(finishedAtMs),
      playedAt: finishedAtMs,
      result: resultSummary(gameState, counts),
      gameResult: gameState.gameResult || null,
      counts,
      lastOpenWinRates: normalizeWinRates(gameState.lastOpenWinRates),
      rules: gameState.rules || latestRoomData?.matchRules || session.matchRules || null,
      specialUsed: gameState.specialUsed || null,
      observeUsesLeft: gameState.observeUsesLeft || null,
      version: Number(gameState.version) || 0
    };
    record.pawPoints = window.CatProfile?.calculatePawPoints?.(record) || null;
    renderPawPointResult(record);

    try {
      if (window.CatProfile?.saveMatchHistory) {
        await window.CatProfile.saveMatchHistory(record);
      } else {
        saveLocalMatchHistory(record);
      }
      savedMatchHistoryKey = key;
    } catch (error) {
      console.warn("Match history save failed.", error);
      saveLocalMatchHistory(record);
    }
  }

  function gameEnded(gameState = null) {
    const clock = currentClock();
    return Boolean(gameState?.gameOver || gameState?.gameResult || gameApi?.getState?.().gameOver || clock.timedOut !== null);
  }

  function isFinalObservePreview(gameState = null) {
    return gameState?.reason === "final-observe-start";
  }

  function isConfirmedEndedState(gameState = null) {
    if (!gameEnded(gameState) || isFinalObservePreview(gameState)) return false;
    const reason = gameState?.reason || "";
    const resultType = gameState?.gameResult?.type || "";
    return reason === "final-observe"
      || reason === "game-over"
      || reason === "disconnect"
      || resultType === "resign"
      || resultType === "disconnect"
      || resultType === "timeout";
  }

  function updateOnlineActionButtons(gameState = null) {
    if (isReviewSession()) {
      if (resignButton) resignButton.hidden = true;
      if (backToRoomButton) backToRoomButton.hidden = false;
      return;
    }
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
    if (!session?.reviewReturnPath) localStorage.removeItem(persistentSessionKey);
    const returnPath = session?.reviewReturnPath === "mypage.html" ? "mypage.html" : "online-select.html";
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      window.parent.postMessage({ type: "othello:navigate", path: returnPath, click: false }, "*");
      return;
    }
    location.href = returnPath;
  }

  function resign() {
    if (!gameApi || gameApi.getState().gameOver) return;
    hideResignConfirm();
    clearPersistentSession();
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

  function localMonotonicNow() {
    return window.performance?.now ? window.performance.now() : Date.now();
  }

  function timestampToMs(value, fallback = null) {
    if (value == null) return fallback;
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && Number.isFinite(Number(value.seconds))) {
      return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
    if (Number.isFinite(Number(value))) return Number(value);
    return fallback;
  }

  function formatDateTimeText(value, fallback = Date.now()) {
    if (typeof value === "string" && value.includes("年")) {
      const year = Number(value.match(/^(\d{4})年/)?.[1]);
      if (!Number.isFinite(year) || year >= 2026) return value;
      value = fallback;
    }
    const date = new Date(timestampToMs(value, fallback));
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}年${month}月${day}日 ${hour}：${minute}`;
  }

  function isUsableDateSource(value) {
    if (value == null) return false;
    if (typeof value !== "string" || !value.includes("年")) return true;
    const year = Number(value.match(/^(\d{4})年/)?.[1]);
    return !Number.isFinite(year) || year >= 2026;
  }

  function rememberServerClock(timestamp) {
    const serverMs = timestampToMs(timestamp);
    if (serverMs === null) return false;
    serverClockAnchorMs = serverMs;
    localClockAnchorMs = localMonotonicNow();
    return true;
  }

  function serverTimeToLocalMonotonic(serverMs) {
    if (serverMs === null || serverMs === undefined) return null;
    if (serverClockAnchorMs === null || localClockAnchorMs === null) return null;
    return localClockAnchorMs + (serverMs - serverClockAnchorMs);
  }

  function clockNow() {
    return localMonotonicNow();
  }

  function clockBaseTime(clock, fallback) {
    const serverMs = timestampToMs(clock?.serverUpdatedAt);
    const localServerTime = serverTimeToLocalMonotonic(serverMs);
    if (localServerTime !== null) return localServerTime;

    const updatedMs = timestampToMs(clock?.updatedAt);
    if (updatedMs !== null) {
      return clock?._displayClock ? updatedMs : fallback;
    }
    return fallback;
  }

  function defaultClock(turn = -1) {
    return {
      remaining: { "-1": matchTimeMs, "1": matchTimeMs },
      active: turn,
      updatedAt: clockNow(),
      serverUpdatedAt: null,
      _displayClock: true,
      paused: false,
      timedOut: null
    };
  }

  function normalizeClock(clock, turn = -1, now = clockNow()) {
    const source = clock || {};
    const remaining = {};
    clockPlayers.forEach(player => {
      const value = Number(source.remaining?.[player] ?? source.remaining?.[String(player)]);
      remaining[String(player)] = Number.isFinite(value) ? Math.max(0, value) : matchTimeMs;
    });
    return {
      remaining,
      active: clockPlayers.includes(Number(source.active)) ? Number(source.active) : turn,
      updatedAt: clockBaseTime(source, now),
      serverUpdatedAt: source.serverUpdatedAt || null,
      _displayClock: Boolean(source._displayClock),
      paused: Boolean(source.paused),
      timedOut: clockPlayers.includes(Number(source.timedOut)) ? Number(source.timedOut) : null
    };
  }

  function clockAt(clock, now = clockNow()) {
    const normalized = normalizeClock(clock, -1, now);
    if (!normalized.paused && normalized.timedOut === null && clockPlayers.includes(normalized.active)) {
      const elapsed = Math.max(0, now - normalized.updatedAt - clockDisplayGraceMs);
      const key = String(normalized.active);
      normalized.remaining[key] = Math.max(0, normalized.remaining[key] - elapsed);
      normalized.updatedAt = now;
      normalized.serverUpdatedAt = null;
      normalized._displayClock = true;
      if (normalized.remaining[key] <= 0) normalized.timedOut = normalized.active;
    }
    return normalized;
  }

  function adoptClockForDisplay(clock, turn = -1, now = clockNow()) {
    const adopted = normalizeClock(clock, turn, now);
    const baseTime = clockBaseTime(clock || {}, now);
    if (!adopted.paused && adopted.timedOut === null && clockPlayers.includes(adopted.active)) {
      const elapsed = Math.max(0, now - baseTime - clockDisplayGraceMs);
      const key = String(adopted.active);
      adopted.remaining[key] = Math.max(0, adopted.remaining[key] - elapsed);
      if (adopted.remaining[key] <= 0) adopted.timedOut = adopted.active;
    }
    adopted.updatedAt = now;
    adopted.serverUpdatedAt = null;
    adopted._displayClock = true;
    return adopted;
  }

  function prepareClockForPublish(state, reason, now = clockNow()) {
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
    current.serverUpdatedAt = null;
    return current;
  }

  function currentClock() {
    return clockAt(latestClock || defaultClock(gameApi?.getState?.().turn ?? -1));
  }

  function isClockExpired(player) {
    if (isReviewSession()) return false;
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

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeMatchRules(source = {}) {
    const specialProbabilities = source?.specialProbabilities || {};
    const specialUseLimits = source?.specialUseLimits || {};
    return {
      normalProbability: clampInteger(source?.normalProbability, 0, 100, 80),
      specialProbabilities: {
        0: clampInteger(specialProbabilities[0] ?? specialProbabilities["0"] ?? source?.special0Probability, 0, 100, 0),
        100: clampInteger(specialProbabilities[100] ?? specialProbabilities["100"] ?? source?.special100Probability, 0, 100, 100)
      },
      specialUseLimits: {
        0: clampInteger(specialUseLimits[0] ?? specialUseLimits["0"] ?? source?.special0Uses, 0, 50, 2),
        100: clampInteger(specialUseLimits[100] ?? specialUseLimits["100"] ?? source?.special100Uses, 0, 50, 2)
      },
      observeUseLimit: clampInteger(source?.observeUseLimit ?? source?.observeUses, 0, 50, 2),
      initialSetup: source?.initialSetup || null
    };
  }

  function updateOnlineResourcePanel(state) {
    if (!state) return;
    const opponent = -playerColorValue();
    const rules = normalizeMatchRules(state.rules || latestRoomData?.matchRules || session?.matchRules);
    const specialUsed = state.specialUsed?.[opponent] || {};
    const special100 = Math.max(0, rules.specialUseLimits[100] - Number(specialUsed[100] || 0));
    const special0 = Math.max(0, rules.specialUseLimits[0] - Number(specialUsed[0] || 0));
    const observeLeft = state.observeUsesLeft?.[opponent] ?? 0;
    const special100El = document.querySelector("#onlineOpponentSpecial100");
    const special0El = document.querySelector("#onlineOpponentSpecial0");
    const observeEl = document.querySelector("#onlineOpponentObserveLeft");
    const special100Label = special100El?.closest(".resource-item")?.querySelector("span");
    const special0Label = special0El?.closest(".resource-item")?.querySelector("span");
    if (special100Label) special100Label.textContent = `あいて ${rules.specialProbabilities[100]}%はこ`;
    if (special0Label) special0Label.textContent = `あいて ${rules.specialProbabilities[0]}%はこ`;
    if (special100El) special100El.textContent = `あと${special100}回`;
    if (special0El) special0El.textContent = `あと${special0}回`;
    if (observeEl) observeEl.textContent = `あと${observeLeft}回`;
    updateClockPanel();
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function clockForFirestore(clock) {
    const { _displayClock, ...clockPayload } = clock || {};
    return {
      ...clockPayload,
      updatedAt: Date.now(),
      serverUpdatedAt: serverTimestamp()
    };
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

  function decodeStringGrid(rows = []) {
    return rows.map(row => String(row).split(",").map(value => value || ""));
  }

  function decodeBooleanGrid(rows = []) {
    return rows.map(row => String(row).split(",").map(value => value === "true" || value === "1"));
  }

  function observedBoardForState(gameState, board) {
    const observed = decodeBooleanGrid(gameState?.observedBoard || []);
    if (gameState?.reason !== "final-observe") return observed;
    return board.map((row, r) => row.map((cell, c) => cell !== 0 || Boolean(observed[r]?.[c])));
  }

  function clockForHistory(clock) {
    if (!clock) return null;
    const { _displayClock, ...clockPayload } = clock;
    return clockPayload;
  }

  function encodeHistory(history = []) {
    return history.map(item => ({
      board: encodeGrid(item.board),
      probBoard: encodeGrid(item.probBoard),
      probLabelBoard: encodeGrid(item.probLabelBoard || []),
      observedBoard: encodeGrid(item.observedBoard.map(row => row.map(value => value ? 1 : 0))),
      turn: item.turn,
      clock: clockForHistory(item.clock)
    }));
  }

  function encodeHistoryItem(item) {
    return encodeHistory([item])[0];
  }

  function decodeHistory(history = []) {
    return history.map(item => ({
      board: decodeNumberGrid(item.board),
      probBoard: decodeNumberGrid(item.probBoard),
      probLabelBoard: decodeStringGrid(item.probLabelBoard || []),
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

  function gridsMatch(left = [], right = []) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((row, r) => (
      Array.isArray(row)
      && Array.isArray(right[r])
      && row.length === right[r].length
      && row.every((value, c) => value === right[r][c])
    ));
  }

  function historyItemsMatch(left, right) {
    return Boolean(left && right
      && gridsMatch(left.board, right.board)
      && gridsMatch(left.probBoard, right.probBoard)
      && gridsMatch(left.probLabelBoard || [], right.probLabelBoard || [])
      && gridsMatch(left.observedBoard || [], right.observedBoard || [])
      && left.turn === right.turn);
  }

  function compactHistoryForReview(history = []) {
    const compacted = [];
    history.forEach(item => {
      if (!item || !Array.isArray(item.board)) return;
      const previous = compacted[compacted.length - 1];
      if (historyItemsMatch(previous, item)) {
        compacted[compacted.length - 1] = { ...previous, clock: item.clock || previous.clock || null };
        return;
      }
      compacted.push(item);
    });
    return compacted;
  }

  function finalHistoryItemFromState(gameState) {
    if (!gameState || (gameState.reason !== "final-observe" && gameState.reason !== "game-over")) return null;
    const board = decodeNumberGrid(gameState.board);
    return {
      board,
      probBoard: decodeNumberGrid(gameState.probBoard),
      probLabelBoard: decodeStringGrid(gameState.probLabelBoard || []),
      observedBoard: observedBoardForState(gameState, board),
      turn: gameState.turn,
      clock: clockForHistory(clockAt(gameState.clock))
    };
  }

  function normalizeHistoryForState(history, gameState) {
    const normalized = compactHistoryForReview(history);
    const finalItem = finalHistoryItemFromState(gameState);
    if (!finalItem) return normalized;

    const lastIndex = normalized.length - 1;
    if (lastIndex < 0) return [finalItem];
    if (historyItemsMatch(normalized[lastIndex], finalItem)) {
      normalized[lastIndex] = { ...normalized[lastIndex], clock: finalItem.clock || normalized[lastIndex].clock || null };
    } else {
      normalized.push(finalItem);
    }
    return normalized;
  }

  function hasCompleteRemoteHistory(gameState) {
    const expectedLength = Number(gameState?.historyLength || 0);
    if (!expectedLength) return false;
    if (remoteHistory.length < expectedLength) return false;
    const indexes = new Set(
      remoteHistory
        .map(item => Number(item.index))
        .filter(index => Number.isInteger(index))
    );
    for (let index = 0; index < expectedLength; index++) {
      if (!indexes.has(index)) return false;
    }
    return true;
  }

  function expectedHistoryLength(gameState) {
    return Number(gameState?.historyLength || 0);
  }

  function missingRemoteHistoryIndexes(gameState) {
    const expectedLength = expectedHistoryLength(gameState);
    if (!expectedLength) return [];
    const indexes = new Set(
      remoteHistory
        .map(item => Number(item.index))
        .filter(index => Number.isInteger(index))
    );
    const missing = [];
    for (let index = 0; index < expectedLength; index++) {
      if (!indexes.has(index)) missing.push(index);
    }
    return missing;
  }

  function hasIncompleteRemoteHistory(gameState) {
    return expectedHistoryLength(gameState) > 0 && missingRemoteHistoryIndexes(gameState).length > 0;
  }

  function showIncompleteHistoryWarning(gameState) {
    if (!isReviewSession() || !hasIncompleteRemoteHistory(gameState)) return;
    setStatus("棋譜が一部保存されていません。保存済みの範囲で表示しています。", true);
  }

  function historyForState(gameState) {
    showIncompleteHistoryWarning(gameState);
    const expectedLength = expectedHistoryLength(gameState);
    const fallbackHistory = decodeHistory(gameState?.positionHistory || []);
    let history = fallbackHistory;
    if (hasCompleteRemoteHistory(gameState)) {
      history = sortedRemoteHistory();
    } else if (expectedLength && fallbackHistory.length >= expectedLength) {
      history = fallbackHistory;
    } else if (isReviewSession() && remoteHistory.length) {
      history = sortedRemoteHistory();
    }
    return normalizeHistoryForState(history, gameState);
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
      probLabelBoard: encodeGrid(state.probLabelBoard || []),
      observedBoard: encodeGrid(state.observedBoard.map(row => row.map(value => value ? 1 : 0))),
      turn: state.turn,
      lastMove: state.lastMove || null,
      specialUsed: state.specialUsed,
      observeUsesLeft: state.observeUsesLeft,
      historyLength: Array.isArray(state.positionHistory) ? state.positionHistory.length : 0,
      gameOver: Boolean(state.gameOver),
      gameResult: state.gameResult || null,
      lastOpenWinRates: normalizeWinRates(state.lastOpenWinRates)
    };
  }

  function restoreState(gameState) {
    const board = decodeNumberGrid(gameState.board);
    return {
      board,
      probBoard: decodeNumberGrid(gameState.probBoard),
      probLabelBoard: decodeStringGrid(gameState.probLabelBoard || []),
      observedBoard: observedBoardForState(gameState, board),
      turn: gameState.turn,
      lastMove: gameState.lastMove || null,
      specialUsed: gameState.specialUsed,
      observeUsesLeft: gameState.observeUsesLeft,
      positionHistory: historyForState(gameState),
      gameOver: Boolean(gameState.gameOver),
      gameResult: gameState.gameResult || null,
      lastOpenWinRates: gameState.lastOpenWinRates || null
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
    const knownIndexes = new Set(publishedHistoryIndexes);
    remoteHistory.forEach(item => {
      const index = Number(item.index);
      if (Number.isInteger(index)) knownIndexes.add(index);
    });
    return history
      .map((item, index) => ({
        index,
        reason,
        version,
        item
      }))
      .filter(entry => !knownIndexes.has(entry.index));
  }

  function writeHistoryEntriesToBatch(batch, entries) {
    entries.forEach(entry => {
      const doc = movesRef.doc(String(entry.index).padStart(3, "0"));
      batch.set(doc, {
        index: entry.index,
        reason: entry.reason,
        version: entry.version,
        ...encodeHistoryItem(entry.item),
        createdAt: serverTimestamp()
      });
    });
  }

  function markPublishedHistoryEntries(entries, historyLength = 0) {
    entries.forEach(entry => publishedHistoryIndexes.add(entry.index));
    publishedHistoryLength = Math.max(
      publishedHistoryLength,
      historyLength,
      ...entries.map(entry => entry.index + 1)
    );
  }

  function writeStateBatch(statePayload, history, reason, version) {
    const entries = collectNewHistoryEntries(history, reason, version);
    const batch = db.batch();
    batch.update(roomRef, {
      gameState: statePayload,
      updatedAt: serverTimestamp()
    });
    writeHistoryEntriesToBatch(batch, entries);
    return batch.commit().then(() => {
      markPublishedHistoryEntries(entries, history.length);
    });
  }

  function reviewApplyOptions(options = {}) {
    return options;
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
    markPublishedHistoryEntries(remoteHistory, remoteHistory.length);

    const expectedLength = Number(latestRoomData?.gameState?.historyLength || 0);
    showIncompleteHistoryWarning(latestRoomData?.gameState);
    if (
      latestRoomData?.gameState
      && gameEnded(latestRoomData.gameState)
      && isConfirmedEndedState(latestRoomData.gameState)
      && expectedLength > 0
      && hasCompleteRemoteHistory(latestRoomData.gameState)
    ) {
      const localState = gameApi?.getState?.();
      if (localState?.finalObservationRunning || (localState?.gameOver && localState?.reviewIndex === null)) {
        return;
      }
      gameApi?.applyExternalState?.(restoreStateWithTimeoutFallback(latestRoomData.gameState), reviewApplyOptions());
      revealReviewScreen();
      updateClockPanel();
    }
  }

  function startMovesListener() {
    if (!movesRef || unsubscribeMoves) return;
    unsubscribeMoves = movesRef.orderBy("index").onSnapshot(applyMovesSnapshot, () => {
      revealReviewScreen();
      setStatus("履歴情報の更新に失敗しました。通信環境を確認してください。", true);
    });
  }

  async function publishState(state, reason) {
    if (isReviewSession()) return;
    if (!ready || !roomRef) {
      pendingPublish = { state, reason };
      return;
    }
    if (reason === "start" && session.playerColor !== "black") return;
    if (publishing) {
      pendingPublish = { state, reason };
      return;
    }

    publishing = true;
    try {
      const version = Math.max(Date.now(), latestVersion + 1);
      latestVersion = version;
      latestClock = prepareClockForPublish(state, reason);
      const stateWithClockHistory = {
        ...state,
        positionHistory: addClockToLatestHistory(state, latestClock)
      };
      if (state.gameResult?.type === "resign") {
        let resignEndedStateForLocal = null;
        let publishedEntries = [];
        let publishedLength = 0;
        await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(roomRef);
          if (!snapshot.exists) return;

          const room = snapshot.data();
          const gameState = room.gameState;
          if (room.status === "finished" || gameState?.gameOver || gameState?.gameResult) return;

          const baseState = gameState ? restoreState(gameState) : stateWithClockHistory;
          const endedState = {
            ...baseState,
            gameOver: true,
            gameResult: state.gameResult,
            positionHistory: addClockToLatestHistory(baseState, latestClock)
          };
          resignEndedStateForLocal = endedState;
          const statePayload = {
            ...sanitizeState(endedState),
            historyLength: Math.max(Number(gameState?.historyLength || 0), endedState.positionHistory.length),
            clock: clockForFirestore(latestClock),
            version,
            updatedBy: session.playerId,
            reason
          };
          transaction.update(roomRef, {
            status: "finished",
            gameState: statePayload,
            updatedAt: serverTimestamp()
          });
          const newHistoryEntries = collectNewHistoryEntries(endedState.positionHistory, reason, version);
          publishedEntries = newHistoryEntries;
          publishedLength = endedState.positionHistory.length;
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
            publishedEntries = [{ index: lastIndex }];
            transaction.set(movesRef.doc(String(lastIndex).padStart(3, "0")), {
              index: lastIndex,
              reason,
              version,
              ...encodeHistoryItem(endedState.positionHistory[lastIndex]),
              createdAt: serverTimestamp()
            }, { merge: true });
          }
        });
        markPublishedHistoryEntries(publishedEntries, publishedLength);
        clearPersistentSession();
        stopPresenceTicker();
        if (resignEndedStateForLocal) gameApi.applyExternalState(resignEndedStateForLocal, reviewApplyOptions());
        updateClockPanel();
        return;
      }
      await writeStateBatch({
        ...sanitizeState(stateWithClockHistory),
        clock: clockForFirestore(latestClock),
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
      if (pendingPublish) {
        const nextPublish = pendingPublish;
        pendingPublish = null;
        publishState(nextPublish.state, nextPublish.reason);
      }
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
      let publishedEntries = [];
      let publishedLength = 0;
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
          updatedAt: clockNow()
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
          clock: clockForFirestore(endedClock),
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
        publishedEntries = newHistoryEntries;
        publishedLength = endedState.positionHistory.length;
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
          publishedEntries = [{ index: lastIndex }];
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
      markPublishedHistoryEntries(publishedEntries, publishedLength);
      if (endedStateForLocal) {
        gameApi.applyExternalState(endedStateForLocal, reviewApplyOptions());
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
    let publishedEntries = [];
    let publishedLength = 0;
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
          updatedAt: clockNow()
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
          clock: clockForFirestore(endedClock),
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
        publishedEntries = newHistoryEntries;
        publishedLength = endedState.positionHistory.length;
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
          publishedEntries = [{ index: lastIndex }];
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
      markPublishedHistoryEntries(publishedEntries, publishedLength);
      if (endedStateForLocal) {
        gameApi.applyExternalState(endedStateForLocal, reviewApplyOptions());
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
    if (!isReviewSession()) trackPresence(room);
    const gameState = room.gameState;
    updatePlayerNames(room.playerNames || {});
    if (!gameState) {
      if (isReviewSession()) {
        setStatus(`${session.roomCode} に接続中です。棋譜を読み込んでいます。`);
        return;
      }
      setStatus(`${session.roomCode} に接続中です。初期盤面を待っています。`);
      if (session.playerColor === "black") publishState(gameApi.getState(), "start");
      checkOpponentPresence();
      return;
    }

    const incomingVersion = Number(gameState.version) || 0;
    if (incomingVersion < latestVersion) return;

    const shouldAdoptClock = !latestClock || incomingVersion > latestVersion;
    if (shouldAdoptClock && rememberServerClock(gameState?.clock?.serverUpdatedAt)) {
      latestClock = adoptClockForDisplay(gameState.clock, gameState.turn);
      updateClockPanel();
    } else if (!latestClock) {
      latestClock = defaultClock(gameState.turn);
      updateClockPanel();
    }
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
    const ended = gameEnded(gameState);
    const finalObservePreview = isFinalObservePreview(gameState);
    const confirmedEnded = isConfirmedEndedState(gameState);
    if (confirmedEnded) {
      if (isReviewSession()) {
        gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), reviewApplyOptions());
        revealReviewScreen();
        updateClockPanel();
        latestVersion = Math.max(latestVersion, version);
        return;
      }
      saveMatchHistory(gameState);
      clearPersistentSession();
      stopPresenceTicker();
    } else if (!ended && !finalObservePreview && !isReviewSession()) {
      checkOpponentPresence();
    }

    const forceTimeoutState = visibleClock.timedOut !== null || gameState.gameResult?.type === "timeout";
    if (forceTimeoutState) {
      const localState = gameApi.getState();
      if (!localState.gameOver || localState.gameResult?.type !== "timeout") {
        gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), reviewApplyOptions());
        revealReviewScreen();
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
        if (delayedObservationTimer) {
          clearTimeout(delayedObservationTimer);
          delayedObservationTimer = null;
        }
        const now = Date.now();
        remoteObservationLabelUntil = now + 1100;
        remoteObservationPreviewUntil = now + 2800;
        gameApi.playExternalObservationAnimation(reason === "final-observe-start" ? "ラスト\nオープン！" : "オープン！");
        return;
      }
      const animateObservation = reason === "observe" || reason === "final-observe";
      const skipObservationAnimation = animateObservation && Date.now() < remoteObservationPreviewUntil;
      const label = reason === "final-observe" ? "ラスト\nオープン！" : "オープン！";
      const applyObservationState = () => {
        delayedObservationTimer = null;
        if (latestVersion !== version) return;
        gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), reviewApplyOptions({
          animateObservation: animateObservation && !skipObservationAnimation,
          popObservationOnly: animateObservation && skipObservationAnimation,
          playPlaceSound: reason === "move",
          label
        }));
      };
      const delay = animateObservation && skipObservationAnimation
        ? Math.max(0, remoteObservationLabelUntil - Date.now())
        : 0;
      if (delay > 0) {
        if (delayedObservationTimer) clearTimeout(delayedObservationTimer);
        delayedObservationTimer = setTimeout(applyObservationState, delay + 50);
        return;
      }
      gameApi.applyExternalState(restoreStateWithTimeoutFallback(gameState), reviewApplyOptions({
        animateObservation: animateObservation && !skipObservationAnimation,
        popObservationOnly: animateObservation && skipObservationAnimation,
        playPlaceSound: reason === "move",
        label
      }));
    }
  }

  async function bootFirebase() {
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
    const auth = firebase.auth?.(app);
    if (!auth || !window.CatProfile?.loadProfile) {
      setStatus("オンライン認証を確認できませんでした。ロビーから入り直してください。", true);
      return false;
    }
    try {
      const profile = await window.CatProfile.loadProfile();
      titleCatalog = window.CatProfile.loadTitleCatalog ? await window.CatProfile.loadTitleCatalog() : [];
      if (!auth.currentUser || auth.currentUser.uid !== session.playerId || profile?.playerId !== session.playerId) {
        setStatus("オンライン認証を確認できませんでした。ロビーから入り直してください。", true);
        return false;
      }
    } catch (error) {
      setStatus("オンライン認証を確認できませんでした。ロビーから入り直してください。", true);
      return false;
    }
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
    return true;
  }

  window.quantumOthelloConfig = {
    mode: "online",
    optionsFrom: "online",
    stateScope: "online",
    rules: normalizeMatchRules(session?.matchRules),
    getPlayerColor: () => session?.playerColor || "black",
    canFinalizeInitialGame: () => session?.playerColor === "black",
    isClockExpired,
    onStateChange: publishState,
    onRender: updateOnlineResourcePanel
  };

  if (resignButton) resignButton.addEventListener("click", showResignConfirm);
  if (pawPointResultButton) pawPointResultButton.addEventListener("click", () => showPawPointDialog());
  if (confirmResignButton) confirmResignButton.addEventListener("click", resign);
  if (cancelResignButton) cancelResignButton.addEventListener("click", hideResignConfirm);
  if (resignConfirm) {
    resignConfirm.addEventListener("click", event => {
      if (event.target === resignConfirm) hideResignConfirm();
    });
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideResignConfirm();
      hidePawPointDialog();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPresenceNow();
  });
  window.addEventListener("focus", refreshPresenceNow);
  window.addEventListener("pageshow", refreshPresenceNow);
  if (backToRoomButton && session?.reviewReturnPath === "mypage.html") {
    backToRoomButton.textContent = "マイページに戻る";
  }
  if (backToRoomButton) backToRoomButton.addEventListener("click", navigateToRoomScreen);
  arrangeClockItems();

  document.addEventListener("quantum-othello:ready", async event => {
    gameApi = event.detail;
    latestClock = defaultClock(gameApi.getState().turn);
    const firebaseReady = await bootFirebase();
    if (!firebaseReady || !roomRef) {
      revealReviewScreen();
      return;
    }
    if (isReviewSession()) {
      updatePlayerNames();
      updateOnlineActionButtons(gameApi.getState());
      setStatus(`${session.roomCode} に接続中です。棋譜を読み込んでいます。`);
      startMovesListener();
      unsubscribeRoom = roomRef.onSnapshot(applyRoomSnapshot, error => {
        revealReviewScreen();
        setStatus("部屋情報の更新に失敗しました。通信環境を確認してください。", true);
      });
      return;
    }
    ready = true;
    updatePlayerNames();
    setStatus(`${session.roomCode} に接続中です。`);
    updateOnlineActionButtons(gameApi.getState());
    startClockTicker();
    startPresenceTicker();
    startMovesListener();
    if (pendingPublish) {
      const nextPublish = pendingPublish;
      pendingPublish = null;
      publishState(nextPublish.state, nextPublish.reason);
    }
    unsubscribeRoom = roomRef.onSnapshot(applyRoomSnapshot, error => {
      revealReviewScreen();
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






(() => {
  const sessionKey = "othelloOnlineSession";
  const audio = window.OthelloAudio?.createMatchAudioController?.();
  const profileStore = window.CatProfile;

  const nameInput = document.querySelector("#profileName");
  const currentTitleDisplay = document.querySelector("#currentTitleDisplay");
  const openTitleListButton = document.querySelector("#openTitleList");
  const openMyDataButton = document.querySelector("#openMyData");
  const mypageButton = document.querySelector("#mypageButton");
  const nameStatus = document.querySelector("#profileNameStatus");
  const historyList = document.querySelector("#matchHistoryList");
  const historyTabs = Array.from(document.querySelectorAll("[data-match-filter]"));
  const modeSelectButton = document.querySelector("#modeSelectButton");
  const loginDaysValue = document.querySelector("#loginDaysValue");
  const currentLoginStreakValue = document.querySelector("#currentLoginStreakValue");
  const longestLoginStreakValue = document.querySelector("#longestLoginStreakValue");
  const pawPointsValue = document.querySelector("#pawPointsValue");
  const randomGamesValue = document.querySelector("#randomGamesValue");
  const randomWinsValue = document.querySelector("#randomWinsValue");
  const randomLossesValue = document.querySelector("#randomLossesValue");
  const randomDrawsValue = document.querySelector("#randomDrawsValue");

  let currentProfile = null;
  let currentHistory = [];
  let currentHistoryFilter = "random";

  function playClickSe() {
    audio?.playSound?.(window.OthelloAudio.sounds.uiClick, 0.55);
  }

  function navigate(path) {
    playClickSe();
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      window.parent.postMessage({ type: "othello:navigate", path, click: false }, "*");
      return;
    }
    location.href = path;
  }

  function notifyScreenReady() {
    if (window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1") {
      const path = location.pathname.split("/").pop() || "mypage.html";
      window.parent.postMessage({ type: "othello:screen-ready", path }, "*");
    }
  }

  function setStatus(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  function formatDate(value) {
    if (!value) return "日時不明";
    if (typeof value === "string" && value.includes("年")) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function resultClass(record, counts) {
    const result = record.gameResult || {};
    const winner = result.winner ?? (counts.black > counts.white ? 1 : counts.white > counts.black ? -1 : 0);
    if (!winner) return "history-draw";
    const playerValue = record.playerColor === "white" ? -1 : 1;
    return winner === playerValue ? "history-win" : "history-loss";
  }

  function scoreLine(record, color) {
    const names = record.playerNames || {};
    const counts = record.counts || {};
    const playerColor = record.playerColor === "white" ? "white" : "black";
    const colorLabel = color === "black" ? "黒" : "白";
    const name = color === playerColor ? "あなた" : (names[color] || "対戦相手");
    const score = color === "black" ? counts.black : counts.white;
    return `${name}(${colorLabel})：${score ?? "-"}ねこ`;
  }

  function matchTypeOf(record) {
    return record?.matchType === "random" ? "random" : "friend";
  }

  function normalizeStats(source = {}) {
    if (profileStore?.normalizeStats) return profileStore.normalizeStats(source);
    return {
      games: Math.max(0, Number(source.games) || 0),
      wins: Math.max(0, Number(source.wins) || 0),
      losses: Math.max(0, Number(source.losses) || 0),
      draws: Math.max(0, Number(source.draws) || 0)
    };
  }

  function renderProfileStats(profile = currentProfile || {}) {
    const stats = normalizeStats(profile.randomStats);
    if (loginDaysValue) loginDaysValue.textContent = `${Math.max(0, Number(profile.loginDays) || 0)}日`;
    if (currentLoginStreakValue) currentLoginStreakValue.textContent = `${Math.max(0, Number(profile.currentLoginStreak) || 0)}日`;
    if (longestLoginStreakValue) longestLoginStreakValue.textContent = `${Math.max(0, Number(profile.longestLoginStreak) || 0)}日`;
    if (pawPointsValue) pawPointsValue.textContent = `${Math.trunc(Number(profile.pawPoints) || 0)}P`;
    if (randomGamesValue) randomGamesValue.textContent = `${stats.games}局`;
    if (randomWinsValue) randomWinsValue.textContent = String(stats.wins);
    if (randomLossesValue) randomLossesValue.textContent = String(stats.losses);
    if (randomDrawsValue) randomDrawsValue.textContent = String(stats.draws);
  }

  async function renderCurrentTitle(profile = currentProfile || {}) {
    const catalog = profileStore?.loadTitleCatalog
      ? await profileStore.loadTitleCatalog()
      : [{ id: "newbie_cat", name: "新米ねこ", type: "normal" }];
    const currentTitleId = profileStore?.normalizeTitleId
      ? profileStore.normalizeTitleId(profile.titleId || profile.title, catalog)
      : "newbie_cat";
    const currentTitle = catalog.find(title => title.id === currentTitleId);
    if (currentTitleDisplay) {
      const rarity = profileStore?.normalizeTitleRarity
        ? profileStore.normalizeTitleRarity(currentTitle?.rarity, currentTitle?.type)
        : currentTitle?.rarity ?? (currentTitle?.type === "special" ? 0 : 1);
      currentTitleDisplay.textContent = currentTitle?.name || profile.title || "新米ねこ";
      currentTitleDisplay.dataset.rarity = String(rarity);
      currentTitleDisplay.classList.add("title-rarity-bg");
    }
  }

  function openHistory(record) {
    if (!record?.roomCode || !record?.playerId || !record?.playerColor) {
      setStatus(nameStatus, "この棋譜は開けませんでした。", true);
      return;
    }
    const session = {
      roomCode: record.roomCode,
      playerId: record.playerId,
      playerColor: record.playerColor,
      playerNames: record.playerNames || {},
      playerTitles: record.playerTitles || {},
      reviewReturnPath: "mypage.html"
    };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    navigate("othello-online.html");
  }

  function renderHistory(history = currentHistory) {
    if (!historyList) return;
    const filteredHistory = history
      .filter(record => matchTypeOf(record) === currentHistoryFilter)
      .slice(0, 20);
    const filterLabel = currentHistoryFilter === "random" ? "ランダム戦" : "友人戦";
    if (!filteredHistory.length) {
      historyList.innerHTML = `<p class="mypage-empty">まだ${filterLabel}の棋譜がありません。オンライン対局が終わるとここに表示されます。</p>`;
      return;
    }
    historyList.replaceChildren(...filteredHistory.map(record => {
      const item = document.createElement("article");
      const counts = record.counts || {};
      item.className = `match-history-item ${resultClass(record, counts)}`;
      item.innerHTML = `
        <div>
          <span>${formatDate(record.finishedAt || record.playedAt)} / 部屋ID ${record.roomCode || "------"}</span>
          <span class="history-score-lines">${scoreLine(record, "black")}<br>${scoreLine(record, "white")}</span>
        </div>
        <button class="action secondary" type="button">棋譜を見る</button>
      `;
      item.querySelector("button").addEventListener("click", () => openHistory(record));
      return item;
    }));
  }

  async function loadProfile() {
    if (!profileStore) return { name: "ねこさん", title: "新米ねこ", offline: true };
    return profileStore.loadProfile();
  }

  async function initProfile() {
    if (historyList) historyList.innerHTML = '<p class="mypage-empty">棋譜を読み込んでいます...</p>';
    currentProfile = await loadProfile();
    if (nameInput) nameInput.value = profileStore?.sanitizeName(currentProfile.name) || "ねこさん";
    await renderCurrentTitle(currentProfile);
    renderProfileStats(currentProfile);
    if (currentProfile.offline) {
      setStatus(nameStatus, "通信できないため、この端末内のデータを表示しています。", true);
    }

    if (historyList) {
      currentHistory = profileStore
        ? await profileStore.loadMatchHistory(100)
        : [];
      renderHistory(currentHistory);
    }
  }

  document.querySelector("#saveProfileName")?.addEventListener("click", async () => {
    playClickSe();
    const name = profileStore?.sanitizeName(nameInput?.value) || "";
    if (!name) {
      setStatus(nameStatus, "名前を入力してください。", true);
      return;
    }
    try {
      currentProfile = profileStore
        ? await profileStore.saveProfile({ name })
        : { name, title: currentTitleDisplay?.textContent || "新米ねこ", offline: true };
      if (nameInput) nameInput.value = currentProfile.name;
      renderProfileStats(currentProfile);
      setStatus(nameStatus, currentProfile.offline ? "この端末内に名前を保存しました。" : "名前を保存しました。", Boolean(currentProfile.offline));
    } catch {
      setStatus(nameStatus, "名前を保存できませんでした。通信環境を確認してください。", true);
    }
  });

  openTitleListButton?.addEventListener("click", () => navigate("title-list.html"));
  openMyDataButton?.addEventListener("click", () => navigate("mydata.html"));
  mypageButton?.addEventListener("click", () => navigate("mypage.html"));

  historyTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      playClickSe();
      currentHistoryFilter = tab.dataset.matchFilter === "friend" ? "friend" : "random";
      historyTabs.forEach(nextTab => {
        const active = nextTab === tab;
        nextTab.classList.toggle("active", active);
        nextTab.setAttribute("aria-selected", String(active));
      });
      renderHistory(currentHistory);
    });
  });

  modeSelectButton?.addEventListener("click", () => navigate("mode-select.html"));
  initProfile()
    .catch(() => {
      currentHistory = [];
      renderHistory(currentHistory);
    })
    .finally(notifyScreenReady);
})();

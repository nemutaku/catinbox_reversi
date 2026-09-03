(() => {
  const audio = window.OthelloAudio?.createMatchAudioController?.();
  const profileStore = window.CatProfile;

  const titleList = document.querySelector("#titleList");
  const titleTabs = Array.from(document.querySelectorAll("[data-title-filter]"));
  const titleStatus = document.querySelector("#profileTitleStatus");
  const mypageButton = document.querySelector("#mypageButton");

  let currentProfile = null;
  let currentTitleCatalog = [];
  let currentTitleFilter = "normal";
  let selectedTitleId = "";
  let inlineTitleMessage = "";
  let unseenTitleIds = new Set();

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
      window.parent.postMessage({ type: "othello:screen-ready", path: "title-list.html" }, "*");
    }
  }

  function setStatus(message, isError = false) {
    if (!titleStatus) return;
    titleStatus.textContent = message;
    titleStatus.classList.toggle("error", isError);
  }

  function titleTypeLabel(type) {
    return type === "special" ? "スペシャル称号" : "ノーマル称号";
  }

  function setTitleTabActive(filter) {
    currentTitleFilter = filter === "special" ? "special" : "normal";
    titleTabs.forEach(tab => {
      const active = tab.dataset.titleFilter === currentTitleFilter;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }

  function unlockedTitleSet() {
    const unlockedIds = Array.isArray(currentProfile?.unlockedTitleIds) && currentProfile.unlockedTitleIds.length
      ? currentProfile.unlockedTitleIds
      : currentTitleCatalog.map(title => title.id);
    return new Set(unlockedIds);
  }

  function renderTitleList() {
    if (!titleList) return;
    const unlockedSet = unlockedTitleSet();
    const displayedUnseenIds = [];
    const titles = currentTitleCatalog.filter(title => {
      const type = title.type === "special" ? "special" : "normal";
      if (type !== currentTitleFilter) return false;
      return type !== "special" || unlockedSet.has(title.id);
    });
    if (!titles.length) {
      titleList.innerHTML = `<p class="mypage-empty">まだ${titleTypeLabel(currentTitleFilter)}はありません。</p>`;
      return;
    }

    titleList.replaceChildren(...titles.map(title => {
      const unlocked = unlockedSet.has(title.id);
      const selected = title.id === selectedTitleId;
      const button = document.createElement("article");
      button.className = `title-list-item${selected ? " selected" : ""}${unlocked ? "" : " locked"}`;
      const rarity = profileStore?.normalizeTitleRarity
        ? profileStore.normalizeTitleRarity(title.rarity, title.type)
        : title.rarity ?? (title.type === "special" ? 0 : 1);
      button.dataset.rarity = String(rarity);
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("role", "button");
      button.setAttribute("aria-disabled", String(!unlocked));
      if (unlocked) button.tabIndex = 0;
      const displayName = unlocked ? title.name : "???";
      const titleContent = document.createElement("span");
      titleContent.className = "title-list-content";
      const titleBadge = document.createElement("span");
      titleBadge.className = "title-list-name-badge";
      titleBadge.dataset.rarity = String(rarity);
      if (unlocked) titleBadge.classList.add("title-rarity-bg");
      const name = document.createElement("strong");
      name.textContent = displayName;
      titleBadge.append(name);
      titleContent.append(titleBadge);
      if (selected && unlocked) {
        const detail = document.createElement("span");
        detail.className = "title-inline-detail";

        const conditionLabel = document.createElement("span");
        conditionLabel.className = "title-inline-label";
        conditionLabel.textContent = "取得条件";
        const conditionText = document.createElement("b");
        conditionText.className = "title-inline-text";
        conditionText.textContent = title.condition || "条件なし";

        const commentLabel = document.createElement("span");
        commentLabel.className = "title-inline-label";
        commentLabel.textContent = "作者コメント";
        const commentText = document.createElement("b");
        commentText.className = "title-inline-text";
        commentText.textContent = title.comment || "作者コメントはまだありません。";

        const saveButton = document.createElement("button");
        saveButton.className = "title-inline-save action";
        saveButton.type = "button";
        saveButton.textContent = "この称号をセットする";
        saveButton.addEventListener("click", event => {
          event.stopPropagation();
          saveSelectedTitle();
        });
        saveButton.addEventListener("keydown", event => {
          event.stopPropagation();
        });

        const closeButton = document.createElement("button");
        closeButton.className = "title-inline-close action secondary";
        closeButton.type = "button";
        closeButton.textContent = "とじる";
        closeButton.addEventListener("click", event => {
          event.stopPropagation();
          playClickSe();
          selectedTitleId = "";
          inlineTitleMessage = "";
          renderTitleList();
        });
        closeButton.addEventListener("keydown", event => {
          event.stopPropagation();
        });

        detail.append(conditionLabel, conditionText, commentLabel, commentText, saveButton, closeButton);
        if (inlineTitleMessage) {
          const message = document.createElement("span");
          message.className = "title-inline-message";
          message.textContent = inlineTitleMessage;
          detail.append(message);
        }
        titleContent.append(detail);
      }
      button.append(titleContent);
      if (unlocked && unseenTitleIds.has(title.id)) {
        const newBadge = document.createElement("span");
        newBadge.className = "title-new-badge";
        newBadge.textContent = "New!";
        button.append(newBadge);
        displayedUnseenIds.push(title.id);
      }
      const selectTitle = () => {
        if (!unlocked) return;
        playClickSe();
        selectedTitleId = selected ? "" : title.id;
        inlineTitleMessage = "";
        renderTitleList();
        setStatus(selectedTitleId ? "セットする称号を選択しました。" : "");
      };
      button.addEventListener("click", selectTitle);
      button.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectTitle();
      });
      return button;
    }));
    if (displayedUnseenIds.length) {
      profileStore?.markTitleIdsSeen?.(displayedUnseenIds);
      displayedUnseenIds.forEach(titleId => unseenTitleIds.delete(titleId));
    }
  }

  async function initTitleList() {
    if (titleList) titleList.innerHTML = '<p class="mypage-empty">称号を読み込んでいます...</p>';
    currentTitleCatalog = profileStore?.loadTitleCatalog
      ? await profileStore.loadTitleCatalog()
      : [{ id: "newbie_cat", name: "新米ねこ", type: "normal" }];
    currentProfile = profileStore
      ? await profileStore.loadProfile()
      : { name: "ねこさん", title: "新米ねこ", titleId: "newbie_cat", offline: true };
    unseenTitleIds = new Set(profileStore?.loadUnseenTitleIds?.() || []);
    const currentTitleId = profileStore?.normalizeTitleId
      ? profileStore.normalizeTitleId(currentProfile.titleId || currentProfile.title, currentTitleCatalog)
      : "newbie_cat";
    const currentTitle = currentTitleCatalog.find(title => title.id === currentTitleId);
    selectedTitleId = "";
    inlineTitleMessage = "";
    setTitleTabActive(currentTitle?.type === "special" ? "special" : "normal");
    renderTitleList();
    if (currentProfile.offline) {
      setStatus("通信できないため、この端末内の称号を表示しています。", true);
    }
  }

  async function saveSelectedTitle() {
    playClickSe();
    const unlockedSet = unlockedTitleSet();
    if (!unlockedSet.has(selectedTitleId)) {
      setStatus("未獲得の称号はセットできません。", true);
      return;
    }
    try {
      currentProfile = profileStore
        ? await profileStore.saveProfile({ titleId: selectedTitleId })
        : { ...currentProfile, titleId: selectedTitleId, offline: true };
      inlineTitleMessage = "称号をセットしました。";
      renderTitleList();
      setStatus(currentProfile.offline ? "この端末内に称号をセットしました。" : "称号をセットしました。", Boolean(currentProfile.offline));
    } catch {
      setStatus("称号を保存できませんでした。通信環境を確認してください。", true);
    }
  }

  titleTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      playClickSe();
      setTitleTabActive(tab.dataset.titleFilter);
      selectedTitleId = "";
      inlineTitleMessage = "";
      renderTitleList();
      setStatus("");
    });
  });

  mypageButton?.addEventListener("click", () => navigate("mypage.html"));

  initTitleList()
    .catch(() => {
      if (titleList) titleList.innerHTML = '<p class="mypage-empty">称号を読み込めませんでした。</p>';
      setStatus("称号を読み込めませんでした。通信環境を確認してください。", true);
    })
    .finally(notifyScreenReady);
})();

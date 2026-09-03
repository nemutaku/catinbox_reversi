(() => {
  const pendingTitleUnlockNoticeKey = "catinboxPendingTitleUnlocks";

  function readPendingUnlocks() {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingTitleUnlockNoticeKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function consumePendingUnlocks() {
    const seen = new Set();
    const titles = readPendingUnlocks()
      .map(item => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || "").trim().slice(0, 16),
        type: item?.type === "special" ? "special" : "normal",
        rarity: Math.max(0, Math.min(7, Math.trunc(Number(item?.rarity) || (item?.type === "special" ? 0 : 1)))),
        comment: String(item?.comment || "").trim().slice(0, 80)
      }))
      .filter(item => {
        if (!item.id || !item.name || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    sessionStorage.removeItem(pendingTitleUnlockNoticeKey);
    return titles;
  }

  function playClickSe() {
    const audio = window.OthelloAudio?.createMatchAudioController?.();
    audio?.playSound?.(window.OthelloAudio.sounds.uiClick, 0.55);
  }

  function showTitleUnlockPopup(titles) {
    if (!titles.length) return;

    const overlay = document.createElement("div");
    overlay.className = "title-unlock-dialog";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("section");
    panel.className = "title-unlock-dialog-panel";

    const heading = document.createElement("h2");
    heading.textContent = "称号を獲得しました！";

    const list = document.createElement("ul");
    list.className = "title-unlock-list";
    titles.forEach(title => {
      const item = document.createElement("li");
      item.className = "title-unlock-item";
      const badge = document.createElement("span");
      badge.className = "title-unlock-name-badge title-rarity-bg";
      badge.dataset.rarity = String(title.rarity);
      const name = document.createElement("strong");
      name.textContent = title.name;
      badge.append(name);
      item.append(badge);
      if (title.comment) {
        const comment = document.createElement("small");
        comment.className = "title-comment";
        comment.textContent = title.comment;
        item.append(comment);
      }
      list.append(item);
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "action secondary";
    closeButton.textContent = "閉じる";
    closeButton.addEventListener("click", () => {
      playClickSe();
      overlay.remove();
    });

    panel.append(heading, list, closeButton);
    overlay.append(panel);
    document.body.append(overlay);
    closeButton.focus({ preventScroll: true });
  }

  window.addEventListener("DOMContentLoaded", () => {
    showTitleUnlockPopup(consumePendingUnlocks());
  });
})();

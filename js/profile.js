(() => {
  const nicknameKey = "catinboxOnlineNickname";
  const titleKey = "catinboxPlayerTitle";
  const matchHistoryKey = "catinboxMatchHistory";
  const pendingTitleUnlockNoticeKey = "catinboxPendingTitleUnlocks";
  const unseenTitleIdsKey = "catinboxUnseenTitleIds";
  const defaultName = "ねこさん";
  const defaultTitleId = "normal_rogin_1";
  const retiredTitleIds = new Set(["newbie_cat", "hello_1day"]);
  const defaultTitleDefinitions = [
    { id: "normal_rogin_1", name: "はじめまして", type: "normal", sort: 10, rarity: 1, comment: "" }
  ];
  const defaultTitle = defaultTitleDefinitions[0].name;
  const defaultUnlockedTitleIds = defaultTitleDefinitions
    .filter(title => !title.unlockType)
    .map(title => title.id);
  const allowedTitles = new Set(defaultTitleDefinitions.map(title => title.name));
  const defaultRandomStats = {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0
  };
  const defaultActionStats = {
    openUses: 0,
    special0Uses: 0,
    special100Uses: 0
  };

  let auth = null;
  let db = null;
  let cachedProfile = null;
  let profilePromise = null;
  let titleCatalogPromise = null;
  let cachedTitleCatalog = null;

  function sanitizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 12);
  }

  function normalizeTitle(value) {
    return titleNameById(normalizeTitleId(value), defaultTitleDefinitions);
  }

  function normalizeTitleDefinition(doc) {
    const data = typeof doc.data === "function" ? doc.data() : doc;
    const id = sanitizeTitleId(doc.id || data.id);
    const name = String(data.name || "").trim().slice(0, 16);
    const type = data.type === "special" ? "special" : "normal";
    if (!id || retiredTitleIds.has(id) || !name || data.active === false) return null;
    return {
      id,
      name,
      type,
      rarity: normalizeTitleRarity(data.rarity, type),
      sort: Number.isFinite(Number(data.sort)) ? Number(data.sort) : 999,
      unlockType: typeof data.unlockType === "string" ? data.unlockType : "",
      unlockValue: Number.isFinite(Number(data.unlockValue)) ? Number(data.unlockValue) : null,
      condition: String(data.condition || "").trim().slice(0, 80),
      comment: String(data.comment || "").trim().slice(0, 80)
    };
  }

  function normalizeTitleRarity(value, type = "normal") {
    const fallback = type === "special" ? 0 : 1;
    if (value === "" || value === null || value === undefined) return fallback;
    const rarity = Math.trunc(Number(value));
    if (!Number.isFinite(rarity)) return fallback;
    const min = type === "special" ? 0 : 1;
    return Math.min(7, Math.max(min, rarity));
  }

  function sanitizeTitleId(value) {
    return String(value || "").trim().replace(/[^\w-]/g, "").slice(0, 64);
  }

  function uniqueTitleCatalog(catalog) {
    const byId = new Map();
    catalog
      .map(normalizeTitleDefinition)
      .filter(Boolean)
      .forEach(title => {
        const current = byId.get(title.id);
        byId.set(title.id, current
          ? {
              ...current,
              ...title,
              rarity: Number.isFinite(Number(title.rarity)) ? title.rarity : current.rarity,
              unlockType: title.unlockType || current.unlockType,
              unlockValue: title.unlockValue ?? current.unlockValue,
              condition: title.condition || current.condition,
              comment: title.comment || current.comment
            }
          : title);
      });
    return Array.from(byId.values())
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "ja"));
  }

  function normalizeTitleId(value, catalog = defaultTitleDefinitions) {
    const raw = String(value || "").trim();
    if (!raw) return defaultTitleId;
    if (retiredTitleIds.has(raw)) return defaultTitleId;
    const byId = catalog.find(title => title.id === raw);
    if (byId) return byId.id;
    const byName = catalog.find(title => title.name === raw);
    return byName ? byName.id : defaultTitleId;
  }

  function titleNameById(titleId, catalog = defaultTitleDefinitions) {
    return catalog.find(title => title.id === titleId)?.name || defaultTitle;
  }

  function normalizeUnlockedTitleIds(value, catalog = defaultTitleDefinitions) {
    const catalogIds = new Set(catalog.map(title => title.id));
    const source = Array.isArray(value) ? value : defaultUnlockedTitleIds;
    const ids = source
      .map(sanitizeTitleId)
      .filter(id => !retiredTitleIds.has(id) && catalogIds.has(id));
    if (!ids.includes(defaultTitleId)) ids.unshift(defaultTitleId);
    return Array.from(new Set(ids));
  }

  function readJsonArray(key) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeJsonArray(key, values) {
    sessionStorage.setItem(key, JSON.stringify(Array.isArray(values) ? values : []));
  }

  function titleSummariesByIds(titleIds = [], catalog = defaultTitleDefinitions) {
    const catalogMap = new Map(catalog.map(title => [title.id, title]));
    return Array.from(new Set(titleIds.map(sanitizeTitleId)))
      .map(id => catalogMap.get(id))
      .filter(Boolean)
      .map(title => ({
        id: title.id,
        name: title.name,
        type: title.type === "special" ? "special" : "normal",
        rarity: normalizeTitleRarity(title.rarity, title.type),
        comment: String(title.comment || "").trim().slice(0, 80)
      }));
  }

  function queueTitleUnlockNotifications(titleIds = [], catalog = defaultTitleDefinitions) {
    const titles = titleSummariesByIds(titleIds, catalog);
    if (!titles.length) return;

    const pendingMap = new Map(readJsonArray(pendingTitleUnlockNoticeKey)
      .filter(item => item?.id)
      .map(item => [sanitizeTitleId(item.id), {
        id: sanitizeTitleId(item.id),
        name: String(item.name || "").trim(),
        type: item.type === "special" ? "special" : "normal",
        rarity: normalizeTitleRarity(item.rarity, item.type),
        comment: String(item.comment || "").trim().slice(0, 80)
      }]));
    titles.forEach(title => pendingMap.set(title.id, title));
    writeJsonArray(pendingTitleUnlockNoticeKey, Array.from(pendingMap.values()));

    const unseenIds = new Set(readJsonArray(unseenTitleIdsKey).map(sanitizeTitleId).filter(Boolean));
    titles.forEach(title => unseenIds.add(title.id));
    writeJsonArray(unseenTitleIdsKey, Array.from(unseenIds));
  }

  function consumePendingTitleUnlockNotifications() {
    const pending = readJsonArray(pendingTitleUnlockNoticeKey)
      .map(item => ({
        id: sanitizeTitleId(item?.id),
        name: String(item?.name || "").trim().slice(0, 16),
        type: item?.type === "special" ? "special" : "normal",
        rarity: normalizeTitleRarity(item?.rarity, item?.type),
        comment: String(item?.comment || "").trim().slice(0, 80)
      }))
      .filter(item => item.id && item.name);
    sessionStorage.removeItem(pendingTitleUnlockNoticeKey);
    return pending;
  }

  function loadUnseenTitleIds() {
    return readJsonArray(unseenTitleIdsKey).map(sanitizeTitleId).filter(Boolean);
  }

  function markTitleIdsSeen(titleIds = []) {
    const seen = new Set(titleIds.map(sanitizeTitleId).filter(Boolean));
    if (!seen.size) return;
    const next = loadUnseenTitleIds().filter(id => !seen.has(id));
    writeJsonArray(unseenTitleIdsKey, next);
    const pending = readJsonArray(pendingTitleUnlockNoticeKey)
      .filter(item => !seen.has(sanitizeTitleId(item?.id)));
    writeJsonArray(pendingTitleUnlockNoticeKey, pending);
  }

  function readLocalProfile() {
    return {
      name: sanitizeName(localStorage.getItem(nicknameKey)) || defaultName,
      title: normalizeTitle(localStorage.getItem(titleKey)),
      titleId: normalizeTitleId(localStorage.getItem(titleKey)),
      unlockedTitleIds: [...defaultUnlockedTitleIds],
      loginDays: 0,
      currentLoginStreak: 0,
      longestLoginStreak: 0,
      lastLoginDate: "",
      pawPoints: 0,
      randomStats: { ...defaultRandomStats }
    };
  }

  function mirrorProfile(profile) {
    if (!profile) return;
    localStorage.setItem(nicknameKey, sanitizeName(profile.name) || defaultName);
    localStorage.setItem(titleKey, normalizeTitle(profile.title));
  }

  function readLocalHistory(limit = 20) {
    try {
      const history = JSON.parse(localStorage.getItem(matchHistoryKey) || "[]");
      return Array.isArray(history) ? history.slice(0, limit) : [];
    } catch {
      return [];
    }
  }

  function mirrorHistory(record) {
    if (!record?.roomCode) return;
    const nextHistory = [
      record,
      ...readLocalHistory(50).filter(item => item?.roomCode !== record.roomCode)
    ].slice(0, 100);
    localStorage.setItem(matchHistoryKey, JSON.stringify(nextHistory));
  }

  function initFirebase() {
    if (!window.firebase || !window.OthelloFirebaseConfig) return null;
    const app = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(window.OthelloFirebaseConfig);
    auth = firebase.auth?.(app) || null;
    db = firebase.firestore?.(app) || null;
    return auth && db ? { auth, db } : null;
  }

  async function ensureAnonymousUser() {
    const services = initFirebase();
    if (!services) return null;
    if (auth.currentUser) return auth.currentUser;
    const credential = await auth.signInAnonymously();
    return credential.user || auth.currentUser;
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function incrementBy(amount) {
    return firebase.firestore.FieldValue.increment(amount);
  }

  function arrayUnion(...values) {
    return firebase.firestore.FieldValue.arrayUnion(...values);
  }

  function profileRef(playerId) {
    return db.collection("players").doc(playerId);
  }

  function titleCollectionName(type) {
    return type === "special" ? "title_special" : "title_normal";
  }

  async function loadTitleDocs(type) {
    const snapshot = await db.collection(titleCollectionName(type)).orderBy("sort", "asc").get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      type,
      ...doc.data()
    }));
  }

  async function loadTitleCatalog() {
    if (cachedTitleCatalog) return cachedTitleCatalog;
    if (titleCatalogPromise) return titleCatalogPromise;

    titleCatalogPromise = (async () => {
      initFirebase();
      if (!db) {
        cachedTitleCatalog = [...defaultTitleDefinitions];
        return cachedTitleCatalog;
      }

      try {
        const [normalTitles, specialTitles] = await Promise.all([
          loadTitleDocs("normal"),
          loadTitleDocs("special")
        ]);
        cachedTitleCatalog = uniqueTitleCatalog([...defaultTitleDefinitions, ...normalTitles, ...specialTitles]);
      } catch {
        cachedTitleCatalog = [...defaultTitleDefinitions];
      } finally {
        titleCatalogPromise = null;
      }
      return cachedTitleCatalog;
    })();

    return titleCatalogPromise;
  }

  function todayJstKey() {
    return jstDateKey(new Date());
  }

  function jstDateKey(date) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function yesterdayJstKey() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 1);
    return jstDateKey(date);
  }

  function normalizeStats(source = {}) {
    return {
      games: Math.max(0, Number(source.games) || 0),
      wins: Math.max(0, Number(source.wins) || 0),
      losses: Math.max(0, Number(source.losses) || 0),
      draws: Math.max(0, Number(source.draws) || 0)
    };
  }

  function normalizeActionStats(source = {}) {
    return {
      openUses: Math.max(0, Number(source.openUses) || 0),
      special0Uses: Math.max(0, Number(source.special0Uses) || 0),
      special100Uses: Math.max(0, Number(source.special100Uses) || 0)
    };
  }

  function normalizeProfileData(data = {}, localProfile = readLocalProfile(), playerId = null, titleCatalog = defaultTitleDefinitions) {
    const unlockedTitleIds = normalizeUnlockedTitleIds(data.unlockedTitleIds || localProfile.unlockedTitleIds, titleCatalog);
    let titleId = normalizeTitleId(data.titleId || data.title || localProfile.titleId || localProfile.title, titleCatalog);
    if (!unlockedTitleIds.includes(titleId)) titleId = defaultTitleId;
    return {
      playerId,
      name: sanitizeName(data.name) || localProfile.name || defaultName,
      title: titleNameById(titleId, titleCatalog),
      titleId,
      unlockedTitleIds,
      loginDays: Math.max(0, Number(data.loginDays) || 0),
      currentLoginStreak: Math.max(0, Number(data.currentLoginStreak) || 0),
      longestLoginStreak: Math.max(0, Number(data.longestLoginStreak) || 0),
      lastLoginDate: String(data.lastLoginDate || ""),
      pawPoints: Number.isFinite(Number(data.pawPoints)) ? Math.trunc(Number(data.pawPoints)) : 0,
      randomStats: normalizeStats(data.randomStats),
      actionStats: normalizeActionStats(data.actionStats)
    };
  }

  function applyProgressTitleUnlocks(profile, titleCatalog = defaultTitleDefinitions) {
    const unlockedTitleIds = normalizeUnlockedTitleIds(profile.unlockedTitleIds, titleCatalog);
    let changed = false;
    const randomStats = normalizeStats(profile.randomStats);
    const actionStats = normalizeActionStats(profile.actionStats);
    const progressValues = {
      loginDays: Number(profile.loginDays) || 0,
      loginStreak: Number(profile.currentLoginStreak) || 0,
      games: randomStats.games,
      wins: randomStats.wins,
      openUses: actionStats.openUses,
      special0Uses: actionStats.special0Uses,
      special100Uses: actionStats.special100Uses
    };
    titleCatalog.forEach(title => {
      if (Object.prototype.hasOwnProperty.call(progressValues, title.unlockType)
        && Number(progressValues[title.unlockType]) >= Number(title.unlockValue)
        && !unlockedTitleIds.includes(title.id)) {
        unlockedTitleIds.push(title.id);
        changed = true;
      }
    });
    return changed ? { ...profile, unlockedTitleIds } : profile;
  }

  function addTitleIfOwnedAll(unlockedTitleIds, catalogIds, titleId, requiredTitleIds) {
    if (!catalogIds.has(titleId) || unlockedTitleIds.includes(titleId)) return false;
    if (!requiredTitleIds.every(requiredTitleId => unlockedTitleIds.includes(requiredTitleId))) return false;
    unlockedTitleIds.push(titleId);
    return true;
  }

  function applyCombinationTitleUnlocks(profile, titleCatalog = defaultTitleDefinitions) {
    const unlockedTitleIds = normalizeUnlockedTitleIds(profile.unlockedTitleIds, titleCatalog);
    const catalogIds = new Set(titleCatalog.map(title => title.id));
    let changed = false;
    changed = addTitleIfOwnedAll(unlockedTitleIds, catalogIds, "normal_blackwhite_64", [
      "normal_black_perfect",
      "normal_white_perfect"
    ]) || changed;
    changed = addTitleIfOwnedAll(unlockedTitleIds, catalogIds, "special_blackwhite_64", [
      "special_black_64",
      "special_white_64"
    ]) || changed;
    return changed ? { ...profile, unlockedTitleIds } : profile;
  }

  function matchOutcomeDelta(record = {}) {
    const counts = record.counts || {};
    const result = record.gameResult || {};
    const winner = result.winner ?? (counts.black > counts.white ? 1 : counts.white > counts.black ? -1 : 0);
    const playerValue = record.playerColor === "white" ? -1 : 1;
    const delta = { games: 1, wins: 0, losses: 0, draws: 0 };
    if (!winner) delta.draws = 1;
    else if (winner === playerValue) delta.wins = 1;
    else delta.losses = 1;
    return delta;
  }

  function playerMapValue(source, player, fallback = {}) {
    if (!source || typeof source !== "object") return fallback;
    return source[player] ?? source[String(player)] ?? fallback;
  }

  function actionStatsDelta(record = {}) {
    const playerValue = record.playerColor === "white" ? -1 : 1;
    const rules = record.rules || {};
    const specialUsed = playerMapValue(record.specialUsed, playerValue, {});
    const observeUsesLeft = record.observeUsesLeft || {};
    const observeLimit = Math.max(0, Number(rules.observeUseLimit) || 2);
    const observeLeft = Number(observeUsesLeft[playerValue] ?? observeUsesLeft[String(playerValue)]);
    return normalizeActionStats({
      openUses: Number.isFinite(observeLeft) ? Math.max(0, observeLimit - observeLeft) : 0,
      special0Uses: Number(specialUsed[0] ?? specialUsed["0"]) || 0,
      special100Uses: Number(specialUsed[100] ?? specialUsed["100"]) || 0
    });
  }

  function calculatePawPoints(record = {}) {
    if (record.matchType !== "random") return null;
    const counts = record.counts || {};
    const blackCount = Math.max(0, Number(counts.black) || 0);
    const whiteCount = Math.max(0, Number(counts.white) || 0);
    const playerValue = record.playerColor === "white" ? -1 : 1;
    const ownCount = playerValue === 1 ? blackCount : whiteCount;
    const opponentCount = playerValue === 1 ? whiteCount : blackCount;
    const result = record.gameResult || {};
    const winner = result.winner ?? (blackCount > whiteCount ? 1 : whiteCount > blackCount ? -1 : 0);
    const isWin = winner === playerValue;
    const isLoss = winner && winner !== playerValue;
    const isResign = result.type === "resign";
    const isDisconnect = result.type === "disconnect";
    if (isLoss && isDisconnect) {
      return {
        total: -100,
        breakdown: [{ label: "切断で敗北する", value: -100, kind: "add" }],
        perfectWin: false
      };
    }

    const breakdown = [{ label: "対局をする", value: 10, kind: "add" }];
    let subtotal = 10;

    if (!isResign && !isDisconnect && ownCount > 0) {
      breakdown.push({ label: "終局時のねこの数", value: ownCount, kind: "add" });
      subtotal += ownCount;
    }
    if (isWin) {
      breakdown.push({ label: "対局に勝利する", value: 20, kind: "add" });
      subtotal += 20;
      if (isResign) {
        breakdown.push({ label: "相手の投了で勝利する", value: 64, kind: "add" });
        subtotal += 64;
      }
      if (isDisconnect) {
        breakdown.push({ label: "相手の切断で勝利する", value: 64, kind: "add" });
        subtotal += 64;
      }
    }
    if (!winner) {
      breakdown.push({ label: "引き分け", value: 10, kind: "add" });
      subtotal += 10;
    }

    const perfectWin = !isResign && !isDisconnect && isWin && ownCount > 0 && opponentCount === 0;
    const total = perfectWin ? subtotal * 2 : subtotal;
    if (perfectWin) {
      breakdown.push({ label: "パーフェクト勝ち", value: 2, kind: "multiply" });
    }
    return { total, breakdown, perfectWin };
  }

  function titleUnlocksForMatch(record = {}, titleCatalog = defaultTitleDefinitions) {
    if (record.matchType !== "random") return [];
    const counts = record.counts || {};
    const blackCount = Math.max(0, Number(counts.black) || 0);
    const whiteCount = Math.max(0, Number(counts.white) || 0);
    const playerValue = record.playerColor === "white" ? -1 : 1;
    const ownCount = playerValue === 1 ? blackCount : whiteCount;
    const opponentCount = playerValue === 1 ? whiteCount : blackCount;
    const result = record.gameResult || {};
    const winner = result.winner ?? (blackCount > whiteCount ? 1 : whiteCount > blackCount ? -1 : 0);
    const isScoreResult = !result.type || result.type === "score";
    const catalogIds = new Set(titleCatalog.map(title => title.id));
    const unlocked = [];

    if (!isScoreResult || !winner) {
      return unlocked;
    }

    if (winner !== playerValue) {
      const lossTitleIds = highWinRateLossTitleUnlocksForMatch(record, playerValue, catalogIds);
      lossTitleIds.forEach(titleId => unlocked.push(titleId));
      return unlocked;
    }

    const comebackTitleIds = comebackTitleUnlocksForMatch(record, playerValue, catalogIds);
    comebackTitleIds.forEach(titleId => unlocked.push(titleId));

    if (ownCount <= 0 || opponentCount !== 0) return unlocked;

    const perfectTitleId = playerValue === 1 ? "normal_black_perfect" : "normal_white_perfect";
    if (catalogIds.has(perfectTitleId)) unlocked.push(perfectTitleId);

    const perfect64TitleId = playerValue === 1 ? "special_black_64" : "special_white_64";
    if (ownCount === 64 && catalogIds.has(perfect64TitleId)) unlocked.push(perfect64TitleId);

    return unlocked;
  }

  function comebackTitleUnlocksForMatch(record = {}, playerValue, catalogIds) {
    const winRates = normalizeWinRates(record.lastOpenWinRates);
    if (!winRates) return [];
    const playerRate = playerValue === 1 ? winRates.black : winRates.white;
    if (!Number.isFinite(playerRate)) return [];
    const thresholds = [
      { max: 30, id: "normal_thirty_percent_win" },
      { max: 20, id: "normal_twenty_percent_win" },
      { max: 10, id: "normal_ten_percent_win" },
      { max: 5, id: "normal_five_percent_win" },
      { max: 1, id: "normal_one_percent_win" },
      { max: 0.1, id: "normal_miracle_comeback" }
    ];
    return thresholds
      .filter(title => playerRate <= title.max && catalogIds.has(title.id))
      .map(title => title.id);
  }

  function highWinRateLossTitleUnlocksForMatch(record = {}, playerValue, catalogIds) {
    const winRates = normalizeWinRates(record.lastOpenWinRates);
    if (!winRates) return [];
    const playerRate = playerValue === 1 ? winRates.black : winRates.white;
    if (!Number.isFinite(playerRate)) return [];
    const thresholds = [
      { min: 70, id: "normal_seventy_percent_lose" },
      { min: 80, id: "normal_eighty_percent_lose" },
      { min: 90, id: "normal_ninety_percent_lose" },
      { min: 95, id: "normal_ninetyfive_percent_lose" },
      { min: 99, id: "normal_ninetynine_percent_lose" },
      { min: 99.9, id: "normal_unbilievable_lose" }
    ];
    return thresholds
      .filter(title => playerRate >= title.min && catalogIds.has(title.id))
      .map(title => title.id);
  }

  function normalizeWinRates(value) {
    if (!value || typeof value !== "object") return null;
    const black = Number(value.black);
    const white = Number(value.white);
    const draw = Number(value.draw);
    if (!Number.isFinite(black) || !Number.isFinite(white) || !Number.isFinite(draw)) return null;
    return {
      black: Math.min(100, Math.max(0, black)),
      white: Math.min(100, Math.max(0, white)),
      draw: Math.min(100, Math.max(0, draw))
    };
  }

  function cleanFirestoreData(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map(item => {
        const cleaned = cleanFirestoreData(item);
        return cleaned === undefined ? null : cleaned;
      });
    }

    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, cleanFirestoreData(item)])
      .filter(([, item]) => item !== undefined));
  }

  async function loadProfile() {
    if (cachedProfile) return cachedProfile;
    if (profilePromise) return profilePromise;

    profilePromise = (async () => {
      const localProfile = readLocalProfile();
      try {
        const user = await ensureAnonymousUser();
        if (!user || !db) throw new Error("Firebase profile is unavailable.");
        const titleCatalog = await loadTitleCatalog();

        let profile = normalizeProfileData({}, localProfile, user.uid, titleCatalog);

        try {
          const ref = profileRef(user.uid);
          const today = todayJstKey();
          const yesterday = yesterdayJstKey();
          let progressUnlocks = [];
          await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const data = snapshot.exists ? snapshot.data() : {};
            profile = normalizeProfileData(data, localProfile, user.uid, titleCatalog);
            const shouldCountLogin = profile.lastLoginDate !== today;
            if (shouldCountLogin) {
              profile.loginDays += 1;
              profile.currentLoginStreak = profile.lastLoginDate === yesterday
                ? profile.currentLoginStreak + 1
                : 1;
              profile.longestLoginStreak = Math.max(profile.longestLoginStreak, profile.currentLoginStreak);
              profile.lastLoginDate = today;
            }
            const beforeProgressUnlocks = new Set(profile.unlockedTitleIds);
            profile = applyProgressTitleUnlocks(profile, titleCatalog);
            profile = applyCombinationTitleUnlocks(profile, titleCatalog);
            progressUnlocks = profile.unlockedTitleIds.filter(titleId => !beforeProgressUnlocks.has(titleId));
            const payload = {
              name: profile.name,
              title: profile.title,
              titleId: profile.titleId,
              unlockedTitleIds: profile.unlockedTitleIds,
              loginDays: profile.loginDays,
              currentLoginStreak: profile.currentLoginStreak,
              longestLoginStreak: profile.longestLoginStreak,
              lastLoginDate: profile.lastLoginDate,
              pawPoints: profile.pawPoints,
              randomStats: profile.randomStats,
              actionStats: profile.actionStats,
              updatedAt: serverTimestamp()
            };
            if (!snapshot.exists) payload.createdAt = serverTimestamp();
            transaction.set(ref, payload, { merge: true });
          });
          if (progressUnlocks.length) queueTitleUnlockNotifications(progressUnlocks, titleCatalog);
        } catch {
          profile.profileSaveFailed = true;
        }

        mirrorProfile(profile);
        cachedProfile = profile;
        return profile;
      } catch {
        cachedProfile = {
          playerId: null,
          ...localProfile,
          offline: true
        };
        return cachedProfile;
      } finally {
        profilePromise = null;
      }
    })();

    return profilePromise;
  }

  async function saveProfile(nextProfile = {}) {
    const current = await loadProfile();
    const titleCatalog = await loadTitleCatalog();
    const unlockedTitleIds = normalizeUnlockedTitleIds(current.unlockedTitleIds, titleCatalog);
    let titleId = normalizeTitleId(nextProfile.titleId ?? nextProfile.title ?? current.titleId ?? current.title, titleCatalog);
    if (!unlockedTitleIds.includes(titleId)) titleId = defaultTitleId;
    const profile = {
      playerId: current.playerId,
      name: sanitizeName(nextProfile.name ?? current.name) || defaultName,
      title: titleNameById(titleId, titleCatalog),
      titleId,
      unlockedTitleIds,
      loginDays: Math.max(0, Number(current.loginDays) || 0),
      currentLoginStreak: Math.max(0, Number(current.currentLoginStreak) || 0),
      longestLoginStreak: Math.max(0, Number(current.longestLoginStreak) || 0),
      lastLoginDate: String(current.lastLoginDate || ""),
      pawPoints: Number.isFinite(Number(current.pawPoints)) ? Math.trunc(Number(current.pawPoints)) : 0,
      randomStats: normalizeStats(current.randomStats),
      actionStats: normalizeActionStats(current.actionStats),
      offline: Boolean(current.offline)
    };
    mirrorProfile(profile);
    cachedProfile = profile;

    if (!profile.offline && profile.playerId && db) {
      await profileRef(profile.playerId).set({
        name: profile.name,
        title: profile.title,
        titleId: profile.titleId,
        unlockedTitleIds: profile.unlockedTitleIds,
        actionStats: profile.actionStats,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return profile;
  }

  async function unlockTitle(titleId) {
    const profile = await loadProfile();
    const titleCatalog = await loadTitleCatalog();
    const rawTitleId = sanitizeTitleId(titleId);
    const normalizedTitleId = titleCatalog.some(title => title.id === rawTitleId) ? rawTitleId : "";
    if (!normalizedTitleId) return profile;

    const unlockedTitleIds = normalizeUnlockedTitleIds(profile.unlockedTitleIds, titleCatalog);
    if (unlockedTitleIds.includes(normalizedTitleId)) return profile;
    unlockedTitleIds.push(normalizedTitleId);

    const nextProfile = {
      ...profile,
      unlockedTitleIds
    };
    cachedProfile = nextProfile;

    if (!profile.offline && profile.playerId && db) {
      await profileRef(profile.playerId).set({
        unlockedTitleIds: arrayUnion(normalizedTitleId),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return nextProfile;
  }

  function timestampToMs(value, fallback = Date.now()) {
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

  function normalizeMatchRecord(record = {}) {
    const playedAt = timestampToMs(record.playedAt || record.finishedAt || Date.now());
    const startedAtSource = record.startedAt || record.startedAtMs || record.createdAt || playedAt;
    const finishedAtSource = record.finishedAt || playedAt;
    const playerNames = record.playerNames || {};
    const playerTitles = record.playerTitles || {};
    const counts = record.counts || {};
    return {
      roomCode: record.roomCode || "",
      playerId: record.playerId || "",
      playerColor: record.playerColor || "",
      matchType: record.matchType === "random" ? "random" : "friend",
      playerNames,
      playerTitles,
      startedAt: formatDateTimeText(startedAtSource, playedAt),
      finishedAt: formatDateTimeText(finishedAtSource, playedAt),
      playedAt,
      result: record.result || null,
      gameResult: record.gameResult || null,
      counts,
      lastOpenWinRates: normalizeWinRates(record.lastOpenWinRates),
      rules: record.rules || null,
      specialUsed: record.specialUsed || null,
      observeUsesLeft: record.observeUsesLeft || null,
      pawPoints: record.pawPoints || null,
      version: Number(record.version) || 0
    };
  }

  async function saveMatchHistory(record = {}) {
    const titleCatalog = await loadTitleCatalog();
    const normalized = normalizeMatchRecord(record);
    normalized.pawPoints = normalized.matchType === "random"
      ? calculatePawPoints(normalized)
      : null;
    mirrorHistory(normalized);

    const profile = await loadProfile();
    if (profile.offline || !profile.playerId || !db || !normalized.roomCode) return normalized;

    const playerRef = profileRef(profile.playerId);
    const matchRef = playerRef.collection("matches").doc(normalized.roomCode);
    const beforeUnlocked = new Set(normalizeUnlockedTitleIds(profile.unlockedTitleIds, titleCatalog));
    let matchTitleUnlocks = titleUnlocksForMatch(normalized, titleCatalog);
    if (normalized.matchType === "random") {
      const outcomeDelta = matchOutcomeDelta(normalized);
      const actionDelta = actionStatsDelta(normalized);
      const progressProfileAfterMatch = applyProgressTitleUnlocks({
        ...profile,
        randomStats: normalizeStats({
          games: (profile.randomStats?.games || 0) + outcomeDelta.games,
          wins: (profile.randomStats?.wins || 0) + outcomeDelta.wins,
          losses: (profile.randomStats?.losses || 0) + outcomeDelta.losses,
          draws: (profile.randomStats?.draws || 0) + outcomeDelta.draws
        }),
        actionStats: normalizeActionStats({
          openUses: (profile.actionStats?.openUses || 0) + actionDelta.openUses,
          special0Uses: (profile.actionStats?.special0Uses || 0) + actionDelta.special0Uses,
          special100Uses: (profile.actionStats?.special100Uses || 0) + actionDelta.special100Uses
        }),
        unlockedTitleIds: Array.from(new Set([...beforeUnlocked, ...matchTitleUnlocks]))
      }, titleCatalog);
      matchTitleUnlocks = Array.from(new Set([
        ...matchTitleUnlocks,
        ...progressProfileAfterMatch.unlockedTitleIds.filter(titleId => !beforeUnlocked.has(titleId))
      ]));
    }
    const titleProfileAfterMatch = applyCombinationTitleUnlocks({
      ...profile,
      unlockedTitleIds: Array.from(new Set([...beforeUnlocked, ...matchTitleUnlocks]))
    }, titleCatalog);
    matchTitleUnlocks = titleProfileAfterMatch.unlockedTitleIds.filter(titleId => !beforeUnlocked.has(titleId));
    const newMatchTitleUnlocks = matchTitleUnlocks.filter(titleId => !beforeUnlocked.has(titleId));
    const delta = normalized.matchType === "random" ? matchOutcomeDelta(normalized) : null;
    const actionDelta = normalized.matchType === "random" ? actionStatsDelta(normalized) : null;
    const pawPointTotal = normalized.matchType === "random" ? Number(normalized.pawPoints?.total) || 0 : 0;
    let rewardApplied = false;
    try {
      rewardApplied = await db.runTransaction(async transaction => {
        const existing = await transaction.get(matchRef);
        const existingData = existing.exists ? existing.data() || {} : {};
        if (existing.exists && existingData.rewardApplied !== false) return false;

        const matchPayload = cleanFirestoreData({
          ...normalized,
          playerId: profile.playerId,
          rewardApplied: true
        });
        matchPayload.rewardAppliedAt = serverTimestamp();
        if (existing.exists) {
          transaction.set(matchRef, {
            rewardApplied: true,
            rewardAppliedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else {
          transaction.set(matchRef, matchPayload);
        }

        const playerPayload = {
          updatedAt: serverTimestamp()
        };
        if (matchTitleUnlocks.length) {
          playerPayload.unlockedTitleIds = arrayUnion(...matchTitleUnlocks);
        }
        if (normalized.matchType === "random") {
          playerPayload.pawPoints = incrementBy(pawPointTotal);
          playerPayload.randomStats = {
            games: incrementBy(delta.games),
            wins: incrementBy(delta.wins),
            losses: incrementBy(delta.losses),
            draws: incrementBy(delta.draws)
          };
          playerPayload.actionStats = {
            openUses: incrementBy(actionDelta.openUses),
            special0Uses: incrementBy(actionDelta.special0Uses),
            special100Uses: incrementBy(actionDelta.special100Uses)
          };
        }
        transaction.set(playerRef, playerPayload, { merge: true });
        return true;
      });
    } catch (error) {
      throw error;
    }

    if (rewardApplied && cachedProfile?.playerId === profile.playerId) {
      if (matchTitleUnlocks.length) {
        const nextUnlocked = normalizeUnlockedTitleIds(cachedProfile.unlockedTitleIds, titleCatalog);
        matchTitleUnlocks.forEach(titleId => {
          if (!nextUnlocked.includes(titleId)) nextUnlocked.push(titleId);
        });
        cachedProfile.unlockedTitleIds = nextUnlocked;
      }
      if (normalized.matchType === "random") {
        cachedProfile.randomStats = normalizeStats({
          games: (cachedProfile.randomStats?.games || 0) + delta.games,
          wins: (cachedProfile.randomStats?.wins || 0) + delta.wins,
          losses: (cachedProfile.randomStats?.losses || 0) + delta.losses,
          draws: (cachedProfile.randomStats?.draws || 0) + delta.draws
        });
        cachedProfile.pawPoints = (Number(cachedProfile.pawPoints) || 0) + pawPointTotal;
        cachedProfile.actionStats = normalizeActionStats({
          openUses: (cachedProfile.actionStats?.openUses || 0) + actionDelta.openUses,
          special0Uses: (cachedProfile.actionStats?.special0Uses || 0) + actionDelta.special0Uses,
          special100Uses: (cachedProfile.actionStats?.special100Uses || 0) + actionDelta.special100Uses
        });
      }
    }
    if (rewardApplied && newMatchTitleUnlocks.length) {
      queueTitleUnlockNotifications(newMatchTitleUnlocks, titleCatalog);
    }
    return normalized;
  }

  async function loadMatchHistory(limit = 20) {
    const profile = await loadProfile();
    if (profile.offline || !profile.playerId || !db) return readLocalHistory(limit);

    try {
      const snapshot = await profileRef(profile.playerId)
        .collection("matches")
        .orderBy("playedAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs.map(doc => {
        const data = doc.data();
        const playedAt = timestampToMs(data.playedAt || data.finishedAt);
        return {
          ...data,
          roomCode: data.roomCode || doc.id,
          startedAt: formatDateTimeText(data.startedAt || data.startedAtMs || data.createdAt || playedAt, playedAt),
          finishedAt: formatDateTimeText(data.finishedAt || playedAt, playedAt),
          playedAt
        };
      });
    } catch {
      return readLocalHistory(limit);
    }
  }

  window.CatProfile = {
    allowedTitles: Array.from(allowedTitles),
    defaultTitleDefinitions,
    defaultName,
    defaultTitle,
    sanitizeName,
    normalizeTitle,
    normalizeTitleId,
    normalizeTitleRarity,
    titleNameById,
    loadTitleCatalog,
    loadProfile,
    saveProfile,
    unlockTitle,
    consumePendingTitleUnlockNotifications,
    loadUnseenTitleIds,
    markTitleIdsSeen,
    loadMatchHistory,
    saveMatchHistory,
    calculatePawPoints,
    normalizeStats
  };
})();

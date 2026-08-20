(() => {
  const nicknameKey = "catinboxOnlineNickname";
  const titleKey = "catinboxPlayerTitle";
  const matchHistoryKey = "catinboxMatchHistory";
  const defaultName = "ねこさん";
  const defaultTitle = "新米ねこ";
  const allowedTitles = new Set(["新米ねこ", "アマチュアねこ", "ボスねこ"]);
  const defaultRandomStats = {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0
  };

  let auth = null;
  let db = null;
  let cachedProfile = null;
  let profilePromise = null;

  function sanitizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 12);
  }

  function normalizeTitle(value) {
    return allowedTitles.has(value) ? value : defaultTitle;
  }

  function readLocalProfile() {
    return {
      name: sanitizeName(localStorage.getItem(nicknameKey)) || defaultName,
      title: normalizeTitle(localStorage.getItem(titleKey)),
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

  function profileRef(playerId) {
    return db.collection("players").doc(playerId);
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

  function normalizeProfileData(data = {}, localProfile = readLocalProfile(), playerId = null) {
    return {
      playerId,
      name: sanitizeName(data.name) || localProfile.name || defaultName,
      title: normalizeTitle(data.title || localProfile.title),
      loginDays: Math.max(0, Number(data.loginDays) || 0),
      currentLoginStreak: Math.max(0, Number(data.currentLoginStreak) || 0),
      longestLoginStreak: Math.max(0, Number(data.longestLoginStreak) || 0),
      lastLoginDate: String(data.lastLoginDate || ""),
      pawPoints: Number.isFinite(Number(data.pawPoints)) ? Math.trunc(Number(data.pawPoints)) : 0,
      randomStats: normalizeStats(data.randomStats)
    };
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

  async function loadProfile() {
    if (cachedProfile) return cachedProfile;
    if (profilePromise) return profilePromise;

    profilePromise = (async () => {
      const localProfile = readLocalProfile();
      try {
        const user = await ensureAnonymousUser();
        if (!user || !db) throw new Error("Firebase profile is unavailable.");

        let profile = normalizeProfileData({}, localProfile, user.uid);

        try {
          const ref = profileRef(user.uid);
          const today = todayJstKey();
          const yesterday = yesterdayJstKey();
          await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref);
            const data = snapshot.exists ? snapshot.data() : {};
            profile = normalizeProfileData(data, localProfile, user.uid);
            const shouldCountLogin = profile.lastLoginDate !== today;
            if (shouldCountLogin) {
              profile.loginDays += 1;
              profile.currentLoginStreak = profile.lastLoginDate === yesterday
                ? profile.currentLoginStreak + 1
                : 1;
              profile.longestLoginStreak = Math.max(profile.longestLoginStreak, profile.currentLoginStreak);
              profile.lastLoginDate = today;
            }
            const payload = {
              name: profile.name,
              title: profile.title,
              loginDays: profile.loginDays,
              currentLoginStreak: profile.currentLoginStreak,
              longestLoginStreak: profile.longestLoginStreak,
              lastLoginDate: profile.lastLoginDate,
              pawPoints: profile.pawPoints,
              randomStats: profile.randomStats,
              updatedAt: serverTimestamp()
            };
            if (!snapshot.exists) payload.createdAt = serverTimestamp();
            transaction.set(ref, payload, { merge: true });
          });
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
    const profile = {
      playerId: current.playerId,
      name: sanitizeName(nextProfile.name ?? current.name) || defaultName,
      title: normalizeTitle(nextProfile.title ?? current.title),
      loginDays: Math.max(0, Number(current.loginDays) || 0),
      currentLoginStreak: Math.max(0, Number(current.currentLoginStreak) || 0),
      longestLoginStreak: Math.max(0, Number(current.longestLoginStreak) || 0),
      lastLoginDate: String(current.lastLoginDate || ""),
      pawPoints: Number.isFinite(Number(current.pawPoints)) ? Math.trunc(Number(current.pawPoints)) : 0,
      randomStats: normalizeStats(current.randomStats),
      offline: Boolean(current.offline)
    };
    mirrorProfile(profile);
    cachedProfile = profile;

    if (!profile.offline && profile.playerId && db) {
      await profileRef(profile.playerId).set({
        name: profile.name,
        title: profile.title,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    return profile;
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
      pawPoints: record.pawPoints || null,
      version: Number(record.version) || 0
    };
  }

  async function saveMatchHistory(record = {}) {
    const normalized = normalizeMatchRecord(record);
    normalized.pawPoints = normalized.matchType === "random"
      ? calculatePawPoints(normalized)
      : null;
    mirrorHistory(normalized);

    const profile = await loadProfile();
    if (profile.offline || !profile.playerId || !db || !normalized.roomCode) return normalized;

    const playerRef = profileRef(profile.playerId);
    const matchRef = playerRef.collection("matches").doc(normalized.roomCode);
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(matchRef);
      transaction.set(matchRef, {
        ...normalized,
        playerId: profile.playerId
      });
      if (!existing.exists && normalized.matchType === "random") {
        const delta = matchOutcomeDelta(normalized);
        const pawPointTotal = Number(normalized.pawPoints?.total) || 0;
        transaction.set(playerRef, {
          pawPoints: incrementBy(pawPointTotal),
          randomStats: {
            games: incrementBy(delta.games),
            wins: incrementBy(delta.wins),
            losses: incrementBy(delta.losses),
            draws: incrementBy(delta.draws)
          },
          updatedAt: serverTimestamp()
        }, { merge: true });
        if (cachedProfile?.playerId === profile.playerId) {
          cachedProfile.randomStats = normalizeStats({
            games: (cachedProfile.randomStats?.games || 0) + delta.games,
            wins: (cachedProfile.randomStats?.wins || 0) + delta.wins,
            losses: (cachedProfile.randomStats?.losses || 0) + delta.losses,
            draws: (cachedProfile.randomStats?.draws || 0) + delta.draws
          });
          cachedProfile.pawPoints = (Number(cachedProfile.pawPoints) || 0) + pawPointTotal;
        }
      }
    });
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
    defaultName,
    defaultTitle,
    sanitizeName,
    normalizeTitle,
    loadProfile,
    saveProfile,
    loadMatchHistory,
    saveMatchHistory,
    calculatePawPoints,
    normalizeStats
  };
})();

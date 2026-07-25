(() => {
  const textEl = document.querySelector("#feedbackText");
  const statusEl = document.querySelector("#feedbackStatus");
  const backButton = document.querySelector("#backButton");
  const sendButton = document.querySelector("#sendButton");
  const audio = window.OthelloAudio?.createMatchAudioController?.();

  let db = null;
  let authReady = false;
  let sending = false;

  function isShellFrame() {
    return window.parent && window.parent !== window && sessionStorage.getItem("othelloShellAudio") === "1";
  }

  function navigate(path) {
    if (isShellFrame()) {
      window.parent.postMessage({ type: "othello:navigate", path, click: false }, "*");
      return;
    }
    location.href = path;
  }

  function playClickSe() {
    audio?.playSound?.(window.OthelloAudio.sounds.uiClick, 0.55);
  }

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function serverTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function getNickname() {
    return String(localStorage.getItem("catinboxOnlineNickname") || "").trim().slice(0, 12);
  }

  function canSend() {
    return Boolean(db && authReady);
  }

  async function sendFeedback() {
    if (sending) return;
    const text = textEl.value.trim();
    if (!text) {
      setStatus("テキストを入力してください", true);
      return;
    }
    if (!canSend()) {
      setStatus("送信の準備中です。少し待ってからもう一度お試しください。", true);
      return;
    }

    sending = true;
    sendButton.disabled = true;
    setStatus("送信しています...");
    try {
      await db.collection("feedback").add({
        text,
        nickname: getNickname(),
        createdAt: serverTimestamp(),
        userAgent: navigator.userAgent,
        screen: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      });
      textEl.value = "";
      setStatus("送信しました。ありがとうございます！");
    } catch {
      setStatus("送信に失敗しました。通信環境を確認して、もう一度お試しください。", true);
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  }

  function bootFirebase() {
    try {
      if (!window.firebase || !window.OthelloFirebaseConfig) {
        setStatus("送信機能の読み込みに失敗しました。通信環境を確認してください。", true);
        return;
      }
      const app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.OthelloFirebaseConfig);
      const auth = firebase.auth(app);
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
        if (user) {
          authReady = true;
          if (!statusEl.textContent) setStatus("");
        }
      });
      auth.signInAnonymously().catch(() => {
        setStatus("送信機能への接続に失敗しました。通信環境を確認してください。", true);
      });
    } catch {
      setStatus("送信機能の準備に失敗しました。ページを再読み込みしてください。", true);
    }
  }

  backButton.addEventListener("click", () => navigate("mode-select.html"));
  sendButton.addEventListener("click", sendFeedback);
  textEl.addEventListener("input", () => {
    if (statusEl.classList.contains("error") && statusEl.textContent === "テキストを入力してください") {
      setStatus("");
    }
  });
  document.addEventListener("click", event => {
    if (event.target.closest("button")) playClickSe();
  });

  bootFirebase();
})();

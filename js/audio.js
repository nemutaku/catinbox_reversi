(() => {
  const audioSettingsKey = 'othelloAudioSettings';
  const audioStateKey = 'othelloBgmState';
  const audioPrimeKey = 'othelloAudioPrime';
  const matchBgmFiles = new Set(['match-01.mp3', 'match-02.mp3']);
  const seGain = 2;
  const defaults = { bgmEnabled: true, seEnabled: true, bgmVolume: 0.45, seVolume: 0.7, matchBgm: 'match-01.mp3' };
  const sounds = {
    stonePlace: 'assets/audio/se/box-place.mp3',
    observeStart: 'assets/audio/se/box-open.mp3',
    observeChange: 'assets/audio/se/meow.mp3',
    uiClick: 'assets/audio/se/ui-click.mp3'
  };
  const bufferCache = new Map();
  let audioContext = null;

  function isLocalFilePage() {
    return window.location.protocol === 'file:';
  }

  function clamp(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(1, number));
  }

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioContext = new AudioContextClass();
    }
    return audioContext;
  }

  function resumeAudioContext() {
    const context = getAudioContext();
    if (!context) return Promise.resolve(null);
    if (context.state === 'suspended') return context.resume().then(() => context);
    return Promise.resolve(context);
  }

  function getAudioSettings() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(audioSettingsKey) || '{}') };
    } catch {
      return defaults;
    }
  }

  function saveAudioSettings(settings) {
    localStorage.setItem(audioSettingsKey, JSON.stringify(settings));
  }

  function volumeWithGain(volume, gain = 1) {
    return clamp(volume, 0) * gain;
  }

  function bgmPath(fileName) {
    return `assets/audio/bgm/${matchBgmFiles.has(fileName) ? fileName : defaults.matchBgm}`;
  }

  function readBgmState() {
    try {
      return JSON.parse(sessionStorage.getItem(audioStateKey) || 'null');
    } catch {
      return null;
    }
  }

  function writeBgmState(state) {
    sessionStorage.setItem(audioStateKey, JSON.stringify({
      src: state.src,
      currentTime: state.currentTime || 0,
      updatedAt: state.updatedAt || Date.now()
    }));
  }

  function loadArrayBuffer(src) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', src, true);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        if (request.status === 0 || (request.status >= 200 && request.status < 300)) resolve(request.response);
        else reject(new Error(`Audio load failed: ${src}`));
      };
      request.onerror = reject;
      request.send();
    });
  }

  async function loadAudioBuffer(src) {
    if (bufferCache.has(src)) return bufferCache.get(src);
    const context = await resumeAudioContext();
    if (!context) throw new Error('Web Audio API is not available.');
    const arrayBuffer = await loadArrayBuffer(src);
    const buffer = await context.decodeAudioData(arrayBuffer);
    bufferCache.set(src, buffer);
    return buffer;
  }

  function playBufferedSound(src, volume = 0.7) {
    const settings = getAudioSettings();
    if (!settings.seEnabled) return;
    if (isLocalFilePage()) {
      playPlainElementSound(src, volume, settings);
      return;
    }
    loadAudioBuffer(src)
      .then(buffer => {
        const context = getAudioContext();
        if (!context) return;
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = Math.min(1, volumeWithGain(settings.seVolume, volume * seGain));
        source.connect(gain);
        gain.connect(context.destination);
        source.start(0);
      })
      .catch(() => playElementSound(src, volume, settings));
  }

  function playPlainElementSound(src, volume = 0.7, settings = getAudioSettings()) {
    const element = new Audio(src);
    element.preload = 'auto';
    element.volume = Math.min(1, volumeWithGain(settings.seVolume, volume * seGain));
    element.play().catch(() => {});
  }

  function playElementSound(src, volume = 0.7, settings = getAudioSettings()) {
    const context = getAudioContext();
    if (!context) return;
    const element = new Audio(src);
    element.preload = 'auto';
    element.volume = 1;
    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    gain.gain.value = Math.min(1, volumeWithGain(settings.seVolume, volume * seGain));
    source.connect(gain);
    gain.connect(context.destination);
    const cleanup = () => {
      source.disconnect();
      gain.disconnect();
    };
    element.addEventListener('ended', cleanup, { once: true });
    element.addEventListener('error', cleanup, { once: true });
    resumeAudioContext()
      .then(() => element.play())
      .catch(cleanup);
  }

  function createBgmController({ initialSrc = '', loop = true, bgmGain = 0.5 } = {}) {
    const element = new Audio(initialSrc);
    element.loop = loop;
    element.preload = 'auto';
    element.volume = 1;
    let sourceNode = null;
    let gainNode = null;
    let mutedByGain = false;

    function connect() {
      if (isLocalFilePage()) return null;
      const context = getAudioContext();
      if (!context) return null;
      if (!sourceNode) {
        sourceNode = context.createMediaElementSource(element);
        gainNode = context.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(context.destination);
      }
      return context;
    }

    function applyVolume(settings = getAudioSettings()) {
      connect();
      if (!gainNode) {
        element.volume = mutedByGain ? 0 : Math.min(1, volumeWithGain(settings.bgmVolume, bgmGain));
        return;
      }
      gainNode.gain.value = mutedByGain ? 0 : Math.min(1, volumeWithGain(settings.bgmVolume, bgmGain));
    }

    function play() {
      connect();
      applyVolume();
      if (isLocalFilePage()) return element.play();
      return resumeAudioContext().then(() => element.play());
    }

    function pause() {
      element.pause();
    }

    const controller = {
      play,
      pause,
      applyVolume,
      addEventListener: (...args) => element.addEventListener(...args),
      getAttribute: name => element.getAttribute(name),
      setAttribute: (...args) => element.setAttribute(...args)
    };

    Object.defineProperties(controller, {
      src: {
        get: () => element.src,
        set: value => {
          element.src = value;
        }
      },
      currentTime: {
        get: () => element.currentTime,
        set: value => {
          element.currentTime = value;
        }
      },
      duration: { get: () => element.duration },
      readyState: { get: () => element.readyState },
      paused: { get: () => element.paused },
      muted: {
        get: () => mutedByGain,
        set: value => {
          mutedByGain = Boolean(value);
          applyVolume();
        }
      }
    });

    return controller;
  }

  function createMatchAudioController({ bgmGain = 0.5 } = {}) {
    const useShellBgm = () => window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1';
    const bgm = createBgmController({ bgmGain });
    let bgmStarted = false;
    let bgmResumeApplied = false;

    function restoreAudibleBgm() {
      bgm.muted = false;
      bgm.applyVolume(getAudioSettings());
    }

    function applySavedBgmPosition() {
      if (bgmResumeApplied) return;
      bgmResumeApplied = true;
      const state = readBgmState();
      if (!state || !state.src || !bgm.src.endsWith(state.src)) return;
      const elapsed = Math.max(0, (Date.now() - state.updatedAt) / 1000);
      const seek = () => {
        const nextTime = state.currentTime + elapsed;
        bgm.currentTime = Number.isFinite(bgm.duration) ? nextTime % bgm.duration : nextTime;
      };
      if (bgm.readyState >= 1) seek();
      else bgm.addEventListener('loadedmetadata', seek, { once: true });
    }

    function startBgm(primeMuted = false) {
      const settings = getAudioSettings();
      if (!settings.bgmEnabled || bgmStarted) return;
      const savedState = readBgmState();
      bgm.src = savedState && savedState.src && savedState.src.includes('/bgm/match-') ? savedState.src : bgmPath(settings.matchBgm);
      applySavedBgmPosition();
      bgm.muted = primeMuted;
      bgm.applyVolume(settings);
      bgmStarted = true;
      bgm.play()
        .then(() => {
          if (primeMuted) setTimeout(restoreAudibleBgm, 920);
        })
        .catch(() => {
          bgm.muted = false;
          bgmStarted = false;
          document.addEventListener('pointerdown', () => startBgm(false), { once: true });
          document.addEventListener('keydown', () => startBgm(false), { once: true });
        });
    }

    function startBgmAfterPageTransition() {
      if (useShellBgm()) return;
      const shouldPrime = document.documentElement.classList.contains('page-entering') || sessionStorage.getItem(audioPrimeKey) === '1';
      sessionStorage.removeItem(audioPrimeKey);
      startBgm(shouldPrime);
    }

    function saveBgmState() {
      if (useShellBgm()) return;
      if (!bgm.src) return;
      writeBgmState({
        src: bgm.getAttribute('src') || bgm.src.replace(location.href.replace(/[^/]*$/, ''), ''),
        currentTime: bgm.currentTime || 0,
        updatedAt: Date.now()
      });
    }

    function syncBgmSettings() {
      const settings = getAudioSettings();
      const nextSrc = bgmPath(settings.matchBgm);
      if (!bgm.src.endsWith(nextSrc)) {
        const wasPlaying = bgmStarted && !bgm.paused;
        bgm.src = nextSrc;
        if (wasPlaying && settings.bgmEnabled) bgm.play().catch(() => {});
      }
      bgm.applyVolume(settings);
      if (!settings.bgmEnabled) {
        bgm.pause();
        bgmStarted = false;
      }
    }

    return {
      sounds,
      startBgmAfterPageTransition,
      saveBgmState,
      playSound: playBufferedSound,
      syncBgmSettings,
      primeNextPage: () => sessionStorage.setItem(audioPrimeKey, '1'),
      clearBgmState: () => sessionStorage.removeItem(audioStateKey),
      pauseBgm: () => bgm.pause()
    };
  }

  window.OthelloAudio = {
    defaults,
    matchBgmFiles,
    getAudioSettings,
    saveAudioSettings,
    volumeWithGain,
    bgmPath,
    readBgmState,
    writeBgmState,
    playSound: playBufferedSound,
    createBgmController,
    createMatchAudioController,
    keys: { audioSettingsKey, audioStateKey, audioPrimeKey },
    sounds
  };
})();

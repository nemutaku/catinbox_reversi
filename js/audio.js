(() => {
  const audioSettingsKey = 'othelloAudioSettings';
  const audioStateKey = 'othelloBgmState';
  const audioPrimeKey = 'othelloAudioPrime';
  const matchBgmFiles = new Set(['match-01.mp3', 'match-02.mp3']);
  const defaults = { bgmEnabled: true, seEnabled: true, bgmVolume: 0.45, seVolume: 0.7, matchBgm: 'match-01.mp3' };
  const sounds = {
    stonePlace: 'assets/audio/se/stone-place.mp3',
    observeStart: 'assets/audio/se/observe-start.mp3',
    observeChange: 'assets/audio/se/observe-change.mp3',
    uiClick: 'assets/audio/se/ui-click.mp3'
  };

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

  function createMatchAudioController({ bgmGain = 0.5 } = {}) {
    const useShellBgm = () => window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1';
    const bgm = new Audio();
    bgm.loop = true;
    let bgmStarted = false;
    let bgmResumeApplied = false;
    function restoreAudibleBgm() {
      const settings = getAudioSettings();
      bgm.volume = settings.bgmVolume * bgmGain;
      bgm.muted = false;
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
      bgm.volume = settings.bgmVolume * bgmGain;
      bgm.muted = primeMuted;
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

    function playSound(src, volume = 0.7) {
      const settings = getAudioSettings();
      if (!settings.seEnabled) return;
      const sound = new Audio(src);
      sound.volume = volume * settings.seVolume;
      sound.play().catch(() => {});
    }

    function syncBgmSettings() {
      const settings = getAudioSettings();
      const nextSrc = bgmPath(settings.matchBgm);
      if (!bgm.src.endsWith(nextSrc)) {
        const wasPlaying = bgmStarted && !bgm.paused;
        bgm.src = nextSrc;
        if (wasPlaying && settings.bgmEnabled) bgm.play().catch(() => {});
      }
      bgm.volume = settings.bgmVolume * bgmGain;
      if (!settings.bgmEnabled) {
        bgm.pause();
        bgmStarted = false;
      }
    }

    return {
      sounds,
      startBgmAfterPageTransition,
      saveBgmState,
      playSound,
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
    bgmPath,
    readBgmState,
    writeBgmState,
    createMatchAudioController,
    keys: { audioSettingsKey, audioStateKey, audioPrimeKey },
    sounds
  };
})();

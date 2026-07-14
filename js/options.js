(() => {
  const audioApi = window.OthelloAudio;
  const shell = window.parent && window.parent !== window && sessionStorage.getItem('othelloShellAudio') === '1';
  const { audioPrimeKey } = audioApi.keys;
  const restoreGameFlagKey = 'othelloRestoreLocalGame';
  const bgmGain = 0.5;
  const defaults = audioApi.defaults;
  const controls = {
    bgmEnabled: document.querySelector('#bgmEnabled'),
    seEnabled: document.querySelector('#seEnabled'),
    bgmVolume: document.querySelector('#bgmVolume'),
    seVolume: document.querySelector('#seVolume'),
    matchBgmButtons: [...document.querySelectorAll('.bgm-choice-button')],
    bgmValue: document.querySelector('#bgmValue'),
    seValue: document.querySelector('#seValue')
  };
  const optionBgm = new Audio();
  optionBgm.loop = true;
  let optionBgmStarted = false;
  let optionResumeApplied = false;
  const matchBgmFiles = audioApi.matchBgmFiles;
  const bgmPath = audioApi.bgmPath;
  const titleBgmPath = 'assets/audio/bgm/title-01.mp3';

  function loadSettings() {
    return audioApi.getAudioSettings();
  }

  function saveSettings(settings) {
    audioApi.saveAudioSettings(settings);
  }

  function readBgmState() {
    return audioApi.readBgmState();
  }

  function saveBgmState() {
    if (shell) return;
    if (!optionBgm.src) return;
    audioApi.writeBgmState({
      src: optionBgm.getAttribute('src') || optionBgm.src.replace(location.href.replace(/[^/]*$/, ''), ''),
      currentTime: optionBgm.currentTime || 0,
      updatedAt: Date.now()
    });
  }

  function resetBgmStateToSelectedMatch(settings) {
    audioApi.writeBgmState({
      src: bgmPath(settings.matchBgm),
      currentTime: 0,
      updatedAt: Date.now()
    });
  }

  function readControls() {
    const selectedButton = controls.matchBgmButtons.find(button => button.classList.contains('selected'));
    return {
      bgmEnabled: controls.bgmEnabled.checked,
      seEnabled: controls.seEnabled.checked,
      bgmVolume: Number(controls.bgmVolume.value) / 100,
      seVolume: Number(controls.seVolume.value) / 100,
      matchBgm: selectedButton?.dataset.bgm || defaults.matchBgm
    };
  }

  function updateLabels(settings) {
    controls.bgmValue.textContent = `${Math.round(settings.bgmVolume * 100)}%`;
    controls.seValue.textContent = `${Math.round(settings.seVolume * 100)}%`;
  }

  function applyControls(settings) {
    controls.bgmEnabled.checked = settings.bgmEnabled;
    controls.seEnabled.checked = settings.seEnabled;
    controls.bgmVolume.value = Math.round(settings.bgmVolume * 100);
    controls.seVolume.value = Math.round(settings.seVolume * 100);
    const currentBgm = matchBgmFiles.has(settings.matchBgm) ? settings.matchBgm : defaults.matchBgm;
    controls.matchBgmButtons.forEach(button => {
      const selected = button.dataset.bgm === currentBgm;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateLabels(settings);
  }

  function applySavedBgmPosition() {
    if (optionResumeApplied) return;
    optionResumeApplied = true;
    const state = readBgmState();
    if (!state || !state.src || !optionBgm.src.endsWith(state.src)) return;
    const elapsed = Math.max(0, (Date.now() - state.updatedAt) / 1000);
    const seek = () => {
      const nextTime = state.currentTime + elapsed;
      optionBgm.currentTime = Number.isFinite(optionBgm.duration) ? nextTime % optionBgm.duration : nextTime;
    };
    if (optionBgm.readyState >= 1) seek();
    else optionBgm.addEventListener('loadedmetadata', seek, { once: true });
  }

  function restoreAudibleOptionBgm() {
    const settings = loadSettings();
    optionBgm.volume = settings.bgmVolume * bgmGain;
    optionBgm.muted = false;
  }

  function syncOptionBgm(settings, preferSelectedMatch = false, primeMuted = false) {
    if (shell) {
      window.parent.postMessage({ type: 'othello:audio-settings' }, '*');
      return;
    }
    if (preferSelectedMatch) resetBgmStateToSelectedMatch(settings);
    const state = readBgmState();
    const nextSrc = state && state.src ? state.src : titleBgmPath;
    const sourceChanged = !optionBgm.src.endsWith(nextSrc);
    if (!optionBgm.src.endsWith(nextSrc)) {
      optionBgm.src = nextSrc;
      optionResumeApplied = false;
    }
    optionBgm.volume = settings.bgmVolume * bgmGain;
    optionBgm.muted = primeMuted;
    if (preferSelectedMatch) optionBgm.currentTime = 0;
    if (!settings.bgmEnabled) {
      optionBgm.pause();
      optionBgmStarted = false;
      return;
    }
    applySavedBgmPosition();
    if (optionBgmStarted && !preferSelectedMatch && !sourceChanged) return;
    optionBgmStarted = true;
    optionBgm.play()
      .then(() => {
        if (primeMuted) setTimeout(restoreAudibleOptionBgm, 920);
      })
      .catch(() => {
        optionBgm.muted = false;
        optionBgmStarted = false;
        document.addEventListener('pointerdown', () => syncOptionBgm(loadSettings()), { once: true });
        document.addEventListener('keydown', () => syncOptionBgm(loadSettings()), { once: true });
      });
  }

  function onChange() {
    const settings = readControls();
    saveSettings(settings);
    updateLabels(settings);
    if (shell) window.parent.postMessage({ type: 'othello:audio-settings' }, '*');
    syncOptionBgm(settings, false);
  }

  function selectMatchBgm(button) {
    controls.matchBgmButtons.forEach(item => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    const settings = readControls();
    saveSettings(settings);
    if (shell) window.parent.postMessage({ type: 'othello:bgm-type', bgmType: 'match' }, '*');
    syncOptionBgm(settings, true);
  }

  function playSeTest() {
    const settings = loadSettings();
    if (!settings.seEnabled) return;
    const sound = new Audio('assets/audio/se/stone-place.mp3');
    sound.volume = 0.7 * settings.seVolume;
    sound.play().catch(() => {});
  }

  function backPath() {
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'mode') return 'mode-select.html';
    if (from === 'ai') return 'othello-ai.html';
    return from === 'local' ? 'othello-local.html' : 'index.html';
  }

  applyControls(loadSettings());
  const primeOptionBgm = document.documentElement.classList.contains('page-entering') || sessionStorage.getItem(audioPrimeKey) === '1';
  sessionStorage.removeItem(audioPrimeKey);
  syncOptionBgm(loadSettings(), false, primeOptionBgm);
  document.querySelectorAll('input').forEach(input => input.addEventListener('input', onChange));
  controls.matchBgmButtons.forEach(button => button.addEventListener('click', () => selectMatchBgm(button)));
  document.querySelector('#testSe').addEventListener('click', playSeTest);
  document.querySelector('#backButton').addEventListener('click', () => {
    const path = backPath();
    if (path === 'othello-local.html') sessionStorage.setItem(restoreGameFlagKey, '1');
    if (path === 'othello-ai.html') sessionStorage.setItem('othelloRestoreAiGame', '1');
    if (shell) {
      window.parent.postMessage({ type: 'othello:navigate', path }, '*');
      return;
    }
    saveBgmState();
    sessionStorage.setItem(audioPrimeKey, '1');
    location.href = path;
  });
})();

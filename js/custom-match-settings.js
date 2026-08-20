(() => {
  const setupKey = "catinboxCustomInitialSetup";
  const storageKeys = {
    ai: "catinboxAiCustomMatchDraft",
    local: "catinboxLocalCustomMatchDraft"
  };
  const defaults = {
    normalProbability: 80,
    special0Probability: 0,
    special0Uses: 2,
    special100Probability: 100,
    special100Uses: 2,
    observeUseLimit: 2
  };
  const initialPieceTypes = new Set(["cat", "box", "special0", "special100"]);

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function normalizeInitialSetup(source = {}) {
    const cells = Array.isArray(source.cells) ? source.cells : [];
    return {
      cells: cells.map(cell => ({
        r: clampInteger(cell?.r, 0, 7, 0),
        c: clampInteger(cell?.c, 0, 7, 0),
        color: cell?.color === "white" ? "white" : "black",
        type: initialPieceTypes.has(cell?.type) ? cell.type : "cat"
      }))
    };
  }

  function normalizeRules(source = {}) {
    const specialProbabilities = source.specialProbabilities || {};
    const specialUseLimits = source.specialUseLimits || {};
    return {
      normalProbability: clampInteger(source.normalProbability, 0, 100, defaults.normalProbability),
      specialProbabilities: {
        0: clampInteger(specialProbabilities[0] ?? specialProbabilities["0"] ?? source.special0Probability, 0, 100, defaults.special0Probability),
        100: clampInteger(specialProbabilities[100] ?? specialProbabilities["100"] ?? source.special100Probability, 0, 100, defaults.special100Probability)
      },
      specialUseLimits: {
        0: clampInteger(specialUseLimits[0] ?? specialUseLimits["0"] ?? source.special0Uses, 0, 50, defaults.special0Uses),
        100: clampInteger(specialUseLimits[100] ?? specialUseLimits["100"] ?? source.special100Uses, 0, 50, defaults.special100Uses)
      },
      observeUseLimit: clampInteger(source.observeUseLimit ?? source.observeUses, 0, 50, defaults.observeUseLimit),
      initialSetup: source.initialSetup ? normalizeInitialSetup(source.initialSetup) : null
    };
  }

  function setupKeyFor(kind) {
    return storageKeys[kind] || storageKeys.local;
  }

  function loadInitialSetup() {
    return readJson(sessionStorage, setupKey);
  }

  function shouldKeepSessionInitialSetup(kind) {
    const returnPath = sessionStorage.getItem("catinboxInitialBoardReturnPath");
    if (kind === "ai") return returnPath === "ai-setup.html";
    if (kind === "local") return returnPath === "local-custom.html";
    return false;
  }

  function kindFromReturnPath(returnPath) {
    if (returnPath === "ai-setup.html") return "ai";
    if (returnPath === "local-custom.html") return "local";
    return null;
  }

  function collectFormRules(fields = {}) {
    return normalizeRules({
      normalProbability: fields.normalProbability?.value,
      specialProbabilities: {
        0: fields.special0Probability?.value,
        100: fields.special100Probability?.value
      },
      specialUseLimits: {
        0: fields.special0Uses?.value,
        100: fields.special100Uses?.value
      },
      observeUseLimit: fields.observeUses?.value,
      initialSetup: loadInitialSetup()
    });
  }

  function applyRulesToForm(fields = {}, rules = normalizeRules()) {
    if (fields.normalProbability) fields.normalProbability.value = String(rules.normalProbability);
    if (fields.special0Probability) fields.special0Probability.value = String(rules.specialProbabilities[0]);
    if (fields.special0Uses) fields.special0Uses.value = String(rules.specialUseLimits[0]);
    if (fields.special100Probability) fields.special100Probability.value = String(rules.specialProbabilities[100]);
    if (fields.special100Uses) fields.special100Uses.value = String(rules.specialUseLimits[100]);
    if (fields.observeUses) fields.observeUses.value = String(rules.observeUseLimit);
  }

  function setDefaultForm(fields = {}) {
    applyRulesToForm(fields, normalizeRules());
    sessionStorage.removeItem(setupKey);
  }

  function clipForm(fields = {}) {
    const rules = collectFormRules(fields);
    applyRulesToForm(fields, rules);
    return rules;
  }

  function bindNumberClipping(fields = {}) {
    Object.values(fields).forEach(input => {
      if (!input) return;
      const clip = () => clipForm(fields);
      input.addEventListener("change", clip);
      input.addEventListener("blur", clip);
    });
  }

  function saveDraft(kind, enabled, fields = {}) {
    const rules = collectFormRules(fields);
    writeJson(localStorage, setupKeyFor(kind), { enabled: Boolean(enabled), rules });
    return rules;
  }

  function restoreDraft(kind, enabledEl, fields = {}) {
    const draft = readJson(localStorage, setupKeyFor(kind));
    if (!draft) {
      setDefaultForm(fields);
      if (enabledEl) enabledEl.checked = false;
      return null;
    }
    const rules = normalizeRules(draft.rules || {});
    const sessionInitialSetup = loadInitialSetup();
    if (shouldKeepSessionInitialSetup(kind) && sessionInitialSetup) {
      rules.initialSetup = normalizeInitialSetup(sessionInitialSetup);
    }
    if (enabledEl) enabledEl.checked = Boolean(draft.enabled);
    applyRulesToForm(fields, rules);
    if (rules.initialSetup) writeJson(sessionStorage, setupKey, rules.initialSetup);
    else if (!shouldKeepSessionInitialSetup(kind)) sessionStorage.removeItem(setupKey);
    return { enabled: Boolean(draft.enabled), rules };
  }

  function loadRules(kind) {
    const draft = readJson(localStorage, setupKeyFor(kind));
    if (!draft?.enabled) return null;
    return normalizeRules(draft.rules || {});
  }

  function prepareInitialBoard(returnPath, fields = {}) {
    const rules = collectFormRules(fields);
    if (rules.initialSetup) writeJson(sessionStorage, setupKey, rules.initialSetup);
    sessionStorage.setItem("catinboxInitialBoardReturnPath", returnPath);
  }

  function saveInitialSetup(returnPath, setup) {
    const initialSetup = normalizeInitialSetup(setup);
    writeJson(sessionStorage, setupKey, initialSetup);

    const kind = kindFromReturnPath(returnPath);
    if (!kind) return initialSetup;

    const draft = readJson(localStorage, setupKeyFor(kind));
    const rules = normalizeRules(draft?.rules || {});
    rules.initialSetup = initialSetup;
    writeJson(localStorage, setupKeyFor(kind), {
      enabled: Boolean(draft?.enabled),
      rules
    });
    return initialSetup;
  }

  window.OthelloCustomSettings = {
    defaults,
    setupKey,
    normalizeRules,
    loadRules,
    restoreDraft,
    saveDraft,
    setDefaultForm,
    clipForm,
    bindNumberClipping,
    collectFormRules,
    prepareInitialBoard,
    saveInitialSetup
  };
})();

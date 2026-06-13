/* ---------- dashboard view builder ---------- */

const ViewBuilder = (() => {
  const BUILTIN_VIEWS = ["default", "live", "history"];
  const DASHBOARD_VIEW_LABELS = {
    default: "Default",
    live: "Live",
    history: "History",
  };
  const BUILTIN_DESCRIPTIONS = {
    default: "Full dashboard with scrollable layout",
    live: "Fullscreen real-time monitor",
    history: "Fullscreen rolling-window dashboard",
  };
  const MAX_CUSTOM_VIEWS = 20;
  const LAYOUT_PANEL_MIN_WIDTH = 280;
  const LAYOUT_PANEL_MAX_WIDTH = 960;
  const LAYOUT_PANEL_DEFAULT_WIDTH = 512;
  const LAYOUT_PANEL_WIDTH_STORAGE_KEY = "networkMonitor.layoutPanelWidth";

  const PANEL_GROUPS = {
    status: { label: "Status & verdict", order: 1 },
    live: { label: "Live monitoring", order: 2 },
    window: { label: "Window summary", order: 3 },
    charts: { label: "Charts", order: 4 },
    history: { label: "History detail", order: 5 },
    tables: { label: "Tables", order: 6 },
  };

  const PANEL_DEFS = [
    {
      id: "hero",
      label: "Connection status",
      group: "status",
      description: "Stabilized gaming verdict banner",
    },
    {
      id: "status",
      label: "Current status",
      group: "status",
      description: "Plain-language narrative and reason chips",
    },
    {
      id: "indicators",
      label: "Key indicators",
      group: "live",
      description: "Ping, jitter, loss, and spike rate tiles",
    },
    {
      id: "live",
      label: "Live feed",
      group: "live",
      description: "Last raw ping, verdict chip, and heartbeat strip",
    },
    {
      id: "stats",
      label: "Selected window",
      group: "window",
      description: "Rolling-window stats with health chip",
    },
    {
      id: "blocks",
      label: "Latency blocks",
      group: "window",
      description: "1-minute candlesticks for the selected window",
    },
    {
      id: "distribution",
      label: "Latency distribution",
      group: "history",
      description: "Histogram of ping quality in the window",
    },
    {
      id: "history-breakdown",
      label: "Window breakdown",
      group: "history",
      description: "Pie charts for latency, jitter, loss, and quality",
    },
    {
      id: "latency",
      label: "Latency chart",
      group: "charts",
      description: "Latency over time with quality threshold bands",
    },
    {
      id: "jitter",
      label: "Jitter chart",
      group: "charts",
      description: "Jitter over the selected window",
    },
    {
      id: "loss",
      label: "Packet loss chart",
      group: "charts",
      description: "Packet loss percentage over time",
    },
    {
      id: "window-insights",
      label: "Window insights",
      group: "history",
      description: "Peak latency, best minute, downtime summary",
    },
    {
      id: "outages",
      label: "Outages table",
      group: "tables",
      description: "Consecutive failure runs in the window",
    },
    {
      id: "recent",
      label: "Recent samples",
      group: "tables",
      description: "Last raw ping samples as a table",
    },
    {
      id: "worst-minutes",
      label: "Worst minutes",
      group: "tables",
      description: "Highest-latency minutes in the window",
    },
    {
      id: "best-minutes",
      label: "Best minutes",
      group: "tables",
      description: "Most stable minutes in the window",
    },
    {
      id: "minute-log",
      label: "Minute log",
      group: "tables",
      description: "Every minute with samples in the window",
    },
  ];

  const VIEW_DEFAULTS = {
    default: {
      hero: true,
      status: true,
      indicators: true,
      live: true,
      stats: true,
      blocks: true,
      distribution: false,
      "history-breakdown": false,
      latency: true,
      jitter: true,
      loss: true,
      outages: true,
      recent: true,
      "worst-minutes": false,
      "window-insights": false,
      "best-minutes": false,
      "minute-log": false,
    },
    live: {
      hero: true,
      status: false,
      indicators: true,
      live: true,
      stats: false,
      blocks: false,
      distribution: false,
      "history-breakdown": false,
      latency: true,
      jitter: false,
      loss: false,
      outages: false,
      recent: false,
      "worst-minutes": false,
      "window-insights": false,
      "best-minutes": false,
      "minute-log": false,
    },
    history: {
      hero: true,
      status: false,
      indicators: false,
      live: false,
      stats: true,
      blocks: true,
      distribution: false,
      "history-breakdown": true,
      latency: true,
      jitter: false,
      loss: false,
      outages: false,
      recent: false,
      "worst-minutes": false,
      "window-insights": false,
      "best-minutes": false,
      "minute-log": false,
    },
  };

  const HISTORY_DATA_PANEL_IDS = [
    "history-breakdown",
    "distribution",
    "worst-minutes",
    "best-minutes",
    "minute-log",
    "window-insights",
  ];

  const VIEW_TEMPLATES = {
    current: {
      label: "From current layout",
      resolvePanels(state) {
        return { ...getEffectivePanelVisibility(state.currentDashboardView) };
      },
    },
    charts: {
      label: "Charts only",
      panels: {
        hero: false,
        status: false,
        indicators: false,
        live: false,
        stats: false,
        blocks: false,
        distribution: false,
        "history-breakdown": false,
        latency: true,
        jitter: true,
        loss: true,
        outages: false,
        recent: false,
        "worst-minutes": false,
        "window-insights": false,
        "best-minutes": false,
        "minute-log": false,
      },
    },
    tables: {
      label: "Tables only",
      panels: {
        hero: true,
        status: false,
        indicators: false,
        live: false,
        stats: false,
        blocks: false,
        distribution: false,
        "history-breakdown": false,
        latency: false,
        jitter: false,
        loss: false,
        outages: true,
        recent: true,
        "worst-minutes": true,
        "window-insights": true,
        "best-minutes": true,
        "minute-log": true,
      },
    },
    minimal: {
      label: "Minimal",
      panels: {
        hero: true,
        status: false,
        indicators: true,
        live: false,
        stats: false,
        blocks: false,
        distribution: false,
        "history-breakdown": false,
        latency: false,
        jitter: false,
        loss: false,
        outages: false,
        recent: false,
        "worst-minutes": false,
        "window-insights": false,
        "best-minutes": false,
        "minute-log": false,
      },
    },
  };

  let viewSelect = null;
  let tablesGrid = null;
  let dashboardViewScrollY = 0;
  let currentDashboardView = "default";
  let panelPrefs = {};
  let customViews = {};
  let viewChangeCallbacks = [];
  let layoutChangeCallbacks = [];
  let onViewApplied = null;

  let layoutDialog = null;
  let layoutBackdrop = null;
  let layoutCloseBtn = null;
  let layoutDoneBtn = null;
  let layoutViewList = null;
  let layoutPanelTitle = null;
  let layoutPanelSearch = null;
  let layoutPanelGroups = null;
  let layoutPanelActions = null;
  let layoutResetBtn = null;
  let layoutRevertBtn = null;
  let layoutNewViewSection = null;
  let layoutNewViewName = null;
  let layoutNewViewTemplate = null;
  let layoutNewViewSaveBtn = null;
  let layoutError = null;
  let layoutFooterCount = null;
  let layoutDuplicateBtn = null;
  let layoutExportBtn = null;
  let layoutImportBtn = null;
  let layoutImportInput = null;
  let layoutConfirmStrip = null;
  let layoutConfirmMessage = null;
  let layoutConfirmYes = null;
  let layoutConfirmNo = null;
  let settingsLayoutSummary = null;
  let settingsOpenLayoutLink = null;
  let layoutToggleBtn = null;
  let layoutPreviewBtn = null;
  let layoutPreviewViewName = null;
  let layoutPreviewModified = null;
  let layoutPreviewEditBtn = null;
  let layoutPreviewDoneBtn = null;
  let layoutPanel = null;
  let layoutResizeHandle = null;
  let layoutPanelWidth = LAYOUT_PANEL_DEFAULT_WIDTH;
  let layoutResizePointerId = null;

  let panelSearchQuery = "";
  let pendingDeleteId = null;
  let customViewSnapshots = {};

  function isBuiltinView(view) {
    return BUILTIN_VIEWS.includes(view);
  }

  function isCustomView(view) {
    return Boolean(customViews[view]);
  }

  function isFullscreenView(view) {
    return view === "live" || view === "history";
  }

  function isHistoryView(view = currentDashboardView) {
    return view === "history";
  }

  function loadCustomViews() {
    try {
      const raw = localStorage.getItem(CUSTOM_VIEWS_STORAGE_KEY);
      customViews = raw ? JSON.parse(raw) : {};
    } catch {
      customViews = {};
    }

    if (typeof customViews !== "object" || customViews === null) {
      customViews = {};
    }

    migrateCustomViews();
  }

  function normalizePanelMap(panels, fallbackDefaults = VIEW_DEFAULTS.default) {
    const visibility = {};
    for (const { id } of PANEL_DEFS) {
      visibility[id] = panels?.[id] ?? fallbackDefaults[id] ?? true;
    }
    return visibility;
  }

  function migrateCustomViews() {
    for (const [id, view] of Object.entries(customViews)) {
      const basedOn = view.basedOn && VIEW_DEFAULTS[view.basedOn] ? view.basedOn : "default";
      view.panels = normalizePanelMap(view.panels, VIEW_DEFAULTS[basedOn]);
      if (!view.createdAt) {
        view.createdAt = new Date(0).toISOString();
      }
      if (!view.basedOn) {
        view.basedOn = "default";
      }
    }
  }

  function saveCustomViews() {
    localStorage.setItem(CUSTOM_VIEWS_STORAGE_KEY, JSON.stringify(customViews));
  }

  function getViewLabel(view) {
    if (isBuiltinView(view)) {
      return DASHBOARD_VIEW_LABELS[view] ?? view;
    }
    return customViews[view]?.label ?? view;
  }

  function getAllViewIds() {
    const customIds = Object.keys(customViews).sort((a, b) =>
      getViewLabel(a).localeCompare(getViewLabel(b), undefined, { sensitivity: "base" }),
    );
    return [...BUILTIN_VIEWS, ...customIds];
  }

  function isValidViewId(view) {
    return getAllViewIds().includes(view);
  }

  function slugifyViewLabel(label) {
    const slug = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "view";
  }

  function uniqueCustomViewId(label) {
    let base = slugifyViewLabel(label);
    let id = base;
    let suffix = 2;
    while (customViews[id] || isBuiltinView(id)) {
      id = `${base}-${suffix++}`;
    }
    return id;
  }

  function customViewLabelExists(label, excludeId = null) {
    const normalized = label.trim().toLowerCase();
    return Object.entries(customViews).some(
      ([id, view]) => id !== excludeId && view.label.trim().toLowerCase() === normalized,
    );
  }

  function showLayoutError(message) {
    if (!layoutError) return;
    if (message) {
      layoutError.textContent = message;
      layoutError.hidden = false;
    } else {
      layoutError.textContent = "";
      layoutError.hidden = true;
    }
  }

  function loadPanelPrefs() {
    try {
      const raw = localStorage.getItem(PANEL_PREFS_STORAGE_KEY);
      panelPrefs = raw ? JSON.parse(raw) : {};
    } catch {
      panelPrefs = {};
    }

    if (typeof panelPrefs !== "object" || panelPrefs === null) {
      panelPrefs = {};
    }
  }

  function savePanelPrefs() {
    localStorage.setItem(PANEL_PREFS_STORAGE_KEY, JSON.stringify(panelPrefs));
  }

  function getPanelOverrides(view) {
    const overrides = panelPrefs[view];
    return overrides && typeof overrides === "object" ? overrides : {};
  }

  function getEffectivePanelVisibility(view = currentDashboardView) {
    if (isCustomView(view)) {
      const panels = customViews[view]?.panels ?? {};
      const basedOn = customViews[view]?.basedOn ?? "default";
      const fallback = VIEW_DEFAULTS[basedOn] ?? VIEW_DEFAULTS.default;
      return normalizePanelMap(panels, fallback);
    }

    const defaults = VIEW_DEFAULTS[view] ?? VIEW_DEFAULTS.default;
    const overrides = getPanelOverrides(view);
    const visibility = {};

    for (const { id } of PANEL_DEFS) {
      visibility[id] = overrides[id] ?? defaults[id] ?? true;
    }

    return visibility;
  }

  function needsHistoryVisualizations(view = currentDashboardView) {
    if (view === "history") {
      return true;
    }
    const visibility = getEffectivePanelVisibility(view);
    return HISTORY_DATA_PANEL_IDS.some((id) => visibility[id]);
  }

  function isViewModified(view = currentDashboardView) {
    if (isBuiltinView(view)) {
      return Object.keys(getPanelOverrides(view)).length > 0;
    }
    if (!isCustomView(view)) {
      return false;
    }
    const snapshot = customViewSnapshots[view];
    if (!snapshot) {
      return false;
    }
    const current = getEffectivePanelVisibility(view);
    return PANEL_DEFS.some(({ id }) => current[id] !== snapshot[id]);
  }

  function updateTablesGridVisibility() {
    if (!tablesGrid) return;

    const tablePanelIds = [
      "window-insights",
      "outages",
      "recent",
      "worst-minutes",
      "best-minutes",
      "minute-log",
    ];
    const allHidden = tablePanelIds.every((id) =>
      document.querySelector(`[data-panel="${id}"]`)?.classList.contains("is-panel-hidden"),
    );
    tablesGrid.classList.toggle("is-panel-hidden", allHidden);
  }

  function applyPanelVisibility(view = currentDashboardView) {
    const visibility = getEffectivePanelVisibility(view);

    for (const { id } of PANEL_DEFS) {
      const element = document.querySelector(`[data-panel="${id}"]`);
      element?.classList.toggle("is-panel-hidden", !visibility[id]);
    }

    updateTablesGridVisibility();
    syncPanelPickerCheckboxes();
    refreshLayoutDialogChrome();
    notifyLayoutChange();
  }

  function notifyLayoutChange() {
    for (const callback of layoutChangeCallbacks) {
      callback(currentDashboardView);
    }
  }

  function notifyViewChange(context) {
    for (const callback of viewChangeCallbacks) {
      callback(context);
    }
    if (onViewApplied) {
      onViewApplied(context);
    }
  }

  function rebuildViewSelect() {
    if (!viewSelect) return;

    const selected = isValidViewId(currentDashboardView) ? currentDashboardView : "default";
    viewSelect.innerHTML = "";

    const builtinGroup = document.createElement("optgroup");
    builtinGroup.label = "Built-in";
    for (const id of BUILTIN_VIEWS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = DASHBOARD_VIEW_LABELS[id];
      builtinGroup.appendChild(option);
    }
    viewSelect.appendChild(builtinGroup);

    const customIds = Object.keys(customViews).sort((a, b) =>
      getViewLabel(a).localeCompare(getViewLabel(b), undefined, { sensitivity: "base" }),
    );
    if (customIds.length) {
      const customGroup = document.createElement("optgroup");
      customGroup.label = "Custom";
      for (const id of customIds) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = customViews[id].label;
        customGroup.appendChild(option);
      }
      viewSelect.appendChild(customGroup);
    }

    viewSelect.value = selected;
  }

  function updateSettingsLayoutSummary() {
    if (settingsLayoutSummary) {
      settingsLayoutSummary.textContent = getViewLabel(currentDashboardView);
    }
  }

  function setDashboardView(view, persist = true) {
    const nextView = isValidViewId(view) ? view : "default";
    const prevView = currentDashboardView;
    const wasFullscreen = isFullscreenView(prevView);
    const isFullscreen = isFullscreenView(nextView);

    if (isFullscreen && !wasFullscreen) {
      dashboardViewScrollY = window.scrollY;
      window.scrollTo(0, 0);
    }

    currentDashboardView = nextView;
    document.body.dataset.view = nextView;

    if (viewSelect) {
      viewSelect.value = nextView;
    }

    applyPanelVisibility(nextView);

    if (persist) {
      localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, nextView);
    }

    notifyViewChange({
      view: nextView,
      prevView,
      wasFullscreen,
      isFullscreen,
    });

    if (!isFullscreen && wasFullscreen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo(0, dashboardViewScrollY);
        });
      });
    }

    updateSettingsLayoutSummary();
  }

  function setPanelVisible(panelId, visible, persist = true) {
    if (isCustomView(currentDashboardView)) {
      const view = customViews[currentDashboardView];
      if (!view) return;
      view.panels = { ...view.panels, [panelId]: visible };
      if (persist) {
        saveCustomViews();
      }
      applyPanelVisibility(currentDashboardView);
      return;
    }

    const defaults = VIEW_DEFAULTS[currentDashboardView] ?? VIEW_DEFAULTS.default;
    const overrides = { ...getPanelOverrides(currentDashboardView) };

    if (visible === defaults[panelId]) {
      delete overrides[panelId];
    } else {
      overrides[panelId] = visible;
    }

    if (Object.keys(overrides).length) {
      panelPrefs[currentDashboardView] = overrides;
    } else {
      delete panelPrefs[currentDashboardView];
    }

    if (persist) {
      savePanelPrefs();
    }

    applyPanelVisibility(currentDashboardView);
  }

  function resetPanelPrefsForCurrentView() {
    if (!isBuiltinView(currentDashboardView)) {
      return;
    }

    delete panelPrefs[currentDashboardView];
    savePanelPrefs();
    applyPanelVisibility(currentDashboardView);
  }

  function revertCustomViewChanges() {
    const snapshot = customViewSnapshots[currentDashboardView];
    const view = customViews[currentDashboardView];
    if (!snapshot || !view) return;

    view.panels = { ...snapshot };
    saveCustomViews();
    applyPanelVisibility(currentDashboardView);
  }

  function captureCustomViewSnapshot(viewId) {
    if (!isCustomView(viewId)) return;
    customViewSnapshots[viewId] = { ...getEffectivePanelVisibility(viewId) };
  }

  function createCustomView(label, panels, basedOn = currentDashboardView) {
    const trimmed = label.trim();
    if (!trimmed) {
      return { error: "Name is required" };
    }
    if (Object.keys(customViews).length >= MAX_CUSTOM_VIEWS) {
      return { error: `Maximum ${MAX_CUSTOM_VIEWS} custom views` };
    }
    if (customViewLabelExists(trimmed)) {
      return { error: "A view with this name already exists" };
    }

    const id = uniqueCustomViewId(trimmed);
    const fallbackBasedOn = isBuiltinView(basedOn) ? basedOn : customViews[basedOn]?.basedOn ?? "default";
    const panelMap = normalizePanelMap(
      panels ?? getEffectivePanelVisibility(currentDashboardView),
      VIEW_DEFAULTS[fallbackBasedOn],
    );

    customViews[id] = {
      label: trimmed,
      panels: panelMap,
      createdAt: new Date().toISOString(),
      basedOn: fallbackBasedOn,
    };
    saveCustomViews();
    rebuildViewSelect();
    captureCustomViewSnapshot(id);
    return { id };
  }

  function renameCustomView(id, nextLabel) {
    const view = customViews[id];
    if (!view) return { error: "View not found" };

    const trimmed = nextLabel.trim();
    if (!trimmed) {
      return { error: "Name is required" };
    }
    if (customViewLabelExists(trimmed, id)) {
      return { error: "A view with this name already exists" };
    }

    view.label = trimmed;
    saveCustomViews();
    rebuildViewSelect();
    if (viewSelect) {
      viewSelect.value = currentDashboardView;
    }
    return { ok: true };
  }

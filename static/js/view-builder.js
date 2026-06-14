/* ---------- dashboard view builder ---------- */

const ViewBuilder = (() => {
  const BUILTIN_VIEWS = ["default", "analytics"];
  const REMOVED_BUILTIN_VIEWS = ["live", "history"];
  const DASHBOARD_VIEW_LABELS = {
    default: "Default",
    analytics: "Analytics",
  };
  const BUILTIN_DESCRIPTIONS = {
    default: "Full dashboard with scrollable layout",
    analytics: "Visualization-focused layout with analytics charts",
  };
  const MAX_CUSTOM_VIEWS = 20;
  const LAYOUT_PANEL_MIN_WIDTH = 280;
  const LAYOUT_PANEL_MAX_WIDTH = 960;
  const LAYOUT_PANEL_DEFAULT_WIDTH = 512;

  const PANEL_GROUPS = {
    status: { label: "Status & verdict", order: 1 },
    live: { label: "Live monitoring", order: 2 },
    window: { label: "Window summary", order: 3 },
    analytics: { label: "Analytics", order: 3.5 },
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
      id: "quality-composition",
      label: "Quality composition",
      group: "analytics",
      description: "Stacked minute-quality timeline across the window",
    },
    {
      id: "spike-timeline",
      label: "Spike timeline",
      group: "analytics",
      description: "Latency spikes detected across the selected window",
    },
    {
      id: "latency-jitter-scatter",
      label: "Latency vs jitter",
      group: "analytics",
      description: "Scatter plot of ping latency against jitter",
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
      "quality-composition": false,
      "spike-timeline": false,
      "latency-jitter-scatter": false,
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
    analytics: {
      hero: false,
      status: false,
      indicators: false,
      live: false,
      stats: true,
      blocks: true,
      "quality-composition": true,
      "spike-timeline": true,
      "latency-jitter-scatter": true,
      distribution: true,
      "history-breakdown": true,
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
  };

  const HISTORY_DATA_PANEL_IDS = [
    "history-breakdown",
    "distribution",
    "quality-composition",
    "spike-timeline",
    "latency-jitter-scatter",
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
        "quality-composition": false,
        "spike-timeline": false,
        "latency-jitter-scatter": false,
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
        "quality-composition": false,
        "spike-timeline": false,
        "latency-jitter-scatter": false,
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
        "quality-composition": false,
        "spike-timeline": false,
        "latency-jitter-scatter": false,
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
    analytics: {
      label: "Analytics dashboard",
      panels: { ...VIEW_DEFAULTS.analytics },
    },
  };

  let viewSelect = null;
  let tablesGrid = null;
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

  function isRemovedBuiltinView(view) {
    return REMOVED_BUILTIN_VIEWS.includes(view);
  }

  function purgeRemovedBuiltinState() {
    for (const id of REMOVED_BUILTIN_VIEWS) {
      delete panelPrefs[id];
      delete customViews[id];
      delete customViewSnapshots[id];
    }

    const saved = localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
    if (saved && isRemovedBuiltinView(saved)) {
      localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, "default");
    }

    localStorage.removeItem("networkMonitor.fillMode");

    if (Object.keys(panelPrefs).length) {
      savePanelPrefs();
    } else {
      localStorage.removeItem(PANEL_PREFS_STORAGE_KEY);
    }

    if (Object.keys(customViews).length) {
      saveCustomViews();
    } else {
      localStorage.removeItem(CUSTOM_VIEWS_STORAGE_KEY);
    }
  }

  function updateViewSelectVisibility() {
    if (!viewSelect) return;

    const viewLabel = viewSelect.closest(".controls")?.querySelector('label[for="view-select"]');
    const hasCustomViews = Object.keys(customViews).length > 0;
    const showViewSelect = BUILTIN_VIEWS.length > 1 || hasCustomViews;

    viewSelect.hidden = !showViewSelect;
    if (viewLabel) {
      viewLabel.hidden = !showViewSelect;
    }
  }

  function isCustomView(view) {
    return Boolean(customViews[view]);
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
      if (view.basedOn === "live" || view.basedOn === "history") {
        view.basedOn = "default";
      }
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
    updateViewSelectVisibility();
  }

  function updateSettingsLayoutSummary() {
    if (settingsLayoutSummary) {
      settingsLayoutSummary.textContent = getViewLabel(currentDashboardView);
    }
  }

  function setDashboardView(view, persist = true) {
    const nextView = isValidViewId(view) ? view : "default";
    const prevView = currentDashboardView;

    currentDashboardView = nextView;

    if (viewSelect) {
      viewSelect.value = nextView;
    }

    document.body.dataset.dashboardView = nextView;

    applyPanelVisibility(nextView);

    if (persist) {
      localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, nextView);
    }

    notifyViewChange({
      view: nextView,
      prevView,
    });

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
  function deleteCustomView(id) {
    const view = customViews[id];
    if (!view) return;

    delete customViews[id];
    delete panelPrefs[id];
    delete customViewSnapshots[id];
    saveCustomViews();
    savePanelPrefs();
    showLayoutError("");

    if (currentDashboardView === id) {
      rebuildViewSelect();
      setDashboardView("default");
      return;
    }

    rebuildViewSelect();
    if (viewSelect) {
      viewSelect.value = currentDashboardView;
    }
  }

  function duplicateCurrentView() {
    if (Object.keys(customViews).length >= MAX_CUSTOM_VIEWS) {
      showLayoutError(`Maximum ${MAX_CUSTOM_VIEWS} custom views`);
      return;
    }

    const baseLabel = `${getViewLabel(currentDashboardView)} copy`;
    let label = baseLabel;
    let suffix = 2;
    while (customViewLabelExists(label)) {
      label = `${baseLabel} ${suffix++}`;
    }

    const basedOn = isBuiltinView(currentDashboardView)
      ? currentDashboardView
      : customViews[currentDashboardView]?.basedOn ?? "default";

    const result = createCustomView(label, getEffectivePanelVisibility(currentDashboardView), basedOn);
    if (result.error) {
      showLayoutError(result.error);
      return;
    }

    showLayoutError("");
    setDashboardView(result.id);
  }

  function saveCurrentAsCustomView() {
    const label = layoutNewViewName?.value ?? "";
    const templateKey = layoutNewViewTemplate?.value ?? "current";
    const template = VIEW_TEMPLATES[templateKey] ?? VIEW_TEMPLATES.current;
    const panels =
      typeof template.resolvePanels === "function"
        ? template.resolvePanels({ currentDashboardView })
        : { ...template.panels };

    const result = createCustomView(label, panels, currentDashboardView);
    if (result.error) {
      showLayoutError(result.error);
      return;
    }

    showLayoutError("");
    if (layoutNewViewName) {
      layoutNewViewName.value = "";
    }
    setDashboardView(result.id);
  }

  function syncPanelPickerCheckboxes() {
    if (!layoutPanelGroups) return;

    const visibility = getEffectivePanelVisibility(currentDashboardView);
    for (const input of layoutPanelGroups.querySelectorAll('input[type="checkbox"][data-panel]')) {
      input.checked = Boolean(visibility[input.dataset.panel]);
    }
  }

  function panelMatchesSearch(panel) {
    if (!panelSearchQuery) return true;
    const q = panelSearchQuery.toLowerCase();
    const groupLabel = PANEL_GROUPS[panel.group]?.label ?? "";
    return (
      panel.label.toLowerCase().includes(q) ||
      panel.description.toLowerCase().includes(q) ||
      groupLabel.toLowerCase().includes(q)
    );
  }

  function setPanelsVisibility(panelIds, visible) {
    for (const id of panelIds) {
      setPanelVisible(id, visible);
    }
  }

  function buildPanelGroups() {
    if (!layoutPanelGroups) return;

    layoutPanelGroups.innerHTML = "";
    const grouped = new Map();
    for (const panel of PANEL_DEFS) {
      if (!grouped.has(panel.group)) {
        grouped.set(panel.group, []);
      }
      grouped.get(panel.group).push(panel);
    }

    const sortedGroups = [...grouped.entries()].sort(
      (a, b) => (PANEL_GROUPS[a[0]]?.order ?? 99) - (PANEL_GROUPS[b[0]]?.order ?? 99),
    );

    let anyVisible = false;

    for (const [groupId, panels] of sortedGroups) {
      const visiblePanels = panels.filter(panelMatchesSearch);
      if (!visiblePanels.length) continue;
      anyVisible = true;

      const group = document.createElement("div");
      group.className = "vb-group";
      group.dataset.group = groupId;

      const header = document.createElement("div");
      header.className = "vb-group__head";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "vb-group__toggle";
      toggle.setAttribute("aria-expanded", "true");
      toggle.innerHTML = `<span class="vb-group__chevron" aria-hidden="true"></span><span class="vb-group__title">${PANEL_GROUPS[groupId]?.label ?? groupId}</span>`;

      const groupActions = document.createElement("div");
      groupActions.className = "vb-group__actions";

      const showAllBtn = document.createElement("button");
      showAllBtn.type = "button";
      showAllBtn.className = "settings-btn settings-btn--link vb-group__action";
      showAllBtn.textContent = "All";
      showAllBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        setPanelsVisibility(
          panels.map((p) => p.id),
          true,
        );
      });

      const hideAllBtn = document.createElement("button");
      hideAllBtn.type = "button";
      hideAllBtn.className = "settings-btn settings-btn--link vb-group__action";
      hideAllBtn.textContent = "None";
      hideAllBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        setPanelsVisibility(
          panels.map((p) => p.id),
          false,
        );
      });

      groupActions.appendChild(showAllBtn);
      groupActions.appendChild(hideAllBtn);

      header.appendChild(toggle);
      header.appendChild(groupActions);

      const body = document.createElement("div");
      body.className = "vb-group__body";

      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
        group.classList.toggle("is-collapsed", expanded);
      });

      for (const panel of visiblePanels) {
        const row = document.createElement("label");
        row.className = "vb-panel-item";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.panel = panel.id;
        input.addEventListener("change", () => {
          setPanelVisible(panel.id, input.checked);
        });

        const textWrap = document.createElement("span");
        textWrap.className = "vb-panel-item__text";

        const title = document.createElement("span");
        title.className = "vb-panel-item__label";
        title.textContent = panel.label;

        const desc = document.createElement("span");
        desc.className = "vb-panel-item__desc";
        desc.textContent = panel.description;

        textWrap.appendChild(title);
        textWrap.appendChild(desc);

        row.appendChild(input);
        row.appendChild(textWrap);
        body.appendChild(row);
      }

      group.appendChild(header);
      group.appendChild(body);
      layoutPanelGroups.appendChild(group);
    }

    if (!anyVisible) {
      const empty = document.createElement("p");
      empty.className = "vb-empty-search";
      empty.textContent = "No panels match your search.";
      layoutPanelGroups.appendChild(empty);
    }

    syncPanelPickerCheckboxes();
  }

  function hideConfirmStrip() {
    pendingDeleteId = null;
    if (layoutConfirmStrip) {
      layoutConfirmStrip.hidden = true;
    }
  }

  function showConfirmStrip(message, onConfirm, options = {}) {
    if (!layoutConfirmStrip || !layoutConfirmMessage) return;

    layoutConfirmMessage.textContent = message;
    if (layoutConfirmYes) {
      layoutConfirmYes.textContent = options.confirmLabel ?? "Confirm";
    }
    if (layoutConfirmNo) {
      layoutConfirmNo.textContent = options.cancelLabel ?? "Cancel";
    }
    layoutConfirmStrip.hidden = false;

    const handleYes = () => {
      cleanup();
      onConfirm();
    };
    const handleNo = () => {
      cleanup();
      hideConfirmStrip();
    };
    const cleanup = () => {
      layoutConfirmYes?.removeEventListener("click", handleYes);
      layoutConfirmNo?.removeEventListener("click", handleNo);
    };

    layoutConfirmYes?.addEventListener("click", handleYes);
    layoutConfirmNo?.addEventListener("click", handleNo);
  }

  function buildViewListItem(id, { isBuiltin = false } = {}) {
    const item = document.createElement("li");
    item.className = "vb-view-row";
    if (id === currentDashboardView) {
      item.classList.add("is-active");
      item.setAttribute("aria-selected", "true");
    } else {
      item.setAttribute("aria-selected", "false");
    }

    const main = document.createElement("button");
    main.type = "button";
    main.className = "vb-view-row__main";
    main.addEventListener("click", () => {
      hideConfirmStrip();
      setDashboardView(id);
      if (isCustomView(id)) {
        captureCustomViewSnapshot(id);
      }
      refreshLayoutDialog();
    });

    const labelWrap = document.createElement("span");
    labelWrap.className = "vb-view-row__label-wrap";

    const label = document.createElement("span");
    label.className = "vb-view-row__label";
    label.textContent = getViewLabel(id);

    labelWrap.appendChild(label);

    if (isViewModified(id)) {
      const badge = document.createElement("span");
      badge.className = "vb-view-row__badge";
      badge.textContent = "Modified";
      labelWrap.appendChild(badge);
    }

    const desc = document.createElement("span");
    desc.className = "vb-view-row__desc";
    desc.textContent = isBuiltin ? BUILTIN_DESCRIPTIONS[id] ?? "" : "Custom panel layout";

    main.appendChild(labelWrap);
    main.appendChild(desc);
    item.appendChild(main);

    if (!isBuiltin) {
      const actions = document.createElement("div");
      actions.className = "vb-view-row__actions";

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "settings-btn settings-btn--link";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        startInlineRename(id, label);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "settings-btn settings-btn--link vb-view-row__delete";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        pendingDeleteId = id;
        showConfirmStrip(
          `Delete "${customViews[id].label}"? This cannot be undone.`,
          () => {
            deleteCustomView(id);
            refreshLayoutDialog();
          },
          { confirmLabel: "Delete view", cancelLabel: "Keep view" },
        );
      });

      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
    }

    return item;
  }

  function startInlineRename(id, labelEl) {
    const view = customViews[id];
    if (!view || !labelEl) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "vb-view-row__rename-input";
    input.value = view.label;
    input.maxLength = 40;
    input.spellcheck = false;
    input.autocomplete = "off";

    const finish = (save) => {
      if (save) {
        const result = renameCustomView(id, input.value);
        if (result.error) {
          showLayoutError(result.error);
          input.focus();
          return;
        }
        showLayoutError("");
      }
      refreshLayoutDialog();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));

    labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function rebuildViewList() {
    if (!layoutViewList) return;

    layoutViewList.innerHTML = "";

    const builtinHeading = document.createElement("li");
    builtinHeading.className = "vb-view-list__heading";
    builtinHeading.textContent = "Built-in";
    layoutViewList.appendChild(builtinHeading);

    for (const id of BUILTIN_VIEWS) {
      layoutViewList.appendChild(buildViewListItem(id, { isBuiltin: true }));
    }

    const customIds = Object.keys(customViews).sort((a, b) =>
      getViewLabel(a).localeCompare(getViewLabel(b), undefined, { sensitivity: "base" }),
    );

    const customHeading = document.createElement("li");
    customHeading.className = "vb-view-list__heading";
    customHeading.textContent = "Custom";
    layoutViewList.appendChild(customHeading);

    if (!customIds.length) {
      const empty = document.createElement("li");
      empty.className = "vb-view-list__empty";
      empty.innerHTML =
        '<p class="vb-view-list__empty-text">No custom views yet.</p><p class="vb-view-list__empty-hint">Create one from the panel on the right.</p>';
      layoutViewList.appendChild(empty);
    } else {
      for (const id of customIds) {
        layoutViewList.appendChild(buildViewListItem(id));
      }
    }

    if (layoutFooterCount) {
      layoutFooterCount.textContent = `${customIds.length} / ${MAX_CUSTOM_VIEWS} custom views`;
    }

    if (layoutDuplicateBtn) {
      layoutDuplicateBtn.disabled = false;
    }
    if (layoutNewViewSaveBtn) {
      layoutNewViewSaveBtn.disabled = customIds.length >= MAX_CUSTOM_VIEWS;
    }
  }

  function refreshLayoutDialogChrome() {
    if (!layoutDialog || layoutDialog.hidden) return;

    if (layoutPanelTitle) {
      layoutPanelTitle.textContent = getViewLabel(currentDashboardView);
    }

    if (layoutResetBtn) {
      layoutResetBtn.hidden = !isBuiltinView(currentDashboardView);
    }
    if (layoutRevertBtn) {
      layoutRevertBtn.hidden = !isCustomView(currentDashboardView) || !isViewModified(currentDashboardView);
    }

    rebuildViewList();
    updateSettingsLayoutSummary();
    syncLayoutPreviewBar();
  }

  function refreshLayoutDialog() {
    refreshLayoutDialogChrome();
    buildPanelGroups();
  }

  function exportViews(includeOverrides = true) {
    const payload = {
      version: VIEWS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      customViews,
    };
    if (includeOverrides) {
      payload.panelPrefs = panelPrefs;
    }
    return payload;
  }

  function downloadExport() {
    const payload = exportViews(true);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "network-monitor-views.json";
    anchor.click();
    URL.revokeObjectURL(url);
    showLayoutError("");
  }

  async function copyExportToClipboard() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportViews(true), null, 2));
      showLayoutError("Copied to clipboard");
      window.setTimeout(() => showLayoutError(""), 2000);
    } catch {
      showLayoutError("Could not copy to clipboard");
    }
  }

  function mergeImportedViews(data, strategy = "rename") {
    if (!data || typeof data !== "object") {
      return { error: "Invalid import file" };
    }

    const importedCustom = data.customViews ?? {};
    if (typeof importedCustom !== "object") {
      return { error: "Invalid custom views in import" };
    }

    let importedCount = 0;
    for (const [, view] of Object.entries(importedCustom)) {
      if (!view?.label || typeof view.panels !== "object") {
        continue;
      }

      let label = String(view.label).trim();
      if (!label) continue;

      if (customViewLabelExists(label)) {
        if (strategy === "skip") {
          continue;
        }
        if (strategy === "replace") {
          const existingId = Object.entries(customViews).find(
            ([, v]) => v.label.trim().toLowerCase() === label.toLowerCase(),
          )?.[0];
          if (existingId) {
            delete customViews[existingId];
            delete customViewSnapshots[existingId];
          }
        } else {
          let suffix = 2;
          const base = label;
          while (customViewLabelExists(label)) {
            label = `${base} (${suffix++})`;
          }
        }
      }

      if (Object.keys(customViews).length >= MAX_CUSTOM_VIEWS) {
        return { error: `Import stopped — maximum ${MAX_CUSTOM_VIEWS} custom views reached` };
      }

      const basedOn =
        view.basedOn && VIEW_DEFAULTS[view.basedOn] ? view.basedOn : "default";
      const id = uniqueCustomViewId(label);
      customViews[id] = {
        label,
        panels: normalizePanelMap(view.panels, VIEW_DEFAULTS[basedOn]),
        createdAt: view.createdAt ?? new Date().toISOString(),
        basedOn,
      };
      captureCustomViewSnapshot(id);
      importedCount += 1;
    }

    if (data.panelPrefs && typeof data.panelPrefs === "object") {
      for (const [viewId, overrides] of Object.entries(data.panelPrefs)) {
        if (isBuiltinView(viewId) && overrides && typeof overrides === "object") {
          panelPrefs[viewId] = { ...overrides };
        }
      }
      savePanelPrefs();
    }

    saveCustomViews();
    rebuildViewSelect();
    applyPanelVisibility(currentDashboardView);
    refreshLayoutDialog();

    return { importedCount };
  }

  function handleImportFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const conflicts = Object.values(data.customViews ?? {}).filter((view) =>
          customViewLabelExists(String(view?.label ?? "")),
        );

        if (conflicts.length) {
          showConfirmStrip(
            `${conflicts.length} view name(s) already exist. Import duplicates with renamed copies?`,
            () => {
              const result = mergeImportedViews(data, "rename");
              if (result.error) {
                showLayoutError(result.error);
              } else {
                showLayoutError(`Imported ${result.importedCount} view(s)`);
              }
            },
            { confirmLabel: "Import renamed copies", cancelLabel: "Cancel import" },
          );
          return;
        }

        const result = mergeImportedViews(data, "rename");
        if (result.error) {
          showLayoutError(result.error);
        } else {
          showLayoutError(`Imported ${result.importedCount} view(s)`);
        }
      } catch {
        showLayoutError("Could not parse import file");
      }
    };
    reader.readAsText(file);
  }

  function getLayoutPanelMaxWidth() {
    return Math.min(Math.round(window.innerWidth * 0.92), LAYOUT_PANEL_MAX_WIDTH);
  }

  function clampLayoutPanelWidth(width) {
    return Math.min(getLayoutPanelMaxWidth(), Math.max(LAYOUT_PANEL_MIN_WIDTH, Math.round(width)));
  }

  function applyLayoutPanelWidth(width, { persist = false } = {}) {
    layoutPanelWidth = clampLayoutPanelWidth(width);
    layoutPanel?.style.setProperty("--layout-panel-width", `${layoutPanelWidth}px`);
    if (persist) {
      localStorage.setItem(LAYOUT_PANEL_WIDTH_STORAGE_KEY, String(layoutPanelWidth));
    }
  }

  function loadLayoutPanelWidth() {
    const saved = Number(localStorage.getItem(LAYOUT_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) {
      applyLayoutPanelWidth(saved);
      return;
    }
    applyLayoutPanelWidth(LAYOUT_PANEL_DEFAULT_WIDTH);
  }

  function finishLayoutPanelResize(event) {
    if (layoutResizePointerId !== event.pointerId) return;

    layoutResizePointerId = null;
    layoutDialog?.classList.remove("is-resizing");
    applyLayoutPanelWidth(layoutPanelWidth, { persist: true });
  }

  function bindLayoutPanelResize() {
    layoutPanel = layoutDialog?.querySelector(".layout-dialog__panel");
    layoutResizeHandle = document.getElementById("layout-dialog-resize");
    if (!layoutPanel || !layoutResizeHandle) return;

    loadLayoutPanelWidth();

    layoutResizeHandle.addEventListener("pointerdown", (event) => {
      if (isLayoutPreviewActive() || event.button !== 0) return;

      event.preventDefault();
      layoutResizePointerId = event.pointerId;
      layoutResizeHandle.setPointerCapture(event.pointerId);
      layoutDialog.classList.add("is-resizing");
    });

    layoutResizeHandle.addEventListener("pointermove", (event) => {
      if (layoutResizePointerId !== event.pointerId) return;
      applyLayoutPanelWidth(event.clientX);
    });

    layoutResizeHandle.addEventListener("pointerup", finishLayoutPanelResize);
    layoutResizeHandle.addEventListener("pointercancel", finishLayoutPanelResize);

    layoutResizeHandle.addEventListener("keydown", (event) => {
      if (isLayoutPreviewActive()) return;

      let delta = 0;
      if (event.key === "ArrowRight") delta = 16;
      else if (event.key === "ArrowLeft") delta = -16;
      else return;

      event.preventDefault();
      applyLayoutPanelWidth(layoutPanelWidth + delta, { persist: true });
    });

    window.addEventListener("resize", () => {
      applyLayoutPanelWidth(layoutPanelWidth);
    });
  }

  function isLayoutPreviewActive() {
    return Boolean(layoutDialog?.classList.contains("is-preview"));
  }

  function playLayoutPanelEnterAnimation() {
    const panel = layoutDialog?.querySelector(".layout-dialog__panel");
    if (!panel) return;

    panel.classList.remove("is-entering");
    void panel.offsetWidth;
    panel.classList.add("is-entering");
    panel.addEventListener(
      "animationend",
      () => {
        panel.classList.remove("is-entering");
      },
      { once: true },
    );
  }

  function syncLayoutPreviewBar() {
    if (layoutPreviewViewName) {
      layoutPreviewViewName.textContent = getViewLabel(currentDashboardView);
    }
    if (layoutPreviewModified) {
      layoutPreviewModified.hidden = !isViewModified(currentDashboardView);
    }
  }

  function enterLayoutPreview() {
    if (!layoutDialog || layoutDialog.hidden) return;

    hideConfirmStrip();
    layoutDialog.querySelector(".layout-dialog__panel")?.classList.remove("is-entering");
    layoutDialog.classList.add("is-preview");
    layoutDialog.setAttribute("aria-modal", "false");
    layoutPreviewBtn?.setAttribute("aria-pressed", "true");
    syncLayoutPreviewBar();
  }

  function exitLayoutPreview() {
    if (!layoutDialog) return;

    layoutDialog.classList.remove("is-preview");
    layoutDialog.setAttribute("aria-modal", "true");
    layoutPreviewBtn?.setAttribute("aria-pressed", "false");
  }

  function toggleLayoutPreview() {
    if (isLayoutPreviewActive()) {
      exitLayoutPreview();
      refreshLayoutDialog();
      layoutPanelSearch?.focus();
      return;
    }
    enterLayoutPreview();
  }

  function openLayoutDialog() {
    if (!layoutDialog) return;

    if (!layoutDialog.hidden && isLayoutPreviewActive()) {
      exitLayoutPreview();
      refreshLayoutDialog();
      layoutPanelSearch?.focus();
      return;
    }

    hideConfirmStrip();
    showLayoutError("");
    exitLayoutPreview();
    panelSearchQuery = layoutPanelSearch?.value?.trim() ?? "";
    layoutDialog.hidden = false;
    layoutToggleBtn?.setAttribute("aria-expanded", "true");
    playLayoutPanelEnterAnimation();

    if (isCustomView(currentDashboardView)) {
      captureCustomViewSnapshot(currentDashboardView);
    }

    refreshLayoutDialog();
    layoutPanelSearch?.focus();
  }

  function closeLayoutDialog() {
    if (!layoutDialog) return;

    hideConfirmStrip();
    exitLayoutPreview();
    layoutDialog.hidden = true;
    layoutToggleBtn?.setAttribute("aria-expanded", "false");
    showLayoutError("");
  }

  function bindLayoutDialog() {
    layoutDialog = document.getElementById("layout-dialog");
    layoutBackdrop = document.getElementById("layout-dialog-backdrop");
    layoutCloseBtn = document.getElementById("layout-dialog-close");
    layoutDoneBtn = document.getElementById("layout-dialog-done");
    layoutViewList = document.getElementById("layout-view-list");
    layoutPanelTitle = document.getElementById("layout-panel-title");
    layoutPanelSearch = document.getElementById("layout-panel-search");
    layoutPanelGroups = document.getElementById("layout-panel-groups");
    layoutPanelActions = document.getElementById("layout-panel-actions");
    layoutResetBtn = document.getElementById("layout-reset-btn");
    layoutRevertBtn = document.getElementById("layout-revert-btn");
    layoutNewViewSection = document.getElementById("layout-new-view-section");
    layoutNewViewName = document.getElementById("layout-new-view-name");
    layoutNewViewTemplate = document.getElementById("layout-new-view-template");
    layoutNewViewSaveBtn = document.getElementById("layout-new-view-save");
    layoutError = document.getElementById("layout-error");
    layoutFooterCount = document.getElementById("layout-footer-count");
    layoutDuplicateBtn = document.getElementById("layout-duplicate-btn");
    layoutExportBtn = document.getElementById("layout-export-btn");
    layoutImportBtn = document.getElementById("layout-import-btn");
    layoutImportInput = document.getElementById("layout-import-input");
    layoutConfirmStrip = document.getElementById("layout-confirm-strip");
    layoutConfirmMessage = document.getElementById("layout-confirm-message");
    layoutConfirmYes = document.getElementById("layout-confirm-yes");
    layoutConfirmNo = document.getElementById("layout-confirm-no");
    settingsLayoutSummary = document.getElementById("settings-layout-summary");
    settingsOpenLayoutLink = document.getElementById("settings-open-layout");
    layoutToggleBtn = document.getElementById("layout-toggle");
    layoutPreviewBtn = document.getElementById("layout-dialog-preview");
    layoutPreviewViewName = document.getElementById("layout-preview-view-name");
    layoutPreviewModified = document.getElementById("layout-preview-modified");
    layoutPreviewEditBtn = document.getElementById("layout-preview-edit");
    layoutPreviewDoneBtn = document.getElementById("layout-preview-done");

    bindLayoutPanelResize();

    layoutToggleBtn?.addEventListener("click", openLayoutDialog);
    settingsOpenLayoutLink?.addEventListener("click", (event) => {
      event.preventDefault();
      openLayoutDialog();
    });

    layoutCloseBtn?.addEventListener("click", closeLayoutDialog);
    layoutDoneBtn?.addEventListener("click", closeLayoutDialog);
    layoutBackdrop?.addEventListener("click", closeLayoutDialog);
    layoutPreviewBtn?.addEventListener("click", toggleLayoutPreview);
    layoutPreviewEditBtn?.addEventListener("click", () => {
      exitLayoutPreview();
      refreshLayoutDialog();
      layoutPanelSearch?.focus();
    });
    layoutPreviewDoneBtn?.addEventListener("click", closeLayoutDialog);

    layoutResetBtn?.addEventListener("click", resetPanelPrefsForCurrentView);
    layoutRevertBtn?.addEventListener("click", revertCustomViewChanges);

    layoutPanelSearch?.addEventListener("input", () => {
      panelSearchQuery = layoutPanelSearch.value.trim();
      buildPanelGroups();
    });

    const showAllPanels = document.getElementById("layout-show-all-panels");
    const hideAllPanels = document.getElementById("layout-hide-all-panels");
    showAllPanels?.addEventListener("click", () => {
      setPanelsVisibility(
        PANEL_DEFS.map((p) => p.id),
        true,
      );
    });
    hideAllPanels?.addEventListener("click", () => {
      setPanelsVisibility(
        PANEL_DEFS.map((p) => p.id),
        false,
      );
    });

    layoutNewViewSaveBtn?.addEventListener("click", saveCurrentAsCustomView);
    layoutNewViewName?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveCurrentAsCustomView();
      }
    });

    layoutDuplicateBtn?.addEventListener("click", duplicateCurrentView);
    layoutExportBtn?.addEventListener("click", downloadExport);

    const layoutCopyBtn = document.getElementById("layout-copy-btn");
    layoutCopyBtn?.addEventListener("click", copyExportToClipboard);

    layoutImportBtn?.addEventListener("click", () => layoutImportInput?.click());
    layoutImportInput?.addEventListener("change", () => {
      const file = layoutImportInput.files?.[0];
      layoutImportInput.value = "";
      handleImportFile(file);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && layoutDialog && !layoutDialog.hidden) {
        if (!layoutConfirmStrip?.hidden) {
          hideConfirmStrip();
          return;
        }
        if (isLayoutPreviewActive()) {
          exitLayoutPreview();
          refreshLayoutDialog();
          layoutPanelSearch?.focus();
          return;
        }
        closeLayoutDialog();
      }
    });

    if (layoutNewViewTemplate) {
      layoutNewViewTemplate.innerHTML = "";
      for (const [key, template] of Object.entries(VIEW_TEMPLATES)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = template.label;
        layoutNewViewTemplate.appendChild(option);
      }
    }
  }

  function getInitialDashboardView() {
    const saved = localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
    if (saved === "live" || saved === "history") {
      localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, "default");
      return "default";
    }
    if (saved && isValidViewId(saved)) {
      return saved;
    }

    return "default";
  }

  function init(options = {}) {
    viewSelect = options.viewSelect ?? document.getElementById("view-select");
    tablesGrid = options.tablesGrid ?? document.querySelector(".tables-grid");
    onViewApplied = options.onViewApplied ?? null;

    loadPanelPrefs();
    loadCustomViews();
    purgeRemovedBuiltinState();
    bindLayoutDialog();
    rebuildViewSelect();

    const initialView = getInitialDashboardView();
    setDashboardView(initialView, false);

    if (isCustomView(initialView)) {
      captureCustomViewSnapshot(initialView);
    }

    viewSelect?.addEventListener("change", () => {
      const next = viewSelect.value;
      setDashboardView(next);
      if (isCustomView(next)) {
        captureCustomViewSnapshot(next);
      }
    });

    updateSettingsLayoutSummary();

    if (new URLSearchParams(window.location.search).get("layout") === "1") {
      openLayoutDialog();
    }
  }

  function onViewChange(callback) {
    viewChangeCallbacks.push(callback);
    return () => {
      viewChangeCallbacks = viewChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  function onLayoutChange(callback) {
    layoutChangeCallbacks.push(callback);
    return () => {
      layoutChangeCallbacks = layoutChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  return {
    init,
    getCurrentView: () => currentDashboardView,
    setView: setDashboardView,
    needsHistoryVisualizations,
    getEffectivePanelVisibility,
    openLayoutDialog,
    closeLayoutDialog,
    updateSettingsLayoutSummary,
    onViewChange,
    onLayoutChange,
  };
})();

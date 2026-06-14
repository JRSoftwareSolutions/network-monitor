/* ---------- dashboard views data model ---------- */

const ViewsModel = (() => {
  const BUILTIN_VIEWS = ["default"];
  const MAX_CUSTOM_VIEWS = 20;

  const STORAGE_KEYS = {
    dashboardView: "networkMonitor.dashboardView",
    panelPrefs: "networkMonitor.panelPrefs",
    customViews: "networkMonitor.customViews",
    panelLayoutPrefs: "networkMonitor.panelLayoutPrefs",
    layoutPanelWidth: "networkMonitor.layoutPanelWidth",
  };

  const PANEL_GROUPS = {
    status: { label: "Status & verdict", order: 1 },
    live: { label: "Live monitoring", order: 2 },
    window: { label: "Window summary", order: 3 },
    charts: { label: "Charts", order: 4 },
    tables: { label: "Tables", order: 5 },
  };

  const PANEL_DEFS = [
    { id: "hero", label: "Connection status", group: "status", description: "Stabilized gaming verdict banner" },
    { id: "status", label: "Current status", group: "status", description: "Plain-language narrative and reason chips" },
    { id: "indicators", label: "Key indicators", group: "live", description: "Ping, jitter, loss, and spike rate tiles" },
    { id: "live", label: "Live feed", group: "live", description: "Last raw ping and heartbeat strip" },
    { id: "narrative", label: "What's happening", group: "live", description: "Plain-language connection readout" },
    { id: "stats", label: "Selected window", group: "window", description: "Rolling-window stats with health chip" },
    { id: "latency", label: "Latency chart", group: "charts", description: "Per-ping round trip time over the window" },
    { id: "distribution", label: "Latency distribution", group: "charts", description: "Ping spread across quality tiers" },
    { id: "jitter", label: "Jitter chart", group: "charts", description: "Timing variation between pings" },
    { id: "loss", label: "Packet loss chart", group: "charts", description: "Failed pings per minute bucket" },
    { id: "quality-timeline", label: "Quality timeline", group: "charts", description: "Minute-by-minute connection quality" },
    { id: "outages", label: "Outages", group: "tables", description: "Failure stretches in the window" },
    { id: "recent", label: "Recent samples", group: "tables", description: "Latest pings, newest first" },
  ];

  const VIEW_LABELS = {
    default: "Default",
    analytics: "Analytics",
  };

  const VIEW_DESCRIPTIONS = {
    default: "Full dashboard with live monitoring and history",
    analytics: "Charts and tables focused on window analytics",
  };

  const VIEW_DEFAULTS = {
    default: {
      hero: true,
      status: true,
      indicators: true,
      live: true,
      narrative: true,
      stats: true,
      latency: true,
      distribution: true,
      jitter: true,
      loss: true,
      "quality-timeline": true,
      outages: true,
      recent: true,
    },
    analytics: {
      hero: false,
      status: true,
      indicators: false,
      live: false,
      narrative: false,
      stats: true,
      latency: true,
      distribution: true,
      jitter: true,
      loss: true,
      "quality-timeline": true,
      outages: true,
      recent: true,
    },
  };

  const LAYOUT_DEFAULTS = {
    default: {
      hero: { w: 8, order: 0 },
      status: { w: 4, order: 1 },
      indicators: { w: 12, order: 2 },
      live: { w: 7, order: 3 },
      narrative: { w: 5, order: 4 },
      stats: { w: 12, order: 5 },
      latency: { w: 8, order: 6 },
      distribution: { w: 4, order: 7 },
      jitter: { w: 6, order: 8 },
      loss: { w: 6, order: 9 },
      "quality-timeline": { w: 12, order: 10 },
      outages: { w: 6, order: 11 },
      recent: { w: 6, order: 12 },
    },
    analytics: {
      hero: { w: 12, order: 0 },
      status: { w: 12, order: 1 },
      indicators: { w: 12, order: 2 },
      live: { w: 12, order: 3 },
      narrative: { w: 12, order: 4 },
      stats: { w: 12, order: 5 },
      latency: { w: 12, order: 6 },
      distribution: { w: 6, order: 7 },
      jitter: { w: 6, order: 8 },
      loss: { w: 6, order: 9 },
      "quality-timeline": { w: 12, order: 10 },
      outages: { w: 6, order: 11 },
      recent: { w: 6, order: 12 },
    },
  };

  let customViews = {};
  let panelPrefs = {};
  let panelLayoutPrefs = {};
  let currentView = "default";

  function panelIds() {
    return PANEL_DEFS.map((p) => p.id);
  }

  function isBuiltinView(viewId) {
    return BUILTIN_VIEWS.includes(viewId);
  }

  function isCustomView(viewId) {
    return Boolean(customViews[viewId]);
  }

  function isValidViewId(viewId) {
    return isBuiltinView(viewId) || isCustomView(viewId);
  }

  function normalizePanelMap(panels, fallbackDefaults = VIEW_DEFAULTS.default) {
    const visibility = {};
    for (const { id } of PANEL_DEFS) {
      visibility[id] = panels?.[id] ?? fallbackDefaults[id] ?? true;
    }
    return visibility;
  }

  function loadCustomViews() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.customViews);
      customViews = raw ? JSON.parse(raw) : {};
    } catch {
      customViews = {};
    }
    for (const [id, view] of Object.entries(customViews)) {
      if (!view || typeof view !== "object") {
        delete customViews[id];
        continue;
      }
      const basedOn = view.basedOn && VIEW_DEFAULTS[view.basedOn] ? view.basedOn : "default";
      view.panels = normalizePanelMap(view.panels, VIEW_DEFAULTS[basedOn]);
      if (!view.layout || typeof view.layout !== "object") view.layout = {};
      if (!view.createdAt) view.createdAt = new Date(0).toISOString();
    }
  }

  function saveCustomViews() {
    localStorage.setItem(STORAGE_KEYS.customViews, JSON.stringify(customViews));
  }

  function loadPanelPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.panelPrefs);
      panelPrefs = raw ? JSON.parse(raw) : {};
    } catch {
      panelPrefs = {};
    }
  }

  function savePanelPrefs() {
    localStorage.setItem(STORAGE_KEYS.panelPrefs, JSON.stringify(panelPrefs));
  }

  function loadPanelLayoutPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.panelLayoutPrefs);
      panelLayoutPrefs = raw ? JSON.parse(raw) : {};
    } catch {
      panelLayoutPrefs = {};
    }
  }

  function savePanelLayoutPrefs() {
    localStorage.setItem(STORAGE_KEYS.panelLayoutPrefs, JSON.stringify(panelLayoutPrefs));
  }

  function getPanelOverrides(viewId) {
    return panelPrefs[viewId] ?? {};
  }

  function getPanelLayoutOverrides(viewId) {
    return panelLayoutPrefs[viewId] ?? {};
  }

  function getLayoutDefaultsForView(viewId) {
    if (isCustomView(viewId)) {
      const basedOn = customViews[viewId].basedOn;
      return LAYOUT_DEFAULTS[basedOn] ?? LAYOUT_DEFAULTS.default;
    }
    return LAYOUT_DEFAULTS[viewId] ?? LAYOUT_DEFAULTS.default;
  }

  function getEffectivePanelVisibility(viewId = currentView) {
    if (isCustomView(viewId)) {
      return normalizePanelMap(customViews[viewId].panels);
    }
    const defaults = VIEW_DEFAULTS[viewId] ?? VIEW_DEFAULTS.default;
    const overrides = getPanelOverrides(viewId);
    const visibility = {};
    for (const { id } of PANEL_DEFS) {
      visibility[id] = overrides[id] ?? defaults[id] ?? true;
    }
    return visibility;
  }

  function getEffectivePanelLayout(viewId = currentView) {
    const defaults = getLayoutDefaultsForView(viewId);
    const layout = {};
    for (const { id } of PANEL_DEFS) {
      let item;
      if (isCustomView(viewId)) {
        item = customViews[viewId]?.layout?.[id];
      } else {
        item = getPanelLayoutOverrides(viewId)[id];
      }
      layout[id] = { ...defaults[id], ...(item ?? {}) };
    }
    return layout;
  }

  function getViewLabel(viewId) {
    if (isBuiltinView(viewId)) return VIEW_LABELS[viewId] ?? viewId;
    return customViews[viewId]?.label ?? viewId;
  }

  function loadCurrentView() {
    const saved = localStorage.getItem(STORAGE_KEYS.dashboardView);
    if (saved && isValidViewId(saved)) {
      currentView = saved;
    } else {
      currentView = "default";
    }
    localStorage.setItem(STORAGE_KEYS.dashboardView, currentView);
  }

  function setCurrentView(viewId) {
    if (!isValidViewId(viewId)) return false;
    currentView = viewId;
    localStorage.setItem(STORAGE_KEYS.dashboardView, viewId);
    return true;
  }

  function setPanelVisibility(viewId, panelId, visible) {
    if (isCustomView(viewId)) {
      customViews[viewId].panels[panelId] = visible;
      saveCustomViews();
      return;
    }
    const defaults = VIEW_DEFAULTS[viewId] ?? VIEW_DEFAULTS.default;
    const overrides = { ...getPanelOverrides(viewId) };
    if (visible === defaults[panelId]) {
      delete overrides[panelId];
    } else {
      overrides[panelId] = visible;
    }
    if (Object.keys(overrides).length) {
      panelPrefs[viewId] = overrides;
    } else {
      delete panelPrefs[viewId];
    }
    savePanelPrefs();
  }

  function setPanelLayout(viewId, panelId, item) {
    if (isCustomView(viewId)) {
      if (!customViews[viewId].layout) customViews[viewId].layout = {};
      customViews[viewId].layout[panelId] = { ...item };
      saveCustomViews();
      return;
    }
    const defaults = getLayoutDefaultsForView(viewId);
    const overrides = { ...getPanelLayoutOverrides(viewId) };
    const merged = { ...defaults[panelId], ...item };
    const isDefault = ["w", "order"].every(
      (key) => merged[key] === defaults[panelId]?.[key],
    );
    if (isDefault) {
      delete overrides[panelId];
    } else {
      overrides[panelId] = item;
    }
    if (Object.keys(overrides).length) {
      panelLayoutPrefs[viewId] = overrides;
    } else {
      delete panelLayoutPrefs[viewId];
    }
    savePanelLayoutPrefs();
  }

  function saveLayoutFromGrid(viewId, layoutMap) {
    if (isCustomView(viewId)) {
      customViews[viewId].layout = { ...layoutMap };
      saveCustomViews();
      return;
    }
    const defaults = getLayoutDefaultsForView(viewId);
    const overrides = {};
    for (const { id } of PANEL_DEFS) {
      const item = layoutMap[id];
      if (!item) continue;
      const isDefault = ["w", "order"].every(
        (key) => item[key] === defaults[id]?.[key],
      );
      if (!isDefault) overrides[id] = { ...item };
    }
    if (Object.keys(overrides).length) {
      panelLayoutPrefs[viewId] = overrides;
    } else {
      delete panelLayoutPrefs[viewId];
    }
    savePanelLayoutPrefs();
  }

  function resetPanelVisibility(viewId) {
    if (isCustomView(viewId)) {
      const basedOn = customViews[viewId].basedOn ?? "default";
      customViews[viewId].panels = normalizePanelMap(null, VIEW_DEFAULTS[basedOn]);
      saveCustomViews();
      return;
    }
    delete panelPrefs[viewId];
    savePanelPrefs();
  }

  function resetPanelLayout(viewId) {
    if (isCustomView(viewId)) {
      customViews[viewId].layout = {};
      saveCustomViews();
      return;
    }
    delete panelLayoutPrefs[viewId];
    savePanelLayoutPrefs();
  }

  function uniqueCustomViewId(label) {
    const base = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "view";
    let id = base;
    let n = 2;
    while (customViews[id] || isBuiltinView(id)) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  function createCustomView(label, templateViewId = currentView) {
    if (Object.keys(customViews).length >= MAX_CUSTOM_VIEWS) return null;
    const trimmed = label.trim();
    if (!trimmed) return null;
    const basedOn = isBuiltinView(templateViewId)
      ? templateViewId
      : customViews[templateViewId]?.basedOn ?? "default";
    const id = uniqueCustomViewId(trimmed);
    customViews[id] = {
      label: trimmed,
      panels: { ...getEffectivePanelVisibility(templateViewId) },
      layout: { ...getEffectivePanelLayout(templateViewId) },
      createdAt: new Date().toISOString(),
      basedOn,
    };
    saveCustomViews();
    return id;
  }

  function deleteCustomView(viewId) {
    if (!isCustomView(viewId)) return false;
    delete customViews[viewId];
    saveCustomViews();
    return true;
  }

  function renameCustomView(viewId, label) {
    if (!isCustomView(viewId)) return false;
    const trimmed = label.trim();
    if (!trimmed) return false;
    customViews[viewId].label = trimmed;
    saveCustomViews();
    return true;
  }

  function duplicateCustomView(viewId) {
    if (!isValidViewId(viewId)) return null;
    const label = `${getViewLabel(viewId)} copy`;
    const newId = createCustomView(label, viewId);
    return newId;
  }

  function exportViewsJson() {
    return JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      customViews,
      panelPrefs,
      panelLayoutPrefs,
    }, null, 2);
  }

  function importViewsJson(raw) {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") throw new Error("Invalid import file");
    if (data.customViews && typeof data.customViews === "object") {
      customViews = data.customViews;
      loadCustomViews();
      saveCustomViews();
    }
    if (data.panelPrefs && typeof data.panelPrefs === "object") {
      panelPrefs = data.panelPrefs;
      savePanelPrefs();
    }
    if (data.panelLayoutPrefs && typeof data.panelLayoutPrefs === "object") {
      panelLayoutPrefs = data.panelLayoutPrefs;
      savePanelLayoutPrefs();
    }
  }

  function init() {
    loadCustomViews();
    loadPanelPrefs();
    loadPanelLayoutPrefs();
    loadCurrentView();
  }

  return {
    BUILTIN_VIEWS,
    MAX_CUSTOM_VIEWS,
    STORAGE_KEYS,
    PANEL_GROUPS,
    PANEL_DEFS,
    VIEW_LABELS,
    VIEW_DESCRIPTIONS,
    VIEW_DEFAULTS,
    LAYOUT_DEFAULTS,
    panelIds,
    isBuiltinView,
    isCustomView,
    isValidViewId,
    get customViews() { return customViews; },
    get currentView() { return currentView; },
    getViewLabel,
    getEffectivePanelVisibility,
    getEffectivePanelLayout,
    getLayoutDefaultsForView,
    setCurrentView,
    setPanelVisibility,
    setPanelLayout,
    saveLayoutFromGrid,
    resetPanelVisibility,
    resetPanelLayout,
    createCustomView,
    deleteCustomView,
    renameCustomView,
    duplicateCustomView,
    exportViewsJson,
    importViewsJson,
    init,
  };
})();

window.ViewsModel = ViewsModel;

/* ---------- dashboard views data model ---------- */

const ViewsModel = (() => {
  const BUILTIN_VIEWS = ["default"];
  const MAX_CUSTOM_VIEWS = 20;

  const STORAGE_KEYS = {
    dashboardView: "networkMonitor.dashboardView",
    panelPrefs: "networkMonitor.panelPrefs",
    customViews: "networkMonitor.customViews",
    panelLayoutPrefs: "networkMonitor.panelLayoutPrefs",
    windowMinutes: "networkMonitor.windowMinutes",
  };

  const PANEL_GROUPS = {
    status: { label: "Status & verdict", order: 1 },
    live: { label: "Live monitoring", order: 2 },
    window: { label: "Window summary", order: 3 },
    charts: { label: "Charts", order: 4 },
    tables: { label: "Tables", order: 5 },
  };

  const PANEL_DEFS = [
    {
      id: "hero",
      label: "Connection status",
      group: "status",
      description: "Stabilized gaming verdict banner",
      layout: { w: 8, order: 0, minW: 6, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "status",
      label: "Current status",
      group: "status",
      description: "Headline summary and live metric readouts",
      layout: { w: 4, order: 1, minW: 4, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "indicators",
      label: "Key indicators",
      group: "live",
      description: "Ping, jitter, loss, and spike rate tiles",
      layout: { w: 12, order: 2, minW: 6, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "live",
      label: "Live feed",
      group: "live",
      description: "Last raw ping and heartbeat strip",
      layout: { w: 7, order: 3, minW: 6, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "narrative",
      label: "What's happening",
      group: "live",
      description: "Plain-language connection readout",
      layout: { w: 5, order: 4, minW: 4, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "stats",
      label: "Selected window",
      group: "window",
      description: "Rolling-window stats with health chip",
      layout: { w: 12, order: 5, minW: 6, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "latency",
      label: "Latency chart",
      group: "charts",
      description: "Per-ping round trip time over the window",
      layout: { w: 8, order: 6, minW: 4, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "distribution",
      label: "Latency distribution",
      group: "charts",
      description: "Ping spread across quality tiers",
      layout: { w: 4, order: 7, minW: 3, maxW: 8 },
      defaultVisible: true,
    },
    {
      id: "jitter",
      label: "Jitter chart",
      group: "charts",
      description: "Timing variation between pings",
      layout: { w: 6, order: 8, minW: 3, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "loss",
      label: "Packet loss chart",
      group: "charts",
      description: "Failed pings per minute bucket",
      layout: { w: 6, order: 9, minW: 3, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "quality-timeline",
      label: "Quality timeline",
      group: "charts",
      description: "Minute-by-minute connection quality",
      layout: { w: 12, order: 10, minW: 6, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "outages",
      label: "Outages",
      group: "tables",
      description: "Failure stretches in the window",
      layout: { w: 6, order: 11, minW: 4, maxW: 12 },
      defaultVisible: true,
    },
    {
      id: "recent",
      label: "Recent samples",
      group: "tables",
      description: "Latest pings, newest first",
      layout: { w: 6, order: 12, minW: 4, maxW: 12 },
      defaultVisible: true,
    },
  ];

  function buildDefaultVisibility() {
    const visibility = {};
    for (const panel of PANEL_DEFS) {
      visibility[panel.id] = panel.defaultVisible;
    }
    return visibility;
  }

  function buildDefaultLayout() {
    const layout = {};
    for (const panel of PANEL_DEFS) {
      layout[panel.id] = { w: panel.layout.w, order: panel.layout.order };
    }
    return layout;
  }

  const VIEW_LABELS = {
    default: "Default",
  };

  const VIEW_DEFAULTS = {
    default: buildDefaultVisibility(),
  };

  const LAYOUT_DEFAULTS = {
    default: buildDefaultLayout(),
  };

  function getPanelMeta(panelId) {
    const panel = PANEL_DEFS.find((p) => p.id === panelId);
    if (!panel) return { minW: 3, maxW: 12, w: 12, order: 0 };
    return {
      minW: panel.layout.minW,
      maxW: panel.layout.maxW,
      w: panel.layout.w,
      order: panel.layout.order,
    };
  }

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

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadCustomViews() {
    customViews = loadJson(STORAGE_KEYS.customViews, {});
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
    saveJson(STORAGE_KEYS.customViews, customViews);
  }

  function loadPanelPrefs() {
    panelPrefs = loadJson(STORAGE_KEYS.panelPrefs, {});
  }

  function savePanelPrefs() {
    saveJson(STORAGE_KEYS.panelPrefs, panelPrefs);
  }

  function loadPanelLayoutPrefs() {
    panelLayoutPrefs = loadJson(STORAGE_KEYS.panelLayoutPrefs, {});
  }

  function savePanelLayoutPrefs() {
    saveJson(STORAGE_KEYS.panelLayoutPrefs, panelLayoutPrefs);
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

  function layoutMatchesDefaults(viewId, panelId, item) {
    const defaults = getLayoutDefaultsForView(viewId);
    return ["w", "order"].every((key) => item[key] === defaults[panelId]?.[key]);
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
    const isDefault = layoutMatchesDefaults(viewId, panelId, merged);
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
      const isDefault = layoutMatchesDefaults(viewId, id, item);
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
    getPanelMeta,
    setCurrentView,
    setPanelVisibility,
    setPanelLayout,
    saveLayoutFromGrid,
    resetPanelVisibility,
    resetPanelLayout,
    createCustomView,
    deleteCustomView,
    init,
  };
})();

window.ViewsModel = ViewsModel;

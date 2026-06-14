/* ---------- native CSS grid dashboard layout (no GridStack) ---------- */

const DashboardGrid = (() => {
  const GRID_COLUMNS = 12;
  const SINGLE_COLUMN_BREAKPOINT = 832;
  const WIDTH_OPTIONS = [12, 8, 7, 6, 5, 4, 3];

  const GRID_PANEL_META = {
    hero: { minW: 6, maxW: 12 },
    status: { minW: 4, maxW: 12 },
    indicators: { minW: 6, maxW: 12 },
    live: { minW: 6, maxW: 12 },
    narrative: { minW: 4, maxW: 12 },
    stats: { minW: 6, maxW: 12 },
    latency: { minW: 4, maxW: 12 },
    distribution: { minW: 3, maxW: 8 },
    jitter: { minW: 3, maxW: 12 },
    loss: { minW: 3, maxW: 12 },
    "quality-timeline": { minW: 6, maxW: 12 },
    outages: { minW: 4, maxW: 12 },
    recent: { minW: 4, maxW: 12 },
  };

  const PANEL_ORDER = ViewsModel.PANEL_DEFS.map((p) => p.id);

  let gridEl = null;
  let editMode = false;
  let selectedPanelId = null;
  let dragPanelId = null;
  let changeCallbacks = [];
  let changeTimer = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isSingleColumnViewport() {
    return window.innerWidth < SINGLE_COLUMN_BREAKPOINT;
  }

  function getMeta(panelId) {
    return GRID_PANEL_META[panelId] ?? { minW: 3, maxW: 12 };
  }

  /** Migrate legacy GridStack { x, y, w, h } records to { w, order }. */
  function migrateLayoutItem(panelId, item = {}, rawItem = {}) {
    const isLegacy = rawItem.x != null || rawItem.y != null || rawItem.h != null;
    if (!isLegacy && item.order != null && item.w != null) {
      return item;
    }
    const order = isLegacy && Number.isFinite(rawItem.y)
      ? rawItem.y * 100 + (Number.isFinite(rawItem.x) ? rawItem.x : 0)
      : (Number.isFinite(item.order) ? item.order : defaultOrder(panelId));
    return {
      w: item.w,
      order,
    };
  }

  function defaultOrder(panelId) {
    const index = PANEL_ORDER.indexOf(panelId);
    return index >= 0 ? index : 0;
  }

  function normalizeLayoutItem(panelId, item = {}) {
    const meta = getMeta(panelId);
    const defaults = ViewsModel.getLayoutDefaultsForView(ViewsModel.currentView)[panelId] ?? {};
    const merged = { ...defaults, ...item };
    const source = migrateLayoutItem(panelId, merged, item);
    let w = Number.isFinite(source.w) ? source.w : defaults.w ?? 12;
    w = clamp(w, meta.minW, meta.maxW);
    if (isSingleColumnViewport()) w = GRID_COLUMNS;

    return {
      w,
      order: Number.isFinite(source.order) ? source.order : defaultOrder(panelId),
    };
  }

  function normalizeLayoutMap(viewId, layoutMap = {}) {
    const defaults = ViewsModel.getLayoutDefaultsForView(viewId);
    const normalized = {};
    for (const panelId of ViewsModel.panelIds()) {
      normalized[panelId] = normalizeLayoutItem(
        panelId,
        layoutMap[panelId] ?? defaults[panelId] ?? {},
      );
    }
    return normalized;
  }

  function panelElement(panelId) {
    return gridEl?.querySelector(`[data-panel="${panelId}"]`) ?? null;
  }

  function spanClass(w) {
    return `span-${w}`;
  }

  function clearSpanClasses(el) {
    for (const cls of [...el.classList]) {
      if (cls.startsWith("span-")) el.classList.remove(cls);
    }
  }

  function applyPanelLayout(el, item) {
    clearSpanClasses(el);
    el.classList.add(spanClass(item.w));
    el.style.order = String(item.order);
  }

  function readLayoutFromDom() {
    const layout = {};
    for (const panelId of ViewsModel.panelIds()) {
      const el = panelElement(panelId);
      if (!el || el.classList.contains("is-panel-hidden")) continue;
      const spanMatch = [...el.classList].find((c) => /^span-\d+$/.test(c));
      const w = spanMatch ? Number(spanMatch.slice(5)) : 12;
      layout[panelId] = normalizeLayoutItem(panelId, {
        w,
        order: Number(el.style.order) || defaultOrder(panelId),
      });
    }
    return layout;
  }

  function dispatchLayoutChange() {
    window.dispatchEvent(new CustomEvent("nm:layout-change"));
    for (const cb of changeCallbacks) cb(readLayoutFromDom());
  }

  function scheduleLayoutChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      ViewsModel.saveLayoutFromGrid(ViewsModel.currentView, readLayoutFromDom());
      dispatchLayoutChange();
    }, 150);
  }

  function applyLayout(layoutMap, visibilityMap) {
    if (!gridEl) return;
    const normalized = {};
    for (const panelId of ViewsModel.panelIds()) {
      normalized[panelId] = normalizeLayoutItem(panelId, layoutMap[panelId]);
    }

    for (const panelId of ViewsModel.panelIds()) {
      const el = panelElement(panelId);
      if (!el) continue;
      const visible = visibilityMap[panelId] !== false;
      el.classList.toggle("is-panel-hidden", !visible);
      if (visible) {
        applyPanelLayout(el, normalized[panelId]);
      }
    }
    dispatchLayoutChange();
  }

  function applyCurrentView() {
    applyLayout(
      ViewsModel.getEffectivePanelLayout(ViewsModel.currentView),
      ViewsModel.getEffectivePanelVisibility(ViewsModel.currentView),
    );
  }

  function selectPanel(panelId) {
    selectedPanelId = panelId;
    for (const el of gridEl.querySelectorAll("[data-panel]")) {
      el.classList.toggle("is-panel-selected", el.dataset.panel === panelId);
    }
    syncWidthButtons();
  }

  function syncWidthButtons() {
    if (!selectedPanelId) return;
    const el = panelElement(selectedPanelId);
    if (!el) return;
    const spanMatch = [...el.classList].find((c) => /^span-\d+$/.test(c));
    const w = spanMatch ? Number(spanMatch.slice(5)) : 12;
    for (const btn of document.querySelectorAll("[data-width]")) {
      btn.classList.toggle("is-active", Number(btn.dataset.width) === w);
    }
  }

  function setSelectedPanelWidth(w) {
    if (!selectedPanelId) return;
    const el = panelElement(selectedPanelId);
    if (!el) return;
    const item = normalizeLayoutItem(selectedPanelId, {
      ...readLayoutFromDom()[selectedPanelId],
      w: Number(w),
    });
    applyPanelLayout(el, item);
    ViewsModel.setPanelLayout(ViewsModel.currentView, selectedPanelId, item);
    syncWidthButtons();
    scheduleLayoutChange();
  }

  function reorderPanel(panelId, targetPanelId) {
    if (!panelId || !targetPanelId || panelId === targetPanelId) return;
    const layout = readLayoutFromDom();
    const moving = layout[panelId];
    const target = layout[targetPanelId];
    if (!moving || !target) return;

    const panels = ViewsModel.panelIds()
      .filter((id) => !panelElement(id)?.classList.contains("is-panel-hidden"))
      .sort((a, b) => (layout[a]?.order ?? 0) - (layout[b]?.order ?? 0));

    const fromIdx = panels.indexOf(panelId);
    const toIdx = panels.indexOf(targetPanelId);
    if (fromIdx < 0 || toIdx < 0) return;

    panels.splice(fromIdx, 1);
    panels.splice(toIdx, 0, panelId);

    const nextLayout = { ...layout };
    panels.forEach((id, index) => {
      nextLayout[id] = { ...nextLayout[id], order: index * 10 };
    });

    for (const id of ViewsModel.panelIds()) {
      const el = panelElement(id);
      if (!el || el.classList.contains("is-panel-hidden")) continue;
      applyPanelLayout(el, normalizeLayoutItem(id, nextLayout[id]));
    }
    scheduleLayoutChange();
  }

  function bindEditInteractions() {
    if (!gridEl) return;

    gridEl.addEventListener("click", (event) => {
      if (!editMode) return;
      const panel = event.target.closest("[data-panel]");
      if (!panel || panel.classList.contains("is-panel-hidden")) return;
      selectPanel(panel.dataset.panel);
    });

    gridEl.addEventListener("dragstart", (event) => {
      if (!editMode) return;
      const panel = event.target.closest("[data-panel]");
      if (!panel || panel.classList.contains("is-panel-hidden")) return;
      dragPanelId = panel.dataset.panel;
      panel.classList.add("is-panel-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragPanelId);
    });

    gridEl.addEventListener("dragend", (event) => {
      const panel = event.target.closest("[data-panel]");
      panel?.classList.remove("is-panel-dragging");
      dragPanelId = null;
      for (const el of gridEl.querySelectorAll("[data-panel]")) {
        el.classList.remove("is-panel-drop-target");
      }
    });

    gridEl.addEventListener("dragover", (event) => {
      if (!editMode || !dragPanelId) return;
      event.preventDefault();
      const panel = event.target.closest("[data-panel]");
      if (!panel || panel.classList.contains("is-panel-hidden")) return;
      for (const el of gridEl.querySelectorAll("[data-panel]")) {
        el.classList.toggle("is-panel-drop-target", el === panel && el.dataset.panel !== dragPanelId);
      }
    });

    gridEl.addEventListener("drop", (event) => {
      if (!editMode || !dragPanelId) return;
      event.preventDefault();
      const panel = event.target.closest("[data-panel]");
      if (!panel) return;
      reorderPanel(dragPanelId, panel.dataset.panel);
      dragPanelId = null;
    });

    window.addEventListener("resize", () => {
      if (!gridEl) return;
      applyCurrentView();
    });
  }

  function setEditMode(enabled) {
    editMode = Boolean(enabled);
    if (editMode) {
      document.body.setAttribute("data-layout-edit", "true");
    } else {
      document.body.removeAttribute("data-layout-edit");
      selectedPanelId = null;
      for (const el of gridEl?.querySelectorAll("[data-panel]") ?? []) {
        el.classList.remove("is-panel-selected", "is-panel-dragging", "is-panel-drop-target");
        el.removeAttribute("draggable");
      }
      scheduleLayoutChange();
      return;
    }

    for (const el of gridEl.querySelectorAll("[data-panel]:not(.is-panel-hidden)")) {
      el.setAttribute("draggable", "true");
    }
  }

  function isEditMode() {
    return editMode;
  }

  function onLayoutChange(callback) {
    changeCallbacks.push(callback);
  }

  function init() {
    gridEl = document.getElementById("dashboard-grid");
    bindEditInteractions();
    applyCurrentView();
  }

  return {
    GRID_COLUMNS,
    SINGLE_COLUMN_BREAKPOINT,
    WIDTH_OPTIONS,
    GRID_PANEL_META,
    normalizeLayoutItem,
    normalizeLayoutMap,
    applyLayout,
    applyCurrentView,
    setEditMode,
    isEditMode,
    selectPanel,
    getSelectedPanel: () => selectedPanelId,
    setSelectedPanelWidth,
    onLayoutChange,
    readLayoutFromDom,
    init,
  };
})();

window.DashboardGrid = DashboardGrid;

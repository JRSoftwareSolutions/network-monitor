/* ---------- dashboard view builder UI ---------- */

const ViewBuilder = (() => {
  const VM = ViewsModel;
  const DG = DashboardGrid;
  const NEW_VIEW_VALUE = "__new_view__";

  let viewSelect = null;
  let layoutEditMode = false;
  let draftVisibility = null;
  let onViewApplied = null;
  let onLayoutApplied = null;

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function syncDraftVisibility() {
    draftVisibility = { ...VM.getEffectivePanelVisibility(VM.currentView) };
  }

  function populateViewSelect() {
    if (!viewSelect) return;
    const previous = viewSelect.value;
    viewSelect.innerHTML = "";

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "default";
    defaultOpt.textContent = VM.getViewLabel("default");
    viewSelect.appendChild(defaultOpt);

    const customIds = Object.keys(VM.customViews).sort((a, b) =>
      VM.getViewLabel(a).localeCompare(VM.getViewLabel(b)),
    );
    for (const id of customIds) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = VM.getViewLabel(id);
      viewSelect.appendChild(opt);
    }

    const newOpt = document.createElement("option");
    newOpt.value = NEW_VIEW_VALUE;
    newOpt.textContent = "+ New view...";
    viewSelect.appendChild(newOpt);

    const valid = [...VM.BUILTIN_VIEWS, ...customIds];
    viewSelect.value = valid.includes(previous) ? previous : VM.currentView;
    updateViewDeleteButton();
  }

  function updateViewDeleteButton() {
    if (!els.viewDeleteBtn) return;
    const isCustom = VM.isCustomView(VM.currentView);
    els.viewDeleteBtn.hidden = !isCustom;
  }

  function renderPanelGroups() {
    const container = els.panelGroups;
    if (!container || !draftVisibility) return;
    container.innerHTML = "";

    const query = (els.panelSearch?.value ?? "").trim().toLowerCase();
    const groups = Object.entries(VM.PANEL_GROUPS)
      .sort((a, b) => a[1].order - b[1].order);

    for (const [groupId, groupMeta] of groups) {
      const panels = VM.PANEL_DEFS.filter((p) => {
        if (p.group !== groupId) return false;
        if (!query) return true;
        return (
          p.label.toLowerCase().includes(query)
          || p.description.toLowerCase().includes(query)
          || p.id.includes(query)
        );
      });
      if (!panels.length) continue;

      const section = document.createElement("section");
      section.className = "layout-panel-group";
      section.innerHTML = `<h5 class="layout-panel-group__title">${groupMeta.label}</h5>`;
      const list = document.createElement("ul");
      list.className = "layout-panel-list";

      for (const panel of panels) {
        const li = document.createElement("li");
        li.className = "layout-panel-item";
        li.innerHTML = `
          <label class="layout-panel-item__label">
            <input type="checkbox" data-panel-id="${panel.id}" ${draftVisibility[panel.id] ? "checked" : ""}>
            <span>
              <span class="layout-panel-item__name">${panel.label}</span>
              <span class="layout-panel-item__desc">${panel.description}</span>
            </span>
          </label>
        `;
        list.appendChild(li);
      }
      section.appendChild(list);
      container.appendChild(section);
    }
  }

  function applyDraftVisibility() {
    if (!draftVisibility) return;
    const layout = VM.getEffectivePanelLayout(VM.currentView);
    DG.applyLayout(layout, draftVisibility);
    onLayoutApplied?.();
  }

  function commitDraftVisibility() {
    if (!draftVisibility) return;
    for (const { id } of VM.PANEL_DEFS) {
      VM.setPanelVisibility(VM.currentView, id, draftVisibility[id]);
    }
    DG.applyCurrentView();
    onLayoutApplied?.();
  }

  function applyView(viewId, options = {}) {
    if (!VM.setCurrentView(viewId)) return;
    if (!options.skipSelect && viewSelect) viewSelect.value = viewId;
    syncDraftVisibility();
    DG.applyCurrentView();
    onViewApplied?.({ viewId, needsHistory: true });
    onLayoutApplied?.();
    renderPanelGroups();
    updateSettingsSummary();
    updateViewDeleteButton();
    if (els.editViewName) {
      els.editViewName.textContent = VM.getViewLabel(viewId);
    }
  }

  function updateSettingsSummary() {
    const summary = $("settings-layout-summary");
    if (summary) summary.textContent = VM.getViewLabel(VM.currentView);
  }

  function setPanelsPopoverOpen(open) {
    if (!els.panelsPopover || !els.panelsToggle) return;
    els.panelsPopover.hidden = !open;
    els.panelsToggle.setAttribute("aria-expanded", String(open));
    if (open) renderPanelGroups();
  }

  function enterEditMode() {
    if (layoutEditMode) return;
    layoutEditMode = true;
    syncDraftVisibility();
    renderPanelGroups();
    DG.setEditMode(true);
    if (els.editBar) els.editBar.hidden = false;
    if (els.layoutToggle) {
      els.layoutToggle.setAttribute("aria-pressed", "true");
      els.layoutToggle.classList.add("is-active");
    }
    if (els.editViewName) {
      els.editViewName.textContent = VM.getViewLabel(VM.currentView);
    }
  }

  function exitEditMode() {
    if (!layoutEditMode) return;
    layoutEditMode = false;
    setPanelsPopoverOpen(false);
    commitDraftVisibility();
    DG.setEditMode(false);
    if (els.editBar) els.editBar.hidden = true;
    if (els.layoutToggle) {
      els.layoutToggle.setAttribute("aria-pressed", "false");
      els.layoutToggle.classList.remove("is-active");
    }
  }

  function toggleEditMode() {
    if (layoutEditMode) exitEditMode();
    else enterEditMode();
  }

  function resetLayout() {
    VM.resetPanelLayout(VM.currentView);
    DG.applyCurrentView();
    onLayoutApplied?.();
  }

  function resetVisibility() {
    VM.resetPanelVisibility(VM.currentView);
    syncDraftVisibility();
    applyDraftVisibility();
    renderPanelGroups();
  }

  function openNewViewModal() {
    if (!els.newViewModal) return;
    if (els.newViewName) els.newViewName.value = "";
    setNewViewError("");
    els.newViewModal.hidden = false;
    els.newViewName?.focus();
  }

  function closeNewViewModal() {
    if (!els.newViewModal) return;
    els.newViewModal.hidden = true;
    setNewViewError("");
    if (viewSelect) viewSelect.value = VM.currentView;
  }

  function setNewViewError(message) {
    if (!els.newViewError) return;
    if (message) {
      els.newViewError.textContent = message;
      els.newViewError.hidden = false;
    } else {
      els.newViewError.hidden = true;
      els.newViewError.textContent = "";
    }
  }

  function createNewView(name) {
    commitDraftVisibility();
    const id = VM.createCustomView(name, VM.currentView);
    if (!id) {
      setNewViewError("Could not create view ? check the name or custom view limit.");
      return false;
    }
    closeNewViewModal();
    populateViewSelect();
    applyView(id);
    return true;
  }

  function deleteCurrentView() {
    if (!VM.isCustomView(VM.currentView)) return;
    const label = VM.getViewLabel(VM.currentView);
    if (!window.confirm(`Delete view "${label}"?`)) return;
    const deleted = VM.currentView;
    if (!VM.deleteCustomView(deleted)) return;
    populateViewSelect();
    applyView("default");
  }

  function bindEvents() {
    viewSelect?.addEventListener("change", (e) => {
      const value = e.target.value;
      if (value === NEW_VIEW_VALUE) {
        openNewViewModal();
        return;
      }
      applyView(value);
    });

    els.layoutToggle?.addEventListener("click", toggleEditMode);
    els.exitEditBtn?.addEventListener("click", exitEditMode);
    els.resetLayoutBtn?.addEventListener("click", resetLayout);
    els.viewDeleteBtn?.addEventListener("click", deleteCurrentView);

    els.panelsToggle?.addEventListener("click", () => {
      setPanelsPopoverOpen(els.panelsPopover?.hidden ?? true);
    });

    els.panelGroups?.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"][data-panel-id]');
      if (!input || !draftVisibility) return;
      draftVisibility[input.dataset.panelId] = input.checked;
      applyDraftVisibility();
      renderPanelGroups();
      if (layoutEditMode) {
        DG.setEditMode(true);
      }
    });

    els.panelSearch?.addEventListener("input", renderPanelGroups);

    els.showAll?.addEventListener("click", () => {
      for (const { id } of VM.PANEL_DEFS) draftVisibility[id] = true;
      applyDraftVisibility();
      renderPanelGroups();
      if (layoutEditMode) DG.setEditMode(true);
    });

    els.hideAll?.addEventListener("click", () => {
      for (const { id } of VM.PANEL_DEFS) draftVisibility[id] = false;
      applyDraftVisibility();
      renderPanelGroups();
      if (layoutEditMode) DG.setEditMode(true);
    });

    els.resetBtn?.addEventListener("click", resetVisibility);

    function bindWidthPresets(container) {
      container?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-width]");
        if (!btn) return;
        DG.setSelectedPanelWidth(btn.dataset.width);
      });
    }

    bindWidthPresets(els.editWidthPresets);

    els.newViewForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = els.newViewName?.value ?? "";
      createNewView(name);
    });

    els.newViewCancel?.addEventListener("click", closeNewViewModal);
    els.newViewClose?.addEventListener("click", closeNewViewModal);
    els.newViewBackdrop?.addEventListener("click", closeNewViewModal);

    $("settings-open-layout")?.addEventListener("click", () => {
      $("settings-modal")?.setAttribute("hidden", "");
      enterEditMode();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (els.newViewModal && !els.newViewModal.hidden) {
          closeNewViewModal();
          return;
        }
        if (els.panelsPopover && !els.panelsPopover.hidden) {
          setPanelsPopoverOpen(false);
          return;
        }
        if (layoutEditMode) exitEditMode();
      }
    });

    document.addEventListener("click", (e) => {
      if (!els.panelsPopover || els.panelsPopover.hidden) return;
      if (e.target.closest(".layout-panels-menu")) return;
      setPanelsPopoverOpen(false);
    });

    if (new URLSearchParams(location.search).get("layout") === "1") {
      requestAnimationFrame(enterEditMode);
    }
  }

  function cacheElements() {
    viewSelect = $("view-select");
    els.layoutToggle = $("layout-toggle");
    els.viewDeleteBtn = $("view-delete-btn");
    els.panelGroups = $("layout-panel-groups");
    els.panelSearch = $("layout-panel-search");
    els.showAll = $("layout-show-all-panels");
    els.hideAll = $("layout-hide-all-panels");
    els.resetBtn = $("layout-reset-btn");
    els.resetLayoutBtn = $("layout-reset-layout");
    els.editBar = $("layout-edit-bar");
    els.exitEditBtn = $("layout-exit-edit");
    els.editWidthPresets = $("layout-edit-width-presets");
    els.editViewName = $("layout-edit-view-name");
    els.panelsToggle = $("layout-panels-toggle");
    els.panelsPopover = $("layout-panels-popover");
    els.newViewModal = $("new-view-modal");
    els.newViewForm = $("new-view-form");
    els.newViewName = $("new-view-name");
    els.newViewError = $("new-view-error");
    els.newViewCancel = $("new-view-cancel");
    els.newViewClose = $("new-view-close");
    els.newViewBackdrop = $("new-view-backdrop");
  }

  function init(options = {}) {
    onViewApplied = options.onViewApplied ?? null;
    onLayoutApplied = options.onLayoutApplied ?? null;
    VM.init();
    cacheElements();
    populateViewSelect();
    bindEvents();
    DG.init();
    syncDraftVisibility();
    updateSettingsSummary();
  }

  return {
    init,
    applyView,
    enterEditMode,
    exitEditMode,
    getCurrentView: () => VM.currentView,
    updateSettingsLayoutSummary: updateSettingsSummary,
    onViewChange(cb) { onViewApplied = cb; },
    onLayoutChange(cb) { onLayoutApplied = cb; },
  };
})();

window.ViewBuilder = ViewBuilder;

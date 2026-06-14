/* ---------- dashboard view builder UI ---------- */

const ViewBuilder = (() => {
  const VM = ViewsModel;
  const DG = DashboardGrid;

  let viewSelect = null;
  let layoutDialog = null;
  let layoutEditMode = false;
  let layoutPreview = false;
  let draftVisibility = null;
  let onViewApplied = null;
  let onLayoutApplied = null;

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function isDialogOpen() {
    return layoutDialog && !layoutDialog.hidden;
  }

  function isViewModified() {
    if (!draftVisibility) return false;
    const current = VM.getEffectivePanelVisibility(VM.currentView);
    return VM.PANEL_DEFS.some(({ id }) => draftVisibility[id] !== current[id]);
  }

  function syncDraftVisibility() {
    draftVisibility = { ...VM.getEffectivePanelVisibility(VM.currentView) };
  }

  function populateViewSelect() {
    if (!viewSelect) return;
    viewSelect.innerHTML = "";
    for (const id of VM.BUILTIN_VIEWS) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = VM.getViewLabel(id);
      viewSelect.appendChild(opt);
    }
    const customIds = Object.keys(VM.customViews).sort((a, b) =>
      VM.getViewLabel(a).localeCompare(VM.getViewLabel(b)),
    );
    for (const id of customIds) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = VM.getViewLabel(id);
      viewSelect.appendChild(opt);
    }
    viewSelect.value = VM.currentView;
  }

  function renderViewList() {
    const list = els.viewList;
    if (!list) return;
    list.innerHTML = "";

    function addItem(id, label, description, isCustom) {
      const li = document.createElement("li");
      li.className = "layout-view-item";
      if (id === VM.currentView) li.classList.add("is-active");
      li.innerHTML = `
        <button type="button" class="layout-view-item__select" data-view-id="${id}">
          <span class="layout-view-item__label">${label}</span>
          ${description ? `<span class="layout-view-item__desc">${description}</span>` : ""}
        </button>
        ${isCustom ? `<button type="button" class="layout-view-item__delete" data-view-id="${id}" aria-label="Delete view">?</button>` : ""}
      `;
      list.appendChild(li);
    }

    for (const id of VM.BUILTIN_VIEWS) {
      addItem(id, VM.getViewLabel(id), VM.VIEW_DESCRIPTIONS[id], false);
    }
    for (const id of Object.keys(VM.customViews).sort((a, b) =>
      VM.getViewLabel(a).localeCompare(VM.getViewLabel(b)),
    )) {
      addItem(id, VM.getViewLabel(id), "Custom view", true);
    }

    if (els.footerCount) {
      const count = Object.keys(VM.customViews).length;
      els.footerCount.textContent = `${count} / ${VM.MAX_CUSTOM_VIEWS} custom views`;
    }
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

    if (els.revertBtn) {
      els.revertBtn.hidden = !isViewModified();
    }
  }

  function populateTemplateSelect() {
    const select = els.newViewTemplate;
    if (!select) return;
    select.innerHTML = "";
    for (const id of VM.BUILTIN_VIEWS) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = VM.getViewLabel(id);
      select.appendChild(opt);
    }
    for (const id of Object.keys(VM.customViews)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = VM.getViewLabel(id);
      select.appendChild(opt);
    }
    select.value = VM.currentView;
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
    applyView(VM.currentView, { skipSelect: true });
  }

  function applyView(viewId, options = {}) {
    if (!VM.setCurrentView(viewId)) return;
    if (!options.skipSelect && viewSelect) viewSelect.value = viewId;
    syncDraftVisibility();
    DG.applyCurrentView();
    onViewApplied?.({ viewId, needsHistory: true });
    onLayoutApplied?.();
    renderViewList();
    renderPanelGroups();
    updateSettingsSummary();
  }

  function setLayoutError(message) {
    if (!els.error) return;
    if (message) {
      els.error.textContent = message;
      els.error.hidden = false;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }
  }

  function updateSettingsSummary() {
    const summary = $("settings-layout-summary");
    if (summary) summary.textContent = VM.getViewLabel(VM.currentView);
  }

  function setLayoutPreview(active) {
    layoutPreview = active;
    layoutDialog?.classList.toggle("is-preview", active);
    els.titleEdit?.toggleAttribute("hidden", active);
    els.titlePreview?.toggleAttribute("hidden", !active);
    els.headActionsEdit?.toggleAttribute("hidden", active);
    els.headActionsPreview?.toggleAttribute("hidden", !active);
    if (els.previewViewName) els.previewViewName.textContent = VM.getViewLabel(VM.currentView);
    if (els.previewModified) els.previewModified.hidden = !isViewModified();
  }

  function openLayoutDialog() {
    if (!layoutDialog) return;
    syncDraftVisibility();
    renderViewList();
    renderPanelGroups();
    populateTemplateSelect();
    setLayoutError("");
    setLayoutPreview(false);
    layoutDialog.hidden = false;
    if (els.layoutToggle) {
      els.layoutToggle.setAttribute("aria-expanded", "true");
    }
    els.panelSearch?.focus();
  }

  function closeLayoutDialog(options = {}) {
    if (!layoutDialog) return;
    if (!options.keepEditMode) {
      exitEditMode();
    }
    commitDraftVisibility();
    setLayoutPreview(false);
    layoutDialog.hidden = true;
    if (els.layoutToggle) {
      els.layoutToggle.setAttribute("aria-expanded", "false");
    }
  }

  function toggleCustomizeGrid() {
    layoutEditMode = !layoutEditMode;
    DG.setEditMode(layoutEditMode);
    if (els.customizeBtn) {
      els.customizeBtn.textContent = layoutEditMode ? "Done customizing" : "Customize grid";
      els.customizeBtn.setAttribute("aria-pressed", String(layoutEditMode));
    }
    if (els.editBar) els.editBar.hidden = !layoutEditMode;
    if (layoutEditMode) {
      closeLayoutDialog({ keepEditMode: true });
    }
  }

  function exitEditMode() {
    if (!layoutEditMode) return;
    layoutEditMode = false;
    DG.setEditMode(false);
    if (els.customizeBtn) {
      els.customizeBtn.textContent = "Customize grid";
      els.customizeBtn.setAttribute("aria-pressed", "false");
    }
    if (els.editBar) els.editBar.hidden = true;
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

  function bindEvents() {
    viewSelect?.addEventListener("change", (e) => {
      applyView(e.target.value);
    });

    els.layoutToggle?.addEventListener("click", () => {
      if (isDialogOpen()) closeLayoutDialog();
      else openLayoutDialog();
    });

    els.dialogClose?.addEventListener("click", closeLayoutDialog);
    els.dialogDone?.addEventListener("click", closeLayoutDialog);
    els.dialogBackdrop?.addEventListener("click", closeLayoutDialog);

    els.dialogPreview?.addEventListener("click", () => {
      commitDraftVisibility();
      setLayoutPreview(true);
    });
    els.previewDone?.addEventListener("click", closeLayoutDialog);
    els.previewEdit?.addEventListener("click", () => setLayoutPreview(false));

    els.viewList?.addEventListener("click", (e) => {
      const selectBtn = e.target.closest(".layout-view-item__select");
      const deleteBtn = e.target.closest(".layout-view-item__delete");
      if (selectBtn) {
        applyView(selectBtn.dataset.viewId);
        syncDraftVisibility();
        renderPanelGroups();
        return;
      }
      if (deleteBtn) {
        const viewId = deleteBtn.dataset.viewId;
        if (VM.deleteCustomView(viewId)) {
          if (VM.currentView === viewId) applyView("default");
          populateViewSelect();
          renderViewList();
          populateTemplateSelect();
        }
      }
    });

    els.panelGroups?.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"][data-panel-id]');
      if (!input || !draftVisibility) return;
      draftVisibility[input.dataset.panelId] = input.checked;
      applyDraftVisibility();
      renderPanelGroups();
    });

    els.panelSearch?.addEventListener("input", renderPanelGroups);

    els.showAll?.addEventListener("click", () => {
      for (const { id } of VM.PANEL_DEFS) draftVisibility[id] = true;
      applyDraftVisibility();
      renderPanelGroups();
    });

    els.hideAll?.addEventListener("click", () => {
      for (const { id } of VM.PANEL_DEFS) draftVisibility[id] = false;
      applyDraftVisibility();
      renderPanelGroups();
    });

    els.resetBtn?.addEventListener("click", resetVisibility);
    els.revertBtn?.addEventListener("click", () => {
      syncDraftVisibility();
      applyDraftVisibility();
      renderPanelGroups();
    });

    els.customizeBtn?.addEventListener("click", toggleCustomizeGrid);
    els.resetLayoutBtn?.addEventListener("click", resetLayout);
    els.exitEditBtn?.addEventListener("click", exitEditMode);

    function bindSizePresets(container) {
      container?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-size]");
        if (!btn) return;
        DG.setSelectedPanelSize(btn.dataset.size);
        container.querySelectorAll("[data-size]").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
      });
    }

    function bindWidthPresets(container) {
      container?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-width]");
        if (!btn) return;
        DG.setSelectedPanelWidth(btn.dataset.width);
      });
    }

    bindSizePresets(els.sizePresets);
    bindSizePresets(els.editSizePresets);
    bindWidthPresets(els.editWidthPresets);

    els.newViewSave?.addEventListener("click", () => {
      const name = els.newViewName?.value ?? "";
      const template = els.newViewTemplate?.value ?? VM.currentView;
      commitDraftVisibility();
      const id = VM.createCustomView(name, template);
      if (!id) {
        setLayoutError("Could not save view ? check the name or custom view limit.");
        return;
      }
      setLayoutError("");
      if (els.newViewName) els.newViewName.value = "";
      populateViewSelect();
      applyView(id);
      populateTemplateSelect();
    });

    els.duplicateBtn?.addEventListener("click", () => {
      commitDraftVisibility();
      const id = VM.duplicateCustomView(VM.currentView);
      if (id) {
        populateViewSelect();
        applyView(id);
        populateTemplateSelect();
      }
    });

    els.exportBtn?.addEventListener("click", () => {
      const blob = new Blob([VM.exportViewsJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "network-monitor-views.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    els.copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(VM.exportViewsJson());
        setLayoutError("");
      } catch {
        setLayoutError("Could not copy to clipboard.");
      }
    });

    els.importBtn?.addEventListener("click", () => els.importInput?.click());
    els.importInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        VM.importViewsJson(await file.text());
        populateViewSelect();
        applyView(VM.currentView);
        populateTemplateSelect();
        renderViewList();
        setLayoutError("");
      } catch (err) {
        setLayoutError(err.message || "Import failed.");
      }
    });

    $("settings-open-layout")?.addEventListener("click", () => {
      $("settings-modal")?.setAttribute("hidden", "");
      openLayoutDialog();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isDialogOpen()) {
        if (layoutPreview) setLayoutPreview(false);
        else closeLayoutDialog();
      }
    });

    if (new URLSearchParams(location.search).get("layout") === "1") {
      requestAnimationFrame(openLayoutDialog);
    }
  }

  function cacheElements() {
    viewSelect = $("view-select");
    layoutDialog = $("layout-dialog");
    els.layoutToggle = $("layout-toggle");
    els.dialogBackdrop = $("layout-dialog-backdrop");
    els.dialogClose = $("layout-dialog-close");
    els.dialogDone = $("layout-dialog-done");
    els.dialogPreview = $("layout-dialog-preview");
    els.titleEdit = $("layout-dialog-title");
    els.titlePreview = $("layout-dialog-title-preview");
    els.headActionsEdit = document.querySelector(".layout-dialog__head-actions--edit");
    els.headActionsPreview = document.querySelector(".layout-dialog__head-actions--preview");
    els.previewViewName = $("layout-preview-view-name");
    els.previewModified = $("layout-preview-modified");
    els.previewDone = $("layout-preview-done");
    els.previewEdit = $("layout-preview-edit");
    els.viewList = $("layout-view-list");
    els.panelGroups = $("layout-panel-groups");
    els.panelSearch = $("layout-panel-search");
    els.showAll = $("layout-show-all-panels");
    els.hideAll = $("layout-hide-all-panels");
    els.resetBtn = $("layout-reset-btn");
    els.revertBtn = $("layout-revert-btn");
    els.customizeBtn = $("layout-customize-grid");
    els.resetLayoutBtn = $("layout-reset-layout");
    els.sizePresets = $("layout-size-presets");
    els.editBar = $("layout-edit-bar");
    els.exitEditBtn = $("layout-exit-edit");
    els.editSizePresets = $("layout-edit-size-presets");
    els.editWidthPresets = $("layout-edit-width-presets");
    els.newViewName = $("layout-new-view-name");
    els.newViewTemplate = $("layout-new-view-template");
    els.newViewSave = $("layout-new-view-save");
    els.duplicateBtn = $("layout-duplicate-btn");
    els.exportBtn = $("layout-export-btn");
    els.copyBtn = $("layout-copy-btn");
    els.importBtn = $("layout-import-btn");
    els.importInput = $("layout-import-input");
    els.footerCount = $("layout-footer-count");
    els.error = $("layout-error");
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
    openLayoutDialog,
    closeLayoutDialog,
    getCurrentView: () => VM.currentView,
    updateSettingsLayoutSummary: updateSettingsSummary,
    onViewChange(cb) { onViewApplied = cb; },
    onLayoutChange(cb) { onLayoutApplied = cb; },
  };
})();

window.ViewBuilder = ViewBuilder;

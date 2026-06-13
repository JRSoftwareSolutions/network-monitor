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


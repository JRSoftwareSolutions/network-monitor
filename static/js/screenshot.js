/* ---------- dashboard screenshot ---------- */

const SCREENSHOT_IGNORE_SELECTOR = ".settings-popover, .metric-popover, .block-screenshot-btn";
const SCREENSHOT_BG = "#04060c";

function shouldIgnoreScreenshotElement(element) {
  return Boolean(element.closest?.(SCREENSHOT_IGNORE_SELECTOR));
}

function decorateScreenshotClone(clonedDoc, captureKey = null) {
  const roots = captureKey
    ? clonedDoc.querySelectorAll(`[data-screenshot-root="${captureKey}"]`)
    : clonedDoc.querySelectorAll(".panel, .hero, .indicator");
  for (const root of roots) {
    root.classList.add("is-screenshot-capture");
  }
}

function replaceNativeSelectInClone(liveDoc, clonedDoc, selectId) {
  const liveSelect = liveDoc.getElementById(selectId);
  const select = clonedDoc.getElementById(selectId);
  if (!select || select.tagName !== "SELECT") return;

  const option = select.options[select.selectedIndex];
  const replacement = clonedDoc.createElement("span");
  replacement.className = "screenshot-select-replacement";
  replacement.textContent = option?.textContent?.trim() || select.value;

  if (liveSelect) {
    const { width, height } = liveSelect.getBoundingClientRect();
    if (width > 0) replacement.style.width = `${width}px`;
    if (height > 0) replacement.style.height = `${height}px`;
  }

  select.replaceWith(replacement);
}

function fixScreenshotFormControls(liveDoc, clonedDoc, captureKey = null) {
  if (captureKey) return;
  replaceNativeSelectInClone(liveDoc, clonedDoc, "window-select");
  replaceNativeSelectInClone(liveDoc, clonedDoc, "screenshot-range");
}

function html2canvasScreenshotOptions(captureKey = null) {
  return {
    backgroundColor: SCREENSHOT_BG,
    scale: window.devicePixelRatio || 1,
    useCORS: true,
    logging: false,
    ignoreElements: shouldIgnoreScreenshotElement,
    onclone: (clonedDoc) => {
      decorateScreenshotClone(clonedDoc, captureKey);
      fixScreenshotFormControls(document, clonedDoc, captureKey);
    },
  };
}

function getScreenshotRange() {
  return screenshotRangeSelect?.value === "full" ? "full" : "viewport";
}

function getLayoutRect(element) {
  let left = 0;
  let top = 0;
  let node = element;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return {
    left,
    top,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

function normalizeScreenshotCrop({ left, top, width, height }) {
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function getViewportContentCrop() {
  const columnElements = [
    document.querySelector(".topbar-inner"),
    document.querySelector("main"),
  ].filter(Boolean);
  if (!columnElements.length) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const element of columnElements) {
    const rect = element.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clippedRight = Math.min(window.innerWidth, right);
  const clippedBottom = Math.min(window.innerHeight, bottom);
  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

  return normalizeScreenshotCrop({
    left: clippedLeft,
    top: clippedTop,
    width: clippedRight - clippedLeft,
    height: clippedBottom - clippedTop,
  });
}

function getFullPageContentCrop() {
  const topbarInner = document.querySelector(".topbar-inner");
  const topbar = document.querySelector(".topbar");
  const main = document.querySelector("main");
  if (!main) return null;

  const columnElements = [topbarInner, main].filter(Boolean);
  const columnRects = columnElements.map(getLayoutRect);
  const topbarRect = topbar ? getLayoutRect(topbar) : null;
  const mainRect = getLayoutRect(main);

  const left = Math.min(...columnRects.map((rect) => rect.left));
  const right = Math.max(...columnRects.map((rect) => rect.left + rect.width));
  const top = topbarRect ? topbarRect.top : Math.min(...columnRects.map((rect) => rect.top));
  const bottom = mainRect.top + mainRect.height;

  return normalizeScreenshotCrop({
    left,
    top,
    width: right - left,
    height: bottom - top,
  });
}

function cropScreenshotCanvas(canvas, crop, scale) {
  if (!crop) return canvas;

  const sx = Math.max(0, Math.floor(crop.left * scale));
  const sy = Math.max(0, Math.floor(crop.top * scale));
  const sw = Math.min(canvas.width - sx, Math.ceil(crop.width * scale));
  const sh = Math.min(canvas.height - sy, Math.ceil(crop.height * scale));
  if (sw <= 0 || sh <= 0) return canvas;

  const cropped = document.createElement("canvas");
  cropped.width = sw;
  cropped.height = sh;
  cropped.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return cropped;
}

async function captureElementCanvas(element) {
  if (typeof html2canvas !== "function") {
    throw new Error("Screenshot library failed to load");
  }

  const captureKey = `cap-${Date.now()}`;
  element.dataset.screenshotRoot = captureKey;

  try {
    return await html2canvas(element, html2canvasScreenshotOptions(captureKey));
  } finally {
    delete element.dataset.screenshotRoot;
  }
}

async function captureDashboardCanvas(range = getScreenshotRange()) {
  if (typeof html2canvas !== "function") {
    throw new Error("Screenshot library failed to load");
  }

  const scale = window.devicePixelRatio || 1;
  const options = html2canvasScreenshotOptions();

  if (range === "full") {
    const doc = document.documentElement;
    const width = Math.max(doc.scrollWidth, doc.clientWidth, window.innerWidth);
    const height = Math.max(doc.scrollHeight, doc.clientHeight, window.innerHeight);
    const crop = getFullPageContentCrop();
    const canvas = await html2canvas(document.body, {
      ...options,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
    });
    return cropScreenshotCanvas(canvas, crop, scale);
  }

  const crop = getViewportContentCrop();
  const canvas = await html2canvas(document.body, {
    ...options,
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
  });
  return cropScreenshotCanvas(canvas, crop, scale);
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode screenshot"));
    }, type);
  });
}

async function copyCanvasToClipboard(canvas) {
  const blob = await canvasToBlob(canvas);
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image copy is not supported in this browser");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function saveScreenshotToServer(dataUrl, label = "dashboard") {
  const response = await fetch("/api/screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl, label }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Failed to save screenshot");
  }
  return response.json();
}

async function takeDashboardScreenshot() {
  if (!screenshotBtn || screenshotBtn.disabled) return;

  const labelEl = screenshotBtn.querySelector(".fill-toggle-label");
  const originalLabel = labelEl?.textContent ?? "Screenshot";
  screenshotBtn.disabled = true;
  document.body.classList.add("is-capturing-screenshot");
  if (labelEl) labelEl.textContent = "Capturing…";

  try {
    const canvas = await captureDashboardCanvas();
    const dataUrl = canvas.toDataURL("image/png");

    await Promise.all([
      copyCanvasToClipboard(canvas),
      saveScreenshotToServer(dataUrl),
    ]);

    if (labelEl) labelEl.textContent = "Copied!";
  } catch (error) {
    console.error("Screenshot failed", error);
    if (labelEl) labelEl.textContent = "Failed";
  } finally {
    window.setTimeout(() => {
      screenshotBtn.disabled = false;
      document.body.classList.remove("is-capturing-screenshot");
      if (labelEl) labelEl.textContent = originalLabel;
    }, 1600);
  }
}

function initScreenshot() {
  initBlockScreenshots();

  if (!screenshotBtn) return;

  if (screenshotRangeSelect) {
    const saved = localStorage.getItem(SCREENSHOT_RANGE_STORAGE_KEY);
    if (saved === "full" || saved === "viewport") {
      screenshotRangeSelect.value = saved;
    }
    screenshotRangeSelect.addEventListener("change", () => {
      localStorage.setItem(SCREENSHOT_RANGE_STORAGE_KEY, screenshotRangeSelect.value);
    });
  }

  screenshotBtn.addEventListener("click", () => {
    void takeDashboardScreenshot();
  });
}

const BLOCK_SCREENSHOT_ICON = `<svg class="block-screenshot-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 5.5h1.2l1-1.5h6.6l1 1.5h1.2a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V7a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

const BLOCK_SCREENSHOT_TARGETS = [
  { selector: "#hero", label: "hero", name: "Connection status", placement: "hero-readout" },
  { selector: "#status-panel", label: "status", name: "Current status", placement: "status-head" },
  { selector: "#ind-ping", label: "ping", name: "Ping", placement: "indicator-head" },
  { selector: "#ind-jitter", label: "jitter", name: "Jitter", placement: "indicator-head" },
  { selector: "#ind-loss", label: "loss", name: "Packet loss", placement: "indicator-head" },
  { selector: "#ind-spikes", label: "spikes", name: "Spike rate", placement: "indicator-head" },
  { selector: ".live-panel", label: "live-feed", name: "Live feed", placement: "title-row" },
  { selector: ".panel--stats", label: "window-stats", name: "Selected window", placement: "title-row" },
  { selector: ".panel--blocks", label: "latency-blocks", name: "Latency blocks", placement: "title-row" },
  { selector: ".panel--latency", label: "latency", name: "Latency", placement: "title-row" },
  { selector: ".panel--jitter", label: "jitter", name: "Jitter", placement: "title-row" },
  { selector: ".panel--loss", label: "loss", name: "Packet loss", placement: "title-row" },
  { selector: ".tables-grid > .panel:first-child", label: "outages", name: "Outages", placement: "title-row" },
  { selector: ".tables-grid > .panel:last-child", label: "recent-samples", name: "Recent samples", placement: "title-row" },
];

const BLOCK_SCREENSHOT_ROOT_SELECTOR = ".panel, .hero, .indicator";

function createBlockScreenshotButton({ label, name }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "block-screenshot-btn";
  button.dataset.screenshotLabel = label;
  button.setAttribute("aria-label", `Screenshot ${name}`);
  button.title = "Screenshot to clipboard";
  button.innerHTML = BLOCK_SCREENSHOT_ICON;
  return button;
}

function ensurePanelTitleRow(titleWrap) {
  if (titleWrap.matches("h2, h3")) {
    const row = document.createElement("div");
    row.className = "panel-title-row";
    titleWrap.replaceWith(row);
    row.appendChild(titleWrap);
    return row;
  }

  let row = titleWrap.querySelector(":scope > .panel-title-row");
  if (row) return row;

  const heading = titleWrap.querySelector(":scope > h2, :scope > h3");
  if (!heading) return titleWrap;

  row = document.createElement("div");
  row.className = "panel-title-row";
  heading.replaceWith(row);
  row.appendChild(heading);
  return row;
}

function mountBlockScreenshotButton(block, button, placement) {
  if (placement === "corner") {
    button.classList.add("block-screenshot-btn--corner");
    block.appendChild(button);
    return;
  }

  if (placement === "hero-readout") {
    const readout = block.querySelector(".hero-readout");
    if (!readout) return;

    const legacyHead = block.querySelector(".hero-head");
    const kicker = legacyHead?.querySelector(".hero-kicker");
    if (kicker && legacyHead) {
      legacyHead.replaceWith(kicker);
    }

    button.classList.add("block-screenshot-btn--corner");
    readout.appendChild(button);
    return;
  }

  if (placement === "status-head") {
    const heading = block.querySelector(".status-head h2");
    if (!heading) return;
    ensurePanelTitleRow(heading.parentElement).appendChild(button);
    return;
  }

  if (placement === "indicator-head") {
    block.querySelector(".indicator-head")?.appendChild(button);
    return;
  }

  const titleRow = block.querySelector(".panel-title-row");
  if (titleRow) {
    titleRow.appendChild(button);
    return;
  }

  const titleWrap = block.querySelector(".panel-head > div:first-child, .panel-head");
  if (titleWrap) {
    ensurePanelTitleRow(titleWrap).appendChild(button);
  }
}

async function takeBlockScreenshot(button) {
  if (button.disabled) return;

  const block = button.closest(BLOCK_SCREENSHOT_ROOT_SELECTOR);
  if (!block) return;

  const label = button.dataset.screenshotLabel || "block";
  const originalTitle = button.title;
  button.disabled = true;
  button.dataset.state = "capturing";
  button.title = "Capturing…";

  try {
    const canvas = await captureElementCanvas(block);
    const dataUrl = canvas.toDataURL("image/png");

    await Promise.all([
      copyCanvasToClipboard(canvas),
      saveScreenshotToServer(dataUrl, label),
    ]);

    button.dataset.state = "copied";
    button.title = "Copied to clipboard!";
  } catch (error) {
    console.error("Block screenshot failed", error);
    button.dataset.state = "failed";
    button.title = "Screenshot failed";
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
      button.removeAttribute("data-state");
      button.title = originalTitle;
    }, 1600);
  }
}

function initBlockScreenshots() {
  for (const target of BLOCK_SCREENSHOT_TARGETS) {
    const block = document.querySelector(target.selector);
    if (!block) continue;

    const existing = block.querySelector(".block-screenshot-btn");
    if (existing) {
      if (target.placement === "hero-readout" && !block.querySelector(".hero-readout")?.contains(existing)) {
        mountBlockScreenshotButton(block, existing, target.placement);
      }
      continue;
    }

    const button = createBlockScreenshotButton(target);
    mountBlockScreenshotButton(block, button, target.placement);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void takeBlockScreenshot(button);
    });
  }
}

/** 应用内软键盘：触摸优先，兼容外接键鼠 */

const LAYOUTS = ["int", "decimal", "ip", "text"];

/** @type {"touch" | "hid"} */
let inputMode = "touch";
/** @type {HTMLInputElement | null} */
let activeInput = null;
/** @type {HTMLElement | null} */
let rootEl = null;
/** @type {string} */
let currentLayout = "int";
let shiftOn = false;
let symbolPage = false;
let suppressBlurHide = false;
let bound = false;

/**
 * @param {HTMLInputElement} input
 * @returns {string | null}
 */
function resolveLayout(input) {
  if (!input || input.disabled || input.readOnly) return null;
  const type = (input.type || "text").toLowerCase();
  if (type !== "number" && type !== "text") return null;

  const explicit = (input.dataset.osk || "").toLowerCase();
  if (LAYOUTS.includes(explicit)) return explicit;

  if (type === "text") return "text";
  const step = input.getAttribute("step");
  if (step && step !== "1" && step !== "any" && String(step).includes(".")) {
    return "decimal";
  }
  if (step === "any") return "decimal";
  return "int";
}

function isOskTarget(el) {
  return !!el?.closest?.("#osk-root");
}

function dispatchInputEvents(input) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * @param {HTMLInputElement} input
 * @param {string} next
 */
function setValue(input, next) {
  const type = (input.type || "").toLowerCase();
  if (type === "number") {
    if (next === "" || next === "-" || next === "." || next === "-.") {
      input.value = next;
    } else {
      const n = Number(next);
      if (!Number.isFinite(n) && next !== "") return;
      input.value = next;
    }
  } else {
    input.value = next;
  }
  dispatchInputEvents(input);
}

function clampOnConfirm(input) {
  if ((input.type || "").toLowerCase() !== "number") return;
  const raw = input.value.trim();
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
    input.value = "";
    dispatchInputEvents(input);
    return;
  }
  let n = Number(raw);
  if (!Number.isFinite(n)) return;
  const minAttr = input.getAttribute("min");
  const maxAttr = input.getAttribute("max");
  if (minAttr !== null && minAttr !== "" && Number.isFinite(Number(minAttr))) {
    n = Math.max(n, Number(minAttr));
  }
  if (maxAttr !== null && maxAttr !== "" && Number.isFinite(Number(maxAttr))) {
    n = Math.min(n, Number(maxAttr));
  }
  const step = input.getAttribute("step");
  if (step && step !== "any" && Number(step) > 0) {
    const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
    n = Number(n.toFixed(decimals));
  }
  input.value = String(n);
  dispatchInputEvents(input);
}

function insertText(input, ch) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const next = input.value.slice(0, start) + ch + input.value.slice(end);
  setValue(input, next);
  const pos = start + ch.length;
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    /* number inputs may not support selection */
  }
}

function backspace(input) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start != null && end != null && start !== end) {
    const next = input.value.slice(0, start) + input.value.slice(end);
    setValue(input, next);
    try {
      input.setSelectionRange(start, start);
    } catch {
      /* ignore */
    }
    return;
  }
  if (start != null && start > 0) {
    const next = input.value.slice(0, start - 1) + input.value.slice(start);
    setValue(input, next);
    try {
      input.setSelectionRange(start - 1, start - 1);
    } catch {
      /* ignore */
    }
    return;
  }
  setValue(input, input.value.slice(0, -1));
}

function clearValue(input) {
  setValue(input, "");
}

function toggleSign(input) {
  const v = input.value;
  if (v.startsWith("-")) setValue(input, v.slice(1));
  else setValue(input, `-${v}`);
}

function renderKeys() {
  if (!rootEl) return;
  const panel = rootEl.querySelector(".osk-panel");
  if (!panel) return;

  let html = "";
  if (currentLayout === "text") {
    html = symbolPage ? renderSymbolKeys() : renderTextKeys();
  } else {
    html = renderNumKeys(currentLayout !== "int");
  }
  panel.innerHTML = html;
}

function keyBtn(label, action, extraClass = "") {
  const cls = ["osk-key", extraClass].filter(Boolean).join(" ");
  return `<button type="button" class="${cls}" data-osk-action="${action}" tabindex="-1">${label}</button>`;
}

function renderNumKeys(withDot) {
  const rows = [
    ["7", "8", "9"],
    ["4", "5", "6"],
    ["1", "2", "3"],
    [withDot ? "." : "±", "0", "⌫"],
  ];
  let html = `<div class="osk-num">`;
  for (const row of rows) {
    html += `<div class="osk-row">`;
    for (const k of row) {
      if (k === "⌫") html += keyBtn("⌫", "backspace", "osk-key--func");
      else if (k === "±") html += keyBtn("±", "sign", "osk-key--func");
      else if (k === ".") html += keyBtn(".", "char:.", "osk-key--func");
      else html += keyBtn(k, `char:${k}`);
    }
    html += `</div>`;
  }
  html += `<div class="osk-row osk-row--actions">`;
  html += keyBtn("C", "clear", "osk-key--func");
  html += keyBtn("确定", "confirm", "osk-key--ok");
  html += `</div></div>`;
  return html;
}

function renderTextKeys() {
  const rows = shiftOn
    ? ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]
    : ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  let html = `<div class="osk-text">`;
  for (let i = 0; i < rows.length; i++) {
    html += `<div class="osk-row">`;
    if (i === 2) html += keyBtn("⇧", "shift", `osk-key--func${shiftOn ? " is-active" : ""}`);
    for (const ch of rows[i]) {
      html += keyBtn(ch, `char:${ch}`);
    }
    if (i === 2) html += keyBtn("⌫", "backspace", "osk-key--func");
    html += `</div>`;
  }
  html += `<div class="osk-row">`;
  html += keyBtn("123", "symbols", "osk-key--func osk-key--wide");
  html += keyBtn("空格", "char: ", "osk-key--space");
  html += keyBtn("确定", "confirm", "osk-key--ok");
  html += `</div></div>`;
  return html;
}

function renderSymbolKeys() {
  const rows = ["1234567890", "-_./:\\", "@#$%&*+=,"];
  let html = `<div class="osk-text">`;
  for (let i = 0; i < rows.length; i++) {
    html += `<div class="osk-row">`;
    for (const ch of rows[i]) {
      html += keyBtn(ch === "\\" ? "\\" : ch, `char:${ch}`);
    }
    if (i === 2) html += keyBtn("⌫", "backspace", "osk-key--func");
    html += `</div>`;
  }
  html += `<div class="osk-row">`;
  html += keyBtn("ABC", "symbols", "osk-key--func osk-key--wide");
  html += keyBtn("空格", "char: ", "osk-key--space");
  html += keyBtn("确定", "confirm", "osk-key--ok");
  html += `</div></div>`;
  return html;
}

function ensureRoot() {
  if (rootEl) return rootEl;
  rootEl = document.querySelector("#osk-root");
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "osk-root";
    document.body.appendChild(rootEl);
  }
  rootEl.innerHTML = `
    <div class="osk-backdrop" data-osk-action="dismiss" aria-hidden="true"></div>
    <div class="osk-shell" role="group" aria-label="屏幕键盘">
      <div class="osk-panel"></div>
    </div>
  `;
  rootEl.hidden = true;
  rootEl.classList.remove("is-open");

  rootEl.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest?.("[data-osk-action]");
    if (!btn) return;
    e.preventDefault();
    suppressBlurHide = true;
    handleAction(btn.getAttribute("data-osk-action") || "");
    queueMicrotask(() => {
      suppressBlurHide = false;
      activeInput?.focus({ preventScroll: true });
    });
  });

  return rootEl;
}

function handleAction(action) {
  if (!activeInput) {
    if (action === "dismiss") hideOsk();
    return;
  }
  if (action === "dismiss") {
    hideOsk();
    return;
  }
  if (action === "confirm") {
    clampOnConfirm(activeInput);
    hideOsk();
    activeInput.blur();
    return;
  }
  if (action === "backspace") {
    backspace(activeInput);
    return;
  }
  if (action === "clear") {
    clearValue(activeInput);
    return;
  }
  if (action === "sign") {
    toggleSign(activeInput);
    return;
  }
  if (action === "shift") {
    shiftOn = !shiftOn;
    renderKeys();
    return;
  }
  if (action === "symbols") {
    symbolPage = !symbolPage;
    renderKeys();
    return;
  }
  if (action.startsWith("char:")) {
    const ch = action.slice(5);
    insertText(activeInput, ch);
    if (shiftOn && currentLayout === "text" && !symbolPage) {
      shiftOn = false;
      renderKeys();
    }
  }
}

function positionNearInput(input) {
  if (!rootEl || !input) return;
  const shell = rootEl.querySelector(".osk-shell");
  if (!shell) return;
  // 底部固定；滚动字段进入可见区，避免被键盘遮挡
  try {
    input.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  } catch {
    input.scrollIntoView(true);
  }
  document.documentElement.style.setProperty("--osk-height", `${shell.offsetHeight || 280}px`);
}

function showFor(input) {
  const layout = resolveLayout(input);
  if (!layout) return;
  ensureRoot();
  activeInput = input;
  currentLayout = layout;
  shiftOn = false;
  symbolPage = false;
  input.setAttribute("inputmode", "none");
  input.setAttribute("autocomplete", "off");
  renderKeys();
  rootEl.hidden = false;
  rootEl.classList.add("is-open");
  rootEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("osk-open");
  requestAnimationFrame(() => positionNearInput(input));
}

export function hideOsk() {
  if (!rootEl) return;
  rootEl.classList.remove("is-open");
  rootEl.hidden = true;
  rootEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("osk-open");
  activeInput = null;
}

/**
 * 标注字段 inputmode，便于系统不抢焦点。
 * @param {ParentNode} [root]
 */
export function prepareOskFields(root = document) {
  root.querySelectorAll?.('input[type="number"], input[type="text"]')?.forEach((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    if (el.disabled || el.readOnly) return;
    if (!resolveLayout(el)) return;
    el.setAttribute("inputmode", "none");
  });
}

function onFocusIn(e) {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (isOskTarget(t)) return;
  if (inputMode !== "touch") return;
  if (!resolveLayout(t)) return;
  showFor(t);
}

function onFocusOut(e) {
  if (suppressBlurHide) return;
  const related = e.relatedTarget;
  if (isOskTarget(related)) return;
  // 延迟：允许 OSK 按键的 pointerdown 先设置 suppressBlurHide
  setTimeout(() => {
    if (suppressBlurHide) return;
    if (isOskTarget(document.activeElement)) return;
    if (document.activeElement === activeInput) return;
    hideOsk();
  }, 0);
}

function onPointerDown(e) {
  if (isOskTarget(e.target)) return;
  // 触摸/手写笔：回到触摸优先（弹出软键盘）；鼠标不切 hid，以便无物理键盘时仍可用 OSK
  if (e.pointerType === "touch" || e.pointerType === "pen") {
    inputMode = "touch";
  }
}

function onKeyDown(e) {
  if (!e.isTrusted) return;
  if (isOskTarget(e.target)) return;
  // Esc：关闭软键盘
  if (e.key === "Escape" && rootEl?.classList.contains("is-open")) {
    e.preventDefault();
    e.stopPropagation();
    hideOsk();
    return;
  }
  // 物理键入 → 键鼠模式
  const typing =
    e.key.length === 1 ||
    e.key === "Backspace" ||
    e.key === "Delete" ||
    e.key === "Enter" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight" ||
    e.key === "Tab";
  if (!typing) return;
  if (e.altKey || e.metaKey) return;
  inputMode = "hid";
  if (rootEl?.classList.contains("is-open")) hideOsk();
}

export function initOsk() {
  if (bound) return;
  bound = true;
  ensureRoot();
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  prepareOskFields(document);
  // 动态插入的向导字段
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        prepareOskFields(/** @type {ParentNode} */ (node));
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

export function getOskInputMode() {
  return inputMode;
}

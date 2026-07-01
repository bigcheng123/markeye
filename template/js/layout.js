/** 布局、弹窗、Toast */

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function syncFullscreenButton() {
  const btn = document.querySelector("#btn-fullscreen");
  if (!btn) return;
  const active = !!document.fullscreenElement;
  btn.textContent = active ? "退出全屏" : "全屏";
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  btn.title = active ? "退出全屏" : "全屏显示";
}

export function initLayout() {
  const app = document.querySelector("#app");
  if (!app) return;

  const applyScale = () => {
    const minW = 1280;
    const vw = window.innerWidth;
    if (vw < minW) {
      const scale = vw / minW;
      app.style.transform = `scale(${scale})`;
      app.style.transformOrigin = "top left";
      app.style.width = `${minW}px`;
      app.style.height = `${window.innerHeight / scale}px`;
    } else {
      app.style.transform = "";
      app.style.width = "";
      app.style.height = "";
    }
  };

  window.addEventListener("resize", applyScale);
  applyScale();

  document.querySelector("#btn-fullscreen")?.addEventListener("click", () => {
    toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  syncFullscreenButton();

  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      toggleFullscreen();
    }
  });
}

export function showConnectionBanner(visible, message) {
  const banner = document.querySelector("#connection-banner");
  if (!banner) return;
  banner.textContent = message || "连接已断开";
  banner.classList.toggle("is-visible", visible);
}

export function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#modal-overlay");
    const msgEl = overlay?.querySelector("#modal-message");
    const btnOk = overlay?.querySelector("#modal-ok");
    const btnCancel = overlay?.querySelector("#modal-cancel");
    if (!overlay || !msgEl) {
      resolve(window.confirm(message));
      return;
    }

    msgEl.textContent = message;
    overlay.classList.add("is-open");

    const cleanup = (result) => {
      overlay.classList.remove("is-open");
      btnOk?.removeEventListener("click", onOk);
      btnCancel?.removeEventListener("click", onCancel);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    btnOk?.addEventListener("click", onOk);
    btnCancel?.addEventListener("click", onCancel);
  });
}

export function promptModal(title, { defaultValue = "", hint = "", label = "配方文件名" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#prompt-overlay");
    const titleEl = overlay?.querySelector("#prompt-title");
    const hintEl = overlay?.querySelector("#prompt-hint");
    const labelEl = overlay?.querySelector("label[for='prompt-input']");
    const input = overlay?.querySelector("#prompt-input");
    const btnOk = overlay?.querySelector("#prompt-ok");
    const btnCancel = overlay?.querySelector("#prompt-cancel");
    if (!overlay || !input) {
      const v = window.prompt(title, defaultValue);
      resolve(v === null ? null : v.trim());
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (hintEl) {
      hintEl.textContent = hint;
      hintEl.hidden = !hint;
    }
    if (labelEl) labelEl.textContent = label;
    input.value = defaultValue;
    overlay.classList.add("is-open");
    input.focus();
    input.select();

    const cleanup = (result) => {
      overlay.classList.remove("is-open");
      btnOk?.removeEventListener("click", onOk);
      btnCancel?.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onOk = () => {
      const v = input.value.trim();
      cleanup(v || null);
    };
    const onCancel = () => cleanup(null);
    const onKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    btnOk?.addEventListener("click", onOk);
    btnCancel?.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKey);
  });
}

export function infoModal(title, message) {
  return infoModalContent(title, message, { html: false });
}

export function infoModalHtml(title, html) {
  return infoModalContent(title, html, { html: true });
}

function infoModalContent(title, content, { html = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#info-overlay");
    const titleEl = overlay?.querySelector("#info-title");
    const msgEl = overlay?.querySelector("#info-message");
    const btnClose = overlay?.querySelector("#info-close");
    if (!overlay || !msgEl) {
      alert(html ? title : content);
      resolve();
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (html) {
      msgEl.innerHTML = content;
      msgEl.classList.add("modal__message--html");
    } else {
      msgEl.textContent = content;
      msgEl.classList.remove("modal__message--html");
    }
    overlay.classList.add("is-open");

    const onClose = () => {
      overlay.classList.remove("is-open");
      btnClose?.removeEventListener("click", onClose);
      if (html) {
        msgEl.innerHTML = "";
        msgEl.classList.remove("modal__message--html");
      }
      resolve();
    };
    btnClose?.addEventListener("click", onClose);
  });
}

export function showMenuPopup(anchorEl, items) {
  return new Promise((resolve) => {
    document.querySelectorAll(".menu-popup").forEach((el) => el.remove());

    const popup = document.createElement("div");
    popup.className = "menu-popup";
    popup.setAttribute("role", "menu");

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-popup__item";
      btn.textContent = item.label;
      btn.dataset.action = item.action;
      if (item.title) btn.title = item.title;
      if (item.checked) btn.classList.add("is-checked");
      if (item.disabled) btn.disabled = true;
      if (item.separator) {
        btn.classList.add("menu-popup__item--separator");
        btn.disabled = true;
      }
      popup.appendChild(btn);
    }

    document.body.appendChild(popup);
    const rect = anchorEl.getBoundingClientRect();
    popup.style.top = `${rect.bottom}px`;
    popup.style.left = `${rect.left}px`;

    const cleanup = (action) => {
      popup.remove();
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
      resolve(action);
    };

    popup.addEventListener("click", (e) => {
      const item = e.target.closest(".menu-popup__item");
      if (item && !item.disabled && item.dataset.action) {
        cleanup(item.dataset.action);
      }
    });

    const onDocClick = (e) => {
      if (!popup.contains(e.target) && e.target !== anchorEl) cleanup(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(null);
    };

    setTimeout(() => {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey);
    }, 0);
  });
}

export function showToast(message, type = "ok") {
  const container = document.querySelector("#toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

export function setAppView(view) {
  const app = document.querySelector("#app");
  if (!app) return;
  app.classList.remove("view-run", "view-set", "view-wizard");
  app.classList.add(`view-${view}`);
}

export function updateModeTabIcons(mode) {
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    const isRun = tab.dataset.mode === "run";
    const active = isRun
      ? mode === "run"
      : mode === "set" || mode === "wizard" || mode === "settings";
    const img = tab.querySelector(".mode-icon");
    if (!img) return;
    if (isRun) {
      img.src = active
        ? "../icon/mode/run-active.svg"
        : "../icon/mode/run-inactive.svg";
    } else {
      img.src = active
        ? "../icon/mode/settings-active.svg"
        : "../icon/mode/settings-inactive.svg";
    }
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

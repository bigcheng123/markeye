/** 布局、弹窗、Toast */

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

  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
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

export function infoModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.querySelector("#info-overlay");
    const titleEl = overlay?.querySelector("#info-title");
    const msgEl = overlay?.querySelector("#info-message");
    const btnClose = overlay?.querySelector("#info-close");
    if (!overlay || !msgEl) {
      alert(message);
      resolve();
      return;
    }

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    overlay.classList.add("is-open");

    const onClose = () => {
      overlay.classList.remove("is-open");
      btnClose?.removeEventListener("click", onClose);
      resolve();
    };
    btnClose?.addEventListener("click", onClose);
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
    const active =
      (mode === "run" && isRun) ||
      ((mode === "set" || mode === "wizard") && !isRun);
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

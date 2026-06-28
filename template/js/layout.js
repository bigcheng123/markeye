/** 布局适配：缩放、全屏 */

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
  banner.textContent = message || "连接已断开，正在重连…";
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

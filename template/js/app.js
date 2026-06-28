/** MarkEye Web UI 入口 */

import { ApiClient } from "./api-client.js";
import { ImageViewer } from "./image-viewer.js";
import { ToolPanel } from "./tool-panel.js";
import { StatusBar } from "./status-bar.js";
import { ConfigEditor } from "./config-editor.js";
import { initLayout, showConnectionBanner, confirmModal } from "./layout.js";
import { addMockCalibration, resetMockStats } from "./mock-data.js";

const ICON = "../icon";

class MarkEyeApp {
  constructor() {
    this.mode = "run";
    this.api = null;

    this.statusBar = new StatusBar();
    this.toolPanel = new ToolPanel();
    this.imageViewer = new ImageViewer(
      document.querySelector("#image-viewport-wrap"),
    );
    this.configEditor = new ConfigEditor(
      document.querySelector("#settings-panel"),
    );

    this._bindModeTabs();
    this._bindActions();
    this._bindKeyboard();
    initLayout();
  }

  start() {
    const useMock = new URLSearchParams(location.search).get("mock") !== "0";
    this.api = new ApiClient(
      {
        onFrame: (data) => this._onFrame(data),
        onConnectionChange: (connected) => {
          showConnectionBanner(!connected && !useMock);
        },
      },
      { mock: useMock },
    );
    this.api.start();
    requestAnimationFrame(() => this.imageViewer.fitToScreen());
  }

  _onFrame(data) {
    if (this.mode !== "run") return;
    this.statusBar.update(data);
    this.imageViewer.updateFrame(data);
    this.toolPanel.update(data);
  }

  _setMode(mode) {
    this.mode = mode;
    const main = document.querySelector("#region-main");
    main?.classList.toggle("is-settings", mode === "settings");

    document.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.mode === mode);
    });

    if (mode === "settings") {
      this.api?.stop();
    } else {
      this.api?.start();
    }
  }

  _bindModeTabs() {
    document.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        this._setMode(tab.dataset.mode);
      });
    });

    this.configEditor.onSave = () => {
      console.info("Config saved (mock):", this.configEditor.getConfig());
      this._setMode("run");
    };
    this.configEditor.onCancel = () => this._setMode("run");
  }

  _bindActions() {
    document.querySelector("#btn-learn-add")?.addEventListener("click", async () => {
      addMockCalibration();
      await this.api?.post("/api/calibration/add");
    });

    document.querySelector("#btn-threshold")?.addEventListener("click", () => {
      this._setMode("settings");
    });

    document.querySelector("#btn-reset")?.addEventListener("click", async () => {
      const ok = await confirmModal("确定要复位 OK/NG 统计计数吗？");
      if (!ok) return;
      resetMockStats();
      this.toolPanel.history = { color: [], size: [], position: [] };
      await this.api?.post("/api/stats/reset");
    });

    document.querySelector("#btn-switch")?.addEventListener("click", async () => {
      await this.api?.post("/api/camera/switch");
      alert("切换相机（Mock 模式，尚未连接后端）");
    });

    document.querySelector("#btn-disconnect")?.addEventListener("click", async () => {
      const ok = await confirmModal("确定要断开相机连接吗？");
      if (!ok) return;
      this.api?.stop();
      this.statusBar.setIdle();
    });

    document.querySelector("#btn-details")?.addEventListener("click", () => {
      const sel = document.querySelector("#config-profile");
      alert(`当前方案: ${sel?.value}\n检测项: 颜色 / 大小 / 位置\n（静态骨架 — 详情待后端接入）`);
    });
  }

  _bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.mode === "settings") {
        this._setMode("run");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new MarkEyeApp();
  app.start();
});

/** 导出图标根路径供 HTML 引用 */
export { ICON };

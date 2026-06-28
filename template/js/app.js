/** MarkEye Web UI 入口（纯前端 Mock，无 Python 后端） */

import { ApiClient } from "./api-client.js";
import { ImageViewer } from "./image-viewer.js";
import { ToolPanel } from "./tool-panel.js";
import { StatusBar } from "./status-bar.js";
import { SetMenu } from "./set-menu.js";
import { Wizard } from "./wizard.js";
import {
  initLayout,
  showConnectionBanner,
  confirmModal,
  infoModal,
  showToast,
  setAppView,
  updateModeTabIcons,
} from "./layout.js";
import { addMockCalibration, resetMockStats, registerMaster, createIdleFrame } from "./mock-data.js";
import { runUiDemo } from "./ui-demo.js";

class MarkEyeApp {
  constructor() {
    this.view = "run";
    this.api = null;

    this.statusBar = new StatusBar();
    this.toolPanel = new ToolPanel();
    this.imageViewer = new ImageViewer(document.querySelector("#image-viewport-wrap"));
    this.setMenu = new SetMenu({ onEnterWizard: () => this._enterWizard() });
    this.wizard = new Wizard({
      onExit: () => this._exitWizard(),
      onComplete: () => this._completeWizard(),
    });

    this._bindModeTabs();
    this._bindGlobalActions();
    this._bindRunActions();
    this._bindKeyboard();
    initLayout();
  }

  start() {
    showConnectionBanner(false);
    this.api = new ApiClient({
      onFrame: (data) => this._onFrame(data),
      onConnectionChange: (connected) => {
        if (!connected && this.view === "run") {
          this.statusBar.setIdle();
          this.imageViewer.setWaiting(true);
        }
      },
    });
    this.api.start();
    this._setView("run");
    requestAnimationFrame(() => this.imageViewer.fitToScreen());

    const params = new URLSearchParams(location.search);
    if (params.get("autodemo") === "1") {
      setTimeout(() => runUiDemo(this), 600);
    }
  }

  _onFrame(data) {
    if (this.view !== "run") return;
    this.statusBar.update(data);
    this.imageViewer.updateFrame(data);
    this.toolPanel.update(data);
  }

  _setView(view) {
    this.view = view;
    setAppView(view === "wizard" ? "wizard" : view === "set" ? "set" : "run");
    updateModeTabIcons(view === "run" ? "run" : "settings");

    if (view === "run") {
      this.wizard.hide();
      this.statusBar.setWaiting();
      this.api?.reconnect?.() || this.api?.start();
      this._onFrame(createIdleFrame());
    } else if (view === "set") {
      this.wizard.hide();
      this.api?.stop();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
    } else if (view === "wizard") {
      this.wizard.show();
      this.statusBar.setWizardLive();
      this.imageViewer.updateFrame(createIdleFrame());
    }
  }

  _enterWizard() {
    this.wizard.goToStep(1);
    this._setView("wizard");
    showToast("进入传感器设定向导", "ok");
  }

  _exitWizard() {
    this._setView("set");
    showToast("已退出向导", "warn");
  }

  async _completeWizard() {
    registerMaster();
    await infoModal("完成", "传感器设定已完成（Mock）。配置已保存到本地状态。");
    this._setView("set");
    showToast("向导完成", "ok");
  }

  _bindModeTabs() {
    document.querySelectorAll(".mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.dataset.mode === "run") this._setView("run");
        else this._setView("set");
      });
    });
  }

  _bindGlobalActions() {
    const menuActions = {
      "menu-file": "文件：打开图片 / 导出结果 / 退出（Mock）",
      "menu-view": "显示：叠加层 / 调试图层切换（Mock）",
      "menu-sensor": "传感器：相机选择 / 曝光增益（Mock）",
      "menu-image": "图像：截图 / 保存当前帧（Mock）",
      "menu-settings": "设定：切换至设定模式",
      "menu-window": "窗口：全屏 / 置顶（Mock）",
      "menu-help": "MarkEye Web UI v1.1 — 纯前端 Mock 模式",
    };

    document.querySelectorAll(".menu-item[data-action]").forEach((el) => {
      el.addEventListener("click", () => {
        const action = el.dataset.action;
        if (action === "menu-settings") {
          this._setView("set");
          return;
        }
        showToast(menuActions[action] || action, "ok");
      });
    });

    document.querySelector("#btn-sensor-switch")?.addEventListener("click", async () => {
      await this.api?.post("/api/camera/switch");
      showToast("已切换连接的传感器（Mock）", "ok");
    });

    document.querySelector("#btn-sensor-disconnect")?.addEventListener("click", async () => {
      const ok = await confirmModal("确定要断开传感器连接吗？");
      if (!ok) return;
      this.api?.stop();
      this.statusBar.setIdle();
      showToast("传感器已断开", "warn");
    });

    document.querySelector("#btn-connect-monitor")?.addEventListener("click", () => {
      showToast("连接监控器（Phase 2 Mock）", "ok");
    });

    document.querySelector("#btn-details")?.addEventListener("click", () => {
      const sel = document.querySelector("#config-profile");
      infoModal("程序详细", `当前方案: ${sel?.selectedOptions[0]?.text}\n检测项: 学习 / 彩色识别\n模式: 纯前端 Mock`);
    });

    document.querySelector("#btn-image-history")?.addEventListener("click", () => {
      showToast("运行/学习 图像历史（Phase 2 Mock）", "ok");
    });

    document.querySelector("#btn-io-settings")?.addEventListener("click", () => {
      showToast("I/O 输入输出设定（Phase 2 Mock）", "ok");
    });

    document.querySelector("#btn-extended")?.addEventListener("click", () => {
      showToast("扩展设定（Phase 2 Mock）", "ok");
    });

    document.querySelector("#config-profile")?.addEventListener("change", (e) => {
      showToast(`已切换程序: ${e.target.selectedOptions[0]?.text}`, "ok");
    });
  }

  _bindRunActions() {
    document.querySelector("#btn-learn-add")?.addEventListener("click", async () => {
      addMockCalibration();
      await this.api?.post("/api/calibration/add");
      this._onFrame(createIdleFrame());
      showToast("已追加学习该图像", "ok");
    });

    document.querySelector("#btn-threshold")?.addEventListener("click", () => {
      this.toolPanel.focusThreshold();
      showToast("调节阈值：请在下方滑块调整", "ok");
    });

    document.querySelector("#btn-trigger")?.addEventListener("click", () => {
      this._doTrigger();
    });

    document.querySelector("#btn-save-frame")?.addEventListener("click", () => {
      showToast("当前帧已保存（Mock）", "ok");
    });

    document.querySelector("#btn-reset")?.addEventListener("click", async () => {
      const ok = await confirmModal("确定要复位 OK/NG 统计计数吗？");
      if (!ok) return;
      resetMockStats();
      this.toolPanel.history = { learn: [], color: [] };
      await this.api?.post("/api/stats/reset");
      this._onFrame(createIdleFrame());
      showToast("统计已复位", "ok");
    });

    document.querySelector("#btn-switch")?.addEventListener("click", async () => {
      await this.api?.post("/api/camera/switch");
      showToast("已切换输入源（Mock）", "ok");
    });

    this._bindWizardDelegatedActions();
  }

  _bindWizardDelegatedActions() {
    document.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action || this.view !== "wizard") return;

      const handlers = {
        "ai-shoot": () => showToast("AI拍摄处理完成（Mock）", "ok"),
        "register-history": () => {
          registerMaster();
          showToast("已从图像历史注册主控（Mock）", "ok");
        },
        "register-file": () => {
          registerMaster();
          showToast("已从文件注册主控（Mock）", "ok");
        },
        "tool-add": () => showToast("追加工具（Mock）", "ok"),
        "tool-edit": () => showToast("编辑工具（Mock）", "ok"),
        "tool-copy": () => showToast("复制工具（Mock）", "ok"),
        "tool-delete": () => showToast("删除工具（Mock）", "warn"),
        logic: () => showToast(`打开逻辑 ${e.target.dataset.n} 编辑器（Mock）`, "ok"),
      };

      if (handlers[action]) handlers[action]();
    });
  }

  async _doTrigger() {
    if (!this.api?._connected) {
      showToast("请先连接传感器", "err");
      return;
    }
    const frame = await this.api.trigger();
    if (frame) {
      this._onFrame(frame);
      showToast(`触发完成 — ${frame.overall.passed ? "OK" : "NG"}`, frame.overall.passed ? "ok" : "err");
    }
  }

  _bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.key === " " && this.view === "run") {
        e.preventDefault();
        this._doTrigger();
      }
      if (e.key === "Escape") {
        if (this.view === "wizard") this._exitWizard();
        else if (this.view === "set") this._setView("run");
      }
    });
  }

  /** 供 ui-demo 调用 */
  clickMode(mode) {
    document.querySelector(`.mode-tab[data-mode="${mode}"]`)?.click();
  }

  clickEl(selector) {
    document.querySelector(selector)?.click();
  }

  getView() {
    return this.view;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.__markeyeApp = new MarkEyeApp();
  window.__markeyeApp.start();
});

/** MarkEye Web UI 入口 */

import { ApiClient, isMockMode } from "./api-client.js";
import { ImageViewer } from "./image-viewer.js";
import { ToolPanel } from "./tool-panel.js";
import { StatusBar } from "./status-bar.js";
import { SetMenu } from "./set-menu.js";
import { Wizard } from "./wizard.js";
import { playNgAlert } from "./ng-alert.js";
import {
  initLayout,
  showConnectionBanner,
  confirmModal,
  infoModal,
  showToast,
  setAppView,
  updateModeTabIcons,
} from "./layout.js";
import {
  addMockCalibration,
  resetMockStats,
  registerMaster,
  createIdleFrame,
  createMasterFramePayload,
  captureMockMasterFromLive,
} from "./mock-data.js";
import { runUiDemo } from "./ui-demo.js";

class MarkEyeApp {
  constructor() {
    this.view = "run";
    this.previewMode = "off";
    this.hasMasterRegistered = false;
    this.masterFrame = null;
    this.livePreviewStarted = false;
    this._ignoreIdleUntil = 0;
    this.api = null;

    this.statusBar = new StatusBar();
    this.toolPanel = new ToolPanel();
    this.imageViewer = new ImageViewer(document.querySelector("#image-viewport-wrap"));
    this.setMenu = new SetMenu({ onEnterWizard: () => this._enterWizard() });
    this.wizard = new Wizard({
      onExit: () => this._exitWizard(),
      onComplete: () => this._completeWizard(),
      onStepChange: (step) => this._onWizardStepChange(step),
      hasMaster: () => this.hasMasterRegistered,
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
        showConnectionBanner(!connected && !isMockMode());
        if (!connected && this.view === "run") {
          this.statusBar.setIdle();
          this.imageViewer.setWaiting(true);
        } else if (connected && this.view === "run" && !isMockMode()) {
          this.api?.pullCurrentFrame?.();
        }
      },
    });
    this._loadProfiles();
    this._setView("run");
    requestAnimationFrame(() => {
      this.imageViewer.fitToScreen();
      requestAnimationFrame(() => this.imageViewer.fitToScreen());
    });

    const params = new URLSearchParams(location.search);
    if (params.get("autodemo") === "1") {
      setTimeout(() => runUiDemo(this), 600);
    }
  }

  _onFrame(data) {
    const isTriggerResult = !data.idle && data.overall?.passed != null;
    if (isTriggerResult) {
      this.imageViewer.updateVerdict(data);
    }

    if (this.view === "wizard") {
      if (this.previewMode === "master") {
        if (!data.idle) {
          if (data.overall?.passed === false) playNgAlert();
          this.statusBar.update(data);
          this.imageViewer.updateFrame(data);
        }
        return;
      }
      if (this.previewMode !== "live") return;
      this.statusBar.update(data);
      this.imageViewer.updateFrame(data);
      return;
    }
    if (this.view !== "run") return;

    if (data.idle && performance.now() < this._ignoreIdleUntil) return;

    if (data.overall?.passed === false && !data.idle) {
      playNgAlert();
    }
    this.statusBar.update(data);
    this.imageViewer.updateFrame(data);
    this.toolPanel.update(data);
  }

  async _loadProfiles() {
    const sel = document.querySelector("#config-profile");
    if (!sel) return;
    try {
      const res = await this.api.get("/api/config/list");
      const profiles = res.profiles || [];
      sel.innerHTML = "";
      for (const p of profiles) {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = `${p.id}: ${p.name}`;
        if (p.active) opt.selected = true;
        sel.appendChild(opt);
      }
    } catch {
      /* 保持 HTML 默认项 */
    }
  }

  _setView(view) {
    this.view = view;
    setAppView(view === "wizard" ? "wizard" : view === "set" ? "set" : "run");
    updateModeTabIcons(view === "run" ? "run" : "settings");

    if (view === "run") {
      this.wizard.hide();
      this._stopWizardPreview();
      this.statusBar.setWaiting();
      if (!this.api?._connected) {
        this.api?.start();
      }
      if (!isMockMode()) {
        this.api?.pullCurrentFrame?.();
      }
      if (isMockMode()) {
        this._onFrame(createIdleFrame());
      }
    } else if (view === "set") {
      this.wizard.hide();
      this._stopWizardPreview();
      this.api?.stop();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
    } else if (view === "wizard") {
      this.wizard.show();
      this.previewMode = "off";
      this.livePreviewStarted = false;
      this.imageViewer.disableRoiEditor?.();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
    }
  }

  _stopWizardPreview() {
    this.previewMode = "off";
    this.livePreviewStarted = false;
    this.api?.stopLivePreview?.();
    this.imageViewer.disableRoiEditor?.();
  }

  _enterWizard() {
    this.hasMasterRegistered = false;
    this.masterFrame = null;
    this.wizard.reloadForProfile(1);
    this._setView("wizard");
    showToast("进入传感器设定向导", "ok");
  }

  _exitWizard() {
    this._stopWizardPreview();
    this._setView("set");
    showToast("已退出向导", "warn");
  }

  async _onWizardStepChange(step) {
    if (step <= 2) {
      if (this.livePreviewStarted) {
        this.previewMode = "live";
        this.statusBar.setWizardLive();
      } else {
        this.previewMode = "off";
        this.statusBar.setWaiting();
        this.imageViewer.updateFrame(createIdleFrame());
      }
      this.imageViewer.disableRoiEditor?.();
      return;
    }

    if (step >= 3) {
      this.api?.stopLivePreview?.();
      this.previewMode = "master";
      await this._showMasterPreview();
      this.wizard.enableStep3Roi?.();
    }
  }

  async _showMasterPreview() {
    if (this.masterFrame) {
      this.imageViewer.updateFrame(this._buildMasterPayload(this.masterFrame));
      this.statusBar.setWaiting();
      return;
    }
    try {
      const img = await this.api.get("/api/calibration/master/image");
      this.cacheMasterFrame(img);
      this.imageViewer.updateFrame(this._buildMasterPayload(img));
      this.statusBar.setWaiting();
    } catch {
      showToast("无法加载主控图像", "err");
      this.imageViewer.updateFrame(createIdleFrame());
    }
  }

  cacheMasterFrame(img) {
    this.masterFrame = img;
    this.hasMasterRegistered = true;
  }

  _buildMasterPayload(img) {
    if (isMockMode()) {
      return createMasterFramePayload(img);
    }
    return {
      type: "frame",
      timestamp: new Date().toISOString(),
      idle: true,
      overall: { passed: null },
      frame: {
        width: img.width,
        height: img.height,
        process_ms: null,
        image_base64: img.image_base64,
      },
      marks: [],
      inspections: [],
      stats: {},
      calibration: {},
      trigger: { source: "external", label: "外部触发" },
    };
  }

  async startLivePreview() {
    if (isMockMode()) {
      this.api.reconnect();
      this.api.startLivePreview();
    } else {
      this.api.reconnect();
    }
    this.livePreviewStarted = true;
    this.previewMode = "live";
    this.statusBar.setWizardLive();
    this.imageViewer.setWaiting(false, { livePreview: true });
    showToast("Live 预览已启动", "ok");
  }

  async registerLiveMaster() {
    if (!this.livePreviewStarted && !isMockMode()) {
      showToast("请先点击 AI拍摄 启动 Live 预览", "err");
      return;
    }
    try {
      if (isMockMode()) {
        const img = captureMockMasterFromLive();
        registerMaster();
        this.cacheMasterFrame(img);
      } else {
        await this.api.post("/api/calibration/master");
        const img = await this.api.get("/api/calibration/master/image");
        this.cacheMasterFrame(img);
      }
      this.api?.stopLivePreview?.();
      this.previewMode = "master";
      this.imageViewer.updateFrame(this._buildMasterPayload(this.masterFrame));
      this.statusBar.setWaiting();
      showToast("已注册 Live 图像为主控", "ok");
    } catch {
      showToast("注册主控图像失败", "err");
    }
  }

  async _completeWizard() {
    const sel = document.querySelector("#config-profile");
    const profileLabel = sel?.selectedOptions[0]?.text || "当前程序";
    if (isMockMode()) {
      registerMaster();
    }
    await infoModal("完成", `传感器设定已完成，配置已保存至「${profileLabel}」。`);
    this._stopWizardPreview();
    this._setView("set");
    showToast("向导完成", "ok");
  }

  _getActiveProfileName() {
    return document.querySelector("#config-profile")?.value || "config.yaml";
  }

  async _switchProfile(name) {
    const prev = this._getActiveProfileName();
    if (name === prev) return;

    await this.api.post("/api/config/switch", { name });

    if (this.view === "wizard") {
      const step = this.wizard.step;
      this.hasMasterRegistered = false;
      this.masterFrame = null;
      this.wizard.reloadForProfile(step);
      await this._onWizardStepChange(step);
    } else if (this.view === "run" && isMockMode()) {
      this._onFrame(createIdleFrame());
    }
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
      "menu-help": isMockMode()
        ? "MarkEye Web UI — Mock 模式 (?mock=1)"
        : "MarkEye Web UI — 已连接后端",
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

    document.querySelector("#config-profile")?.addEventListener("change", async (e) => {
      const name = e.target.value;
      const label = e.target.selectedOptions[0]?.text;
      try {
        await this._switchProfile(name);
        showToast(`已切换程序: ${label}`, "ok");
      } catch {
        showToast("切换程序失败", "err");
        await this._loadProfiles();
      }
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
      if (isMockMode()) {
        resetMockStats();
        this.toolPanel.history = { learn: [], color: [], size: [], position: [] };
      }
      await this.api?.post("/api/stats/reset");
      if (isMockMode()) this._onFrame(createIdleFrame());
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
        "ai-shoot": () => this.startLivePreview(),
        "register-live": () => this.registerLiveMaster(),
        "register-file": async () => {
          if (isMockMode()) {
            registerMaster();
            const { captureMockMasterFromLive: cap } = await import("./mock-data.js");
            this.cacheMasterFrame(cap());
            showToast("已从文件注册主控（Mock）", "ok");
          } else {
            showToast("文件注册（Phase 2）", "ok");
          }
        },
        logic: () => showToast(`打开逻辑 ${e.target.dataset.n} 编辑器（Mock）`, "ok"),
      };

      if (handlers[action]) await handlers[action]();
    });
  }

  async _doTrigger() {
    if (!this.api?._connected) {
      showToast("请先连接传感器", "err");
      return;
    }
    this._ignoreIdleUntil = performance.now() + 700;
    const frame = await this.api.trigger();
    if (frame) {
      // post() 已调用 onFrame；此处仅补 toast（避免重复处理）
      if (!frame.idle && frame.overall?.passed != null) {
        showToast(`触发完成 — ${frame.overall.passed ? "OK" : "NG"}`, frame.overall.passed ? "ok" : "err");
      }
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

function bootMarkEyeApp() {
  if (window.__markeyeApp) return;
  try {
    window.__markeyeApp = new MarkEyeApp();
    window.__markeyeApp.start();
  } catch (err) {
    console.error("MarkEye 启动失败:", err);
    showConnectionBanner(true);
    showToast(`界面启动失败: ${err?.message || err}`, "err");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootMarkEyeApp);
} else {
  bootMarkEyeApp();
}

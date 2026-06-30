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
    this._mockCameras = [0, 1, 2];
    this._mockCameraId = 0;
    this._lastCameraList = [0, 1, 2];
    this._toolPreview = { active: false, tool: null };

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
    this._bindCameraSelect();
    this._bindKeyboard();
    this._bindToolPreview();
    initLayout();
  }

  _deviceIdToCamSlot(deviceId, cameras = this._lastCameraList) {
    const list = Array.isArray(cameras) && cameras.length ? cameras : [0, 1];
    const id = parseInt(deviceId, 10);
    const idx = list.indexOf(id);
    return idx >= 0 ? Math.min(1, idx) : 0;
  }

  _applyPreviewCamForDevice(deviceId, cameras = this._lastCameraList) {
    const slot = this._deviceIdToCamSlot(deviceId, cameras);
    this.imageViewer?.setPreviewCamSlot?.(slot);
    this.imageViewer?.refreshOverlays?.();
  }

  _isCameraSelectEnabled() {
    return this.view === "run" || (this.view === "wizard" && this.previewMode === "live");
  }

  _updateCameraSelectDisabled() {
    const sel = document.querySelector("#camera-select");
    if (sel) sel.disabled = !this._isCameraSelectEnabled();
  }

  async syncCameraSelect(override = null) {
    const sel = document.querySelector("#camera-select");
    if (!sel) return;

    let cameras = [0, 1, 2];
    let cameraId = 0;

    if (override?.cameras) {
      cameras = override.cameras;
      cameraId = override.camera_id ?? cameras[0];
    } else if (isMockMode()) {
      cameras = this._mockCameras || [0, 1, 2];
      cameraId = this._mockCameraId ?? cameras[0];
    } else {
      try {
        const data = await this.api?.get?.("/api/camera/options");
        if (Array.isArray(data?.cameras) && data.cameras.length) cameras = data.cameras;
        if (data?.camera_id != null) cameraId = data.camera_id;
      } catch {
        /* 保持默认 */
      }
    }

    if (!cameras.includes(cameraId)) cameraId = cameras[0];

    this._lastCameraList = cameras;
    this._applyPreviewCamForDevice(cameraId, cameras);

    const prev = parseInt(sel.value, 10);
    sel.innerHTML = cameras
      .map((id) => `<option value="${id}">${id}</option>`)
      .join("");
    sel.value = String(cameraId);
    this._updateCameraSelectDisabled();

    if (prev !== cameraId && this._isCameraSelectEnabled() && !isMockMode()) {
      await this.api?.pullCurrentFrame?.();
    }
  }

  async _onCameraSelectChange(cameraId, { silent = false } = {}) {
    if (!Number.isFinite(cameraId)) return;
    this._applyPreviewCamForDevice(cameraId);
    if (isMockMode()) {
      this._mockCameraId = cameraId;
      await this.syncCameraSelect({ cameras: this._mockCameras || [0, 1, 2], camera_id: cameraId });
      return;
    }
    try {
      await this.api?.post?.("/api/camera/select", { camera_id: cameraId });
      await this.api?.pullCurrentFrame?.();
      await this.syncCameraSelect();
      if (!silent) showToast(`已切换至相机 ${cameraId}`, "ok");
    } catch {
      if (!silent) showToast("相机切换失败", "err");
      await this.syncCameraSelect();
    }
  }

  _bindCameraSelect() {
    document.querySelector("#camera-select")?.addEventListener("change", (e) => {
      const cameraId = parseInt(e.target.value, 10);
      this._onCameraSelectChange(cameraId);
    });
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
    this.syncCameraSelect();
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
          this.toolPanel?.update?.(data);
        }
        return;
      }
      if (this.previewMode !== "live") return;
      this.statusBar.update(data);
      this.imageViewer.updateFrame(data);
      this.toolPanel?.update?.(data);
      return;
    }
    if (this.view !== "run") return;

    if (data.idle && performance.now() < this._ignoreIdleUntil) return;

    if (data.overall?.passed === false && !data.idle) {
      playNgAlert();
    }
    this.statusBar.update(data);
    // 工具预览激活时：保持主画面显示工具对应图像，不被实时帧覆盖
    if (!this._toolPreview?.active) {
      this.imageViewer.updateFrame(data);
    }
    this.toolPanel.update(data);
  }

  _bindToolPreview() {
    this.toolPanel.onToolSelect = async (tool) => {
      if (this.view !== "run") return;
      if (!tool) {
        this._toolPreview = { active: false, tool: null };
        this.imageViewer.clearVerdict?.();
        if (!isMockMode()) {
          await this.api?.pullCurrentFrame?.();
        } else {
          this._onFrame(createIdleFrame());
        }
        return;
      }
      await this.showToolPreview(tool);
    };
  }

  async showToolPreview(tool) {
    this._toolPreview = { active: true, tool };
    if (isMockMode()) {
      // Mock 模式下回退为显示当前帧（避免无后端接口）
      this._toolPreview = { active: false, tool: null };
      showToast("Mock 模式暂不支持工具图像预览", "warn");
      return;
    }
    try {
      const data = await this.api.get(`/api/tools/image?tool=${encodeURIComponent(tool)}`);
      const slot = data?.cam != null ? data.cam : 0;
      this.imageViewer?.setPreviewCamSlot?.(slot);
      this.imageViewer.clearVerdict?.();
      this.imageViewer.updateFrame(this._buildMasterPayload(data, slot));
      showToast(`已显示 Tool ${tool} 对应图像`, "ok");
    } catch {
      showToast("工具图像获取失败", "err");
    }
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
      this._toolPreview = { active: false, tool: null };
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
      this.syncCameraSelect();
      this._updateCameraSelectDisabled();
    } else if (view === "set") {
      this.wizard.hide();
      this._stopWizardPreview();
      this._toolPreview = { active: false, tool: null };
      this.api?.stop();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
      this.syncCameraSelect();
      this._updateCameraSelectDisabled();
    } else if (view === "wizard") {
      this.wizard.show();
      this.previewMode = "off";
      this.livePreviewStarted = false;
      this._toolPreview = { active: false, tool: null };
      this.imageViewer.disableRoiEditor?.();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
      this.syncCameraSelect();
      this._updateCameraSelectDisabled();
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
      // STEP3 起使用 CAM# 对应 Live 画面做 ROI 设定，不再依赖 STEP2 注册的主控图像。
      // 仍停止连续 Live Preview（如果有），但保持 wizard 内可更新预览。
      this.api?.stopLivePreview?.();
      this.previewMode = "live";
      const cam = this.wizard?.getSelectedToolCam?.() ?? 0;
      await this.showLivePreviewSlot(cam);
      this.wizard.enableStep3Roi?.();
    }
  }

  getSelectedToolCam() {
    return this.wizard?.getSelectedToolCam?.() ?? 0;
  }

  async showMasterPreview(cam = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    this.imageViewer?.setPreviewCamSlot?.(slot);
    try {
      const img = await this.api.get(`/api/calibration/master/image?cam=${slot}`);
      this.cacheMasterFrame(img, slot);
      this.imageViewer.updateFrame(this._buildMasterPayload(img, slot));
      this.statusBar.setWaiting();
    } catch {
      showToast(`无法加载 CAM#${slot} 主控图像`, "err");
      this.imageViewer.updateFrame(createIdleFrame());
    }
  }

  async showLivePreviewSlot(slot = 0) {
    const cam = Math.max(0, Math.min(1, parseInt(slot, 10) || 0));
    this.imageViewer?.setPreviewCamSlot?.(cam);
    if (isMockMode()) {
      this.api.startLivePreview?.();
      return;
    }
    try {
      const data = await this.api.get(`/api/cameras/live?cam=${cam}`);
      if (data?.image_base64) {
        this.imageViewer.updateFrame(this._buildMasterPayload(data, cam));
        this.statusBar.setWizardLive();
      }
    } catch {
      showToast(`无法预览 CAM#${cam} Live 画面`, "warn");
    }
  }

  cacheMasterFrame(img, slot = 0) {
    if (!this._masterFrames) this._masterFrames = {};
    this._masterFrames[slot] = img;
    this.masterFrame = img;
    this.hasMasterRegistered = true;
  }

  _buildMasterPayload(img, camSlot = 0) {
    if (isMockMode()) {
      return createMasterFramePayload(img);
    }
    const slot = Math.max(0, Math.min(1, parseInt(camSlot, 10) || 0));
    return {
      type: "frame",
      timestamp: new Date().toISOString(),
      idle: true,
      overall: { passed: null },
      preview_cam: slot,
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
      if (this.view === "wizard" && this.wizard?.step === 1) {
        await this.wizard.applyStep1Cameras({ silent: true });
      }
      this.api.reconnect();
      await this.api.pullCurrentFrame();
    }
    this.livePreviewStarted = true;
    this.previewMode = "live";
    this.statusBar.setWizardLive();
    this.imageViewer.setWaiting(false, { livePreview: true });
    this._updateCameraSelectDisabled();
    await this.syncCameraSelect();
    showToast("Live 预览已启动", "ok");
  }

  async registerLiveMaster(cam = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    if (!this.livePreviewStarted && !isMockMode()) {
      showToast("请先点击 拍摄 启动 Live 预览", "err");
      return;
    }
    try {
      if (isMockMode()) {
        const img = captureMockMasterFromLive();
        registerMaster();
        this.cacheMasterFrame(img, slot);
      } else {
        await this.api.post("/api/calibration/master", { cam: slot });
        const img = await this.api.get(`/api/calibration/master/image?cam=${slot}`);
        this.cacheMasterFrame(img, slot);
      }
      this.api?.stopLivePreview?.();
      this.previewMode = "master";
      this.imageViewer.updateFrame(this._buildMasterPayload(this.masterFrame));
      this.statusBar.setWaiting();
      showToast(`已注册 CAM#${slot} Live 图像为主控`, "ok");
    } catch {
      showToast(`注册 CAM#${slot} 主控图像失败`, "err");
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

    await this.syncCameraSelect();

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
        "ai-shoot": async (e) => {
          const row = e.target.closest(".wizard-camera-row");
          const cameraId = row
            ? parseInt(row.querySelector('[data-field="camera-id"]')?.value, 10)
            : NaN;
          if (Number.isFinite(cameraId)) {
            await this._onCameraSelectChange(cameraId, { silent: true });
          }
          return this.startLivePreview();
        },
        "register-live": (e) => {
          const cam = parseInt(e.target.closest("[data-action]")?.dataset?.cam, 10);
          return this.registerLiveMaster(Number.isFinite(cam) ? cam : 0);
        },
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

      if (handlers[action]) await handlers[action](e);
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
      if (!frame.idle && (!Array.isArray(frame.inspections) || frame.inspections.length === 0)) {
        showToast("未收到工具判定结果：请确认 STEP3 已保存且 STEP2 已注册主控图像", "warn");
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

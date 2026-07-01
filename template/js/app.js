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
import { openProfileManager } from "./profile-manager.js";
import {
  addMockCalibration,
  resetMockStats,
  registerMaster,
  createIdleFrame,
  createMasterFramePayload,
} from "./mock-data.js";
import { runUiDemo } from "./ui-demo.js";

class MarkEyeApp {
  constructor() {
    this.view = "run";
    this.previewMode = "off";
    this.hasMasterRegistered = false;
    this.masterFrame = null;
    this._masterFrames = {};
    this._masterSlots = { 0: false, 1: false };
    this._masterDraft = { 0: false, 1: false };
    this._masterThumbRev = 0;
    this._step2PreviewActive = false;
    this._step2PreviewTimer = null;
    this.livePreviewStarted = false;
    this._ignoreIdleUntil = 0;
    this._continuousTrigger = false;
    this._continuousTriggerTimer = null;
    this._lastNgAlertAt = 0;
    this.api = null;
    this._mockCameras = [0, 1, 2];
    this._mockCameraId = 0;
    this._lastCameraList = [0, 1, 2];
    this._toolPreview = { active: false, tool: null, cam: null };
    this._toolPreviewSeq = 0;

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
    this._bindToolPreview();
    initLayout();
  }

  _camSlotToDeviceId(camSlot, cameras = this._lastCameraList) {
    const list = Array.isArray(cameras) && cameras.length ? cameras : [0, 1];
    const slot = Math.max(0, Math.min(1, parseInt(camSlot, 10) || 0));
    return list[slot] ?? list[0] ?? slot;
  }

  /** 相机号码：仅反映当前主画面 CAM 槽位，不参与检测/切换逻辑 */
  _syncDisplayCameraNumber(camSlot) {
    this._setCameraNumberText(this._camSlotToDeviceId(camSlot));
  }

  _syncDisplayCameraNumberFromFrame(data) {
    const slot =
      data?.preview_cam != null
        ? data.preview_cam
        : this.imageViewer?.getPreviewCamSlot?.() ?? 0;
    this._syncDisplayCameraNumber(slot);
  }

  _setCameraNumberText(cameraId) {
    const el = document.querySelector("#camera-select");
    if (!el) return;
    el.textContent = cameraId != null ? String(cameraId) : "0";
  }

  async syncCameraSelect(override = null) {
    let cameras = [0, 1, 2];

    if (override?.cameras) {
      cameras = override.cameras;
    } else if (isMockMode()) {
      cameras = this._mockCameras || [0, 1, 2];
    } else {
      try {
        const data = await this.api?.get?.("/api/camera/options");
        if (Array.isArray(data?.cameras) && data.cameras.length) cameras = data.cameras;
      } catch {
        /* 保持默认 */
      }
    }

    this._lastCameraList = cameras;
  }

  start() {
    showConnectionBanner(false);
    this.api = new ApiClient({
      onFrame: (data) => this._onFrame(data),
      onConnectionChange: (connected) => {
        const needsLiveStream =
          this.view === "run" ||
          (this.view === "wizard" && this.livePreviewStarted);
        showConnectionBanner(!connected && !isMockMode() && needsLiveStream);
        if (!connected) {
          this._stopContinuousTrigger();
        }
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
          this._syncDisplayCameraNumberFromFrame(data);
          this.toolPanel?.update?.(data);
        }
        return;
      }
      if (this.previewMode !== "live" && this.previewMode !== "step1") return;
      if (data.no_tools) return;
      this.statusBar.update(data);
      this.imageViewer.updateFrame(data);
      this._syncDisplayCameraNumberFromFrame(data);
      this.toolPanel?.update?.(data);
      return;
    }
    if (this.view !== "run") return;

    if (data.idle && !data.no_tools && performance.now() < this._ignoreIdleUntil) return;

    this._syncDisabledToolPreview(data);

    if (data.no_tools) {
      this.imageViewer.clearVerdict?.();
      this._setCameraNumberText("—");
    }

    if (data.overall?.passed === false && !data.idle && !data.no_tools) {
      const now = performance.now();
      const ngGap = this._continuousTrigger ? 500 : 0;
      if (now - this._lastNgAlertAt >= ngGap) {
        this._lastNgAlertAt = now;
        playNgAlert();
      }
    }
    this.statusBar.update(data);
    if (!this._toolPreview?.active) {
      this.imageViewer.updateFrame(data);
      this._syncDisplayCameraNumberFromFrame(data);
    } else {
      this._applyToolPreviewFrame(data, isTriggerResult);
    }
    this.toolPanel.update(data);
  }

  _applyToolPreviewFrame(data, isTriggerResult) {
    const toolCam = this._toolPreview.cam;
    const frameCam = data.preview_cam != null ? parseInt(data.preview_cam, 10) : 0;
    const resolvedToolCam = Number.isFinite(toolCam)
      ? toolCam
      : this.imageViewer.getPreviewCamSlot();

    if (isTriggerResult) {
      if (Number.isFinite(toolCam) && frameCam === toolCam) {
        this.imageViewer.updateFrame(data);
        this._syncDisplayCameraNumberFromFrame(data);
        return;
      }
      void this._refreshToolPreviewFrame(this._toolPreview.tool, { triggerData: data, silent: true });
      return;
    }

    if (data.idle && !data.no_tools && Number.isFinite(toolCam) && frameCam === toolCam) {
      this.imageViewer.updateFrame(data);
      this._syncDisplayCameraNumberFromFrame(data);
      return;
    }

    this._syncDisplayCameraNumber(resolvedToolCam);
  }

  async _refreshToolPreviewFrame(tool, { triggerData = null, silent = false } = {}) {
    if (!tool || isMockMode()) return;
    const seq = ++this._toolPreviewSeq;
    try {
      const info = await this.api.get(`/api/tools/image?tool=${encodeURIComponent(tool)}`);
      if (seq !== this._toolPreviewSeq || !this._toolPreview?.active || this._toolPreview.tool !== tool) {
        return;
      }

      const slot = info?.cam != null ? parseInt(info.cam, 10) : 0;
      const camSlot = Number.isFinite(slot) ? Math.max(0, Math.min(1, slot)) : 0;
      this._toolPreview.cam = camSlot;
      this.imageViewer?.setPreviewCamSlot?.(camSlot);
      this._syncDisplayCameraNumber(camSlot);

      const frameCam = triggerData?.preview_cam != null ? parseInt(triggerData.preview_cam, 10) : null;
      if (
        triggerData
        && !triggerData.idle
        && triggerData.overall?.passed != null
        && frameCam === camSlot
      ) {
        if (seq !== this._toolPreviewSeq) return;
        this.imageViewer.updateFrame(triggerData);
        return;
      }

      const live = await this.api.get(`/api/cameras/live?cam=${camSlot}`);
      if (seq !== this._toolPreviewSeq || !this._toolPreview?.active || this._toolPreview.tool !== tool) {
        return;
      }

      const overlayRoi = info?.roi || null;
      this.imageViewer.updateFrame({
        type: "frame",
        timestamp: new Date().toISOString(),
        idle: true,
        overall: triggerData?.overall ?? { passed: null },
        preview_cam: camSlot,
        frame: {
          width: live.width,
          height: live.height,
          process_ms: triggerData?.frame?.process_ms ?? null,
          image_base64: live.image_base64,
          binary_base64: live.binary_base64 || "",
        },
        tool_rois: overlayRoi ? [{ cam: camSlot, roi: overlayRoi }] : [],
        marks: [],
        inspections: triggerData?.inspections || [],
        stats: triggerData?.stats || {},
        calibration: triggerData?.calibration || {},
        trigger: triggerData?.trigger || { source: "tool", label: `Tool ${tool}` },
      });
      if (!silent) {
        showToast(`已切换至 Tool ${tool} 的相机画面`, "ok");
      }
    } catch {
      if (seq === this._toolPreviewSeq && !silent) {
        showToast("工具图像获取失败", "err");
      }
    }
  }

  _syncDisabledToolPreview(data) {
    const available = new Set((data.inspections || []).map((i) => i.tool));
    if (!this._toolPreview?.active || !this._toolPreview.tool) return;
    if (available.has(this._toolPreview.tool)) return;
    this._toolPreview = { active: false, tool: null, cam: null };
    this._toolPreviewSeq += 1;
    if (!isMockMode()) {
      void this.api?.pullCurrentFrame?.();
    }
  }

  _bindToolPreview() {
    this.toolPanel.onToolSelect = async (tool) => {
      if (this.view !== "run") return;
      if (!tool) {
        this._toolPreview = { active: false, tool: null, cam: null };
        this._toolPreviewSeq += 1;
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
    this._toolPreview = { active: true, tool, cam: null };
    if (isMockMode()) {
      this._toolPreview = { active: false, tool: null, cam: null };
      this._toolPreviewSeq += 1;
      showToast("Mock 模式暂不支持工具图像预览", "warn");
      return;
    }
    this.imageViewer.clearVerdict?.();
    await this._refreshToolPreviewFrame(tool);
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
    updateModeTabIcons(view);

    if (view !== "run") {
      this._stopContinuousTrigger();
    }

    if (view === "run") {
      this.wizard.hide();
      this._stopWizardPreview();
      this._toolPreview = { active: false, tool: null, cam: null };
      this._toolPreviewSeq += 1;
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
    } else if (view === "set") {
      this.wizard.hide();
      this._stopWizardPreview();
      this._toolPreview = { active: false, tool: null, cam: null };
      this._toolPreviewSeq += 1;
      showConnectionBanner(false);
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
      this.syncCameraSelect();
    } else if (view === "wizard") {
      this.wizard.show();
      this.previewMode = "off";
      this.livePreviewStarted = false;
      this._toolPreview = { active: false, tool: null, cam: null };
      this._toolPreviewSeq += 1;
      this.imageViewer.disableRoiEditor?.();
      this.statusBar.setWaiting();
      this.imageViewer.updateFrame(createIdleFrame());
      this.syncCameraSelect();
    }
  }

  _stopWizardPreview() {
    this._stopStep2Preview();
    this.previewMode = "off";
    this.livePreviewStarted = false;
    this.api?.stopLivePreview?.();
    this.imageViewer.disableRoiEditor?.();
  }

  _stopStep2Preview() {
    this._step2PreviewActive = false;
    if (this._step2PreviewTimer) {
      clearInterval(this._step2PreviewTimer);
      this._step2PreviewTimer = null;
    }
  }

  async _fetchCameraFrame(cam) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    if (isMockMode()) {
      const { createLivePreviewFrame } = await import("./mock-data.js");
      const frame = createLivePreviewFrame();
      return {
        image_base64: frame.frame.image_base64,
        width: frame.frame.width,
        height: frame.frame.height,
      };
    }
    return this.api.get(`/api/cameras/live?cam=${slot}`);
  }

  async _refreshStep2PreviewFrame(cam) {
    if (!this._step2PreviewActive || this.wizard?.step !== 2) return;
    try {
      const data = await this._fetchCameraFrame(cam);
      if (data?.image_base64) {
        this.imageViewer?.setPreviewCamSlot?.(cam);
        this.imageViewer.updateFrame(this._buildMasterPayload(data, cam));
        this.statusBar.setWizardLive();
      }
    } catch {
      /* 单帧抓取失败时保持上一帧 */
    }
  }

  async startStep2Preview() {
    this._stopStep2Preview();
    this.api?.stopLivePreview?.();
    this.livePreviewStarted = false;
    this._step2PreviewActive = true;
    this.previewMode = "step2";
    const slot = this.wizard?._previewCamSlot ?? 0;
    await this._refreshStep2PreviewFrame(slot);
    this._step2PreviewTimer = setInterval(() => {
      const cam = this.wizard?._previewCamSlot ?? 0;
      this._refreshStep2PreviewFrame(cam);
    }, 400);
  }

  _enterWizard(step = 1, { resetMaster = step === 1 } = {}) {
    if (resetMaster) {
      this.hasMasterRegistered = false;
      this.masterFrame = null;
      this._masterFrames = {};
      this._masterSlots = { 0: false, 1: false };
    }
    this.wizard.reloadForProfile(step);
    this._setView("wizard");
    this.loadMasterThumbnails();
    showToast(step === 3 ? "进入 STEP3 工具设定" : "进入传感器设定向导", "ok");
  }

  async _exitWizard() {
    const saved = await this.wizard.saveCurrentStep({ silent: true });
    this._stopWizardPreview();
    this._setView("set");
    showToast(saved ? "参数已保存，已退出向导" : "已退出向导", saved ? "ok" : "warn");
  }

  async _onWizardStepChange(step) {
    if (step === 1) {
      this._stopStep2Preview();
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

    if (step === 2) {
      this.api?.stopLivePreview?.();
      this.livePreviewStarted = false;
      this.imageViewer.disableRoiEditor?.();
      await this.loadMasterThumbnails();
      await this.startStep2Preview();
      return;
    }

    if (step >= 3) {
      this._stopStep2Preview();
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
      this._markMasterSlot(slot, img);
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

  getMasterFrame(cam = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    return this._masterFrames?.[slot] ?? null;
  }

  hasMasterOnDisk(cam = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    return Boolean(this._masterSlots?.[slot]);
  }

  getMasterThumbSrc(cam = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    if (!this._masterSlots?.[slot]) return null;
    const img = this.getMasterFrame(slot);
    if (img?.image_base64) {
      return `data:image/jpeg;base64,${img.image_base64}`;
    }
    if (!isMockMode()) {
      const base = this.api?._base || "";
      return `${base}/api/calibration/master/image?cam=${slot}&_=${this._masterThumbRev || 0}`;
    }
    return null;
  }

  async loadMasterThumbnails() {
    this._masterSlots = { 0: false, 1: false };
    this._masterDraft = { 0: false, 1: false };
    this._masterFrames = {};
    if (isMockMode()) {
      const { loadAllMockMastersFromStorage } = await import("./mock-data.js");
      loadAllMockMastersFromStorage(this._getActiveProfileName());
      for (const cam of [0, 1]) {
        const img = this.getMasterFrame(cam);
        if (img?.image_base64) {
          this._masterSlots[cam] = true;
          this._masterDraft[cam] = false;
        }
      }
    } else {
      try {
        const status = await this.api.get("/api/calibration/master/status");
        if (status?.slots) {
          for (const cam of [0, 1]) {
            if (status.slots[String(cam)] || status.slots[cam]) {
              this._masterSlots[cam] = true;
            }
          }
        }
      } catch {
        /* ignore */
      }
      for (const cam of [0, 1]) {
        if (!this._masterSlots[cam]) continue;
        try {
          const img = await this.api.get(`/api/calibration/master/image?cam=${cam}`);
          if (img?.image_base64) {
            this._masterFrames[cam] = img;
            this._masterDraft[cam] = false;
          }
        } catch {
          this._masterSlots[cam] = false;
        }
      }
    }
    this._masterThumbRev = Date.now();
    this.hasMasterRegistered = [0, 1].some((c) => this._masterSlots[c]);
    this.wizard?.refreshStep2MasterThumbs?.();
  }

  _markMasterSlot(cam, img = null, { draft = false } = {}) {
    const slot = Math.max(0, Math.min(1, parseInt(cam, 10) || 0));
    this._masterSlots[slot] = true;
    if (img) this._masterFrames[slot] = img;
    if (draft) this._masterDraft[slot] = true;
    this._masterThumbRev = Date.now();
    this.hasMasterRegistered = [0, 1].some((c) => this._masterSlots[c]);
    this.wizard?.refreshStep2MasterThumbs?.();
  }

  /** STEP2：从预览通道抓取一帧，填入指定 CAM# 槽位（仅更新界面，不落盘） */
  async captureStep2MasterSlot(targetSlot = 0) {
    const slot = Math.max(0, Math.min(1, parseInt(targetSlot, 10) || 0));
    const previewCam = this.wizard?._previewCamSlot ?? 0;
    try {
      const img = await this._fetchCameraFrame(previewCam);
      if (!img?.image_base64) throw new Error("no frame");
      this._markMasterSlot(slot, img, { draft: true });
      showToast(`已抓取 CAM#${previewCam} 图像至 CAM#${slot}`, "ok");
    } catch {
      showToast(`抓取 CAM#${previewCam} 图像失败`, "err");
    }
  }

  /** RUN 模式：保存主画面当前显示图像到项目目录 */
  async saveCurrentFrame() {
    const payload = this.imageViewer?.getCurrentFrameForSave?.();
    if (!payload?.image_base64) {
      showToast("当前无可保存的画面", "warn");
      return;
    }
    try {
      const res = await this.api.post("/api/frame/save", payload);
      const label = res.filename || "capture.jpg";
      showToast(
        isMockMode() ? `当前帧已保存（Mock 已触发下载）：${label}` : `已保存：${label}`,
        "ok",
      );
    } catch {
      showToast("保存画面失败", "err");
    }
  }

  /** STEP2：将当前槽位主控图像写入磁盘 */
  async saveStep2Masters() {
    const slots = [0, 1].filter((s) => this._masterFrames[s]?.image_base64);
    if (!slots.length) {
      showToast("请先点击上方按钮抓取主控图像", "warn");
      return;
    }
    try {
      for (const slot of slots) {
        const img = this._masterFrames[slot];
        await this.api.post("/api/calibration/master", {
          cam: slot,
          image_base64: img.image_base64,
          width: img.width,
          height: img.height,
          ui_only: true,
        });
        this._masterDraft[slot] = false;
      }
      this._masterThumbRev = Date.now();
      this.hasMasterRegistered = true;
      showToast("主控图像已保存", "ok");
    } catch {
      showToast("保存主控图像失败", "err");
    }
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

  /** STEP1：按 OpenCV 设备号单帧抓拍（纯硬件测试，不依赖 STEP3 工具） */
  async captureStep1Shot(deviceId = 0) {
    const dev = parseInt(deviceId, 10);
    if (!Number.isFinite(dev) || dev < 0) {
      showToast("相机号码无效", "err");
      return;
    }
    this._setCameraNumberText(dev);
    if (isMockMode()) {
      const { createLivePreviewFrame } = await import("./mock-data.js");
      const frame = createLivePreviewFrame();
      this.imageViewer?.setPreviewCamSlot?.(0);
      this.imageViewer.updateFrame(frame);
      this.previewMode = "step1";
      this.livePreviewStarted = true;
      this.statusBar.setWizardLive();
      this.imageViewer.setWaiting(false, { livePreview: true });
      showToast(`相机 ${dev} 拍摄成功（Mock）`, "ok");
      return;
    }
    try {
      if (this.view === "wizard" && this.wizard?.step === 1) {
        await this.wizard.applyStep1Cameras({ silent: true });
      }
      const data = await this.api.get(`/api/cameras/snapshot?device_id=${dev}`);
      if (!data?.image_base64) throw new Error("no frame");
      const slot = data.cam != null ? parseInt(data.cam, 10) : 0;
      this.imageViewer?.setPreviewCamSlot?.(slot);
      this.imageViewer.updateFrame(this._buildMasterPayload(data, slot));
      this.previewMode = "step1";
      this.livePreviewStarted = true;
      this.statusBar.setWizardLive();
      this.imageViewer.setWaiting(false, { livePreview: true });
      await this.syncCameraSelect({ camera_id: dev });
      showToast(`相机 ${dev} 拍摄成功`, "ok");
    } catch {
      showToast(`相机 ${dev} 拍摄失败`, "err");
    }
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
    await this.syncCameraSelect();
    showToast("Live 预览已启动", "ok");
  }

  async registerLiveMaster(cam = 0) {
    return this.captureStep2MasterSlot(cam);
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
      this._masterFrames = {};
      this._masterSlots = { 0: false, 1: false };
      this._masterDraft = { 0: false, 1: false };
      this.wizard.reloadForProfile(step);
      await this.loadMasterThumbnails();
      await this._onWizardStepChange(step);
    } else if (this.view === "run" && isMockMode()) {
      this._onFrame(createIdleFrame());
    }
  }

  async _onProfileSwitch(name, { forceReload = false } = {}) {
    const prev = this._getActiveProfileName();
    if (name !== prev) {
      await this._switchProfile(name);
      return;
    }
    if (!forceReload) return;
    if (this.view === "wizard") {
      const step = this.wizard.step;
      this.hasMasterRegistered = false;
      this.masterFrame = null;
      this._masterFrames = {};
      this._masterSlots = { 0: false, 1: false };
      this._masterDraft = { 0: false, 1: false };
      this.wizard.reloadForProfile(step);
      await this.loadMasterThumbnails();
      await this._onWizardStepChange(step);
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
      openProfileManager({
        api: this.api,
        onProfilesChanged: () => this._loadProfiles(),
        onSwitchProfile: (name, opts) => this._onProfileSwitch(name, opts),
      });
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
      this._enterWizard(3, { resetMaster: false });
    });

    document.querySelector("#btn-trigger")?.addEventListener("click", () => {
      this._doTrigger();
    });

    document.querySelector("#btn-continuous-trigger")?.addEventListener("click", () => {
      this._toggleContinuousTrigger();
    });

    document.querySelector("#btn-save-frame")?.addEventListener("click", () => {
      this.saveCurrentFrame();
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
          return this.captureStep1Shot(Number.isFinite(cameraId) ? cameraId : 0);
        },
        "register-live": (e) => {
          const cam = parseInt(e.target.closest("[data-action]")?.dataset?.cam, 10);
          return this.captureStep2MasterSlot(Number.isFinite(cam) ? cam : 0);
        },
        "save-master": () => this.saveStep2Masters(),
        logic: () => showToast(`打开逻辑 ${e.target.dataset.n} 编辑器（Mock）`, "ok"),
      };

      if (handlers[action]) await handlers[action](e);
    });
  }

  async _doTrigger(options = {}) {
    const { silent = false } = options;
    if (!this.api?._connected) {
      if (!silent) showToast("请先连接传感器", "err");
      else if (this._continuousTrigger) this._stopContinuousTrigger();
      return;
    }
    this._ignoreIdleUntil = performance.now() + 700;
    const frame = await this.api.trigger();
    if (frame) {
      // WebSocket 推送 onFrame；WS 断连时 post() 会 fallback 调用 onFrame
      if (!silent && !frame.idle && frame.overall?.passed != null) {
        showToast(`触发完成 — ${frame.overall.passed ? "OK" : "NG"}`, frame.overall.passed ? "ok" : "err");
      }
      if (!silent && !frame.idle && (!Array.isArray(frame.inspections) || frame.inspections.length === 0)) {
        showToast("未收到工具判定结果：请确认 STEP3 已保存且 STEP2 已注册主控图像", "warn");
      }
    }
    return frame;
  }

  _toggleContinuousTrigger() {
    if (this._continuousTrigger) {
      this._stopContinuousTrigger();
      showToast("连续触发已停止", "ok");
      return;
    }
    if (!this.api?._connected) {
      showToast("请先连接传感器", "err");
      return;
    }
    this._continuousTrigger = true;
    this._updateContinuousTriggerButton();
    showToast("连续触发已启动", "ok");
    this._continuousTriggerStep();
  }

  _stopContinuousTrigger() {
    if (!this._continuousTrigger && !this._continuousTriggerTimer) return;
    this._continuousTrigger = false;
    if (this._continuousTriggerTimer) {
      clearTimeout(this._continuousTriggerTimer);
      this._continuousTriggerTimer = null;
    }
    this._updateContinuousTriggerButton();
  }

  _updateContinuousTriggerButton() {
    const btn = document.querySelector("#btn-continuous-trigger");
    if (!btn) return;
    btn.classList.toggle("is-active", this._continuousTrigger);
    btn.setAttribute("aria-pressed", this._continuousTrigger ? "true" : "false");
  }

  async _continuousTriggerStep() {
    if (!this._continuousTrigger) return;
    const stepStart = performance.now();
    let frame = null;
    try {
      frame = await this._doTrigger({ silent: true });
    } catch {
      this._stopContinuousTrigger();
      showToast("连续触发已停止（触发失败）", "err");
      return;
    }
    if (!this._continuousTrigger) return;
    const processMs = frame?.frame?.process_ms ?? 0;
    const elapsed = performance.now() - stepStart;
    const delay = Math.max(50, processMs + 20, Math.round(elapsed * 0.5));
    this._continuousTriggerTimer = setTimeout(() => this._continuousTriggerStep(), delay);
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

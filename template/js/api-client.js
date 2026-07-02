/** WebSocket / REST 客户端 — 真实后端 + ?mock=1 回退 */

import {
  createMockFrame,
  createIdleFrame,
  createLivePreviewFrame,
  captureMockMasterFromLive,
  getMockMasterImage,
  triggerMockFrame,
  getMockState,
} from "./mock-data.js";

export function isMockMode() {
  return new URLSearchParams(location.search).get("mock") === "1";
}

function apiBase() {
  const { protocol, hostname, port } = window.location;
  if (port === "5500" || port === "5173" || !port) {
    return `${protocol}//${hostname}:8080`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

function wsUrl() {
  const base = apiBase();
  return base.replace(/^http/, "ws") + "/ws/frame";
}

class MockApiClient {
  constructor(handlers) {
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange || (() => {});
    this.onProfileSwitch = handlers.onProfileSwitch || (() => {});
    this._connected = false;
    this._liveTimer = null;
    this._activeProfile = "config.yaml";
    this._profiles = [
      { id: "config", name: "config.yaml", active: true },
      { id: "config.local", name: "config.local.yaml", active: false },
    ];
    this._wizardData = {};
    this._mockCameras = [0, 1, 2];
    this._mockCameraId = 0;
    this._mockIo = {
      enabled: false,
      connected: false,
      run_mode_enabled: true,
      inputs: Array(8).fill(false),
      outputs: Array(8).fill(false),
    };
  }

  _profileList() {
    return this._profiles.map((p) => ({
      ...p,
      active: p.name === this._activeProfile,
    }));
  }

  start() {
    this._setConnected(true);
    this.onFrame(createIdleFrame());
  }

  stop() {
    this.stopLivePreview();
    this._setConnected(false);
  }

  reconnect() {
    this.start();
  }

  startLivePreview() {
    this.stopLivePreview();
    if (!this._connected) this._setConnected(true);
    this.onFrame(createLivePreviewFrame());
    this._liveTimer = setInterval(() => {
      this.onFrame(createLivePreviewFrame());
    }, 100);
  }

  stopLivePreview() {
    if (this._liveTimer) {
      clearInterval(this._liveTimer);
      this._liveTimer = null;
    }
  }

  _setConnected(connected) {
    if (this._connected === connected) return;
    this._connected = connected;
    this.onConnectionChange(connected);
  }

  _mockIoStatus() {
    return {
      enabled: this._mockIo.enabled,
      connected: this._mockIo.connected,
      transport: "rtu",
      unit_id: 1,
      busy: false,
      run_mode_enabled: this._mockIo.run_mode_enabled,
      input_bits: [...this._mockIo.inputs],
      output_bits: [...this._mockIo.outputs],
      output_assignments: [],
      input_assignments: [],
      outputs: { link_ok: 0, result_ng: 1 },
      inputs: { trigger_bits: [0] },
    };
  }

  async post(path, body = {}) {
    await this._delay(80);
    if (path === "/api/trigger") {
      const frame = triggerMockFrame();
      this.onFrame(frame);
      return frame;
    }
    if (path === "/api/frame/save") {
      const viewer = window.__markeyeApp?.imageViewer;
      const payload = viewer?.getCurrentFrameForSave?.() || body;
      if (!payload?.image_base64) throw new Error("no frame");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = `data:image/jpeg;base64,${payload.image_base64}`;
      a.download = `capture_${stamp}.jpg`;
      a.click();
      return {
        ok: true,
        mock: true,
        filename: `capture_${stamp}.jpg`,
        dir: "mock/download",
      };
    }
    if (path === "/api/system/restart") {
      return { ok: true, mock: true };
    }
    if (path === "/api/system/shutdown") {
      return { ok: true, mock: true };
    }
    if (path === "/api/cameras/disconnect") {
      return { ok: true, mock: true, connected: false, cameras: [] };
    }
    if (path === "/api/stats/reset") {
      const { resetMockStats } = await import("./mock-data.js");
      resetMockStats();
      this.onFrame(createIdleFrame());
    }
    if (path === "/api/calibration/master") {
      const slot = parseInt(body?.cam, 10) || 0;
      const {
        captureMockMasterFromLive,
        saveMockMasterToStorage,
        setMockMasterImage,
        registerMaster,
      } = await import("./mock-data.js");
      let img;
      if (body?.image_base64) {
        img = {
          image_base64: body.image_base64,
          width: body.width || 800,
          height: body.height || 500,
        };
        setMockMasterImage(img, slot);
        registerMaster();
      } else {
        img = captureMockMasterFromLive(slot);
      }
      saveMockMasterToStorage(this._activeProfile, slot, img);
      return { ok: true, calibration: { sample_count: getMockState().sampleCount }, cam: slot };
    }
    if (path === "/api/config/switch") {
      const name = body?.name;
      if (name) this._activeProfile = name;
      const { loadAllMockMastersFromStorage } = await import("./mock-data.js");
      loadAllMockMastersFromStorage(name);
      await window.__markeyeApp?.loadMasterThumbnails?.();
      return { ok: true, active: this._activeProfile };
    }
    if (path === "/api/config/create") {
      const name = body?.name;
      if (!name) throw new Error("missing name");
      if (this._profiles.some((p) => p.name === name)) throw new Error("409 exists");
      const id = name.replace(/\.yaml$/i, "");
      this._profiles.push({ id, name, active: false });
      return { ok: true, name };
    }
    if (path === "/api/config/copy") {
      const from = body?.from;
      const name = body?.name;
      if (!from || !name) throw new Error("missing fields");
      if (!this._profiles.some((p) => p.name === from)) throw new Error("404");
      if (this._profiles.some((p) => p.name === name)) throw new Error("409");
      const id = name.replace(/\.yaml$/i, "");
      this._profiles.push({ id, name, active: false });
      return { ok: true, from, name };
    }
    if (path === "/api/config/rename") {
      const from = body?.from;
      const to = body?.to;
      if (!from || !to) throw new Error("missing fields");
      const item = this._profiles.find((p) => p.name === from);
      if (!item) throw new Error("404");
      if (this._profiles.some((p) => p.name === to)) throw new Error("409");
      item.name = to;
      item.id = to.replace(/\.yaml$/i, "");
      if (this._activeProfile === from) this._activeProfile = to;
      return { ok: true, from, to, active: this._activeProfile };
    }
    if (path === "/api/config/delete") {
      const name = body?.name;
      if (!name) throw new Error("missing name");
      if (name === this._activeProfile) throw new Error("409 active");
      if (this._profiles.length <= 1) throw new Error("409 last");
      const idx = this._profiles.findIndex((p) => p.name === name);
      if (idx < 0) throw new Error("404");
      this._profiles.splice(idx, 1);
      return { ok: true, name, active: this._activeProfile };
    }
    if (path === "/api/tools/hsv-area") {
      const viewer = window.__markeyeApp?.imageViewer;
      if (!viewer?._hasFrame) throw new Error("no frame");
      return viewer.computeHsvAreaInRoi({
        roi: body?.roi,
        hLower: body?.h_lower || body?.params?.h_lower,
        hUpper: body?.h_upper || body?.params?.h_upper,
      });
    }
    if (path === "/api/tools/hsv-sample-roi") {
      const viewer = window.__markeyeApp?.imageViewer;
      if (!viewer?._hasFrame) throw new Error("no frame");
      const hsv = viewer.sampleHsvFromRoi({ roi: body?.roi });
      if (!hsv) throw new Error("empty roi");
      return { hsv };
    }
    if (path === "/api/cameras/reconnect") {
      const cameras = Array.isArray(body?.cameras) && body.cameras.length
        ? [...new Set(body.cameras.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
        : [0, 1];
      if (!cameras.length) cameras.push(0);
      this._mockCameras = cameras;
      if (!cameras.includes(this._mockCameraId)) this._mockCameraId = cameras[0];
      if (window.__markeyeApp) {
        window.__markeyeApp._mockCameras = cameras;
        window.__markeyeApp._mockCameraId = this._mockCameraId;
      }
      return {
        ok: true,
        mock: true,
        results: { 0: true, 1: cameras.length > 1 },
        cameras: [
          { slot: 0, device_id: cameras[0], connected: true },
          { slot: 1, device_id: cameras[1] ?? cameras[0], connected: cameras.length > 1 },
        ],
        available_cameras: cameras,
      };
    }
    if (path === "/api/camera/switch") {
      return { ok: true, camera_id: 1, cam: 2, mock: true };
    }
    if (path === "/api/io/reconnect") {
      this._mockIo.connected = !!this._mockIo.enabled;
      return { ok: this._mockIo.connected, connected: this._mockIo.connected, ...this._mockIoStatus() };
    }
    if (path === "/api/io/switch") {
      this._mockIo.enabled = body?.enabled === true;
      this._mockIo.connected = this._mockIo.enabled;
      return { ok: true, connected: this._mockIo.connected, ...this._mockIoStatus() };
    }
    if (path === "/api/io/run-mode") {
      this._mockIo.run_mode_enabled = body?.enabled === true;
      const runningIdx = (this._wizardData[`${this._activeProfile}:step4`]?.io?.output_assignments || [])
        .findIndex((role) => role === "running");
      if (runningIdx >= 0) {
        this._mockIo.outputs[runningIdx] = this._mockIo.run_mode_enabled;
      }
      return { ok: true, run_mode_enabled: this._mockIo.run_mode_enabled, ...this._mockIoStatus() };
    }
    if (path === "/api/io/test/output") {
      const ch = Math.max(0, Math.min(7, parseInt(body?.channel, 10) || 0));
      this._mockIo.outputs[ch] = !!body?.value;
      return { ok: true, channel: ch, value: !!body?.value, ...this._mockIoStatus() };
    }
    if (path === "/api/camera/select") {
      let cameraId = body?.camera_id;
      if (cameraId == null && body?.cam != null) {
        cameraId = Math.max(0, parseInt(body.cam, 10) - 1);
      }
      cameraId = parseInt(cameraId, 10);
      if (!Number.isFinite(cameraId)) cameraId = 0;
      this._mockCameraId = cameraId;
      if (!this._mockCameras.includes(cameraId)) {
        this._mockCameras = [...new Set([...this._mockCameras, cameraId])].sort((a, b) => a - b);
      }
      if (window.__markeyeApp) {
        window.__markeyeApp._mockCameras = this._mockCameras;
        window.__markeyeApp._mockCameraId = cameraId;
      }
      return {
        ok: true,
        connected: true,
        camera_id: cameraId,
        cam: cameraId + 1,
        mock: true,
        available_cameras: this._mockCameras,
      };
    }
    return { ok: true, mock: true, path, body, state: getMockState() };
  }

  async put(path, body = {}) {
    await this._delay(80);
    const m = path.match(/^\/api\/wizard\/step\/(\d+)$/);
    if (m) {
      const step = m[1];
      const key = `${this._activeProfile}:step${step}`;
      this._wizardData[key] = { ...(this._wizardData[key] || {}), ...body };
      if (step === "4" && body?.io) {
        this._mockIo.enabled = body.io.enabled === true;
        this._mockIo.connected = this._mockIo.enabled;
      }
      if (step === "1" && body?.input?.cameras) {
        const cameras = body.input.cameras.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n) && n >= 0);
        if (cameras.length) {
          this._mockCameras = [...new Set(cameras)].sort((a, b) => a - b);
          const cid = parseInt(body.input.camera_id, 10);
          this._mockCameraId = Number.isFinite(cid) && this._mockCameras.includes(cid)
            ? cid
            : this._mockCameras[0];
          if (window.__markeyeApp) {
            window.__markeyeApp._mockCameras = this._mockCameras;
            window.__markeyeApp._mockCameraId = this._mockCameraId;
          }
        }
      }
      return { ok: true, mock: true };
    }
    return { ok: true, mock: true, path, body };
  }

  async get(path) {
    await this._delay(50);
    if (path === "/api/config/list") {
      return { profiles: this._profileList() };
    }
    const wm = path.match(/^\/api\/wizard\/step\/(\d+)$/);
    if (wm) {
      const key = `${this._activeProfile}:step${wm[1]}`;
      const stored = this._wizardData[key] || {};
      if (wm[1] === "4") {
        const step3 = this._wizardData[`${this._activeProfile}:step3`] || {};
        const tools = Array.isArray(stored.tools)
          ? stored.tools
          : Array.isArray(step3.tools)
            ? step3.tools
            : [];
        if (!stored.output) {
          return {
            ...stored,
            tools,
            io: stored.io || {
              enabled: false,
              transport: "rtu",
              comprehensive_logic: 1,
              trerr_enabled: true,
              output_assignments: ["link_ok", "result_ng", "off", "off", "off", "off", "off", "off"],
              input_assignments: ["trigger", "off", "off", "off", "off", "off", "off", "off"],
            },
            output: {
              save_policy: "none",
              history: {
                enabled: false,
                format: "csv",
                dir: "output/history/",
                flush_on_profile_switch: true,
                flush_on_idle_minutes: 50,
              },
            },
          };
        }
        return { ...stored, tools };
      }
      return stored;
    }
    if (path === "/api/io/status") {
      return this._mockIoStatus();
    }
    if (path === "/api/device") {
      return {
        model: "MarkEye-Cam",
        name: "MarkEye-01",
        ip: "127.0.0.1",
        mac: "00:00:00:00:00:01",
        app: { version: "1.0" },
      };
    }
    if (path === "/api/camera/options") {
      return {
        cameras: this._mockCameras,
        camera_id: this._mockCameraId,
        connected: this._connected,
        mock: true,
      };
    }
    if (path === "/api/cameras/enumerate") {
      return {
        count: 2,
        devices: [
          {
            device_id: 0,
            model: "Mock USB Camera A",
            backend: "MOCK",
            width: 1920,
            height: 1080,
            accessible: true,
          },
          {
            device_id: 1,
            model: "Mock USB Camera B",
            backend: "MOCK",
            width: 1280,
            height: 720,
            accessible: true,
          },
        ],
        mock: true,
      };
    }
    if (path.startsWith("/api/calibration/master/status")) {
      const { hasMockMaster } = await import("./mock-data.js");
      return {
        profile: this._activeProfile,
        masters_dir: `mock/localStorage/${this._activeProfile}`,
        slots: { 0: hasMockMaster(0), 1: hasMockMaster(1) },
      };
    }
    if (path.startsWith("/api/calibration/master/image")) {
      const camMatch = path.match(/[?&]cam=(\d+)/);
      const slot = camMatch ? parseInt(camMatch[1], 10) : 0;
      const img = getMockMasterImage(slot);
      if (!img) throw new Error("404");
      return img;
    }
    if (path.startsWith("/api/cameras/live")) {
      const img = getMockMasterImage() || { image_base64: "", width: 800, height: 500 };
      return img;
    }
    if (path.startsWith("/api/cameras/snapshot")) {
      const img = captureMockMasterFromLive(0);
      const devMatch = path.match(/[?&]device_id=(\d+)/);
      const deviceId = devMatch ? parseInt(devMatch[1], 10) : 0;
      return { ...img, device_id: deviceId, cam: 0 };
    }
    return { ok: true, mock: true, path, state: getMockState() };
  }

  async trigger(options = {}) {
    if (!this._connected) return null;
    const frame = triggerMockFrame();
    this.onFrame(frame);
    return frame;
  }

  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

class RealApiClient {
  constructor(handlers) {
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange || (() => {});
    this.onProfileSwitch = handlers.onProfileSwitch || (() => {});
    this._base = apiBase();
    this._ws = null;
    this._connected = false;
    this._reconnectTimer = null;
  }

  start() {
    if (this._ws && this._ws.readyState !== WebSocket.CLOSED) return;
    this._ws = null;
    this._connectWs();
  }

  stop() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
    this._setConnected(false);
  }

  reconnect() {
    this.stop();
    this.start();
  }

  async pullCurrentFrame() {
    try {
      const data = await this.get("/api/frame/current");
      if (data?.type === "frame") this.onFrame(data);
    } catch {
      /* 后端未就绪时忽略 */
    }
  }

  _connectWs() {
    try {
      this._ws = new WebSocket(wsUrl());
      this._ws.onopen = () => {
        this._setConnected(true);
        this.pullCurrentFrame();
      };
      this._ws.onclose = () => {
        this._ws = null;
        this._setConnected(false);
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => this._connectWs(), 2000);
      };
      this._ws.onerror = () => this._setConnected(false);
      this._ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "profile_switch") this.onProfileSwitch(data);
          else if (data.type === "frame") this.onFrame(data);
        } catch (err) {
          console.warn("WebSocket frame parse error", err);
        }
      };
    } catch {
      this._setConnected(false);
    }
  }

  _setConnected(connected) {
    if (this._connected === connected) return;
    this._connected = connected;
    this.onConnectionChange(connected);
  }

  _wsConnected() {
    return Boolean(this._ws && this._ws.readyState === WebSocket.OPEN);
  }

  async post(path, body = {}) {
    const res = await fetch(this._base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          detail = data?.detail || data?.error || text;
        } catch {
          detail = text;
        }
      } catch {
        /* ignore */
      }
      throw new Error(`${path} ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await res.json();
    // /api/trigger 已通过 WebSocket broadcast；避免 HTTP+WS 双通道重复 onFrame
    const skipFrame = path === "/api/trigger" && this._wsConnected();
    if (data.type === "frame" && !skipFrame) this.onFrame(data);
    return data;
  }

  async get(path) {
    const res = await fetch(this._base + path);
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          detail = data?.detail || data?.error || text;
        } catch {
          detail = text;
        }
      } catch {
        /* ignore */
      }
      throw new Error(`${path} ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  async put(path, body) {
    const res = await fetch(this._base + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          detail = data?.detail || data?.error || text;
        } catch {
          detail = text;
        }
      } catch {
        /* ignore */
      }
      throw new Error(`${path} ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  async trigger(options = {}) {
    const body = options.continuous ? { continuous: true } : {};
    return this.post("/api/trigger", body);
  }
}

export class ApiClient {
  constructor(handlers) {
    this._impl = isMockMode()
      ? new MockApiClient(handlers)
      : new RealApiClient(handlers);
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange;
    this.onProfileSwitch = handlers.onProfileSwitch || (() => {});
  }

  get _connected() {
    return this._impl._connected;
  }

  start() {
    return this._impl.start();
  }

  stop() {
    return this._impl.stop();
  }

  reconnect() {
    return this._impl.reconnect();
  }

  pullCurrentFrame() {
    return this._impl.pullCurrentFrame?.();
  }

  post(path, body) {
    return this._impl.post(path, body);
  }

  get(path) {
    return this._impl.get(path);
  }

  put(path, body) {
    return this._impl.put?.(path, body);
  }

  trigger(options = {}) {
    return this._impl.trigger(options);
  }

  startLivePreview() {
    return this._impl.startLivePreview?.();
  }

  stopLivePreview() {
    return this._impl.stopLivePreview?.();
  }
}

export { apiBase };

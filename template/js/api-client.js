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

  async post(path, body = {}) {
    await this._delay(80);
    if (path === "/api/trigger") {
      const frame = triggerMockFrame();
      this.onFrame(frame);
      return frame;
    }
    if (path === "/api/stats/reset") {
      const { resetMockStats } = await import("./mock-data.js");
      resetMockStats();
      this.onFrame(createIdleFrame());
    }
    if (path === "/api/calibration/master") {
      const slot = parseInt(body?.cam, 10) || 0;
      captureMockMasterFromLive(slot);
      return { ok: true, calibration: { sample_count: getMockState().sampleCount } };
    }
    if (path === "/api/config/switch") {
      const name = body?.name;
      if (name) this._activeProfile = name;
      return { ok: true, active: this._activeProfile };
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
      return this._wizardData[key] || {};
    }
    if (path === "/api/camera/options") {
      return {
        cameras: this._mockCameras,
        camera_id: this._mockCameraId,
        connected: this._connected,
        mock: true,
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
    return { ok: true, mock: true, path, state: getMockState() };
  }

  async trigger() {
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
          if (data.type === "frame") this.onFrame(data);
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

  async post(path, body = {}) {
    const res = await fetch(this._base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    const data = await res.json();
    if (data.type === "frame") this.onFrame(data);
    return data;
  }

  async get(path) {
    const res = await fetch(this._base + path);
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  async put(path, body) {
    const res = await fetch(this._base + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  async trigger() {
    return this.post("/api/trigger");
  }
}

export class ApiClient {
  constructor(handlers) {
    this._impl = isMockMode()
      ? new MockApiClient(handlers)
      : new RealApiClient(handlers);
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange;
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

  trigger() {
    return this._impl.trigger();
  }

  startLivePreview() {
    return this._impl.startLivePreview?.();
  }

  stopLivePreview() {
    return this._impl.stopLivePreview?.();
  }
}

export { apiBase };

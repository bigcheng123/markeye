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
      const img = captureMockMasterFromLive();
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
    return { ok: true, mock: true, path, body, state: getMockState() };
  }

  async put(path, body = {}) {
    await this._delay(80);
    const m = path.match(/^\/api\/wizard\/step\/(\d+)$/);
    if (m) {
      const step = m[1];
      const key = `${this._activeProfile}:step${step}`;
      this._wizardData[key] = { ...(this._wizardData[key] || {}), ...body };
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
    if (path === "/api/calibration/master/image") {
      const img = getMockMasterImage();
      if (!img) throw new Error("404");
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

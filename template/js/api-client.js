/** WebSocket / REST 客户端 — 真实后端 + ?mock=1 回退 */

import {
  createMockFrame,
  createIdleFrame,
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
  }

  start() {
    this._setConnected(true);
    this.onFrame(createIdleFrame());
  }

  stop() {
    this._setConnected(false);
  }

  reconnect() {
    this.start();
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
    return { ok: true, mock: true, path, body, state: getMockState() };
  }

  async get(path) {
    await this._delay(50);
    if (path === "/api/config/list") {
      return { profiles: [{ id: "config", name: "config.yaml", active: true }] };
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
    this._connectWs();
  }

  stop() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setConnected(false);
  }

  reconnect() {
    this.stop();
    this.start();
  }

  _connectWs() {
    try {
      this._ws = new WebSocket(wsUrl());
      this._ws.onopen = () => this._setConnected(true);
      this._ws.onclose = () => {
        this._setConnected(false);
        this._reconnectTimer = setTimeout(() => this._connectWs(), 2000);
      };
      this._ws.onerror = () => this._setConnected(false);
      this._ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "frame") this.onFrame(data);
        } catch {
          /* ignore */
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
}

export { apiBase };

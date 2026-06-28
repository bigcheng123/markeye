/** WebSocket / REST 客户端；默认 Mock 模式 */

import { createMockFrame } from "./mock-data.js";

const DEFAULT_WS_URL = "ws://localhost:8765/ws/frame";
const MOCK_INTERVAL_MS = 800;

export class ApiClient {
  /**
   * @param {{ onFrame: (data: object) => void, onConnectionChange?: (connected: boolean) => void }} handlers
   * @param {{ mock?: boolean, wsUrl?: string }} options
   */
  constructor(handlers, options = {}) {
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange || (() => {});
    this.mock = options.mock !== false;
    this.wsUrl = options.wsUrl || DEFAULT_WS_URL;
    this._ws = null;
    this._mockTimer = null;
    this._reconnectTimer = null;
    this._connected = false;
  }

  start() {
    if (this.mock) {
      this._setConnected(true);
      this._mockTimer = setInterval(() => {
        this.onFrame(createMockFrame());
      }, MOCK_INTERVAL_MS);
      this.onFrame(createMockFrame());
      return;
    }
    this._connectWs();
  }

  stop() {
    if (this._mockTimer) {
      clearInterval(this._mockTimer);
      this._mockTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setConnected(false);
  }

  _connectWs() {
    try {
      this._ws = new WebSocket(this.wsUrl);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => this._setConnected(true);

    this._ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "frame") {
          this.onFrame(data);
        }
      } catch {
        /* ignore malformed */
      }
    };

    this._ws.onclose = () => {
      this._setConnected(false);
      this._scheduleReconnect();
    };

    this._ws.onerror = () => {
      this._ws?.close();
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectWs();
    }, 3000);
  }

  _setConnected(connected) {
    if (this._connected === connected) return;
    this._connected = connected;
    this.onConnectionChange(connected);
  }

  async post(path, body = {}) {
    if (this.mock) {
      return { ok: true, mock: true, path, body };
    }
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }
}

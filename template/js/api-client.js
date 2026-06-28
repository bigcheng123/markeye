/** 纯前端 Mock API（Python 后端已断开） */

import {
  createMockFrame,
  createIdleFrame,
  triggerMockFrame,
  getMockState,
} from "./mock-data.js";

export class ApiClient {
  /**
   * @param {{ onFrame: (data: object) => void, onConnectionChange?: (connected: boolean) => void }} handlers
   */
  constructor(handlers) {
    this.onFrame = handlers.onFrame;
    this.onConnectionChange = handlers.onConnectionChange || (() => {});
    this._connected = false;
    this._streaming = false;
    this._streamTimer = null;
  }

  start() {
    this._setConnected(true);
    this._streaming = true;
    this.onFrame(createIdleFrame());
  }

  stop() {
    this._streaming = false;
    if (this._streamTimer) {
      clearInterval(this._streamTimer);
      this._streamTimer = null;
    }
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
    return { ok: true, mock: true, path, body, state: getMockState() };
  }

  async get(path) {
    await this._delay(50);
    return { ok: true, mock: true, path, state: getMockState() };
  }

  /** 软触发：模拟一次检测帧 */
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

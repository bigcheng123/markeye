/** 图像视口：Canvas + SVG 叠加 + OK/NG 徽章 */

import { drawPlaceholderScene } from "./mock-data.js";

const COLOR_OK = "#00B050";
const COLOR_NG = "#E74C3C";

export class ImageViewer {
  constructor(rootEl) {
    this.root = rootEl;
    this.canvas = rootEl.querySelector("#frame-canvas");
    this.svg = rootEl.querySelector("#overlay-svg");
    this.placeholder = rootEl.querySelector("#viewport-placeholder");
    this.verdictBadge = document.querySelector("#verdict-badge");
    this.zoomLabel = document.querySelector("#zoom-label");
    this.ctx = this.canvas.getContext("2d");

    this.scale = 1;
    this.imgWidth = 800;
    this.imgHeight = 500;
    this.processMode = "overlay";
    this._lastMarks = [];
    this._lastToolRois = [];
    this._lastOriginalB64 = "";
    this._lastBinaryB64 = "";
    this._hasFrame = false;
    this._loadSeq = 0;
    this._reuseImg = new Image();
    this._loadedCacheKey = "";
    this._hsvMatchPreview = { active: false, sourceData: null };

    this._marksLayer = null;
    this._roiLayer = null;
    this._roiEdit = {
      active: false,
      dragging: false,
      mode: "move",
      shape: "rect",
      handles: "none",
      roi: null,
      allowPick: false,
      onRoiChange: null,
      onPickPixel: null,
      activeCorner: null,
      anchor: null,
      _start: null,
      _dragOffset: null,
    };

    this._ensureSvgLayers();
    this._bindRoiEditorEvents();
    this._bindToolbar();
    drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, "original");
    window.addEventListener("resize", () => this._render());
  }

  _ensureSvgLayers() {
    if (!this.svg) return;
    const ns = "http://www.w3.org/2000/svg";
    if (!this._marksLayer) {
      this._marksLayer = document.createElementNS(ns, "g");
      this._marksLayer.setAttribute("data-layer", "marks");
      this.svg.appendChild(this._marksLayer);
    }
    if (!this._roiLayer) {
      this._roiLayer = document.createElementNS(ns, "g");
      this._roiLayer.setAttribute("data-layer", "roi");
      this.svg.appendChild(this._roiLayer);
    }
  }

  _clientToImageXY(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((clientX - rect.left) / rect.width) * this.imgWidth;
    const y = ((clientY - rect.top) / rect.height) * this.imgHeight;
    return { x: Math.max(0, Math.min(this.imgWidth - 1, x)), y: Math.max(0, Math.min(this.imgHeight - 1, y)) };
  }

  _rgbToHsvOpenCv(r, g, b) {
    // r,g,b: 0..255 -> OpenCV HSV: H 0..180, S/V 0..255
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return [Math.round(h / 2), Math.round(s * 255), Math.round(v * 255)];
  }

  _pickPixelHsvAt(imgX, imgY) {
    try {
      const x = Math.max(0, Math.min(this.imgWidth - 1, Math.floor(imgX)));
      const y = Math.max(0, Math.min(this.imgHeight - 1, Math.floor(imgY)));
      const d = this.ctx.getImageData(x, y, 1, 1).data;
      return this._rgbToHsvOpenCv(d[0], d[1], d[2]);
    } catch {
      return null;
    }
  }

  _hsvInRange(h, s, v, lower, upper) {
    if (s < lower[1] || s > upper[1] || v < lower[2] || v > upper[2]) return false;
    const lo = lower[0];
    const hi = upper[0];
    if (lo <= hi) return h >= lo && h <= hi;
    return h >= lo || h <= hi;
  }

  /** 统计 ROI 内符合 HSV 范围的像素面积（px） */
  computeHsvAreaInRoi({ roi, hLower, hUpper }) {
    if (!this._hasFrame || !roi) return null;
    const lower = (hLower || [0, 0, 0]).map((n) => Number(n));
    const upper = (hUpper || [180, 255, 255]).map((n) => Number(n));
    if (lower.length < 3 || upper.length < 3) return null;

    let match = 0;
    let total = 0;

    const countPixel = (r, g, b) => {
      total += 1;
      const [h, s, v] = this._rgbToHsvOpenCv(r, g, b);
      if (this._hsvInRange(h, s, v, lower, upper)) match += 1;
    };

    if (roi.shape === "circle") {
      const cx = roi.cx || 0;
      const cy = roi.cy || 0;
      const r = Math.max(1, roi.r || 1);
      const x0 = Math.max(0, Math.floor(cx - r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const x1 = Math.min(this.imgWidth, Math.ceil(cx + r + 1));
      const y1 = Math.min(this.imgHeight, Math.ceil(cy + r + 1));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return { match: 0, total: 0, ratio: 0 };
      const data = this.ctx.getImageData(x0, y0, w, h).data;
      const r2 = r * r;
      for (let yy = 0; yy < h; yy += 1) {
        for (let xx = 0; xx < w; xx += 1) {
          const gx = x0 + xx;
          const gy = y0 + yy;
          const dx = gx - cx;
          const dy = gy - cy;
          if (dx * dx + dy * dy > r2) continue;
          const i = (yy * w + xx) * 4;
          countPixel(data[i], data[i + 1], data[i + 2]);
        }
      }
    } else {
      const x0 = Math.max(0, Math.floor(roi.x || 0));
      const y0 = Math.max(0, Math.floor(roi.y || 0));
      const x1 = Math.min(this.imgWidth, Math.floor((roi.x || 0) + (roi.w || 1)));
      const y1 = Math.min(this.imgHeight, Math.floor((roi.y || 0) + (roi.h || 1)));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return { match: 0, total: 0, ratio: 0 };
      const data = this.ctx.getImageData(x0, y0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        countPixel(data[i], data[i + 1], data[i + 2]);
      }
    }

    return { match, total, ratio: total > 0 ? match / total : 0 };
  }

  /** 清除 HSV 匹配像素预览，恢复原图 */
  clearHsvMatchPreview() {
    if (this._hsvMatchPreview?.sourceData && this._hasFrame) {
      this.ctx.putImageData(this._hsvMatchPreview.sourceData, 0, 0);
      this._render();
    }
    this._hsvMatchPreview = { active: false, sourceData: null };
  }

  /** 在画面上仅显示 ROI 内符合 HSV 的像素（其余为黑） */
  setHsvMatchPreview({ active, roi, hLower, hUpper } = {}) {
    if (!active) {
      this.clearHsvMatchPreview();
      return false;
    }
    if (!this._hasFrame || !roi) return false;

    const w = this.imgWidth;
    const h = this.imgHeight;
    if (!this._hsvMatchPreview?.sourceData) {
      this._hsvMatchPreview = {
        active: true,
        sourceData: this.ctx.getImageData(0, 0, w, h),
      };
    } else {
      this.ctx.putImageData(this._hsvMatchPreview.sourceData, 0, 0);
    }

    const lower = (hLower || [0, 0, 0]).map((n) => Number(n));
    const upper = (hUpper || [180, 255, 255]).map((n) => Number(n));
    if (lower.length < 3 || upper.length < 3) return false;

    const src = this._hsvMatchPreview.sourceData;
    const out = new ImageData(w, h);
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 255;
    }

    const paintMatch = (gx, gy, si) => {
      const [hr, s, v] = this._rgbToHsvOpenCv(src.data[si], src.data[si + 1], src.data[si + 2]);
      if (!this._hsvInRange(hr, s, v, lower, upper)) return;
      const oi = (gy * w + gx) * 4;
      out.data[oi] = src.data[si];
      out.data[oi + 1] = src.data[si + 1];
      out.data[oi + 2] = src.data[si + 2];
      out.data[oi + 3] = 255;
    };

    if (roi.shape === "circle") {
      const cx = roi.cx || 0;
      const cy = roi.cy || 0;
      const r = Math.max(1, roi.r || 1);
      const x0 = Math.max(0, Math.floor(cx - r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const x1 = Math.min(w, Math.ceil(cx + r + 1));
      const y1 = Math.min(h, Math.ceil(cy + r + 1));
      const rw = x1 - x0;
      const rh = y1 - y0;
      if (rw <= 0 || rh <= 0) return false;
      const r2 = r * r;
      for (let yy = 0; yy < rh; yy += 1) {
        for (let xx = 0; xx < rw; xx += 1) {
          const gx = x0 + xx;
          const gy = y0 + yy;
          if ((gx - cx) ** 2 + (gy - cy) ** 2 > r2) continue;
          paintMatch(gx, gy, (gy * w + gx) * 4);
        }
      }
    } else {
      const x0 = Math.max(0, Math.floor(roi.x || 0));
      const y0 = Math.max(0, Math.floor(roi.y || 0));
      const x1 = Math.min(w, Math.floor((roi.x || 0) + (roi.w || 1)));
      const y1 = Math.min(h, Math.floor((roi.y || 0) + (roi.h || 1)));
      const rw = x1 - x0;
      const rh = y1 - y0;
      if (rw <= 0 || rh <= 0) return false;
      for (let yy = 0; yy < rh; yy += 1) {
        for (let xx = 0; xx < rw; xx += 1) {
          const gx = x0 + xx;
          const gy = y0 + yy;
          const si = (gy * w + gx) * 4;
          paintMatch(gx, gy, si);
        }
      }
    }

    this._hsvMatchPreview.active = true;
    this.ctx.putImageData(out, 0, 0);
    this._render();
    return true;
  }

  /** ROI 内取样：优先取高饱和度像素的中位 HSV（与后端一致） */
  sampleHsvFromRoi({ roi, minSaturation = 30 }) {
    if (!this._hasFrame || !roi) return null;
    const pixels = [];

    const pushPixel = (r, g, b) => {
      const hsv = this._rgbToHsvOpenCv(r, g, b);
      if (minSaturation <= 0 || hsv[1] >= minSaturation) pixels.push(hsv);
    };

    if (roi.shape === "circle") {
      const cx = roi.cx || 0;
      const cy = roi.cy || 0;
      const r = Math.max(1, roi.r || 1);
      const x0 = Math.max(0, Math.floor(cx - r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const x1 = Math.min(this.imgWidth, Math.ceil(cx + r + 1));
      const y1 = Math.min(this.imgHeight, Math.ceil(cy + r + 1));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return null;
      const data = this.ctx.getImageData(x0, y0, w, h).data;
      const r2 = r * r;
      for (let yy = 0; yy < h; yy += 1) {
        for (let xx = 0; xx < w; xx += 1) {
          const gx = x0 + xx;
          const gy = y0 + yy;
          if ((gx - cx) ** 2 + (gy - cy) ** 2 > r2) continue;
          const i = (yy * w + xx) * 4;
          pushPixel(data[i], data[i + 1], data[i + 2]);
        }
      }
    } else {
      const x0 = Math.max(0, Math.floor(roi.x || 0));
      const y0 = Math.max(0, Math.floor(roi.y || 0));
      const x1 = Math.min(this.imgWidth, Math.floor((roi.x || 0) + (roi.w || 1)));
      const y1 = Math.min(this.imgHeight, Math.floor((roi.y || 0) + (roi.h || 1)));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w <= 0 || h <= 0) return null;
      const data = this.ctx.getImageData(x0, y0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        pushPixel(data[i], data[i + 1], data[i + 2]);
      }
    }

    if (!pixels.length) return null;
    const median = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };
    return [
      median(pixels.map((p) => p[0])),
      median(pixels.map((p) => p[1])),
      median(pixels.map((p) => p[2])),
    ];
  }

  _isPointInRoi(x, y, roi) {
    if (!roi) return false;
    if (roi.shape === "circle") {
      const dx = x - (roi.cx || 0);
      const dy = y - (roi.cy || 0);
      return dx * dx + dy * dy <= (roi.r || 0) ** 2;
    }
    const rx = roi.x || 0;
    const ry = roi.y || 0;
    return x >= rx && x <= rx + (roi.w || 0) && y >= ry && y <= ry + (roi.h || 0);
  }

  enableRoiEditor({ roi, shape = "rect", handles = "none", allowPick = false, onRoiChange = null, onPickPixel = null } = {}) {
    this._roiEdit.active = true;
    this._roiEdit.shape = shape;
    this._roiEdit.handles = handles;
    this._roiEdit.roi = roi || (shape === "circle" ? { shape: "circle", cx: 100, cy: 100, r: 50 } : { shape: "rect", x: 100, y: 100, w: 120, h: 80 });
    this._roiEdit.allowPick = allowPick;
    this._roiEdit.onRoiChange = onRoiChange;
    this._roiEdit.onPickPixel = onPickPixel;
    this._drawRoiOverlay();
  }

  refreshRoiOverlay() {
    if (!this._roiEdit.active) return;
    this._drawRoiOverlay();
  }

  updateRoiEditor(roi) {
    if (!this._roiEdit.active || !roi) return;
    this._roiEdit.roi = structuredClone(roi);
    this._drawRoiOverlay();
  }

  _hitTolerance() {
    const scale = this.imgWidth && this.svg?.clientWidth ? this.svg.clientWidth / this.imgWidth : 1;
    return 10 / Math.max(scale, 0.01);
  }

  _hitTestRectRoi(imgX, imgY, roi) {
    const x = roi.x || 0;
    const y = roi.y || 0;
    const w = roi.w || 1;
    const h = roi.h || 1;
    const tol = this._hitTolerance();
    const corners = {
      tl: [x, y],
      tr: [x + w, y],
      br: [x + w, y + h],
      bl: [x, y + h],
    };
    for (const [name, [cx, cy]] of Object.entries(corners)) {
      if (Math.hypot(imgX - cx, imgY - cy) <= tol) return name;
    }
    if (imgX >= x && imgX <= x + w && imgY >= y && imgY <= y + h) return "inside";
    return null;
  }

  _clampRectRoi(roi) {
    const x0 = Math.max(0, Math.min(this.imgWidth - 1, roi.x));
    const y0 = Math.max(0, Math.min(this.imgHeight - 1, roi.y));
    const x1 = Math.max(x0 + 1, Math.min(this.imgWidth, roi.x + roi.w));
    const y1 = Math.max(y0 + 1, Math.min(this.imgHeight, roi.y + roi.h));
    roi.x = Math.round(x0);
    roi.y = Math.round(y0);
    roi.w = Math.max(1, Math.round(x1 - x0));
    roi.h = Math.max(1, Math.round(y1 - y0));
    return roi;
  }

  _resizeRectByCorner(roi, corner, p) {
    const ax = this._roiEdit.anchor?.x ?? roi.x;
    const ay = this._roiEdit.anchor?.y ?? roi.y;
    const x0 = Math.round(Math.min(p.x, ax));
    const y0 = Math.round(Math.min(p.y, ay));
    const x1 = Math.round(Math.max(p.x, ax));
    const y1 = Math.round(Math.max(p.y, ay));
    roi.x = x0;
    roi.y = y0;
    roi.w = Math.max(1, x1 - x0);
    roi.h = Math.max(1, y1 - y0);
    return this._clampRectRoi(roi);
  }

  _cornerAnchor(corner, roi) {
    const x = roi.x || 0;
    const y = roi.y || 0;
    const w = roi.w || 1;
    const h = roi.h || 1;
    if (corner === "tl") return { x: x + w, y: y + h };
    if (corner === "tr") return { x, y: y + h };
    if (corner === "br") return { x, y };
    if (corner === "bl") return { x: x + w, y };
    return { x, y };
  }

  disableRoiEditor() {
    this.clearHsvMatchPreview();
    this._roiEdit.active = false;
    this._roiEdit.dragging = false;
    this._roiEdit._start = null;
    this._roiEdit._dragOffset = null;
    this._roiEdit.onRoiChange = null;
    this._roiEdit.onPickPixel = null;
    if (this._roiLayer) this._roiLayer.innerHTML = "";
  }

  _drawRoiOverlay() {
    if (!this._roiLayer) return;
    this._roiLayer.innerHTML = "";
    if (!this._roiEdit.active || !this._roiEdit.roi) return;
    const ns = "http://www.w3.org/2000/svg";
    const roi = this._roiEdit.roi;
    const scaleX = this.imgWidth ? this.svg.clientWidth / this.imgWidth : 1;
    const scaleY = this.imgHeight ? this.svg.clientHeight / this.imgHeight : 1;
    const stroke = "#ff9900";
    const strokeW = 2;

    if (roi.shape === "circle") {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", String((roi.cx || 0) * scaleX));
      c.setAttribute("cy", String((roi.cy || 0) * scaleY));
      c.setAttribute("r", String((roi.r || 1) * Math.min(scaleX, scaleY)));
      c.setAttribute("fill", "rgba(255,153,0,0.12)");
      c.setAttribute("stroke", stroke);
      c.setAttribute("stroke-width", String(strokeW));
      this._roiLayer.appendChild(c);
    } else {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String((roi.x || 0) * scaleX));
      r.setAttribute("y", String((roi.y || 0) * scaleY));
      r.setAttribute("width", String((roi.w || 1) * scaleX));
      r.setAttribute("height", String((roi.h || 1) * scaleY));
      r.setAttribute("fill", "rgba(255,153,0,0.12)");
      r.setAttribute("stroke", stroke);
      r.setAttribute("stroke-width", String(strokeW));
      this._roiLayer.appendChild(r);

      if (this._roiEdit.handles === "corners") {
        const corners = [
          [roi.x, roi.y],
          [roi.x + roi.w, roi.y],
          [roi.x + roi.w, roi.y + roi.h],
          [roi.x, roi.y + roi.h],
        ];
        for (const [cx, cy] of corners) {
          const h = document.createElementNS(ns, "circle");
          h.setAttribute("cx", String(cx * scaleX));
          h.setAttribute("cy", String(cy * scaleY));
          h.setAttribute("r", "6");
          h.setAttribute("fill", stroke);
          h.setAttribute("stroke", "#fff");
          h.setAttribute("stroke-width", "1.5");
          this._roiLayer.appendChild(h);
        }
      }
    }
  }

  _bindRoiEditorEvents() {
    if (!this.svg) return;
    const onDown = (e) => {
      if (!this._roiEdit.active) return;
      const p = this._clientToImageXY(e.clientX, e.clientY);
      if (!p) return;
      this._roiEdit.dragging = true;
      this._roiEdit._start = p;
      const roi = this._roiEdit.roi;
      const useCorners = this._roiEdit.handles === "corners" && roi?.shape !== "circle";

      if (useCorners) {
        const hit = this._hitTestRectRoi(p.x, p.y, roi);
        if (hit && hit !== "inside") {
          this._roiEdit.mode = "resize-corner";
          this._roiEdit.activeCorner = hit;
          this._roiEdit.anchor = this._cornerAnchor(hit, roi);
          e.preventDefault();
          return;
        }
        if (hit === "inside") {
          this._roiEdit.mode = "move";
          this._roiEdit._dragOffset = { dx: (roi.x || 0) - p.x, dy: (roi.y || 0) - p.y };
          e.preventDefault();
          return;
        }
        this._roiEdit.mode = "draw";
        this._roiEdit.roi = { shape: "rect", x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 };
        this._roiEdit.anchor = { x: Math.round(p.x), y: Math.round(p.y) };
        this._drawRoiOverlay();
        this._roiEdit.onRoiChange?.(structuredClone(this._roiEdit.roi));
        e.preventDefault();
        return;
      }

      this._roiEdit.mode = e.shiftKey ? "draw" : "move";
      if (this._roiEdit.mode === "draw") {
        if (this._roiEdit.shape === "circle") {
          this._roiEdit.roi = { shape: "circle", cx: Math.round(p.x), cy: Math.round(p.y), r: 1 };
        } else {
          this._roiEdit.roi = { shape: "rect", x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 };
        }
        this._drawRoiOverlay();
        this._roiEdit.onRoiChange?.(structuredClone(this._roiEdit.roi));
        e.preventDefault();
        return;
      }
      if (roi?.shape === "circle") {
        this._roiEdit._dragOffset = { dx: (roi.cx || 0) - p.x, dy: (roi.cy || 0) - p.y };
      } else {
        this._roiEdit._dragOffset = { dx: (roi.x || 0) - p.x, dy: (roi.y || 0) - p.y };
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!this._roiEdit.active || !this._roiEdit.dragging) return;
      const p = this._clientToImageXY(e.clientX, e.clientY);
      if (!p) return;
      const roi = this._roiEdit.roi;
      const start = this._roiEdit._start;
      if (!roi || !start) return;

      if (this._roiEdit.mode === "resize-corner" && roi.shape !== "circle") {
        this._resizeRectByCorner(roi, this._roiEdit.activeCorner, p);
      } else if (this._roiEdit.mode === "draw") {
        if (roi.shape === "circle") {
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          roi.r = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        } else if (this._roiEdit.handles === "corners" && this._roiEdit.anchor) {
          this._resizeRectByCorner(roi, "br", p);
        } else {
          const x0 = Math.round(Math.min(start.x, p.x));
          const y0 = Math.round(Math.min(start.y, p.y));
          const x1 = Math.round(Math.max(start.x, p.x));
          const y1 = Math.round(Math.max(start.y, p.y));
          roi.x = x0;
          roi.y = y0;
          roi.w = Math.max(1, x1 - x0);
          roi.h = Math.max(1, y1 - y0);
        }
      } else {
        const off = this._roiEdit._dragOffset || { dx: 0, dy: 0 };
        if (roi.shape === "circle") {
          roi.cx = Math.round(p.x + off.dx);
          roi.cy = Math.round(p.y + off.dy);
        } else {
          roi.x = Math.round(p.x + off.dx);
          roi.y = Math.round(p.y + off.dy);
          this._clampRectRoi(roi);
        }
      }
      this._drawRoiOverlay();
      this._roiEdit.onRoiChange?.(structuredClone(roi));
      e.preventDefault();
    };
    const onUp = (e) => {
      if (!this._roiEdit.active) return;
      const p = this._clientToImageXY(e.clientX, e.clientY);
      if (p && this._roiEdit.allowPick) {
        const hsv = this._pickPixelHsvAt(p.x, p.y);
        if (hsv) this._roiEdit.onPickPixel?.({ x: Math.round(p.x), y: Math.round(p.y), hsv });
      }
      this._roiEdit.dragging = false;
      this._roiEdit.mode = "move";
      this._roiEdit.activeCorner = null;
      this._roiEdit.anchor = null;
      this._roiEdit._start = null;
      this._roiEdit._dragOffset = null;
    };

    this.svg.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  _bindToolbar() {
    document.querySelector("#btn-zoom-in")?.addEventListener("click", () => {
      this.scale = Math.min(this.scale + 0.1, 3);
      this._render();
    });
    document.querySelector("#btn-zoom-out")?.addEventListener("click", () => {
      this.scale = Math.max(this.scale - 0.1, 0.2);
      this._render();
    });
    document.querySelector("#btn-fit")?.addEventListener("click", () => {
      this.fitToScreen();
    });
    document.querySelector("#process-mode")?.addEventListener("change", (e) => {
      this.processMode = e.target.value;
      this._applyDisplayMode();
    });
  }

  _resolveImageB64() {
    if (this.processMode === "binary") {
      return this._lastBinaryB64 || this._lastOriginalB64;
    }
    return this._lastOriginalB64;
  }

  _applyDisplayMode() {
    this._loadedCacheKey = "";
    const b64 = this._resolveImageB64();
    if (b64) {
      this._drawBase64Image(b64, {
        waiting: false,
        onReady: () => {
          this._ensureVisibleScale();
          this._render();
        },
      });
      return;
    }
    this._redrawScene();
  }

  fitToScreen() {
    const wrap = this.root;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (!cw || !ch || !this.imgWidth || !this.imgHeight) return;
    this.scale = Math.min(cw / this.imgWidth, ch / this.imgHeight, 1);
    if (this.scale <= 0) this.scale = 1;
    this._render();
  }

  _ensureVisibleScale() {
    if (this.scale <= 0.01) this.fitToScreen();
    if (this.scale <= 0.01) this.scale = 1;
  }

  setWaiting(waiting, { livePreview = false } = {}) {
    if (this.placeholder) {
      const show = waiting && !livePreview;
      this.placeholder.classList.toggle("is-hidden", !show);
      this.placeholder.textContent = show ? "正在等待触发……" : "";
    }
  }

  _markColor(passed) {
    if (passed === false) return COLOR_NG;
    return COLOR_OK;
  }

  /** 更新工具栏综合判定 OK/NG 徽标（触发结果帧） */
  updateVerdict(data) {
    if (!this.verdictBadge) return;
    if (data?.idle || data?.overall?.passed == null) return;
    const ok = Boolean(data.overall.passed);
    this.verdictBadge.hidden = false;
    this.verdictBadge.textContent = ok ? "OK" : "NG";
    this.verdictBadge.className = `verdict-badge verdict-badge--${ok ? "ok" : "ng"}`;
  }

  clearVerdict() {
    if (!this.verdictBadge) return;
    this.verdictBadge.hidden = true;
    this.verdictBadge.textContent = "";
    this.verdictBadge.className = "verdict-badge";
  }

  _drawBase64Image(b64, { waiting = false, livePreview = false, onReady = null } = {}) {
    const finish = (loaded = false) => {
      this.setWaiting(waiting, { livePreview: loaded && livePreview });
      if (onReady) onReady();
      else this._render();
    };

    if (!b64) {
      this._loadedCacheKey = "";
      this._hasFrame = false;
      this._redrawScene();
      finish(false);
      return;
    }

    const cacheKey = `${this.processMode}:${b64}`;
    if (cacheKey === this._loadedCacheKey) {
      finish(true);
      return;
    }

    const seq = ++this._loadSeq;
    this._reuseImg.onload = () => {
      if (seq !== this._loadSeq) return;
      this.canvas.width = this._reuseImg.width;
      this.canvas.height = this._reuseImg.height;
      this.imgWidth = this._reuseImg.width;
      this.imgHeight = this._reuseImg.height;
      this._hsvMatchPreview = { active: false, sourceData: null };
      this.ctx.drawImage(this._reuseImg, 0, 0);
      this._loadedCacheKey = cacheKey;
      this._hasFrame = true;
      this._ensureVisibleScale();
      finish(true);
    };
    this._reuseImg.onerror = () => {
      if (seq !== this._loadSeq) return;
      this._loadedCacheKey = "";
      this._hasFrame = false;
      this._redrawScene();
      finish(false);
    };
    this._reuseImg.src = `data:image/jpeg;base64,${b64}`;
  }

  updateFrame(data) {
    const isDetectionResult = !data.idle && data.overall?.passed != null;
    if (isDetectionResult) {
      this._loadedCacheKey = "";
    }

    this._lastToolRois = data.tool_rois || [];
    const frame = data.frame || {};
    const prevOriginal = this._lastOriginalB64;
    const prevBinary = this._lastBinaryB64;
    const nextOriginal = frame.original_base64 || frame.image_base64 || "";
    const nextBinary = frame.binary_base64 || "";

    // 空 idle 帧（如统计复位）不带图像字段，保留上一帧缓存避免黑屏
    if (nextOriginal) this._lastOriginalB64 = nextOriginal;
    if (nextBinary) this._lastBinaryB64 = nextBinary;

    const frameChanged =
      (nextOriginal && nextOriginal !== prevOriginal) ||
      (nextBinary && nextBinary !== prevBinary);

    if (frame.width) this.imgWidth = frame.width;
    if (frame.height) this.imgHeight = frame.height;

    if (frameChanged) {
      this._loadedCacheKey = "";
    }

    const b64 = this._resolveImageB64();
    const hasDisplayImage = Boolean(b64);
    const isLiveIdle = Boolean(data.idle);

    if (isLiveIdle) {
      this._lastMarks = data.marks || [];
      if (hasDisplayImage) {
        this._drawBase64Image(b64, {
          waiting: true,
          livePreview: true,
          onReady: () => {
            this._ensureVisibleScale();
            this._render();
          },
        });
        return;
      }

      this._hasFrame = false;
      this._loadedCacheKey = "";
      this.setWaiting(true);
      this.canvas.width = this.imgWidth;
      this.canvas.height = this.imgHeight;
      drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, "original");
      this._ensureVisibleScale();
      this._render();
      return;
    }

    this.updateVerdict(data);
    this._lastMarks = data.marks || [];

    if (hasDisplayImage) {
      this._drawBase64Image(b64, {
        waiting: false,
        onReady: () => {
          this._ensureVisibleScale();
          this._render();
        },
      });
    } else {
      this._hasFrame = false;
      this._loadedCacheKey = "";
      this.setWaiting(false);
      this._redrawScene();
    }
  }

  _redrawScene() {
    this.canvas.width = this.imgWidth;
    this.canvas.height = this.imgHeight;
    const sceneMode = this.processMode === "binary" ? "binary" : "original";
    drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, sceneMode);
    this._render();
  }

  _render() {
    const wrap = this.root;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const displayW = this.imgWidth * this.scale;
    const displayH = this.imgHeight * this.scale;
    const tx = (cw - displayW) / 2;
    const ty = (ch - displayH) / 2;

    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;
    this.canvas.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;

    this.svg.setAttribute("width", displayW);
    this.svg.setAttribute("height", displayH);
    this.svg.style.width = `${displayW}px`;
    this.svg.style.height = `${displayH}px`;
    this.svg.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;

    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    }

    this._drawOverlays();
    this._drawRoiOverlay();
  }

  _drawOverlays() {
    this._ensureSvgLayers();
    if (this._marksLayer) this._marksLayer.innerHTML = "";

    if (!this._hasFrame) return;

    if (this.processMode === "overlay") {
      this._drawToolRois(this._lastToolRois);
    }
  }

  _drawToolRois(toolRois) {
    if (!this._marksLayer || !toolRois?.length) return;

    const scaleX = this.imgWidth ? this.svg.clientWidth / this.imgWidth : 1;
    const scaleY = this.imgHeight ? this.svg.clientHeight / this.imgHeight : 1;
    const ns = "http://www.w3.org/2000/svg";
    const stroke = "#ff9900";
    const strokeW = 2;

    for (const item of toolRois) {
      const roi = item.roi;
      if (!roi) continue;

      if (roi.shape === "circle") {
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", String((roi.cx || 0) * scaleX));
        c.setAttribute("cy", String((roi.cy || 0) * scaleY));
        c.setAttribute("r", String((roi.r || 1) * Math.min(scaleX, scaleY)));
        c.setAttribute("fill", "rgba(255,153,0,0.12)");
        c.setAttribute("stroke", stroke);
        c.setAttribute("stroke-width", String(strokeW));
        this._marksLayer.appendChild(c);
      } else {
        const r = document.createElementNS(ns, "rect");
        r.setAttribute("x", String((roi.x || 0) * scaleX));
        r.setAttribute("y", String((roi.y || 0) * scaleY));
        r.setAttribute("width", String((roi.w || 1) * scaleX));
        r.setAttribute("height", String((roi.h || 1) * scaleY));
        r.setAttribute("fill", "rgba(255,153,0,0.12)");
        r.setAttribute("stroke", stroke);
        r.setAttribute("stroke-width", String(strokeW));
        this._marksLayer.appendChild(r);

        const corners = [
          [roi.x, roi.y],
          [roi.x + roi.w, roi.y],
          [roi.x + roi.w, roi.y + roi.h],
          [roi.x, roi.y + roi.h],
        ];
        for (const [cx, cy] of corners) {
          const h = document.createElementNS(ns, "circle");
          h.setAttribute("cx", String(cx * scaleX));
          h.setAttribute("cy", String(cy * scaleY));
          h.setAttribute("r", "6");
          h.setAttribute("fill", stroke);
          h.setAttribute("stroke", "#fff");
          h.setAttribute("stroke-width", "1.5");
          this._marksLayer.appendChild(h);
        }
      }
    }
  }

  _drawMarkOverlays(marks) {
    if (!this._marksLayer || !marks.length) return;

    const scaleX = this.imgWidth ? this.svg.clientWidth / this.imgWidth : 1;
    const scaleY = this.imgHeight ? this.svg.clientHeight / this.imgHeight : 1;

    for (const mark of marks) {
      const color = this._markColor(mark.passed);
      const strokeW = 2;

      if (mark.contour?.length >= 3) {
        const points = mark.contour
          .map(([px, py]) => `${px * scaleX},${py * scaleY}`)
          .join(" ");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", points);
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", color);
        poly.setAttribute("stroke-width", String(strokeW));
        this._marksLayer.appendChild(poly);
      } else if (mark.bbox) {
        const [x, y, w, h] = mark.bbox;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x * scaleX);
        rect.setAttribute("y", y * scaleY);
        rect.setAttribute("width", w * scaleX);
        rect.setAttribute("height", h * scaleY);
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", color);
        rect.setAttribute("stroke-width", String(strokeW));
        this._marksLayer.appendChild(rect);
      }

      const [bx, by] = mark.bbox || [0, 0, 0, 0];
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", bx * scaleX);
      text.setAttribute("y", by * scaleY - 4);
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "12");
      text.textContent = mark.label || "";
      this._marksLayer.appendChild(text);
    }
  }
}

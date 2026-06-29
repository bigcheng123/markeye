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
    this._hasFrame = false;
    this._loadSeq = 0;
    this._reuseImg = new Image();
    this._lastB64 = "";

    this._marksLayer = null;
    this._roiLayer = null;
    this._roiEdit = {
      active: false,
      dragging: false,
      mode: "move",
      shape: "rect",
      roi: null,
      allowPick: false,
      onRoiChange: null,
      onPickPixel: null,
      _start: null,
      _dragOffset: null,
    };

    this._ensureSvgLayers();
    this._bindRoiEditorEvents();
    this._bindToolbar();
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

  enableRoiEditor({ roi, shape = "rect", allowPick = false, onRoiChange = null, onPickPixel = null } = {}) {
    this._roiEdit.active = true;
    this._roiEdit.shape = shape;
    this._roiEdit.roi = roi || (shape === "circle" ? { shape: "circle", cx: 100, cy: 100, r: 50 } : { shape: "rect", x: 100, y: 100, w: 120, h: 80 });
    this._roiEdit.allowPick = allowPick;
    this._roiEdit.onRoiChange = onRoiChange;
    this._roiEdit.onPickPixel = onPickPixel;
    this._drawRoiOverlay();
  }

  disableRoiEditor() {
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
      this._roiEdit.mode = e.shiftKey ? "draw" : "move";
      const roi = this._roiEdit.roi;
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

      if (this._roiEdit.mode === "draw") {
        if (roi.shape === "circle") {
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          roi.r = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
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
        // 拖动：按住鼠标移动 ROI（不做缩放手柄）
        const off = this._roiEdit._dragOffset || { dx: 0, dy: 0 };
        if (roi.shape === "circle") {
          roi.cx = Math.round(p.x + off.dx);
          roi.cy = Math.round(p.y + off.dy);
        } else {
          roi.x = Math.round(p.x + off.dx);
          roi.y = Math.round(p.y + off.dy);
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
      this._redrawScene();
    });
  }

  fitToScreen() {
    const wrap = this.root;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    this.scale = Math.min(cw / this.imgWidth, ch / this.imgHeight, 1);
    this._render();
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

  _updateVerdict(data) {
    if (!this.verdictBadge) return;
    if (!data.idle && data.overall?.passed != null) {
      const ok = data.overall.passed;
      this.verdictBadge.hidden = false;
      this.verdictBadge.textContent = ok ? "OK" : "NG";
      this.verdictBadge.className = `verdict-badge verdict-badge--${ok ? "ok" : "ng"}`;
    }
  }

  _drawBase64Image(b64, { waiting = false, livePreview = false, onReady = null } = {}) {
    const finish = () => {
      this.setWaiting(waiting, { livePreview });
      if (onReady) onReady();
      else this._render();
    };

    if (b64 === this._lastB64 && this._hasFrame) {
      finish();
      return;
    }
    this._lastB64 = b64;
    const seq = ++this._loadSeq;
    this._reuseImg.onload = () => {
      if (seq !== this._loadSeq) return;
      this.canvas.width = this._reuseImg.width;
      this.canvas.height = this._reuseImg.height;
      this.imgWidth = this._reuseImg.width;
      this.imgHeight = this._reuseImg.height;
      this.ctx.drawImage(this._reuseImg, 0, 0);
      finish();
    };
    this._reuseImg.src = `data:image/jpeg;base64,${b64}`;
  }

  updateFrame(data) {
    if (data.idle) {
      this._lastMarks = data.marks || [];
      if (data.frame?.image_base64) {
        this._hasFrame = true;
        this._drawBase64Image(data.frame.image_base64, {
          waiting: true,
          livePreview: true,
          onReady: () => this._drawOverlays(this._lastMarks),
        });
        return;
      }

      this._hasFrame = false;
      this._lastB64 = "";
      this.setWaiting(true);
      this.canvas.width = this.imgWidth;
      this.canvas.height = this.imgHeight;
      drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, "original");
      this._render();
      this._drawOverlays([]);
      return;
    }

    this._hasFrame = true;
    this._updateVerdict(data);

    if (data.frame?.width) this.imgWidth = data.frame.width;
    if (data.frame?.height) this.imgHeight = data.frame.height;
    this._lastMarks = data.marks || [];

    if (data.frame?.image_base64) {
      this._drawBase64Image(data.frame.image_base64, {
        waiting: false,
        onReady: () => this._drawOverlays(this._lastMarks),
      });
    } else {
      this.setWaiting(false);
      this._redrawScene();
    }
  }

  _redrawScene() {
    this.canvas.width = this.imgWidth;
    this.canvas.height = this.imgHeight;
    drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, this.processMode);
    this._render();
    this._drawOverlays(this._lastMarks);
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

    this._drawOverlays(this._lastMarks);
    this._drawRoiOverlay();
  }

  _drawOverlays(marks) {
    this._ensureSvgLayers();
    if (this._marksLayer) this._marksLayer.innerHTML = "";

    if (!this._hasFrame || !marks.length) return;

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

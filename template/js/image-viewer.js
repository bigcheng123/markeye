/** 图像视口：Canvas + SVG 叠加 */

import { drawPlaceholderScene } from "./mock-data.js";

export class ImageViewer {
  constructor(rootEl) {
    this.root = rootEl;
    this.canvas = rootEl.querySelector("#frame-canvas");
    this.svg = rootEl.querySelector("#overlay-svg");
    this.placeholder = rootEl.querySelector("#viewport-placeholder");
    this.zoomLabel = document.querySelector("#zoom-label");
    this.ctx = this.canvas.getContext("2d");

    this.scale = 1;
    this.imgWidth = 800;
    this.imgHeight = 500;
    this.processMode = "overlay";
    this._lastMarks = [];
    this._hasFrame = false;

    this._bindToolbar();
    window.addEventListener("resize", () => this._render());
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

  setWaiting(waiting) {
    if (this.placeholder) {
      this.placeholder.classList.toggle("is-hidden", !waiting);
      this.placeholder.textContent = waiting ? "正在等待触发……" : "";
    }
  }

  updateFrame(data) {
    if (data.idle) {
      this._hasFrame = false;
      this._lastMarks = [];
      this.setWaiting(true);
      this.canvas.width = this.imgWidth;
      this.canvas.height = this.imgHeight;
      drawPlaceholderScene(this.ctx, this.imgWidth, this.imgHeight, "original");
      this._render();
      this._drawOverlays([]);
      return;
    }

    this._hasFrame = true;
    this.setWaiting(false);

    if (data.frame?.width) this.imgWidth = data.frame.width;
    if (data.frame?.height) this.imgHeight = data.frame.height;
    this._lastMarks = data.marks || [];

    if (data.frame?.image_base64) {
      const img = new Image();
      img.onload = () => {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.imgWidth = img.width;
        this.imgHeight = img.height;
        this.ctx.drawImage(img, 0, 0);
        this._render();
      };
      img.src = `data:image/jpeg;base64,${data.frame.image_base64}`;
    } else {
      this._redrawScene();
    }

    this._drawOverlays(this._lastMarks);
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
  }

  _drawOverlays(marks) {
    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    if (!this._hasFrame || !marks.length) return;

    const scaleX = this.imgWidth ? this.svg.clientWidth / this.imgWidth : 1;
    const scaleY = this.imgHeight ? this.svg.clientHeight / this.imgHeight : 1;

    for (const mark of marks) {
      const color = mark.passed ? "#00B050" : "#E74C3C";
      const [x, y, w, h] = mark.bbox;

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x * scaleX);
      rect.setAttribute("y", y * scaleY);
      rect.setAttribute("width", w * scaleX);
      rect.setAttribute("height", h * scaleY);
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", "2");
      this.svg.appendChild(rect);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x * scaleX);
      text.setAttribute("y", y * scaleY - 4);
      text.setAttribute("fill", color);
      text.setAttribute("font-size", "12");
      text.textContent = mark.label;
      this.svg.appendChild(text);
    }
  }
}

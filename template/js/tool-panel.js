/** 右侧 Tool 列表与详情面板 */

import { getToolMeta } from "./mock-data.js";

export class ToolPanel {
  constructor() {
    this.listEl = document.querySelector("#tool-list");
    this.detailEl = document.querySelector("#tool-detail");
    this.chartCanvas = document.querySelector("#metric-chart");
    this.chartCtx = this.chartCanvas?.getContext("2d");
    this.selectedTool = "position";
    this.history = { color: [], size: [], position: [] };
    this._meta = getToolMeta();
    this._bindList();
    this._renderDetailShell();
  }

  _bindList() {
    this.listEl?.addEventListener("click", (e) => {
      const card = e.target.closest(".tool-card");
      if (!card) return;
      this.selectTool(card.dataset.tool);
    });
  }

  selectTool(tool) {
    this.selectedTool = tool;
    this.listEl?.querySelectorAll(".tool-card").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.tool === tool);
    });
    this._renderDetail(this._lastInspections, this._lastStats);
  }

  update(data) {
    this._lastInspections = data.inspections || [];
    this._lastStats = data.stats || {};

    for (const insp of this._lastInspections) {
      const arr = this.history[insp.tool];
      if (!arr) continue;
      arr.push(insp.value);
      if (arr.length > 30) arr.shift();
    }

    this._renderCards(this._lastInspections);
    this._renderDetail(this._lastInspections, this._lastStats);
  }

  _renderCards(inspections) {
    if (!this.listEl) return;
    this.listEl.innerHTML = "";

    for (const insp of inspections) {
      const meta = this._meta[insp.tool];
      if (!meta) continue;

      const state = insp.passed ? "ok" : "ng";
      const selected = insp.tool === this.selectedTool ? " is-selected" : "";
      const pct = this._valueToPercent(insp.tool, insp.value);

      const card = document.createElement("article");
      card.className = `tool-card${selected}`;
      card.dataset.tool = insp.tool;
      card.dataset.state = state;
      card.innerHTML = `
        <header class="tool-card__header">
          <span class="tool-card__id">${meta.id}</span>
          <span class="tool-card__name">${meta.name}</span>
          <span class="tool-card__verdict ${state}">${state.toUpperCase()}</span>
        </header>
        <div class="tool-card__metric">
          <label>当前值</label>
          <div class="tool-card__bar">
            <input type="range" disabled min="0" max="100" value="${pct}" />
            <span class="tool-card__value">${this._formatValue(insp)}</span>
          </div>
        </div>
      `;
      this.listEl.appendChild(card);
    }
  }

  _formatValue(insp) {
    if (insp.tool === "position") return `${insp.value} px`;
    if (insp.tool === "size") return `${insp.value}`;
    return `${insp.value}`;
  }

  _valueToPercent(tool, value) {
    const meta = this._meta[tool];
    if (!meta) return 50;
    const range = meta.max - meta.min;
    if (range <= 0) return 50;
    return Math.round(((value - meta.min) / range) * 100);
  }

  _renderDetailShell() {
    if (!this.detailEl) return;
    this.detailEl.innerHTML = `
      <div class="tool-detail__title" id="detail-title">Tool 详情</div>
      <div class="tool-detail__chart-wrap">
        <canvas id="metric-chart"></canvas>
      </div>
      <div class="tool-detail__current">
        <div>当前值</div>
        <div class="tool-detail__current-value" id="detail-current">—</div>
      </div>
      <div class="tool-detail__stats" id="detail-stats"></div>
    `;
    this.chartCanvas = this.detailEl.querySelector("#metric-chart");
    this.chartCtx = this.chartCanvas?.getContext("2d");
  }

  _renderDetail(inspections, stats) {
    const insp = (inspections || []).find((i) => i.tool === this.selectedTool);
    const meta = this._meta[this.selectedTool];
    if (!insp || !meta) return;

    const title = this.detailEl?.querySelector("#detail-title");
    const current = this.detailEl?.querySelector("#detail-current");
    const statsEl = this.detailEl?.querySelector("#detail-stats");

    if (title) title.textContent = `${meta.id}: ${meta.name}`;
    if (current) current.textContent = this._formatValue(insp);

    const hist = this.history[this.selectedTool] || [];
    const max = hist.length ? Math.max(...hist) : insp.value;
    const min = hist.length ? Math.min(...hist) : insp.value;
    const ave = hist.length
      ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length)
      : insp.value;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">OK</div><div class="tool-detail__stat-value">${stats?.ok_count ?? 0}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">NG</div><div class="tool-detail__stat-value">${stats?.ng_count ?? 0}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Max</div><div class="tool-detail__stat-value">${max}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Min</div><div class="tool-detail__stat-value">${min}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Ave</div><div class="tool-detail__stat-value">${ave}</div></div>
      `;
    }

    this._drawChart(hist.length ? hist : [insp.value]);
  }

  _drawChart(values) {
    if (!this.chartCtx || !this.chartCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.chartCanvas.parentElement.getBoundingClientRect();
    this.chartCanvas.width = rect.width * dpr;
    this.chartCanvas.height = rect.height * dpr;
    this.chartCtx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = 8;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;

    this.chartCtx.clearRect(0, 0, w, h);
    this.chartCtx.fillStyle = "#f5f5f5";
    this.chartCtx.fillRect(0, 0, w, h);

    this.chartCtx.strokeStyle = "#00B050";
    this.chartCtx.lineWidth = 2;
    this.chartCtx.beginPath();

    values.forEach((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      if (i === 0) this.chartCtx.moveTo(x, y);
      else this.chartCtx.lineTo(x, y);
    });
    this.chartCtx.stroke();

    this.chartCtx.fillStyle = "rgba(0,176,80,0.2)";
    this.chartCtx.lineTo(w - pad, h - pad);
    this.chartCtx.lineTo(pad, h - pad);
    this.chartCtx.closePath();
    this.chartCtx.fill();
  }
}

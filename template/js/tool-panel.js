/** 右侧 Tool 列表与详情（直方图 + 阈值滑块） */

import { getToolMeta, setToolThreshold } from "./mock-data.js";

export class ToolPanel {
  constructor() {
    this.listEl = document.querySelector("#tool-list");
    this.detailEl = document.querySelector("#tool-detail");
    this.selectedTool = null;
    this.history = {};
    this._meta = { ...getToolMeta() };
    this._bindList();
    this._renderDetailShell();
    this.onThresholdChange = null;
    this.onToolSelect = null;
  }

  _syncMetaFromInspections(inspections) {
    for (const insp of inspections || []) {
      const existing = this._meta[insp.tool] || {};
      this._meta[insp.tool] = {
        id: existing.id || insp.tool || "—",
        name: insp.name || existing.name || insp.tool,
        min: 0,
        max: 100,
        threshold: insp.threshold ?? existing.threshold ?? 0,
      };
    }
  }

  _bindList() {
    this.listEl?.addEventListener("click", (e) => {
      const card = e.target.closest(".tool-card");
      if (!card) return;
      this.selectTool(card.dataset.tool);
    });
  }

  selectTool(tool) {
    // 再次点击当前工具：取消选择并恢复默认画面
    if (tool && this.selectedTool === tool) {
      this.selectedTool = null;
    } else {
      this.selectedTool = tool;
    }
    this.listEl?.querySelectorAll(".tool-card").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.tool === this.selectedTool);
    });
    this._renderDetail(this._lastInspections, this._lastStats);
    this.detailEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    this.onToolSelect?.(this.selectedTool);
  }

  focusThreshold() {
    this.selectTool(this.selectedTool);
    this.detailEl?.querySelector("#detail-threshold")?.focus();
  }

  update(data) {
    this._lastInspections = data.inspections || [];
    this._lastStats = data.stats || {};
    this._syncMetaFromInspections(this._lastInspections);

    if (!this.selectedTool || !this._meta[this.selectedTool]) {
      this.selectedTool = this._lastInspections[0]?.tool || this.selectedTool;
    }

    if (!data.idle) {
      for (const insp of this._lastInspections) {
        const arr = (this.history[insp.tool] = this.history[insp.tool] || []);
        arr.push(insp.value);
        if (arr.length > 30) arr.shift();
      }
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

      const state = insp.passed === null ? "idle" : insp.passed ? "ok" : "ng";
      const selected = insp.tool === this.selectedTool ? " is-selected" : "";
      const val = insp.value ?? meta.threshold;
      const statusBadge =
        state === "ok"
          ? '<span class="tool-card__status tool-card__status--ok">OK</span>'
          : state === "ng"
            ? '<span class="tool-card__status tool-card__status--ng">NG</span>'
            : "";

      const card = document.createElement("article");
      card.className = `tool-card${selected}`;
      card.dataset.tool = insp.tool;
      card.dataset.state = state;
      card.innerHTML = `
        <header class="tool-card__header">
          <span class="tool-card__id">${meta.id}</span>
          <span class="tool-card__name">${meta.name}</span>
          ${statusBadge}
          <span class="tool-card__value">${val}</span>
        </header>
        <div class="tool-card__bar">
          <input type="range" disabled min="0" max="100" value="${val}" />
        </div>
      `;
      this.listEl.appendChild(card);
    }
  }

  _renderDetailShell() {
    if (!this.detailEl) return;
    this.detailEl.innerHTML = `
      <div class="tool-detail__title" id="detail-title">Tool 详情</div>
      <div class="tool-detail__chart-wrap">
        <canvas id="metric-chart"></canvas>
      </div>
      <div class="tool-detail__threshold">
        <label for="detail-threshold">阈值</label>
        <input type="range" id="detail-threshold" min="0" max="100" value="73" />
        <span id="detail-threshold-val">73</span>
      </div>
      <div class="tool-detail__stats" id="detail-stats"></div>
    `;

    const slider = this.detailEl.querySelector("#detail-threshold");
    slider?.addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      this.detailEl.querySelector("#detail-threshold-val").textContent = v;
      setToolThreshold(this.selectedTool, v);
      this.onThresholdChange?.(this.selectedTool, v);
      this._drawChart(this.history[this.selectedTool] || [v], v);
    });
  }

  _renderDetail(inspections, stats) {
    const insp = (inspections || []).find((i) => i.tool === this.selectedTool);
    const meta = this._meta[this.selectedTool];
    if (!meta) return;

    const title = this.detailEl?.querySelector("#detail-title");
    const statsEl = this.detailEl?.querySelector("#detail-stats");
    const slider = this.detailEl?.querySelector("#detail-threshold");
    const sliderVal = this.detailEl?.querySelector("#detail-threshold-val");

    if (title) title.textContent = `Tool ${meta.id}: ${meta.name}`;

    const threshold = insp?.threshold ?? meta.threshold;
    if (slider) slider.value = threshold;
    if (sliderVal) sliderVal.textContent = threshold;

    const hist = this.history[this.selectedTool] || [];
    const vals = hist.length ? hist : [insp?.value ?? threshold];
    const max = vals.length ? Math.max(...vals) : "—";
    const min = vals.length ? Math.min(...vals) : "—";
    const ave = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : "—";

    const toolOk = insp?.passed === true ? 1 : 0;
    const toolNg = insp?.passed === false ? 1 : 0;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">OK</div><div class="tool-detail__stat-value">${insp?.passed === null ? 0 : toolOk}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">NG</div><div class="tool-detail__stat-value">${insp?.passed === null ? 0 : toolNg}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Max</div><div class="tool-detail__stat-value">${max}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Min</div><div class="tool-detail__stat-value">${min}</div></div>
        <div class="tool-detail__stat"><div class="tool-detail__stat-label">Ave</div><div class="tool-detail__stat-value">${ave}</div></div>
      `;
    }

    this._drawChart(vals, threshold);
  }

  _drawChart(values, threshold = 73) {
    const canvas = this.detailEl?.querySelector("#metric-chart");
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const pad = 8;

    ctx.clearRect(0, 0, w, h);

    const thX = pad + (threshold / 100) * (w - pad * 2);
    ctx.fillStyle = "rgba(231,76,60,0.35)";
    ctx.fillRect(pad, pad, thX - pad, h - pad * 2);
    ctx.fillStyle = "rgba(0,176,80,0.35)";
    ctx.fillRect(thX, pad, w - pad - thX, h - pad * 2);

    ctx.strokeStyle = "#ff9900";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(thX, pad);
    ctx.lineTo(thX, h - pad);
    ctx.stroke();

    if (values.length > 1) {
      const max = Math.max(...values, 1);
      const min = Math.min(...values, 0);
      const range = max - min || 1;
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
}

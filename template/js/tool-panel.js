/** 右侧 Tool 列表与详情（直方图 + 阈值滑块） */

import { getToolMeta, setToolThreshold } from "./mock-data.js";

export class ToolPanel {
  constructor() {
    this.listEl = document.querySelector("#tool-list");
    this.detailEl = document.querySelector("#tool-detail");
    this.selectedTool = null;
    this.history = {};
    this._meta = { ...getToolMeta() };
    this._cardEls = new Map();
    this._chartRaf = null;
    this._bindList();
    this._renderDetailShell();
    this.onThresholdChange = null;
    this.onToolSelect = null;
  }

  _activeToolKeys(inspections) {
    return (inspections || []).map((insp) => insp.tool).filter(Boolean);
  }

  _syncMetaFromInspections(inspections) {
    for (const insp of inspections || []) {
      const existing = this._meta[insp.tool] || {};
      this._meta[insp.tool] = {
        id: insp.tool || existing.id || "—",
        name: insp.name || existing.name || insp.tool,
        min: 0,
        max: 100,
        threshold: insp.threshold ?? existing.threshold ?? 0,
      };
    }
    const active = new Set(this._activeToolKeys(inspections));
    for (const key of Object.keys(this._meta)) {
      if (!active.has(key)) delete this._meta[key];
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
    const activeTools = this._activeToolKeys(this._lastInspections);
    this._syncMetaFromInspections(this._lastInspections);

    if (!this.selectedTool || !activeTools.includes(this.selectedTool)) {
      this.selectedTool = activeTools[0] || null;
    }
    this._lastActiveTools = activeTools;

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

  _ensureCard(insp, meta) {
    let card = this._cardEls.get(insp.tool);
    if (!card) {
      card = document.createElement("article");
      card.className = "tool-card";
      card.dataset.tool = insp.tool;
      card.innerHTML = `
        <header class="tool-card__header">
          <span class="tool-card__id"></span>
          <span class="tool-card__name"></span>
          <span class="tool-card__status-wrap"></span>
          <span class="tool-card__value"></span>
        </header>
        <div class="tool-card__bar">
          <input type="range" disabled min="0" max="100" />
        </div>
      `;
      this._cardEls.set(insp.tool, card);
      this.listEl?.appendChild(card);
    }
    return card;
  }

  _updateCard(card, insp, meta) {
    const state = insp.passed === null ? "idle" : insp.passed ? "ok" : "ng";
    const val = insp.value ?? meta.threshold;

    card.dataset.state = state;
    card.classList.toggle("is-selected", insp.tool === this.selectedTool);

    const idEl = card.querySelector(".tool-card__id");
    const nameEl = card.querySelector(".tool-card__name");
    const statusWrap = card.querySelector(".tool-card__status-wrap");
    const valueEl = card.querySelector(".tool-card__value");
    const rangeEl = card.querySelector(".tool-card__bar input");

    if (idEl) idEl.textContent = meta.id;
    if (nameEl) nameEl.textContent = meta.name;
    if (valueEl) valueEl.textContent = String(val);
    if (rangeEl) rangeEl.value = String(val);

    if (statusWrap) {
      let badge = statusWrap.querySelector(".tool-card__status");
      if (state === "idle") {
        statusWrap.innerHTML = "";
      } else {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "tool-card__status";
          statusWrap.innerHTML = "";
          statusWrap.appendChild(badge);
        }
        badge.className = `tool-card__status tool-card__status--${state}`;
        badge.textContent = state === "ok" ? "OK" : "NG";
      }
    }
  }

  _renderCards(inspections) {
    if (!this.listEl) return;

    const active = new Set();
    for (const insp of inspections) {
      const meta = this._meta[insp.tool];
      if (!meta) continue;
      active.add(insp.tool);
      const card = this._ensureCard(insp, meta);
      this._updateCard(card, insp, meta);
    }

    for (const [tool, card] of this._cardEls) {
      if (!active.has(tool)) {
        card.remove();
        this._cardEls.delete(tool);
      }
    }

    const order = inspections.map((i) => i.tool).filter((t) => this._cardEls.has(t));
    for (const tool of order) {
      const card = this._cardEls.get(tool);
      if (card) this.listEl.appendChild(card);
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
      this._scheduleChartDraw(this.history[this.selectedTool] || [v], v);
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

    this._scheduleChartDraw(vals, threshold);
  }

  _scheduleChartDraw(values, threshold = 73) {
    this._pendingChart = { values, threshold };
    if (this._chartRaf != null) return;
    this._chartRaf = requestAnimationFrame(() => {
      this._chartRaf = null;
      const pending = this._pendingChart;
      this._pendingChart = null;
      if (pending) this._drawChart(pending.values, pending.threshold);
    });
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

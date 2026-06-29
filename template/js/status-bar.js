/** StatusHeader + RunFooter 刷新 */

const TRIGGER_LABELS = {
  external: "外部触发",
  software: "软触发",
  continuous: "连续采集",
};

export class StatusBar {
  constructor() {
    this.badge = document.querySelector("#status-badge");
    this.learnCount = document.querySelector("#learn-count");
    this.triggerMode = document.querySelector("#trigger-mode");
    this.processTime = document.querySelector("#process-time");

    this.statMax = document.querySelector("#stat-max");
    this.statMin = document.querySelector("#stat-min");
    this.statAve = document.querySelector("#stat-ave");
    this.statTriggerTotal = document.querySelector("#stat-trigger-total");
    this.statOk = document.querySelector("#stat-ok");
    this.statNg = document.querySelector("#stat-ng");
    this.statTrerr = document.querySelector("#stat-trerr");
  }

  setIdle() {
    this._setBadge("idle");
    this.learnCount.textContent = "已学习: —";
    this.triggerMode.textContent = "—";
    this.processTime.textContent = "处理: —ms";
    this._setFooterStats(null);
  }

  setWaiting() {
    this._setBadge("master");
    this.processTime.textContent = "处理: —ms";
  }

  setWizardLive() {
    this._setBadge("live");
  }

  update(data) {
    const samples = data.calibration?.sample_count ?? 0;
    this.learnCount.textContent = `已学习: ${samples}张`;

    const triggerKey = data.trigger?.source || "external";
    const triggerLabel = data.trigger?.label || TRIGGER_LABELS[triggerKey] || triggerKey;
    this.triggerMode.textContent = triggerLabel;

    if (data.idle) {
      const hasPreview = Boolean(data.frame?.image_base64);
      this._setBadge(hasPreview ? "live" : "master");
      this.processTime.textContent = "处理: —ms";
    } else {
      this._setBadge("master");
      const ms = data.frame?.process_ms ?? "—";
      this.processTime.textContent = `处理: ${ms}ms`;
    }

    this._setFooterStats(data.stats);
  }

  _setBadge(mode) {
    if (!this.badge) return;
    this.badge.hidden = false;
    this.badge.className = "status-badge";
    if (mode === "master") {
      this.badge.classList.add("status-badge--master");
      this.badge.textContent = "Master";
    } else if (mode === "live") {
      this.badge.classList.add("status-badge--live");
      this.badge.textContent = "Live";
    } else {
      this.badge.hidden = true;
    }
  }

  _setFooterStats(stats) {
    const dash = "—";
    if (!stats) {
      if (this.statMax) this.statMax.textContent = dash;
      if (this.statMin) this.statMin.textContent = dash;
      if (this.statAve) this.statAve.textContent = dash;
      if (this.statTriggerTotal) this.statTriggerTotal.textContent = "0";
      if (this.statOk) this.statOk.textContent = "0";
      if (this.statNg) this.statNg.textContent = "0";
      if (this.statTrerr) this.statTrerr.textContent = "0";
      return;
    }
    if (this.statMax) this.statMax.textContent = stats.process_ms_max ?? dash;
    if (this.statMin) this.statMin.textContent = stats.process_ms_min ?? dash;
    if (this.statAve) this.statAve.textContent = stats.process_ms_ave ?? dash;
    if (this.statTriggerTotal) this.statTriggerTotal.textContent = `${stats.trigger_total ?? 0}`;
    if (this.statOk) this.statOk.textContent = `${stats.ok_count ?? 0}`;
    if (this.statNg) this.statNg.textContent = `${stats.ng_count ?? 0}`;
    if (this.statTrerr) this.statTrerr.textContent = `${stats.trerr_count ?? 0}`;
  }
}

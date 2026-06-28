/** 顶部/底部状态栏刷新 */

const TRIGGER_LABELS = {
  external: "外部触发",
  software: "软触发",
  continuous: "连续采集",
};

export class StatusBar {
  constructor() {
    this.verdict = document.querySelector("#verdict-badge");
    this.learnCount = document.querySelector("#learn-count");
    this.triggerMode = document.querySelector("#trigger-mode");
    this.processTime = document.querySelector("#process-time");

    this.statProcess = document.querySelector("#stat-process");
    this.statMax = document.querySelector("#stat-max");
    this.statMin = document.querySelector("#stat-min");
    this.statAve = document.querySelector("#stat-ave");
  }

  setIdle() {
    this.verdict.textContent = "—";
    this.verdict.className = "state-idle";
    this.learnCount.textContent = "已学习: —";
    this.triggerMode.textContent = "—";
    this.processTime.textContent = "处理: —";
  }

  update(data) {
    const passed = data.overall?.passed;
    this.verdict.textContent = passed ? "OK" : "NG";
    this.verdict.className = passed ? "state-ok" : "state-ng";

    const samples = data.calibration?.sample_count ?? 0;
    this.learnCount.textContent = `已学习: ${samples}张`;

    const triggerKey = data.trigger?.source || "external";
    const triggerLabel = data.trigger?.label || TRIGGER_LABELS[triggerKey] || triggerKey;
    this.triggerMode.textContent = triggerLabel;

    const ms = data.frame?.process_ms ?? data.stats?.process_ms ?? 0;
    this.processTime.textContent = `处理: ${ms}ms`;

    const stats = data.stats || {};
    if (this.statProcess) this.statProcess.textContent = `${ms}`;
    if (this.statMax) this.statMax.textContent = `${stats.process_ms_max ?? ms}`;
    if (this.statMin) this.statMin.textContent = `${stats.process_ms_min ?? ms}`;
    if (this.statAve) this.statAve.textContent = `${stats.process_ms_ave ?? ms}`;
  }
}

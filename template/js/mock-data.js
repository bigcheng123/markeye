/** Mock 帧数据（纯前端，无 Python 后端） */

const TOOL_META = {
  learn: { id: "01", name: "学习", min: 0, max: 100, threshold: 73 },
  color: { id: "02", name: "彩色识别", min: 0, max: 100, threshold: 0 },
};

let _tick = 0;
let _triggerTotal = 0;
let _okCount = 0;
let _ngCount = 0;
let _trerrCount = 0;
let _sampleCount = 21;
let _hasMaster = true;
let _waitingTrigger = true;
let _processHistory = [];
let _connected = true;

export function getToolMeta() {
  return TOOL_META;
}

export function getMockState() {
  return {
    triggerTotal: _triggerTotal,
    okCount: _okCount,
    ngCount: _ngCount,
    trerrCount: _trerrCount,
    sampleCount: _sampleCount,
    hasMaster: _hasMaster,
    waitingTrigger: _waitingTrigger,
    connected: _connected,
  };
}

export function setMockConnected(v) {
  _connected = v;
}

export function resetMockStats() {
  _triggerTotal = 0;
  _okCount = 0;
  _ngCount = 0;
  _trerrCount = 0;
  _processHistory = [];
}

export function addMockCalibration() {
  _sampleCount += 1;
}

export function registerMaster() {
  _hasMaster = true;
}

export function triggerMockFrame() {
  _waitingTrigger = false;
  return createMockFrame({ triggered: true });
}

export function createIdleFrame() {
  return {
    type: "frame",
    timestamp: new Date().toISOString(),
    idle: true,
    overall: { passed: null },
    frame: { width: 800, height: 500, process_ms: null },
    marks: [
      {
        label: "mark_1",
        bbox: [200, 140, 140, 80],
        passed: null,
        contour: [[200, 140], [340, 140], [340, 220], [200, 220]],
      },
    ],
    inspections: [
      { tool: "learn", name: "学习", passed: null, value: 73, threshold: TOOL_META.learn.threshold },
      { tool: "color", name: "彩色识别", passed: null, value: 0, threshold: TOOL_META.color.threshold },
    ],
    stats: {
      trigger_total: _triggerTotal,
      ok_count: _okCount,
      ng_count: _ngCount,
      trerr_count: _trerrCount,
      process_ms_max: null,
      process_ms_min: null,
      process_ms_ave: null,
    },
    calibration: { sample_count: _sampleCount },
    trigger: { source: "external", label: "外部触发" },
  };
}

export function createMockFrame(overrides = {}) {
  if (overrides.idle || (!_waitingTrigger && !overrides.triggered && _tick === 0)) {
    return createIdleFrame();
  }

  _tick += 1;
  const processMs = Math.round(435 + Math.random() * 8);
  _processHistory.push(processMs);
  if (_processHistory.length > 50) _processHistory.shift();

  const learnVal = TOOL_META.learn.threshold;
  const colorVal = Math.round(Math.random() * 30);
  const learnPass = learnVal >= TOOL_META.learn.threshold;
  const colorPass = colorVal <= TOOL_META.color.threshold + 5;
  const allPass = learnPass && colorPass;

  _triggerTotal += 1;
  if (allPass) _okCount += 1;
  else _ngCount += 1;

  const maxMs = Math.max(..._processHistory);
  const minMs = Math.min(..._processHistory);
  const aveMs = Math.round(_processHistory.reduce((a, b) => a + b, 0) / _processHistory.length);

  return {
    type: "frame",
    timestamp: new Date().toISOString(),
    overall: { passed: allPass },
    frame: {
      width: 800,
      height: 500,
      process_ms: processMs,
    },
    marks: [
      {
        label: "轮廓",
        bbox: [200, 140, 140, 80],
        passed: allPass,
        contour: [[200, 140], [340, 140], [340, 220], [200, 220]],
      },
    ],
    inspections: [
      {
        tool: "learn",
        name: "学习",
        passed: learnPass,
        value: learnVal,
        threshold: TOOL_META.learn.threshold,
      },
      {
        tool: "color",
        name: "彩色识别",
        passed: colorPass,
        value: colorVal,
        threshold: TOOL_META.color.threshold,
      },
    ],
    stats: {
      trigger_total: _triggerTotal,
      ok_count: _okCount,
      ng_count: _ngCount,
      trerr_count: _trerrCount,
      process_ms: processMs,
      process_ms_max: maxMs,
      process_ms_min: minMs,
      process_ms_ave: aveMs,
    },
    calibration: { sample_count: _sampleCount },
    trigger: { source: "external", label: "外部触发" },
    ...overrides,
  };
}

export function setToolThreshold(tool, value) {
  if (TOOL_META[tool]) {
    TOOL_META[tool].threshold = value;
  }
}

export function drawPlaceholderScene(ctx, width, height, mode = "overlay") {
  ctx.fillStyle = mode === "binary" ? "#fff" : "#1a1a1a";
  ctx.fillRect(0, 0, width, height);

  if (mode === "binary") {
    ctx.fillStyle = "#000";
    ctx.fillRect(200, 140, 140, 80);
    return;
  }

  ctx.fillStyle = "#333";
  ctx.fillRect(0, 0, width, 80);
  ctx.fillStyle = "#555";
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(40, 100 + i * 120, width - 80, 20);
  }

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.ellipse(width * 0.45, height * 0.45, 90, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#00b050";
  ctx.beginPath();
  ctx.ellipse(width * 0.45, height * 0.42, 30, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  if (mode !== "original") {
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.strokeRect(200, 140, 140, 80);
    ctx.strokeStyle = "#00b050";
    ctx.beginPath();
    ctx.moveTo(220, 200);
    ctx.lineTo(260, 160);
    ctx.lineTo(300, 200);
    ctx.stroke();
  }
}

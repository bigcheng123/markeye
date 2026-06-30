/** Mock 帧数据（纯前端，无 Python 后端） */

const TOOL_META = {
  learn: { id: "01", name: "学习", min: 0, max: 100, threshold: 73 },
  color: { id: "02", name: "彩色识别", min: 0, max: 100, threshold: 0 },
};

const MOCK_TOOL_ROIS = [
  {
    id: "01",
    name: "学习",
    cam: 0,
    roi: { shape: "rect", x: 200, y: 140, w: 140, h: 80 },
  },
  {
    id: "02",
    name: "彩色识别",
    cam: 1,
    roi: { shape: "rect", x: 480, y: 280, w: 120, h: 70 },
  },
];

function _canvasToB64(canvas, quality = 0.72) {
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

function _buildMockImages(mode = "original") {
  const w = 800;
  const h = 500;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  drawPlaceholderScene(ctx, w, h, mode);
  const originalB64 = _canvasToB64(canvas);

  const binCanvas = document.createElement("canvas");
  binCanvas.width = w;
  binCanvas.height = h;
  const binCtx = binCanvas.getContext("2d");
  drawPlaceholderScene(binCtx, w, h, "binary");
  const binaryB64 = _canvasToB64(binCanvas);

  return { width: w, height: h, original_base64: originalB64, binary_base64: binaryB64 };
}

let _tick = 0;
let _triggerTotal = 0;
let _okCount = 0;
let _ngCount = 0;
let _trerrCount = 0;
let _sampleCount = 21;
let _hasMaster = false;
let _masterFrameB64 = null;
let _masterWidth = 800;
let _masterHeight = 500;
let _liveTick = 0;
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

export function hasMockMaster() {
  return _hasMaster && Boolean(_masterFrameB64);
}

export function createLivePreviewFrame() {
  _liveTick += 1;
  const imgs = _buildMockImages("original");
  const canvas = document.createElement("canvas");
  canvas.width = imgs.width;
  canvas.height = imgs.height;
  const ctx = canvas.getContext("2d");
  drawPlaceholderScene(ctx, imgs.width, imgs.height, "original");
  ctx.fillStyle = `rgba(0, 176, 80, ${0.35 + 0.15 * Math.sin(_liveTick * 0.25)})`;
  ctx.beginPath();
  ctx.arc(40, 40, 10 + (_liveTick % 4), 0, Math.PI * 2);
  ctx.fill();
  const originalB64 = _canvasToB64(canvas);
  const frame = createIdleFrame();
  frame.frame = {
    width: imgs.width,
    height: imgs.height,
    process_ms: null,
    image_base64: originalB64,
    original_base64: originalB64,
    binary_base64: imgs.binary_base64,
  };
  frame.tool_rois = MOCK_TOOL_ROIS;
  return frame;
}

export function captureMockMasterFromLive() {
  const frame = createLivePreviewFrame();
  _masterFrameB64 = frame.frame.image_base64;
  _masterWidth = frame.frame.width;
  _masterHeight = frame.frame.height;
  registerMaster();
  return {
    image_base64: _masterFrameB64,
    width: _masterWidth,
    height: _masterHeight,
  };
}

export function getMockMasterImage() {
  if (!_masterFrameB64) return null;
  return {
    image_base64: _masterFrameB64,
    width: _masterWidth,
    height: _masterHeight,
  };
}

export function createMasterFramePayload(img) {
  const w = img?.width || _masterWidth;
  const h = img?.height || _masterHeight;
  const b64 = img?.image_base64 || _masterFrameB64;
  const imgs = b64 ? { original_base64: b64, binary_base64: _buildMockImages("original").binary_base64 } : _buildMockImages("original");
  return {
    type: "frame",
    timestamp: new Date().toISOString(),
    idle: true,
    overall: { passed: null },
    frame: {
      width: w,
      height: h,
      process_ms: null,
      image_base64: b64 || imgs.original_base64,
      original_base64: b64 || imgs.original_base64,
      binary_base64: imgs.binary_base64,
    },
    tool_rois: MOCK_TOOL_ROIS,
    marks: [],
    inspections: [],
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

export function triggerMockFrame() {
  _waitingTrigger = false;
  return createMockFrame({ triggered: true });
}

export function createIdleFrame() {
  const imgs = _buildMockImages("original");
  return {
    type: "frame",
    timestamp: new Date().toISOString(),
    idle: true,
    overall: { passed: null },
    frame: {
      width: imgs.width,
      height: imgs.height,
      process_ms: null,
      image_base64: imgs.original_base64,
      original_base64: imgs.original_base64,
      binary_base64: imgs.binary_base64,
    },
    tool_rois: MOCK_TOOL_ROIS,
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
  const imgs = _buildMockImages("original");

  return {
    type: "frame",
    timestamp: new Date().toISOString(),
    overall: { passed: allPass },
    frame: {
      width: imgs.width,
      height: imgs.height,
      process_ms: processMs,
      image_base64: imgs.original_base64,
      original_base64: imgs.original_base64,
      binary_base64: imgs.binary_base64,
    },
    tool_rois: MOCK_TOOL_ROIS,
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

export function drawPlaceholderScene(ctx, width, height, mode = "original") {
  ctx.fillStyle = mode === "binary" ? "#fff" : "#1a1a1a";
  ctx.fillRect(0, 0, width, height);

  if (mode === "binary") {
    ctx.fillStyle = "#000";
    ctx.fillRect(200, 140, 140, 80);
    ctx.fillRect(480, 280, 120, 70);
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
}

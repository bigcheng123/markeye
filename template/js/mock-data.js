/** Mock 帧数据生成器（静态调试 / 无后端时使用） */

const TOOL_META = {
  color: { id: "Tool 01", name: "颜色检查", min: 0, max: 100 },
  size: { id: "Tool 02", name: "大小检查", min: 1500, max: 2200 },
  position: { id: "Tool 03", name: "位置检查", min: 0, max: 20 },
};

let _tick = 0;
let _okCount = 18;
let _ngCount = 4;
let _sampleCount = 3;

export function getToolMeta() {
  return TOOL_META;
}

export function resetMockStats() {
  _okCount = 0;
  _ngCount = 0;
}

export function addMockCalibration() {
  _sampleCount += 1;
}

export function createMockFrame(overrides = {}) {
  _tick += 1;
  const jitter = Math.sin(_tick * 0.3) * 3;
  const processMs = Math.round(437 + Math.random() * 6);

  const colorVal = Math.round(88 + jitter);
  const sizeVal = Math.round(1840 + jitter * 8);
  const posVal = Math.round((4.2 + jitter * 0.2) * 10) / 10;

  const allPass = colorVal >= 80 && sizeVal >= 1700 && posVal <= 10;

  if (allPass) {
    _okCount += 1;
  } else {
    _ngCount += 1;
  }

  const frame = {
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
        label: "mark_1",
        bbox: [180, 120, 120, 48],
        center: [240, 144],
        area: sizeVal,
        passed: allPass,
        contour: [
          [180, 120],
          [300, 120],
          [300, 168],
          [180, 168],
        ],
      },
      {
        label: "mark_2",
        bbox: [420, 200, 100, 40],
        center: [470, 220],
        area: 1680,
        passed: true,
        contour: [
          [420, 200],
          [520, 200],
          [520, 240],
          [420, 240],
        ],
      },
    ],
    inspections: [
      {
        tool: "color",
        passed: colorVal >= 80,
        value: colorVal,
        expected: "yellow",
        fail_reasons: colorVal < 80 ? ["颜色偏差过大"] : [],
      },
      {
        tool: "size",
        passed: sizeVal >= 1700,
        value: sizeVal,
        deviation: 0.03,
        fail_reasons: sizeVal < 1700 ? ["面积偏小"] : [],
      },
      {
        tool: "position",
        passed: posVal <= 10,
        value: posVal,
        fail_reasons: posVal > 10 ? ["中心偏移超限"] : [],
      },
    ],
    stats: {
      ok_count: _okCount,
      ng_count: _ngCount,
      process_ms: processMs,
      process_ms_max: processMs + 2,
      process_ms_min: processMs - 2,
      process_ms_ave: processMs,
    },
    calibration: { sample_count: _sampleCount },
    trigger: { source: "external", label: "外部触发" },
    ...overrides,
  };

  return frame;
}

/** 生成占位场景图（Canvas 用） */
export function drawPlaceholderScene(ctx, width, height) {
  ctx.fillStyle = "#1a6b3c";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111";
  for (let i = 0; i < 4; i++) {
    const y = 80 + i * 100;
    ctx.beginPath();
    ctx.ellipse(width * 0.35, y, 180, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(width * 0.65, y + 20, 160, 24, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f1c40f";
  ctx.fillRect(175, 115, 130, 50);
  ctx.fillRect(415, 195, 110, 45);

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.font = "14px sans-serif";
  ctx.fillText("MarkEye Mock 场景", 12, 24);
}

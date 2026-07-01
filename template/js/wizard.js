/** SET 模式四步设定向导 */

import { confirmModal, infoModal, infoModalHtml, showToast } from "./layout.js";
import { isMockMode } from "./api-client.js";

const STEP_TITLES = {
  1: { title: "STEP1 拍摄条件", desc: "设定拍摄与触发相关条件。" },
  2: { title: "STEP2 注册主控", desc: "将用作判断标准的检测对象图像注册为主控图像。" },
  3: { title: "STEP3 工具设定", desc: "设定判断使用的工具。请单击[追加工具]或选择工具后单击[编辑]。" },
  4: { title: "STEP4 输出分配", desc: "在输出线上设定输出内容。" },
};

const DEFAULT_TOOL = () => ({
  name: "色彩识别",
  type: "hsv_roi",
  enabled: true,
  cam: 0,
  roi: { shape: "rect", x: 100, y: 100, w: 120, h: 80 },
  params: { h_lower: [0, 50, 50], h_upper: [180, 255, 255] },
});

const TOOL_KIND_OPTIONS = [
  { name: "色彩识别", type: "hsv_roi" },
  { name: "轮廓识别", type: "contour_roi" },
];

const DEFAULT_HSV_PARAMS = () => ({ h_lower: [0, 50, 50], h_upper: [180, 255, 255] });

const DEFAULT_CONTOUR_PARAMS = () => ({
  target_shape: "rect",
  size_tolerance: 0.15,
  position_tolerance: 10,
  expected: { center: [350, 190], size: [120, 80] },
});

function _renderIoChannelBtn(kind, index, active) {
  const on = active ? " is-on" : "";
  const label = kind === "in" ? `X${index + 1}` : `Y${index + 1}`;
  const title = kind === "in" ? `${label} 输入状态` : `${label} 点击切换输出`;
  return `<button type="button" class="wizard-io-ch-btn${on}" data-io-ch="${kind}" data-ch="${index}" title="${title}">${index + 1}</button>`;
}

function _ioLinkBadgeClass(enabled, connected) {
  if (!enabled) return "is-disabled";
  return connected ? "is-ok" : "is-err";
}

function _ioLinkBadgeLabel(enabled, connected) {
  if (!enabled) return "已关闭";
  return connected ? "连接成功" : "连接失败";
}

const IO_CHANNEL_COUNT = 8;

const IO_OUT_STATIC_OPTIONS = [
  { value: "off", label: "OFF" },
  { value: "link_ok", label: "通信成功" },
  { value: "result_ok", label: "综合判断OK" },
  { value: "result_ng", label: "综合判断NG" },
];

const IO_IN_OPTIONS = [
  { value: "off", label: "OFF" },
  { value: "trigger", label: "触发" },
  { value: "switch_program", label: "切换程序" },
  { value: "restart", label: "重启软件" },
];

const DEFAULT_OUTPUT_ASSIGNMENTS = [
  "link_ok",
  "result_ng",
  "tool:02",
  "tool:01",
  "off",
  "off",
  "off",
  "off",
];

const DEFAULT_INPUT_ASSIGNMENTS = [
  "trigger",
  "switch_program",
  "restart",
  "off",
  "off",
  "off",
  "off",
  "off",
];

function _ioOutOptions(tools) {
  const toolOpts = (tools || []).map((t) => ({
    value: `tool:${t.id}`,
    label: `工具${t.id}: ${t.name || _toolNameFromKind(_toolKindFromSel(t))}`,
  }));
  return [...IO_OUT_STATIC_OPTIONS, ...toolOpts];
}

function _renderIoSelect(field, options, current, label) {
  const known = new Set(options.map((o) => o.value));
  const extra =
    current && current !== "off" && !known.has(current)
      ? `<option value="${current}" selected>${current}</option>`
      : "";
  const optsHtml = options
    .map(
      (o) =>
        `<option value="${o.value}"${o.value === current ? " selected" : ""}>${o.label}</option>`,
    )
    .join("");
  return `<div class="wizard-form-row"><label>${label}</label><select data-field="${field}">${optsHtml}${extra}</select></div>`;
}

function _toolKindFromSel(sel) {
  if (sel?.type === "contour_roi" || sel?.type === "hsv_roi") return sel.type;
  const byName = TOOL_KIND_OPTIONS.find((o) => o.name === sel?.name);
  return byName?.type || "hsv_roi";
}

function _toolNameFromKind(kind) {
  return TOOL_KIND_OPTIONS.find((o) => o.type === kind)?.name || "色彩识别";
}

/** 按列表顺序生成工具 ID：第 1 个 → "01"，第 2 个 → "02" … */
function _formatToolId(index) {
  return String(index + 1).padStart(2, "0");
}

/** 解析工具绑定的逻辑相机槽位 CAM#0 / CAM#1 */
function _toolCamSlot(tool) {
  const n = parseInt(tool?.cam, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(1, n) : 0;
}

const DEFAULT_CAMERAS_LIST = () => [0, 1, 2];

function _readCamerasListFromForm(el) {
  const inputs = el?.querySelectorAll('[data-field="camera-id"]') || [];
  const ids = [...inputs]
    .map((inp) => parseInt(inp.value, 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  return unique.length ? unique : [0];
}

function _renderCameraListRows(cameras) {
  return cameras
    .map(
      (id, i) => `
        <div class="wizard-camera-row" data-camera-index="${i}">
          <input type="number" min="0" step="1" data-field="camera-id" value="${id}" aria-label="相机设备号 ${i}" />
          <button type="button" class="btn btn-secondary btn-camera-row-del" data-action="camera-remove"
            ${cameras.length <= 1 ? "disabled" : ""} title="删除">−</button>
          <button type="button" class="btn btn-primary btn-ai-shoot-row" data-action="ai-shoot" title="拍摄">✨ 拍摄</button>
        </div>`,
    )
    .join("");
}

function _refreshDefaultCameraSelect(el, cameras, selected) {
  const sel = el?.querySelector('[data-field="camera-default"]');
  if (!sel) return;
  const cur = Number.isFinite(selected) ? selected : parseInt(sel.value, 10);
  const pick = cameras.includes(cur) ? cur : cameras[0];
  sel.innerHTML = cameras
    .map((id) => `<option value="${id}" ${id === pick ? "selected" : ""}>${id}</option>`)
    .join("");
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _editorFieldKey(el) {
  if (!el?.dataset) return null;
  if (el.dataset.toolField) return `tool:${el.dataset.toolField}`;
  if (el.dataset.roiField) return `roi:${el.dataset.roiField}`;
  if (el.dataset.paramField) return `param:${el.dataset.paramField}`;
  return null;
}

function _focusEditorField(editorEl, key) {
  if (!editorEl || !key) return;
  const [kind, name] = key.split(":");
  const attr = kind === "tool" ? "data-tool-field"
    : kind === "roi" ? "data-roi-field"
      : "data-param-field";
  editorEl.querySelector(`[${attr}="${name}"]`)?.focus?.();
}

/** ROI 几何像素面积（矩形 w×h，圆形 πr²）— 用于面积上下限输入框的 max */
function _roiPixelArea(roi) {
  if (!roi) return 0;
  if (roi.shape === "circle") {
    const r = Math.max(0, parseInt(roi.r, 10) || 0);
    return Math.round(Math.PI * r * r);
  }
  const w = Math.max(0, parseInt(roi.w, 10) || 0);
  const h = Math.max(0, parseInt(roi.h, 10) || 0);
  return w * h;
}

/** 「计算面积」得到的 ROI 总像素，用于面积上下限输入框的 max */
function _hsvRoiAreaMax(tool, areaResults) {
  const cached = areaResults?.[tool?.id];
  if (cached && cached.total > 0) return cached.total;
  return _roiPixelArea(tool?.roi);
}

/** 工具卡片滑块：min=0, max=面积上限值, value=检测值；末端数字=面积上限值 */
function _hsvSliderConfig(tool, areaResults) {
  const params = tool?.params || {};
  const upperLimit = parseInt(params.match_area_max, 10);
  const hasUpper = Number.isFinite(upperLimit) && upperLimit > 0;
  const cached = areaResults?.[tool?.id];
  const detectVal = cached && cached.match >= 0 ? cached.match : 0;
  const maxVal = hasUpper ? upperLimit : 1;
  return {
    min: 0,
    max: maxVal,
    value: hasUpper ? clamp(detectVal, 0, maxVal) : 0,
    endLabel: hasUpper ? String(upperLimit) : "—",
  };
}

const HSV_PICK_TOL = { h: 10, s: 40, v: 40 };

function _applyHsvSample(params, h, s, v) {
  const { h: dh, s: ds, v: dv } = HSV_PICK_TOL;
  params.h_sample = [h, s, v];
  params.h_lower = [clamp(h - dh, 0, 180), clamp(s - ds, 0, 255), clamp(v - dv, 0, 255)];
  params.h_upper = [clamp(h + dh, 0, 180), clamp(s + ds, 0, 255), clamp(v + dv, 0, 255)];
}

const HSV_LIMITS = [
  { min: 0, max: 180 },
  { min: 0, max: 255 },
  { min: 0, max: 255 },
];

function _hsvSampleDisplay(params, channel) {
  const sample = params?.h_sample;
  if (Array.isArray(sample) && sample[channel] != null && !Number.isNaN(sample[channel])) {
    return String(sample[channel]);
  }
  return "—";
}

/** OpenCV HSV (H 0–180, S/V 0–255) → RGB 0–255 */
function _hsvOpenCvToRgb(h, s, v) {
  const hd = (Number(h) || 0) * 2;
  const sd = (Number(s) || 0) / 255;
  const vd = (Number(v) || 0) / 255;
  const c = vd * sd;
  const x = c * (1 - Math.abs(((hd / 60) % 2) - 1));
  const m = vd - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hd < 60) {
    r = c; g = x; b = 0;
  } else if (hd < 120) {
    r = x; g = c; b = 0;
  } else if (hd < 180) {
    r = 0; g = c; b = x;
  } else if (hd < 240) {
    r = 0; g = x; b = c;
  } else if (hd < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function _hsvSampleTextColor(params) {
  const sample = params?.h_sample;
  if (!Array.isArray(sample) || sample.length < 3) return "";
  const [h, s, v] = sample.map((n) => Number(n));
  if ([h, s, v].some((n) => Number.isNaN(n))) return "";
  const { r, g, b } = _hsvOpenCvToRgb(h, s, v);
  return `color: rgb(${r}, ${g}, ${b});`;
}

function _sanitizeHsvParams(params) {
  if (!params || typeof params !== "object") return params;
  const allowed = new Set(["h_lower", "h_upper", "match_area_min", "match_area_max", "h_sample"]);
  for (const k of Object.keys(params)) {
    if (!allowed.has(k)) delete params[k];
  }
  return params;
}

function _renderHsvThresholdGrid(params, areaResult = null, { hsvPickActive = false, hsvMatchActive = false, roiAreaMax = 0 } = {}) {
  const hLower = params.h_lower || [0, 0, 0];
  const hUpper = params.h_upper || [180, 255, 255];
  const areaMin = params.match_area_min ?? "";
  const areaMax = params.match_area_max ?? "";
  const areaLimit = Math.max(0, roiAreaMax);

  const sampleColorStyle = _hsvSampleTextColor(params);
  const sampleStyleAttr = sampleColorStyle ? ` style="${sampleColorStyle}"` : "";

  const hsvCoreCells = (label, i) => {
    const lim = HSV_LIMITS[i];
    const sample = _hsvSampleDisplay(params, i);
    return `
        <th class="wizard-hsv-grid__axis">${label}</th>
        <td><input type="number" data-param-field="h_lower_${i}" value="${hLower[i] ?? 0}" min="${lim.min}" max="${lim.max}" aria-label="${label} 下限值" /></td>
        <td><span class="wizard-hsv-grid__sample" data-hsv-sample="${i}" aria-label="${label} 取样值"${sampleStyleAttr}>${sample}</span></td>
        <td><input type="number" data-param-field="h_upper_${i}" value="${hUpper[i] ?? lim.max}" min="${lim.min}" max="${lim.max}" aria-label="${label} 上限值" /></td>`;
  };

  let areaHtml = "—";
  if (areaResult && areaResult.total >= 0) {
    const pct = areaResult.total > 0 ? ((areaResult.match / areaResult.total) * 100).toFixed(1) : "0.0";
    areaHtml = `
      <div class="wizard-hsv-area-result__value">${areaResult.match} px</div>
      <div class="wizard-hsv-area-result__sub">ROI ${areaResult.total} px · ${pct}%</div>`;
  }

  return `
    <div class="wizard-hsv-panel">
      <table class="wizard-hsv-grid">
        <thead>
          <tr>
            <th class="wizard-hsv-grid__corner">
              <button type="button" class="btn btn-primary" data-editor-action="hsv-sample-roi">ROI 内取样</button>
            </th>
            <th>下限值</th>
            <th class="wizard-hsv-grid__sample-header">
              <button type="button" class="btn btn-secondary${hsvPickActive ? " is-active" : ""}" data-editor-action="hsv-pick-on" title="在 ROI 内单击目标颜色完成取样">点击取 HSV</button>
            </th>
            <th>上限值</th>
            <th class="wizard-hsv-grid__action-header">
              <button type="button" class="btn btn-secondary" data-editor-action="hsv-calc-area">计算面积</button>
            </th>
            <th class="wizard-hsv-grid__result-header" id="wizard-hsv-area-result">${areaHtml}</th>
          </tr>
        </thead>
        <tbody>
          <tr>${hsvCoreCells("H", 0)}
            <td class="wizard-hsv-grid__action-cell">
              <button type="button" class="btn btn-secondary${hsvMatchActive ? " is-active" : ""}" data-editor-action="hsv-show-match" title="仅显示 ROI 内符合 HSV 阈值的像素">显示匹配像素</button>
            </td>
            <td class="wizard-hsv-grid__cell-empty" aria-hidden="true"></td>
          </tr>
          <tr>${hsvCoreCells("S", 1)}
            <td class="wizard-hsv-grid__area-label">面积上限值</td>
            <td><input type="number" data-param-field="match_area_max" value="${areaMax}" min="0" max="${areaLimit}" placeholder="设定值" aria-label="面积上限值" /></td>
          </tr>
          <tr>${hsvCoreCells("V", 2)}
            <td class="wizard-hsv-grid__area-label">面积下限值</td>
            <td><input type="number" data-param-field="match_area_min" value="${areaMin}" min="0" max="${areaLimit}" placeholder="设定值" aria-label="面积下限值" /></td>
          </tr>
        </tbody>
      </table>
      <p class="wizard-hint wizard-hsv-grid__hint">建议用「ROI 内取样」获取目标色；点击「点击取 HSV」后在 ROI 内单击目标颜色即可完成取样。橙色通常 H≈10–25。</p>
    </div>`;
}

function _renderToolParamsTwoColumn(sel, roi, roiRect) {
  const toolKind = _toolKindFromSel(sel);
  const camSlot = _toolCamSlot(sel);
  const toolOptions = TOOL_KIND_OPTIONS.map(
    (o) => `<option value="${o.type}" ${toolKind === o.type ? "selected" : ""}>${o.name}</option>`,
  ).join("");
  return `
    <p class="wizard-hint wizard-tool-params__hint">拖拽四角调整 ROI，拖内部移动；空白处拖拽可新建 ROI。</p>
    <div class="wizard-tool-params-grid">
      <div class="wizard-tool-params-col">
        <div class="wizard-form-row"><label>启用</label>
          <select data-tool-field="enabled">
            <option value="true" ${sel.enabled === false ? "" : "selected"}>ON</option>
            <option value="false" ${sel.enabled === false ? "selected" : ""}>OFF</option>
          </select>
        </div>
        <div class="wizard-form-row"><label>CAM#</label>
          <select data-tool-field="cam">
            <option value="0" ${camSlot === 0 ? "selected" : ""}>CAM#0</option>
            <option value="1" ${camSlot === 1 ? "selected" : ""}>CAM#1</option>
          </select>
        </div>
        <div class="wizard-form-row"><label>选择工具</label>
          <select data-tool-field="tool_kind">${toolOptions}</select>
        </div>
        <div class="wizard-form-row"><label>ROI 形状</label>
          <select data-roi-field="shape">
            <option value="rect" ${roiRect ? "selected" : ""}>矩形</option>
            <option value="circle" ${roi.shape === "circle" ? "selected" : ""}>圆形</option>
          </select>
        </div>
        <div class="wizard-form-row"><label>ROI X</label><input type="number" data-roi-field="x" value="${roi.x ?? 0}" ${roiRect ? "" : "disabled"} /></div>
        <div class="wizard-form-row"><label>ROI Y</label><input type="number" data-roi-field="y" value="${roi.y ?? 0}" ${roiRect ? "" : "disabled"} /></div>
      </div>
      <div class="wizard-tool-params-col">
        <div class="wizard-form-row"><label>ROI W</label><input type="number" data-roi-field="w" value="${roi.w ?? 10}" ${roiRect ? "" : "disabled"} /></div>
        <div class="wizard-form-row"><label>ROI H</label><input type="number" data-roi-field="h" value="${roi.h ?? 10}" ${roiRect ? "" : "disabled"} /></div>
        <div class="wizard-form-row"><label>ROI CX</label><input type="number" data-roi-field="cx" value="${roi.cx ?? 0}" ${roi.shape === "circle" ? "" : "disabled"} /></div>
        <div class="wizard-form-row"><label>ROI CY</label><input type="number" data-roi-field="cy" value="${roi.cy ?? 0}" ${roi.shape === "circle" ? "" : "disabled"} /></div>
        <div class="wizard-form-row"><label>ROI R</label><input type="number" data-roi-field="r" value="${roi.r ?? 10}" ${roi.shape === "circle" ? "" : "disabled"} /></div>
      </div>
    </div>`;
}

export class Wizard {
  constructor({ onExit, onComplete, onStepChange, hasMaster }) {
    this.step = 1;
    this.tab = "output";
    this.contentEl = document.querySelector("#wizard-content");
    this.rightCol = document.querySelector("#wizard-right-col");
    this.stepNav = document.querySelector("#wizard-step-nav");
    this.footer = document.querySelector("#wizard-footer");
    this.btnBack = document.querySelector("#wizard-back");
    this.btnNext = document.querySelector("#wizard-next");
    this.btnExit = document.querySelector("#wizard-exit");
    this.onExit = onExit;
    this.onComplete = onComplete;
    this.onStepChange = onStepChange;
    this.hasMaster = hasMaster;

    this._tools = [];
    this._step1Loaded = false;
    this._step3Loaded = false;
    this._selectedToolId = null;
    this._hsvAreaResults = {};
    this._hsvPickActive = false;
    this._hsvMatchPreviewActive = false;
    this._previewCamSlot = 0;
    this._step4Loaded = false;
    this._comprehensiveLogic = 1;
    this._trerrEnabled = true;
    this._ioConfig = {};
    this._outputAssignments = [...DEFAULT_OUTPUT_ASSIGNMENTS];
    this._inputAssignments = [...DEFAULT_INPUT_ASSIGNMENTS];
    this._ioLiveInputs = Array(IO_CHANNEL_COUNT).fill(false);
    this._ioLiveOutputs = Array(IO_CHANNEL_COUNT).fill(false);
    this._ioConnected = false;
    this._ioPollTimer = null;

    this._bindNav();
    this._render();
  }

  _bindNav() {
    this.stepNav?.querySelectorAll(".wizard-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = parseInt(btn.dataset.step, 10);
        if (!Number.isFinite(s) || s < 1 || s > 4 || s === this.step) return;
        this._navigateToStep(s);
      });
    });

    this.btnBack?.addEventListener("click", () => {
      if (this.step > 1) this._navigateToStep(this.step - 1);
    });

    this.btnNext?.addEventListener("click", async () => {
      if (this.step < 4) {
        this._navigateToStep(this.step + 1);
        return;
      }
      const ok = await this._saveCurrentStep({ silent: false });
      if (ok) this.onComplete?.();
    });

    this.btnExit?.addEventListener("click", () => this.onExit?.());
  }

  /** 先切换界面，再在后台保存离开步骤的参数（避免阻塞 UI） */
  _navigateToStep(step) {
    if (!Number.isFinite(step) || step < 1 || step > 4 || step === this.step) return;
    if (this.step === 4) this._readStep4FromForm();
    const fromStep = this.step;
    const fragment = this._collectStepFragment();
    this.goToStep(step);
    this._persistStepFragment(fromStep, fragment);
  }

  _hasPersistableFragment(step, fragment) {
    if (!fragment || typeof fragment !== "object") return false;
    if (step === 2) return false;
    return Object.keys(fragment).length > 0;
  }

  _persistStepFragment(step, fragment) {
    if (!this._hasPersistableFragment(step, fragment)) return;
    if (isMockMode()) return;
    const api = window.__markeyeApp?.api;
    if (!api?.put) return;
    api.put(`/api/wizard/step/${step}`, fragment).catch(() => {
      showToast(`STEP${step} 参数保存失败`, "err");
    });
  }

  goToStep(step) {
    if (this.step === 3 && step !== 3) {
      this._readToolEditor();
    }
    if (step !== 3 && this._hsvMatchPreviewActive) {
      this._clearHsvMatchPreview();
    }
    if (step !== 3) this._hsvPickActive = false;
    if (step !== 4) this._stopIoPoll();
    this.step = step;
    if (step < 4) this.tab = "output";
    this._render();
    this.onStepChange?.(step);
  }

  show() {
    if (this.rightCol) this.rightCol.hidden = false;
    this.stepNav.hidden = false;
    this.footer.hidden = false;
    this.contentEl.hidden = false;
    this._render();
  }

  hide() {
    this._stopIoPoll();
    if (this.rightCol) this.rightCol.hidden = true;
    this.stepNav.hidden = true;
    this.footer.hidden = true;
    this.contentEl.hidden = true;
  }

  /** 切换程序后重置向导缓存，保留当前步骤 */
  reloadForProfile(step = this.step) {
    this._tools = [];
    this._step1Loaded = false;
    this._step3Loaded = false;
    this._step4Loaded = false;
    this._selectedToolId = null;
    this._hsvAreaResults = {};
    this._hsvPickActive = false;
    this._clearHsvMatchPreview();
    this.goToStep(step);
  }

  _render() {
    this.stepNav?.querySelectorAll(".wizard-step").forEach((btn) => {
      const s = parseInt(btn.dataset.step, 10);
      btn.classList.toggle("is-active", s === this.step);
      btn.classList.toggle("is-done", s < this.step);
    });

    if (this.btnBack) this.btnBack.disabled = this.step === 1;
    if (this.btnNext) {
      this.btnNext.textContent =
        this.step < 4 ? `进入到STEP${this.step + 1} ›` : "完成";
    }

    const meta = STEP_TITLES[this.step];
    if (!this.contentEl || !meta) return;

    if (this.step === 1) this.contentEl.innerHTML = this._renderStep1(meta);
    else if (this.step === 2) this.contentEl.innerHTML = this._renderStep2(meta);
    else if (this.step === 3) this.contentEl.innerHTML = this._renderStep3(meta);
    else this.contentEl.innerHTML = this._renderStep4(meta);

    this._bindStepEvents();
    if (this.step === 1) this._hydrateStep1();
    if (this.step === 2) this._hydrateStep2();
    if (this.step === 3) this._hydrateStep3();
    if (this.step === 4) this._hydrateStep4();
    this._syncIoPoll();
  }

  async _hydrateStep2() {
    // 缩略图与预览由 app._onWizardStepChange 统一加载，避免重复请求
  }

  async _hydrateStep1() {
    if (isMockMode() || this._step1Loaded) return;

    try {
      const data = await window.__markeyeApp?.api?.get?.("/api/wizard/step/1");
      const source = data?.trigger?.source || "external";
      const sel = this.contentEl?.querySelector('[data-field="trigger-source"]');
      if (sel) {
        sel.value = source === "internal" ? "software" : source;
      }
      const delay = data?.trigger?.delay_ms;
      const delayEl = this.contentEl?.querySelector('[data-field="trigger-delay"]');
      if (delayEl && delay != null) delayEl.value = String(delay);

      const exposure = data?.input?.exposure;
      const exposureEl = this.contentEl?.querySelector('[data-field="exposure"]');
      if (exposureEl && exposure != null) exposureEl.value = String(exposure);

      const gain = data?.input?.gain;
      const gainEl = this.contentEl?.querySelector('[data-field="gain"]');
      if (gainEl && gain != null) gainEl.value = String(gain);

      const cameras = Array.isArray(data?.input?.cameras) && data.input.cameras.length
        ? [...new Set(data.input.cameras.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
        : data?.input?.camera_id != null
          ? [parseInt(data.input.camera_id, 10) || 0]
          : DEFAULT_CAMERAS_LIST();
      const listEl = this.contentEl?.querySelector("#wizard-camera-list");
      if (listEl) listEl.innerHTML = _renderCameraListRows(cameras.length ? cameras : DEFAULT_CAMERAS_LIST());
      const defaultId = data?.input?.camera_id != null ? parseInt(data.input.camera_id, 10) : cameras[0];
      _refreshDefaultCameraSelect(this.contentEl, cameras.length ? cameras : DEFAULT_CAMERAS_LIST(), defaultId);

      this._bindStep1CameraEvents();
      this._step1Loaded = true;
    } catch {
      this._bindStep1CameraEvents();
      this._step1Loaded = true;
    }
  }

  _renderStep1(meta) {
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-accordion">
        <div class="wizard-accordion__item is-open">
          <button type="button" class="wizard-accordion__head is-active" data-acc="trigger">
            触发条件 <span class="wizard-accordion__hint">外部触发、延迟0ms</span>
          </button>
          <div class="wizard-accordion__body">
            <div class="wizard-form-row">
              <label>触发源</label>
              <select data-field="trigger-source">
                <option value="external" selected>外部触发</option>
                <option value="software">软触发</option>
              </select>
            </div>
            <div class="wizard-form-row">
              <label>延迟 (ms)</label>
              <input type="number" value="0" min="0" max="10000" data-field="trigger-delay" />
            </div>
            <div class="wizard-form-row wizard-form-row--camera-list">
              <label>相机号码</label>
              <div class="wizard-camera-list-wrap">
                <div id="wizard-camera-list" class="wizard-camera-list">
                  ${_renderCameraListRows(DEFAULT_CAMERAS_LIST())}
                </div>
                <div class="wizard-camera-list-actions">
                  <button type="button" class="btn btn-secondary btn-camera-add" data-action="camera-add">＋ 追加相机</button>
                  <button type="button" class="btn btn-secondary btn-camera-enumerate" data-action="camera-enumerate">🔍 枚举相机</button>
                </div>
              </div>
            </div>
            <div class="wizard-form-row">
              <label>默认相机</label>
              <select data-field="camera-default" aria-label="默认相机">
                <option value="0" selected>0</option>
              </select>
            </div>
          </div>
        </div>
        <div class="wizard-accordion__item">
          <button type="button" class="wizard-accordion__head" data-acc="brightness">调节亮度/焦点</button>
          <div class="wizard-accordion__body">
            <div class="wizard-form-row"><label>曝光</label><input type="number" value="50" min="0" max="100" data-field="exposure" /></div>
            <div class="wizard-form-row"><label>增益</label><input type="number" value="1" min="0" max="10" step="0.1" data-field="gain" /></div>
          </div>
        </div>
        <div class="wizard-accordion__item">
          <button type="button" class="wizard-accordion__head" data-acc="ext">扩展功能</button>
          <div class="wizard-accordion__body"><p>扩展功能（Phase 2）</p></div>
        </div>
      </div>
    `;
  }

  _step2MasterThumbHtml(cam) {
    const url = window.__markeyeApp?.getMasterThumbSrc?.(cam);
    if (url) {
      return `<img src="${url}" alt="CAM#${cam} 已注册图像" />`;
    }
    return `<span class="wizard-master-thumb__placeholder">CAM#${cam} 已注册图像</span>`;
  }

  refreshStep2MasterThumbs() {
    if (this.step !== 2) return;
    [0, 1].forEach((cam) => {
      const el = this.contentEl?.querySelector(`[data-master-thumb="${cam}"]`);
      if (el) el.innerHTML = this._step2MasterThumbHtml(cam);
    });
  }

  _renderStep2(meta) {
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-tabs">
        <button type="button" class="wizard-tab is-active" data-tab="master">注册主控图像</button>
        <button type="button" class="wizard-tab" data-tab="ext">扩展功能</button>
      </div>
      <div class="wizard-tab-panel is-active" data-panel="master">
        <p>将各通道 Live 画面分别注册为主控图像，供 STEP3 工具设定使用。</p>
        <div class="wizard-form-row" style="margin-top:12px">
          <label>预览通道</label>
          <select id="wizard-step2-preview-cam">
            <option value="0" ${this._previewCamSlot === 0 ? "selected" : ""}>CAM#0</option>
            <option value="1" ${this._previewCamSlot === 1 ? "selected" : ""}>CAM#1</option>
          </select>
        </div>
        <div class="wizard-master-grid">
          <div class="wizard-master-col">
            <button type="button" class="btn btn-primary wizard-master-register-btn" data-action="register-live" data-cam="0">注册 CAM#0 Live 图像</button>
            <div class="wizard-master-thumb" data-master-thumb="0">${this._step2MasterThumbHtml(0)}</div>
          </div>
          <div class="wizard-master-col">
            <button type="button" class="btn btn-primary wizard-master-register-btn" data-action="register-live" data-cam="1">注册 CAM#1 Live 图像</button>
            <div class="wizard-master-thumb" data-master-thumb="1">${this._step2MasterThumbHtml(1)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary wizard-master-file-btn" data-action="save-master">注册主控图像</button>
      </div>
      <div class="wizard-tab-panel" data-panel="ext"><p>扩展功能（Phase 2）</p></div>
    `;
  }

  _renderStep3(meta) {
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-tool-actions">
        <button type="button" class="btn btn-primary" data-action="tool-add">＋ 追加工具</button>
        <button type="button" class="btn btn-secondary" data-action="tool-edit">✎ 编辑</button>
        <button type="button" class="btn btn-secondary" data-action="tool-copy">⧉ 复制</button>
        <button type="button" class="btn btn-secondary btn-danger" data-action="tool-delete">✕ 删除</button>
        <button type="button" class="btn btn-secondary wizard-tool-save-btn" data-action="tool-save">💾 保存参数</button>
      </div>
      <div class="wizard-tool-list" id="wizard-tool-list"></div>
      <div class="wizard-tool-editor" id="wizard-tool-editor" style="margin-top:12px"></div>
    `;
  }

  _renderStep4(meta) {
    const logic = this._comprehensiveLogic ?? 1;
    const trerrOn = this._trerrEnabled !== false;
    const logicBtnClass = (n) =>
      `btn btn-secondary${logic === n ? " is-active" : ""}`;
    const io = this._ioConfig || {};
    const transport = io.transport || "rtu";
    const ioEnabled = io.enabled === true;
    const outOpts = _ioOutOptions(this._tools);
    const outRows = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) =>
      _renderIoSelect(
        `out-assign-${i}`,
        outOpts,
        this._outputAssignments[i] || "off",
        `OUT${i + 1}`,
      ),
    ).join("");
    const inRows = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) =>
      _renderIoSelect(
        `in-assign-${i}`,
        IO_IN_OPTIONS,
        this._inputAssignments[i] || "off",
        `IN${i + 1}`,
      ),
    ).join("");
    const tcpFieldsHidden = transport === "rtu" ? " hidden" : "";
    const rtuFieldsHidden = transport === "tcp" ? " hidden" : "";
    const linkBadgeClass = _ioLinkBadgeClass(ioEnabled, this._ioConnected);
    const linkBadgeLabel = _ioLinkBadgeLabel(ioEnabled, this._ioConnected);
    const inBtns = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) =>
      _renderIoChannelBtn("in", i, this._ioLiveInputs[i]),
    ).join("");
    const outBtns = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) =>
      _renderIoChannelBtn("out", i, this._ioLiveOutputs[i]),
    ).join("");
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-tabs">
        <button type="button" class="wizard-tab ${this.tab === "output" ? "is-active" : ""}" data-tab="output">输出分配</button>
        <button type="button" class="wizard-tab ${this.tab === "logic" ? "is-active" : ""}" data-tab="logic">综合判断</button>
        <button type="button" class="wizard-tab ${this.tab === "autoswitch" ? "is-active" : ""}" data-tab="autoswitch">自动切换程序</button>
        <button type="button" class="wizard-tab ${this.tab === "modbus" ? "is-active" : ""}" data-tab="modbus">Modbus</button>
        <button type="button" class="wizard-tab ${this.tab === "ext2" ? "is-active" : ""}" data-tab="ext2">扩展功能 2</button>
      </div>
      <div class="wizard-tab-panel ${this.tab === "output" ? "is-active" : ""}" data-panel="output">
        <div class="wizard-io-grid">
          <div class="wizard-io-grid__col">${outRows}</div>
          <div class="wizard-io-grid__col">${inRows}</div>
        </div>
        <div class="wizard-form-row"><label>触发错误</label>
          <div class="toggle-group" data-toggle="trerr">
            <button type="button" class="${trerrOn ? "is-active" : ""}" data-val="on">有效</button>
            <button type="button" class="${!trerrOn ? "is-active" : ""}" data-val="off">无效</button>
          </div>
        </div>
      </div>
      <div class="wizard-tab-panel ${this.tab === "logic" ? "is-active" : ""}" data-panel="logic">
        <div class="wizard-form-row"><label>综合判断条件</label>
          <select data-field="comprehensive-condition">
            <option value="1" ${logic === 1 ? "selected" : ""}>全部OK</option>
            <option value="2" ${logic === 2 ? "selected" : ""}>任一NG</option>
          </select>
        </div>
        <p>定义逻辑判断条件：</p>
        <div class="wizard-logic-btns">
          <button type="button" class="${logicBtnClass(1)}" data-action="logic" data-n="1">逻辑 1</button>
          <button type="button" class="${logicBtnClass(2)}" data-action="logic" data-n="2">逻辑 2</button>
          <button type="button" class="${logicBtnClass(3)}" data-action="logic" data-n="3">逻辑 3</button>
          <button type="button" class="${logicBtnClass(4)}" data-action="logic" data-n="4">逻辑 4</button>
        </div>
      </div>
      <div class="wizard-tab-panel ${this.tab === "autoswitch" ? "is-active" : ""}" data-panel="autoswitch">
        <div class="wizard-form-row"><label>自动切换程序</label>
          <div class="toggle-group" data-toggle="autoswitch">
            <button type="button" class="is-active" data-val="on">有效</button>
            <button type="button" data-val="off">无效</button>
          </div>
        </div>
        <div class="wizard-form-row"><label>综合判断OK时</label><select><option>不切换</option></select></div>
        <div class="wizard-form-row"><label>延迟 (ms)</label><input type="number" value="3000" min="0" max="10000" /></div>
        <div class="wizard-form-row"><label>综合判断NG时</label><select><option>不切换</option></select></div>
        <div class="wizard-form-row"><label>延迟 (ms)</label><input type="number" value="3000" min="0" max="10000" /></div>
        <div class="wizard-form-row"><label>判断NG的时机</label><select><option>每次触发</option></select></div>
        <div class="wizard-form-row"><label>重试次数</label><input type="number" value="5" min="0" max="999" disabled /></div>
      </div>
      <div class="wizard-tab-panel ${this.tab === "modbus" ? "is-active" : ""}" data-panel="modbus">
        <div class="wizard-modbus-layout">
          <div class="wizard-modbus-config">
            <div class="wizard-form-row wizard-modbus-enable-row">
              <label>IO 启用</label>
              <div class="toggle-group" data-toggle="io-enabled">
                <button type="button" class="${ioEnabled ? "is-active" : ""}" data-val="on">开ON</button>
                <button type="button" class="${!ioEnabled ? "is-active" : ""}" data-val="off">关OFF</button>
              </div>
              <button type="button" class="wizard-io-link-badge ${linkBadgeClass}" data-action="io-reconnect" title="点击重新连接">${linkBadgeLabel}</button>
            </div>
            <div class="wizard-form-row"><label>传输方式</label>
              <select data-field="io-transport">
                <option value="rtu" ${transport === "rtu" ? "selected" : ""}>RTU 串口</option>
                <option value="tcp" ${transport === "tcp" ? "selected" : ""}>TCP</option>
              </select>
            </div>
            <div class="wizard-form-row wizard-io-rtu-field${rtuFieldsHidden}"><label>串口</label>
              <input type="text" data-field="io-serial-port" value="${io.serial_port || "COM4"}" />
            </div>
            <div class="wizard-form-row wizard-io-rtu-field${rtuFieldsHidden}"><label>波特率</label>
              <input type="number" data-field="io-baudrate" value="${io.baudrate ?? 9600}" min="300" max="115200" />
            </div>
            <div class="wizard-form-row wizard-io-rtu-field${rtuFieldsHidden}"><label>数据位</label>
              <input type="number" data-field="io-bytesize" value="${io.bytesize ?? 8}" min="5" max="8" />
            </div>
            <div class="wizard-form-row wizard-io-rtu-field${rtuFieldsHidden}"><label>校验位</label>
              <select data-field="io-parity">
                <option value="N" ${(io.parity || "N") === "N" ? "selected" : ""}>N</option>
                <option value="E" ${io.parity === "E" ? "selected" : ""}>E</option>
                <option value="O" ${io.parity === "O" ? "selected" : ""}>O</option>
              </select>
            </div>
            <div class="wizard-form-row wizard-io-rtu-field${rtuFieldsHidden}"><label>停止位</label>
              <input type="number" data-field="io-stopbits" value="${io.stopbits ?? 1}" min="1" max="2" />
            </div>
            <div class="wizard-form-row wizard-io-tcp-field${tcpFieldsHidden}"><label>TCP 主机</label>
              <input type="text" data-field="io-host" value="${io.host || "127.0.0.1"}" />
            </div>
            <div class="wizard-form-row wizard-io-tcp-field${tcpFieldsHidden}"><label>TCP 端口</label>
              <input type="number" data-field="io-port" value="${io.port ?? 502}" min="1" max="65535" />
            </div>
            <div class="wizard-form-row"><label>从站地址</label>
              <input type="number" data-field="io-unit-id" value="${io.unit_id ?? 1}" min="1" max="247" />
            </div>
            <div class="wizard-form-row"><label>轮询间隔 (ms)</label>
              <input type="number" data-field="io-poll-interval" value="${io.poll_interval_ms ?? 50}" min="10" max="5000" />
            </div>
            <div class="wizard-form-row"><label>输出保持 (ms)</label>
              <input type="number" data-field="io-output-pulse-ms" value="${io.output_pulse_ms ?? 0}" min="0" max="10000" />
            </div>
            <div class="wizard-form-row"><label>重连间隔 (s)</label>
              <input type="number" data-field="io-reconnect-interval" value="${io.reconnect_interval_s ?? 3}" min="1" max="60" />
            </div>
          </div>
          <div class="wizard-modbus-io-panel">
            <div class="wizard-modbus-io-head">
              <span>IN</span>
              <span>OUT</span>
            </div>
            <div class="wizard-modbus-io-cols">
              <div class="wizard-modbus-io-col">${inBtns}</div>
              <div class="wizard-modbus-io-col">${outBtns}</div>
            </div>
            <p class="wizard-modbus-io-hint">IN：实时输入状态；OUT：点击切换线圈测试</p>
          </div>
        </div>
      </div>
      <div class="wizard-tab-panel ${this.tab === "ext2" ? "is-active" : ""}" data-panel="ext2"><p>扩展功能 2（Phase 2）</p></div>
    `;
  }

  _bindStepEvents() {
    this.contentEl?.querySelectorAll(".wizard-accordion__head").forEach((head) => {
      head.addEventListener("click", () => {
        const item = head.closest(".wizard-accordion__item");
        const open = item?.classList.contains("is-open");
        this.contentEl.querySelectorAll(".wizard-accordion__item").forEach((i) => {
          i.classList.remove("is-open");
          i.querySelector(".wizard-accordion__head")?.classList.remove("is-active");
        });
        if (!open) {
          item?.classList.add("is-open");
          head.classList.add("is-active");
        }
      });
    });

    this.contentEl?.querySelectorAll(".wizard-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const next = tab.dataset.tab;
        if (!next || next === this.tab) return;
        if (this.step === 4) {
          this._readStep4FromForm();
          this.tab = next;
          this._switchStep4Tab();
          return;
        }
        this.tab = next;
        this._render();
      });
    });

    this.contentEl?.querySelectorAll(".toggle-group button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.closest(".toggle-group");
        group?.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    });

    if (this.step === 1) {
      this.contentEl?.querySelector('[data-action="camera-add"]')?.addEventListener("click", () => {
        const listEl = this.contentEl?.querySelector("#wizard-camera-list");
        if (!listEl) return;
        const cameras = _readCamerasListFromForm(this.contentEl);
        const next = cameras.length ? Math.max(...cameras) + 1 : 0;
        cameras.push(next);
        listEl.innerHTML = _renderCameraListRows(cameras);
        _refreshDefaultCameraSelect(this.contentEl, cameras);
        this._bindStep1CameraEvents();
      });

      this.contentEl?.querySelector('[data-action="camera-enumerate"]')?.addEventListener("click", () => {
        this._enumerateCameras();
      });

      this._bindStep1CameraEvents();
    }

    if (this.step === 2) {
      this.contentEl?.querySelector("#wizard-step2-preview-cam")?.addEventListener("change", async (e) => {
        this._previewCamSlot = parseInt(e.target.value, 10) || 0;
        window.__markeyeApp?.imageViewer?.setPreviewCamSlot?.(this._previewCamSlot);
        await window.__markeyeApp?._refreshStep2PreviewFrame?.(this._previewCamSlot);
      });
    }

    if (this.step === 4) {
      this.contentEl?.querySelector('[data-field="comprehensive-condition"]')?.addEventListener("change", (e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) {
          this._comprehensiveLogic = n;
          this._updateComprehensiveLogicUI();
        }
      });
      this.contentEl?.querySelectorAll('[data-action="logic"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const n = parseInt(btn.dataset.n, 10);
          if (Number.isFinite(n)) {
            this._comprehensiveLogic = n;
            this._updateComprehensiveLogicUI();
          }
        });
      });
      this.contentEl?.querySelector('[data-field="io-transport"]')?.addEventListener("change", (e) => {
        this._ioConfig = { ...this._ioConfig, transport: e.target.value };
        this._updateIoTransportFields(e.target.value);
      });
      this.contentEl?.querySelector('[data-action="io-reconnect"]')?.addEventListener("click", () => {
        this._ioReconnect();
      });
      this.contentEl?.querySelectorAll('[data-toggle="io-enabled"] button').forEach((btn) => {
        btn.addEventListener("click", () => {
          const enabled = btn.dataset.val === "on";
          this._ioSwitchEnabled(enabled);
        });
      });
      this.contentEl?.querySelectorAll('[data-io-ch="out"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const ch = parseInt(btn.dataset.ch, 10);
          if (Number.isFinite(ch)) this._ioTestOutput(ch);
        });
      });
      this.contentEl?.querySelectorAll('[data-io-ch="in"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          this._refreshIoStatus();
        });
      });
    }

    // STEP3 tools
    if (this.step === 3) {
      this.contentEl?.querySelector('[data-action="tool-add"]')?.addEventListener("click", () => {
        this._readToolEditor();
        this._tools = [...this._tools, DEFAULT_TOOL()];
        this._renumberToolIds();
        this._selectedToolId = this._tools.at(-1)?.id || null;
        this._renderStep3ListAndEditor({ skipEditorFlush: true });
        const added = this._tools.find((t) => t.id === this._selectedToolId);
        if (added) this._enableRoiForTool(added);
        showToast("已追加工具", "ok");
      });

      this.contentEl?.querySelector('[data-action="tool-copy"]')?.addEventListener("click", () => {
        this._readToolEditor();
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        const copy = structuredClone(src);
        delete copy.id;
        copy.name = `${copy.name || "工具"}_copy`;
        this._tools = [...this._tools, copy];
        this._renumberToolIds();
        this._selectedToolId = this._tools.at(-1)?.id || null;
        this._renderStep3ListAndEditor({ skipEditorFlush: true });
        showToast("已复制工具", "ok");
      });

      this.contentEl?.querySelector('[data-action="tool-delete"]')?.addEventListener("click", async () => {
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        const ok = await confirmModal(`确定要删除工具 ${src.id}: ${src.name} 吗？`);
        if (!ok) return;
        this._readToolEditor();
        this._tools = this._tools.filter((t) => t.id !== src.id);
        this._renumberToolIds();
        this._selectedToolId = this._tools[0]?.id || null;
        this._renderStep3ListAndEditor({ skipEditorFlush: true });
        showToast("已删除工具", "warn");
      });

      this.contentEl?.querySelector('[data-action="tool-edit"]')?.addEventListener("click", async () => {
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        this._enableRoiForTool(src);
      });

      this.contentEl?.querySelector('[data-action="tool-save"]')?.addEventListener("click", async () => {
        const ok = await this._saveCurrentStep({ silent: false });
        if (!ok) return;
        // 回读一次后端持久化结果，避免“看似保存成功但配置未落盘”的错觉
        try {
          const data = await window.__markeyeApp?.api?.get?.("/api/wizard/step/3");
          if (Array.isArray(data?.tools)) this._tools = data.tools;
        } catch {
          /* ignore */
        }
        this._renumberToolIds();
        this._renderStep3ListAndEditor();
        const sel = this._tools.find((t) => t.id === this._selectedToolId);
        if (sel) this._enableRoiForTool(sel);
        showToast(`STEP3 工具已保存：${this._tools.filter((t) => t?.enabled !== false).length} 个启用`, "ok");
      });

      this.contentEl?.querySelector("#wizard-tool-list")?.addEventListener("click", (e) => {
        const card = e.target.closest(".tool-card");
        if (!card) return;
        if (card.dataset.id === this._selectedToolId) return;
        if (this._hsvMatchPreviewActive) this._clearHsvMatchPreview();
        this._switchSelectedTool(card.dataset.id);
        const sel = this._tools.find((t) => t.id === this._selectedToolId);
        if (sel) {
          const slot = _toolCamSlot(sel);
          window.__markeyeApp?.imageViewer?.setPreviewCamSlot?.(slot);
          window.__markeyeApp?.showLivePreviewSlot?.(slot).then(() => {
            this._enableRoiForTool(sel);
          });
        }
      });

      this.contentEl?.querySelector("#wizard-tool-editor")?.addEventListener("change", async (e) => {
        if (!e.target.matches("[data-tool-field], [data-roi-field], [data-param-field]")) return;
        const editorEl = e.currentTarget;
        const refocusKey = editorEl.contains(document.activeElement)
          ? _editorFieldKey(document.activeElement)
          : null;
        const camChanged = e.target.matches('[data-tool-field="cam"]');
        if (e.target.matches("[data-roi-field]") && this._selectedToolId) {
          delete this._hsvAreaResults[this._selectedToolId];
        }
        this._readToolEditor();
        this._renderStep3ListAndEditor();
        if (refocusKey) _focusEditorField(editorEl, refocusKey);
        const sel = this._tools.find((t) => t.id === this._selectedToolId);
        if (camChanged && sel) {
          const slot = _toolCamSlot(sel);
          window.__markeyeApp?.imageViewer?.setPreviewCamSlot?.(slot);
          await window.__markeyeApp?.showLivePreviewSlot?.(slot);
        }
        if (sel?.roi) window.__markeyeApp?.imageViewer?.updateRoiEditor?.(sel.roi);
        if (sel && !camChanged) this._enableRoiForTool(sel);
        if (this._hsvMatchPreviewActive) {
          const idx = this._tools.findIndex((t) => t.id === this._selectedToolId);
          if (idx >= 0) this._refreshHsvMatchPreview(idx);
        }
      });

      this.contentEl?.querySelector("#wizard-tool-editor")?.addEventListener("click", async (e) => {
        const action = e.target.closest("[data-editor-action]")?.dataset.editorAction;
        if (!action) return;
        const idx = this._tools.findIndex((t) => t.id === this._selectedToolId);
        if (idx < 0) return;
        const t = this._tools[idx];

        if (action === "roi-reset") {
          t.roi = { shape: "rect", x: 100, y: 100, w: 120, h: 80 };
          this._tools[idx] = t;
          this._renderStep3ListAndEditor();
          this._enableRoiForTool(t);
          showToast("ROI 已重置", "ok");
        }
        if (action === "hsv-pick-on") {
          this._hsvPickActive = true;
          this._enableRoiForTool(t, { allowPick: true });
          this._renderStep3ListAndEditor({ keepEditorFocus: true });
          showToast("HSV 取样已开启（请在 ROI 内单击目标颜色）", "ok");
        }
        if (action === "hsv-sample-roi") {
          await this._sampleHsvInRoi(idx);
        }
        if (action === "hsv-calc-area") {
          await this._calcHsvArea(idx);
        }
        if (action === "hsv-show-match") {
          await this._toggleHsvMatchPreview(idx);
        }
      });
    }
  }

  _enableRoiForTool(tool, { allowPick = false } = {}) {
    const viewer = window.__markeyeApp?.imageViewer;
    if (!viewer?.enableRoiEditor) return;
    const idx = this._tools.findIndex((t) => t.id === tool.id);
    const roi = tool.roi || { shape: "rect", x: 100, y: 100, w: 120, h: 80 };
    viewer.enableRoiEditor({
      roi,
      shape: roi.shape === "circle" ? "circle" : "rect",
      handles: "corners",
      allowPick,
      onRoiChange: (newRoi) => {
        if (idx >= 0) {
          this._tools[idx].roi = newRoi;
          delete this._hsvAreaResults[this._tools[idx].id];
          this._syncRoiFields(newRoi);
          this._updateHsvThresholdSlider(this._tools[idx]);
          if (this._hsvMatchPreviewActive) this._refreshHsvMatchPreview(idx);
        }
      },
      onPickPixel: ({ x, y, hsv }) => {
        if (idx < 0 || tool.type !== "hsv_roi") return;
        const v = window.__markeyeApp?.imageViewer;
        if (v && !v._isPointInRoi(x, y, this._tools[idx]?.roi || tool.roi)) {
          showToast("取样点不在 ROI 内，请重新在橙色区域单击", "warn");
          return;
        }
        const [h, s, val] = hsv;
        this._tools[idx].params = this._tools[idx].params || {};
        _applyHsvSample(this._tools[idx].params, h, s, val);
        this._hsvPickActive = false;
        this._renderStep3ListAndEditor({ keepEditorFocus: true });
        this._enableRoiForTool(this._tools[idx], { allowPick: false });
        if (h >= 35 && h <= 90 && s < 80) {
          showToast(`已取样 HSV=${h},${s},${val}（偏灰/绿色，橙色通常 H≈10–25）`, "warn");
        } else {
          showToast(`已取样 HSV=${h},${s},${val}`, "ok");
        }
      },
    });
  }

  async _sampleHsvInRoi(idx) {
    this._readToolEditor();
    const tool = this._tools[idx];
    if (!tool || tool.type !== "hsv_roi") return;

    let hsv = null;

    if (!isMockMode()) {
      try {
        const res = await window.__markeyeApp?.api?.post?.("/api/tools/hsv-sample-roi", {
          roi: tool.roi,
          cam: _toolCamSlot(tool),
          prefer_live: true,
        });
        hsv = res?.hsv;
      } catch {
        showToast("ROI 取样失败，请确认实时画面可用（相机已连接）", "err");
        return;
      }
    } else {
      const viewer = window.__markeyeApp?.imageViewer;
      if (!viewer?._hasFrame) {
        showToast("请先加载实时图像", "err");
        return;
      }
      hsv = viewer.sampleHsvFromRoi({ roi: tool.roi });
    }

    if (!hsv) {
      showToast("ROI 内无有效颜色像素", "err");
      return;
    }

    const [h, s, v] = hsv;
    tool.params = tool.params || {};
    _applyHsvSample(tool.params, h, s, v);
    this._tools[idx] = tool;
    this._renderStep3ListAndEditor();
    showToast(`ROI 内取样 HSV=${h},${s},${v}`, "ok");
  }

  async _calcHsvArea(idx) {
    this._readToolEditor();
    const tool = this._tools[idx];
    if (!tool || tool.type !== "hsv_roi") return;

    const p = tool.params || {};
    const hLower = p.h_lower || [0, 0, 0];
    const hUpper = p.h_upper || [180, 255, 255];
    let result = null;

    if (!isMockMode()) {
      try {
        result = await window.__markeyeApp?.api?.post?.("/api/tools/hsv-area", {
          roi: tool.roi,
          h_lower: hLower,
          h_upper: hUpper,
          cam: _toolCamSlot(tool),
          prefer_live: true,
        });
      } catch {
        showToast("面积计算失败，请确认实时画面可用（相机已连接）", "err");
        return;
      }
    } else {
      const viewer = window.__markeyeApp?.imageViewer;
      if (!viewer?._hasFrame) {
        showToast("请先加载实时图像", "err");
        return;
      }
      result = viewer.computeHsvAreaInRoi({ roi: tool.roi, hLower, hUpper });
    }

    if (!result) {
      showToast("无法计算面积", "err");
      return;
    }

    this._hsvAreaResults[tool.id] = result;
    this._renderStep3ListAndEditor();
    if (result.match === 0) {
      showToast(`符合面积为 0 px。请用「ROI 内取样」重新设定阈值（橙色 H≈10–25）`, "warn");
    } else {
      showToast(`符合 HSV 面积: ${result.match} px`, "ok");
    }
  }

  _clearHsvMatchPreview() {
    window.__markeyeApp?.imageViewer?.clearHsvMatchPreview?.();
    this._hsvMatchPreviewActive = false;
  }

  async _refreshHsvMatchPreview(idx) {
    this._readToolEditor();
    const tool = this._tools[idx];
    const viewer = window.__markeyeApp?.imageViewer;
    if (!tool || tool.type !== "hsv_roi" || !viewer?._hasFrame) return;

    const p = tool.params || {};
    const hLower = p.h_lower || [0, 0, 0];
    const hUpper = p.h_upper || [180, 255, 255];

    const applyFrontend = () => {
      viewer._hsvMatchPreview = { active: false, sourceData: null };
      viewer.setHsvMatchPreview({ active: true, roi: tool.roi, hLower, hUpper });
    };

    if (!isMockMode()) {
      try {
        if (!viewer._hsvMatchPreview?.sourceData) {
          viewer._hsvMatchPreview = {
            active: false,
            sourceData: viewer.ctx.getImageData(0, 0, viewer.imgWidth, viewer.imgHeight),
          };
        } else {
          viewer.ctx.putImageData(viewer._hsvMatchPreview.sourceData, 0, 0);
        }
        const res = await window.__markeyeApp?.api?.post?.("/api/tools/hsv-match-preview", {
          roi: tool.roi,
          h_lower: hLower,
          h_upper: hUpper,
          cam: _toolCamSlot(tool),
          prefer_live: true,
        });
        if (!res?.image_base64) throw new Error("no preview");
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            viewer.ctx.drawImage(img, 0, 0);
            viewer._hsvMatchPreview.active = true;
            viewer._render();
            resolve();
          };
          img.onerror = reject;
          img.src = `data:image/jpeg;base64,${res.image_base64}`;
        });
        return;
      } catch {
        applyFrontend();
        return;
      }
    }
    applyFrontend();
  }

  async _toggleHsvMatchPreview(idx) {
    this._readToolEditor();
    const tool = this._tools[idx];
    const viewer = window.__markeyeApp?.imageViewer;
    if (!tool || tool.type !== "hsv_roi") return;

    if (this._hsvMatchPreviewActive) {
      this._clearHsvMatchPreview();
      this._renderStep3ListAndEditor({ keepEditorFocus: true });
      showToast("已恢复原图", "ok");
      return;
    }

    if (!viewer?._hasFrame) {
      showToast("请先加载实时图像", "err");
      return;
    }

    await this._refreshHsvMatchPreview(idx);
    this._hsvMatchPreviewActive = true;
    this._renderStep3ListAndEditor({ keepEditorFocus: true });
    showToast("已显示 ROI 内匹配像素", "ok");
  }

  enableStep3Roi() {
    const sel = this._tools.find((t) => t.id === this._selectedToolId) || this._tools[0];
    if (sel) {
      this._selectedToolId = sel.id;
      this._renderStep3ListAndEditor();
      const slot = _toolCamSlot(sel);
      window.__markeyeApp?.imageViewer?.setPreviewCamSlot?.(slot);
      window.__markeyeApp?.showLivePreviewSlot?.(slot).then(() => {
        this._enableRoiForTool(sel);
      });
    }
  }

  getSelectedToolCam() {
    const sel = this._tools.find((t) => t.id === this._selectedToolId) || this._tools[0];
    return sel ? _toolCamSlot(sel) : 0;
  }

  _syncRoiFields(roi) {
    const editorEl = this.contentEl?.querySelector("#wizard-tool-editor");
    if (!editorEl || !roi) return;
    const map = { x: roi.x, y: roi.y, w: roi.w, h: roi.h, cx: roi.cx, cy: roi.cy, r: roi.r };
    editorEl.querySelectorAll("[data-roi-field]").forEach((el) => {
      const k = el.dataset.roiField;
      if (k === "shape") return;
      if (map[k] != null) el.value = map[k];
    });
  }

  _updateHsvThresholdSlider(tool) {
    if (!tool || tool.type !== "hsv_roi") return;
    const { min, max, value, endLabel } = _hsvSliderConfig(tool, this._hsvAreaResults);

    const card = this.contentEl?.querySelector(`.tool-card[data-id="${tool.id}"]`);
    const slider = card?.querySelector("[data-hsv-threshold-slider]");
    if (slider) {
      slider.min = String(min);
      slider.max = String(max);
      slider.value = String(value);
    }
    const valueEl = card?.querySelector(".tool-card__value");
    if (valueEl) valueEl.textContent = endLabel;

    if (tool.id !== this._selectedToolId) return;
    const editorEl = this.contentEl?.querySelector("#wizard-tool-editor");
    const roiAreaMax = _hsvRoiAreaMax(tool, this._hsvAreaResults);
    editorEl?.querySelectorAll('[data-param-field="match_area_max"], [data-param-field="match_area_min"]').forEach((el) => {
      el.max = String(roiAreaMax);
    });
  }

  async _hydrateStep3() {
    if (isMockMode()) {
      if (!this._tools.length) {
        this._tools = [
          { name: "色彩识别", type: "hsv_roi", enabled: true, roi: { shape: "rect", x: 100, y: 100, w: 120, h: 80 }, params: { h_lower: [0, 50, 50], h_upper: [180, 255, 255] } },
          { name: "轮廓识别", type: "contour_roi", enabled: true, roi: { shape: "rect", x: 260, y: 120, w: 180, h: 140 }, params: { target_shape: "rect", size_tolerance: 0.15, position_tolerance: 10, expected: { center: [350, 190], size: [120, 80] } } },
        ];
      }
      this._renumberToolIds();
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      if (this.step === 3) this.enableStep3Roi();
      return;
    }

    if (this._step3Loaded) {
      this._renumberToolIds();
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      if (this.step === 3) this.enableStep3Roi();
      return;
    }

    try {
      const data = await window.__markeyeApp?.api?.get?.("/api/wizard/step/3");
      this._tools = Array.isArray(data?.tools) ? data.tools : [];
      this._step3Loaded = true;
      this._renumberToolIds();
      this._selectedToolId = this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      if (this.step === 3) this.enableStep3Roi();
    } catch {
      this._tools = this._tools.length ? this._tools : [];
      this._renumberToolIds();
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      if (this.step === 3) this.enableStep3Roi();
    }
  }

  async _hydrateStep4() {
    if (isMockMode()) {
      this._comprehensiveLogic = 1;
      this._trerrEnabled = true;
      this._ioConnected = true;
      return;
    }
    if (!this._tools.length) {
      try {
        const t3 = await window.__markeyeApp?.api?.get?.("/api/wizard/step/3");
        if (Array.isArray(t3?.tools)) this._tools = t3.tools;
      } catch {
        /* ignore */
      }
    }
    if (this._step4Loaded) return;
    try {
      const data = await window.__markeyeApp?.api?.get?.("/api/wizard/step/4");
      const io = data?.io || {};
      this._ioConfig = io;
      if (Array.isArray(io.output_assignments) && io.output_assignments.length) {
        this._outputAssignments = [...io.output_assignments];
        while (this._outputAssignments.length < IO_CHANNEL_COUNT) {
          this._outputAssignments.push("off");
        }
      }
      if (Array.isArray(io.input_assignments) && io.input_assignments.length) {
        this._inputAssignments = [...io.input_assignments];
        while (this._inputAssignments.length < IO_CHANNEL_COUNT) {
          this._inputAssignments.push("off");
        }
      }
      const logic = parseInt(io.comprehensive_logic, 10);
      this._comprehensiveLogic = Number.isFinite(logic) && logic >= 1 && logic <= 4 ? logic : 1;
      this._trerrEnabled = io.trerr_enabled !== false;
      this._step4Loaded = true;
      if (this.step === 4) this._render();
    } catch {
      this._comprehensiveLogic = 1;
      this._trerrEnabled = true;
    }
  }

  _switchStep4Tab() {
    if (!this.contentEl) return;
    this.contentEl.querySelectorAll(".wizard-tab").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.tab === this.tab);
    });
    this.contentEl.querySelectorAll(".wizard-tab-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === this.tab);
    });
    this._syncIoPoll();
  }

  _updateComprehensiveLogicUI() {
    const logic = this._comprehensiveLogic ?? 1;
    const condSel = this.contentEl?.querySelector('[data-field="comprehensive-condition"]');
    if (condSel) condSel.value = String(logic <= 2 ? logic : 1);
    this.contentEl?.querySelectorAll('[data-action="logic"]').forEach((btn) => {
      const n = parseInt(btn.dataset.n, 10);
      btn.classList.toggle("is-active", n === logic);
    });
  }

  _updateIoTransportFields(transport) {
    const isTcp = transport === "tcp";
    this.contentEl?.querySelectorAll(".wizard-io-rtu-field").forEach((el) => {
      el.classList.toggle("hidden", isTcp);
    });
    this.contentEl?.querySelectorAll(".wizard-io-tcp-field").forEach((el) => {
      el.classList.toggle("hidden", !isTcp);
    });
  }

  _readStep4FromForm() {
    if (this.step !== 4) return;
    this._collectStepFragment();
  }

  _syncIoPoll() {
    if (this.step === 4 && this.tab === "modbus") {
      this._startIoPoll();
    } else {
      this._stopIoPoll();
    }
  }

  _startIoPoll() {
    if (this._ioPollTimer) return;
    this._refreshIoStatus();
    this._ioPollTimer = setInterval(() => this._refreshIoStatus(), 400);
  }

  _stopIoPoll() {
    if (!this._ioPollTimer) return;
    clearInterval(this._ioPollTimer);
    this._ioPollTimer = null;
  }

  async _refreshIoStatus() {
    try {
      const data = await window.__markeyeApp?.api?.get?.("/api/io/status");
      if (!data) return;
      if (Array.isArray(data.input_bits)) {
        this._ioLiveInputs = data.input_bits.map((v) => !!v);
      }
      if (Array.isArray(data.output_bits)) {
        this._ioLiveOutputs = data.output_bits.map((v) => !!v);
      }
      this._ioConnected = !!data.connected;
      this._updateIoChannelUI();
    } catch {
      /* ignore */
    }
  }

  _updateIoChannelUI() {
    if (this.step !== 4 || this.tab !== "modbus" || !this.contentEl) return;
    const ioEnabled =
      this.contentEl.querySelector('[data-toggle="io-enabled"] .is-active')?.dataset?.val === "on";
    const badge = this.contentEl.querySelector('[data-action="io-reconnect"]');
    if (badge) {
      badge.textContent = _ioLinkBadgeLabel(ioEnabled, this._ioConnected);
      badge.className = `wizard-io-link-badge ${_ioLinkBadgeClass(ioEnabled, this._ioConnected)}`;
    }
    this.contentEl.querySelectorAll('[data-io-ch="in"]').forEach((btn) => {
      const i = parseInt(btn.dataset.ch, 10);
      if (Number.isFinite(i)) btn.classList.toggle("is-on", !!this._ioLiveInputs[i]);
    });
    this.contentEl.querySelectorAll('[data-io-ch="out"]').forEach((btn) => {
      const i = parseInt(btn.dataset.ch, 10);
      if (Number.isFinite(i)) btn.classList.toggle("is-on", !!this._ioLiveOutputs[i]);
    });
  }

  async _ioReconnect() {
    const ioEnabled =
      this.contentEl?.querySelector('[data-toggle="io-enabled"] .is-active')?.dataset?.val === "on";
    if (!ioEnabled) {
      showToast("请先启用 IO", "warn");
      return;
    }
    try {
      await this._saveCurrentStep({ silent: true });
      const data = await window.__markeyeApp?.api?.post?.("/api/io/reconnect");
      if (Array.isArray(data?.input_bits)) this._ioLiveInputs = data.input_bits.map((v) => !!v);
      if (Array.isArray(data?.output_bits)) this._ioLiveOutputs = data.output_bits.map((v) => !!v);
      this._ioConnected = !!data?.connected;
      this._updateIoChannelUI();
      showToast(data?.ok ? "Modbus 已连接" : "Modbus 连接失败", data?.ok ? "ok" : "err");
    } catch {
      showToast("重连失败", "err");
    }
  }

  async _ioSwitchEnabled(enabled) {
    if (isMockMode()) {
      this._ioConfig = { ...this._ioConfig, enabled: !!enabled };
      this._ioConnected = !!enabled;
      this._updateIoChannelUI();
      showToast(enabled ? "Modbus 已开启" : "Modbus 已关闭", "ok");
      return;
    }
    try {
      // 先保存 STEP4 表单（包括串口参数），再切换启用状态
      await this._saveCurrentStep({ silent: true });
      const data = await window.__markeyeApp?.api?.post?.("/api/io/switch", { enabled: !!enabled });
      this._ioConnected = !!data?.connected;
      if (Array.isArray(data?.input_bits)) this._ioLiveInputs = data.input_bits.map((v) => !!v);
      if (Array.isArray(data?.output_bits)) this._ioLiveOutputs = data.output_bits.map((v) => !!v);
      this._updateIoChannelUI();
      if (enabled) {
        showToast(data?.connected ? "Modbus 连接成功" : "Modbus 连接失败", data?.connected ? "ok" : "err");
      } else {
        showToast("Modbus 已关闭", "ok");
      }
    } catch {
      showToast("切换 IO 失败", "err");
      // 回读状态避免 UI 停在错误状态
      this._refreshIoStatus();
    }
  }

  async _ioTestOutput(channel) {
    const ch = Math.max(0, Math.min(IO_CHANNEL_COUNT - 1, channel));
    const next = !this._ioLiveOutputs[ch];
    try {
      const data = await window.__markeyeApp?.api?.post?.("/api/io/test/output", {
        channel: ch,
        value: next,
      });
      if (Array.isArray(data?.output_bits)) {
        this._ioLiveOutputs = data.output_bits.map((v) => !!v);
      } else {
        this._ioLiveOutputs[ch] = next;
      }
      this._updateIoChannelUI();
    } catch (err) {
      const msg = typeof err?.message === "string" ? err.message : "";
      showToast(msg ? `OUT${ch + 1} 测试失败：${msg}` : `OUT${ch + 1} 测试失败`, "err");
    }
  }

  /** 按列表顺序自动分配工具 ID，并保留当前选中项与 HSV 面积缓存 */
  _renumberToolIds() {
    const selIdx = this._tools.findIndex((t) => t.id === this._selectedToolId);
    const areaByIndex = this._tools.map((t) => this._hsvAreaResults[t.id]);

    this._tools.forEach((t, i) => {
      t.id = _formatToolId(i);
      if (t.cam === undefined || t.cam === null) t.cam = 0;
    });

    this._hsvAreaResults = {};
    this._tools.forEach((t, i) => {
      if (areaByIndex[i]) this._hsvAreaResults[t.id] = areaByIndex[i];
    });

    if (selIdx >= 0 && selIdx < this._tools.length) {
      this._selectedToolId = this._tools[selIdx].id;
    }
  }

  _switchSelectedTool(toolId) {
    if (!toolId || toolId === this._selectedToolId) return;
    this._readToolEditor();
    this._selectedToolId = toolId;
    this._hsvPickActive = false;
    this._renderStep3ListAndEditor({ skipEditorFlush: true });
  }

  _renderStep3ListAndEditor({ keepEditorFocus = false, skipEditorFlush = false } = {}) {
    const listEl = this.contentEl?.querySelector("#wizard-tool-list");
    const editorEl = this.contentEl?.querySelector("#wizard-tool-editor");
    if (!listEl || !editorEl) return;

    // 重绘前先同步编辑器 → 当前选中工具（切换工具时须 skipEditorFlush，避免写入错误工具）
    if (!skipEditorFlush && editorEl.querySelector("[data-param-field]")) {
      this._readToolEditor();
    }

    if (!this._selectedToolId && this._tools.length) this._selectedToolId = this._tools[0].id;
    const sel = this._tools.find((t) => t.id === this._selectedToolId) || null;

    listEl.innerHTML = "";
    for (const t of this._tools) {
      const selected = t.id === this._selectedToolId ? " is-selected" : "";
      const card = document.createElement("article");
      card.className = `tool-card${selected}`;
      card.dataset.id = t.id;
      card.dataset.state = t.enabled === false ? "off" : "ok";

      let barHtml = `<input type="range" disabled min="0" max="100" value="0" style="width:100%" />`;
      if (t.type === "hsv_roi") {
        const { min, max, value } = _hsvSliderConfig(t, this._hsvAreaResults);
        barHtml = `
          <div class="tool-card__bar">
            <input type="range" data-hsv-threshold-slider data-tool-id="${t.id}" disabled
              min="${min}" max="${max}" value="${value}" aria-label="检测面积（只读）" />
          </div>`;
      }

      const valueText = t.type === "hsv_roi"
        ? _hsvSliderConfig(t, this._hsvAreaResults).endLabel
        : (t.enabled === false ? "OFF" : t.type);

      card.innerHTML = `
        <header class="tool-card__header">
          <span class="tool-card__id">${t.id || "—"}</span>
          <span class="tool-card__name">${t.name || t.type || "tool"}</span>
          <span class="tool-card__value">${valueText}</span>
        </header>
        ${barHtml}
      `;
      listEl.appendChild(card);
    }

    if (!sel) {
      editorEl.innerHTML = `<div class="wizard-hint">暂无工具。请点击「追加工具」。</div>`;
      return;
    }

    const roi = sel.roi || {};
    const params = sel.params || {};
    const roiRect = roi.shape !== "circle";
    const roiAreaMax = sel.type === "hsv_roi" ? _hsvRoiAreaMax(sel, this._hsvAreaResults) : 0;
    const expected = params.expected || {};
    const expCenter = expected.center || ["", ""];
    const expSize = expected.size || ["", ""];

    const active = document.activeElement?.id;
    const contourActions = sel.type !== "hsv_roi"
      ? `<div class="wizard-tool-actions-row">
          <button type="button" class="btn btn-secondary" data-editor-action="roi-reset">重置 ROI</button>
        </div>`
      : "";
    editorEl.innerHTML = `
      ${contourActions}
      ${_renderToolParamsTwoColumn(sel, roi, roiRect)}
      ${sel.type === "hsv_roi" ? _renderHsvThresholdGrid(params, this._hsvAreaResults?.[sel.id], { hsvPickActive: this._hsvPickActive, hsvMatchActive: this._hsvMatchPreviewActive, roiAreaMax }) : `
        <hr class="wizard-tool-divider" />
        <div class="wizard-form-row"><label>目标形状</label>
          <select data-param-field="target_shape">
            <option value="rect" ${params.target_shape === "rect" ? "selected" : ""}>矩形</option>
            <option value="circle" ${params.target_shape === "circle" ? "selected" : ""}>圆形</option>
          </select>
        </div>
        <div class="wizard-form-row"><label>尺寸容差</label><input type="number" step="0.01" data-param-field="size_tolerance" value="${params.size_tolerance ?? 0.15}" /></div>
        <div class="wizard-form-row"><label>位置容差(px)</label><input type="number" step="0.1" data-param-field="position_tolerance" value="${params.position_tolerance ?? 10}" /></div>
        <div class="wizard-form-row"><label>期望中心X</label><input type="number" data-param-field="exp_center_0" value="${expCenter[0] ?? ""}" /></div>
        <div class="wizard-form-row"><label>期望中心Y</label><input type="number" data-param-field="exp_center_1" value="${expCenter[1] ?? ""}" /></div>
        <div class="wizard-form-row"><label>期望尺寸1</label><input type="number" data-param-field="exp_size_0" value="${expSize[0] ?? ""}" /></div>
        <div class="wizard-form-row"><label>期望尺寸2</label><input type="number" data-param-field="exp_size_1" value="${expSize[1] ?? ""}" /></div>
        `}
    `;

    if (keepEditorFocus && active) {
      editorEl.querySelector(`#${active}`)?.focus?.();
    }
  }

  _readToolEditor() {
    const editorEl = this.contentEl?.querySelector("#wizard-tool-editor");
    if (!editorEl) return;
    const idx = this._tools.findIndex((t) => t.id === this._selectedToolId);
    if (idx < 0) return;
    const t = structuredClone(this._tools[idx]);

    editorEl.querySelectorAll("[data-tool-field]").forEach((el) => {
      const k = el.dataset.toolField;
      if (k === "enabled") t.enabled = el.value === "true";
      else if (k === "cam") t.cam = Math.max(0, Math.min(1, parseInt(el.value, 10) || 0));
      else if (k === "tool_kind") {
        const prevType = t.type;
        t.type = el.value;
        t.name = _toolNameFromKind(t.type);
        if (prevType !== t.type) {
          t.params = t.type === "hsv_roi" ? DEFAULT_HSV_PARAMS() : DEFAULT_CONTOUR_PARAMS();
          delete this._hsvAreaResults[t.id];
          if (this._hsvMatchPreviewActive) this._clearHsvMatchPreview();
          this._hsvPickActive = false;
        }
      } else t[k] = el.value;
    });
    t.roi = t.roi || {};
    editorEl.querySelectorAll("[data-roi-field]").forEach((el) => {
      const k = el.dataset.roiField;
      if (k === "shape") t.roi.shape = el.value;
      else t.roi[k] = parseInt(el.value, 10);
    });

    t.params = t.params || {};
    editorEl.querySelectorAll("[data-param-field]").forEach((el) => {
      const k = el.dataset.paramField;
      if (k.startsWith("h_lower_")) {
        const i = parseInt(k.split("_")[2], 10);
        const arr = Array.isArray(t.params.h_lower) ? [...t.params.h_lower] : [0, 0, 0];
        arr[i] = parseInt(el.value, 10);
        t.params.h_lower = arr;
      } else if (k.startsWith("h_upper_")) {
        const i = parseInt(k.split("_")[2], 10);
        const arr = Array.isArray(t.params.h_upper) ? [...t.params.h_upper] : [180, 255, 255];
        arr[i] = parseInt(el.value, 10);
        t.params.h_upper = arr;
      } else if (k === "target_shape") {
        t.params.target_shape = el.value;
      } else if (k === "size_tolerance") {
        t.params.size_tolerance = parseFloat(el.value);
      } else if (k === "position_tolerance") {
        t.params.position_tolerance = parseFloat(el.value);
      } else if (k === "match_area_min") {
        const roiMax = Math.max(0, _hsvRoiAreaMax(t, this._hsvAreaResults));
        t.params.match_area_min = el.value === "" ? null : clamp(parseInt(el.value, 10) || 0, 0, roiMax);
      } else if (k === "match_area_max") {
        const roiMax = Math.max(0, _hsvRoiAreaMax(t, this._hsvAreaResults));
        t.params.match_area_max = el.value === "" ? null : clamp(parseInt(el.value, 10) || 0, 0, roiMax);
      } else if (k.startsWith("exp_center_")) {
        const i = parseInt(k.split("_")[2], 10);
        t.params.expected = t.params.expected || {};
        const arr = Array.isArray(t.params.expected.center) ? [...t.params.expected.center] : ["", ""];
        arr[i] = el.value === "" ? "" : parseFloat(el.value);
        t.params.expected.center = arr;
      } else if (k.startsWith("exp_size_")) {
        const i = parseInt(k.split("_")[2], 10);
        t.params.expected = t.params.expected || {};
        const arr = Array.isArray(t.params.expected.size) ? [...t.params.expected.size] : ["", ""];
        arr[i] = el.value === "" ? "" : parseFloat(el.value);
        t.params.expected.size = arr;
      }
    });

    // 清理 expected 中的空值
    if (t.type === "contour_roi" && t.params?.expected) {
      const c = t.params.expected.center;
      if (Array.isArray(c) && c.every((v) => v === "" || Number.isNaN(v))) delete t.params.expected.center;
      const s = t.params.expected.size;
      if (Array.isArray(s) && s.every((v) => v === "" || Number.isNaN(v))) delete t.params.expected.size;
      if (!Object.keys(t.params.expected).length) delete t.params.expected;
    }
    if (t.type === "hsv_roi") {
      _sanitizeHsvParams(t.params);
    }

    this._tools[idx] = t;
  }

  _escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async _enumerateCameras() {
    try {
      let data;
      if (isMockMode()) {
        data = {
          count: 2,
          devices: [
            {
              device_id: 0,
              model: "Mock USB Camera A",
              backend: "MOCK",
              width: 1920,
              height: 1080,
              accessible: true,
            },
            {
              device_id: 1,
              model: "Mock USB Camera B",
              backend: "MOCK",
              width: 1280,
              height: 720,
              accessible: true,
            },
          ],
        };
      } else {
        data = await window.__markeyeApp?.api?.get?.("/api/cameras/enumerate");
      }

      const devices = Array.isArray(data?.devices) ? data.devices : [];
      const count = data?.count ?? devices.length;
      if (!devices.length) {
        await infoModal("枚举相机", "未检测到可用相机设备。\n请确认相机已连接且未被其他程序占用。");
        return;
      }

      const rows = devices
        .map((d) => {
          const res = d.width > 0 && d.height > 0 ? `${d.width}×${d.height}` : "—";
          const status = d.accessible ? "可连接" : "不可用";
          return `<tr>
            <td>${this._escapeHtml(d.device_id)}</td>
            <td>${this._escapeHtml(d.model || "—")}</td>
            <td>${this._escapeHtml(res)}</td>
            <td>${this._escapeHtml(d.backend || "—")}</td>
            <td>${status}</td>
          </tr>`;
        })
        .join("");

      const html = `
        <p class="camera-enum-summary">共检测到 <strong>${count}</strong> 个相机设备：</p>
        <div class="camera-enum-table-wrap">
          <table class="camera-enum-table">
            <thead>
              <tr>
                <th>相机 ID</th>
                <th>型号</th>
                <th>分辨率</th>
                <th>后端</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      await infoModalHtml("枚举相机", html);
    } catch {
      showToast("枚举相机失败", "err");
    }
  }

  /** 按 STEP1 表单重连相机并刷新工具栏下拉 */
  async applyStep1Cameras({ silent = false } = {}) {
    if (isMockMode()) {
      window.__markeyeApp?.syncCameraSelect?.();
      return { ok: true, mock: true };
    }
    const cameras = _readCamerasListFromForm(this.contentEl);
    try {
      const res = await window.__markeyeApp?.api?.post?.("/api/cameras/reconnect", { cameras });
      if (!silent) {
        const statuses = res?.cameras || [];
        const okCount = statuses.filter((s) => s.connected).length;
        if (okCount >= 1) showToast(`已连接 ${okCount} 路相机`, "ok");
        else showToast("相机连接失败，请检查设备", "warn");
      }
      await window.__markeyeApp?.syncCameraSelect?.();
      return res;
    } catch {
      if (!silent) showToast("相机连接失败", "err");
      return null;
    }
  }

  _bindStep1CameraEvents() {
    const onCameraFormChange = () => {
      const cameras = _readCamerasListFromForm(this.contentEl);
      _refreshDefaultCameraSelect(this.contentEl, cameras);
      this.applyStep1Cameras();
      window.__markeyeApp?.syncCameraSelect?.();
    };

    this.contentEl?.querySelectorAll('[data-field="camera-id"]').forEach((el) => {
      el.removeEventListener("change", el._markeyeCamHandler);
      el._markeyeCamHandler = onCameraFormChange;
      el.addEventListener("change", el._markeyeCamHandler);
    });

    const defaultSel = this.contentEl?.querySelector('[data-field="camera-default"]');
    if (defaultSel) {
      defaultSel.removeEventListener("change", defaultSel._markeyeCamHandler);
      defaultSel._markeyeCamHandler = async () => {
        const cameraId = parseInt(defaultSel.value, 10);
        if (!Number.isFinite(cameraId)) return;
        if (isMockMode()) {
          window.__markeyeApp?.syncCameraSelect?.({ camera_id: cameraId });
          return;
        }
        try {
          await window.__markeyeApp?.api?.post?.("/api/camera/select", { camera_id: cameraId });
          await window.__markeyeApp?.syncCameraSelect?.();
        } catch {
          showToast("切换默认相机失败", "err");
        }
      };
      defaultSel.addEventListener("change", defaultSel._markeyeCamHandler);
    }

    this.contentEl?.querySelectorAll('[data-action="camera-remove"]').forEach((btn) => {
      btn.removeEventListener("click", btn._markeyeCamRemove);
      btn._markeyeCamRemove = () => {
        const row = btn.closest(".wizard-camera-row");
        const listEl = this.contentEl?.querySelector("#wizard-camera-list");
        if (!row || !listEl) return;
        const inputs = [...listEl.querySelectorAll('[data-field="camera-id"]')];
        if (inputs.length <= 1) return;
        const idx = parseInt(row.dataset.cameraIndex, 10);
        const values = inputs.map((inp) => parseInt(inp.value, 10) || 0);
        values.splice(idx, 1);
        listEl.innerHTML = _renderCameraListRows(values);
        _refreshDefaultCameraSelect(this.contentEl, _readCamerasListFromForm(this.contentEl));
        this._bindStep1CameraEvents();
        onCameraFormChange();
      };
      btn.addEventListener("click", btn._markeyeCamRemove);
    });
  }

  /** @deprecated 使用 applyStep1Cameras */
  async applyStep1Camera(opts) {
    return this.applyStep1Cameras(opts);
  }

  async saveCurrentStep(options) {
    return this._saveCurrentStep(options);
  }

  async _saveCurrentStep({ silent = true } = {}) {
    const fragment = this._collectStepFragment();
    if (!this._hasPersistableFragment(this.step, fragment)) {
      if (!silent) showToast("参数已保存", "ok");
      return true;
    }

    if (isMockMode()) {
      if (!silent) showToast("参数已保存（Mock）", "ok");
      return true;
    }

    if (!window.__markeyeApp?.api?.put) {
      if (!silent) showToast("参数保存失败", "err");
      return false;
    }
    try {
      await window.__markeyeApp.api.put(`/api/wizard/step/${this.step}`, fragment);
      if (!silent) showToast("参数已保存", "ok");
      return true;
    } catch {
      if (!silent) showToast("参数保存失败", "err");
      return false;
    }
  }

  _collectStepFragment() {
    const el = this.contentEl;
    if (!el) return null;

    if (this.step === 1) {
      const source = el.querySelector('[data-field="trigger-source"]')?.value || "internal";
      const mapped = source === "software" ? "internal" : source === "external" ? "external" : source;
      const delay = parseInt(el.querySelector('[data-field="trigger-delay"]')?.value, 10);
      const cameras = _readCamerasListFromForm(el);
      const defaultCam = parseInt(el.querySelector('[data-field="camera-default"]')?.value, 10);
      const camera_id = cameras.includes(defaultCam) ? defaultCam : cameras[0];
      const exposure = parseFloat(el.querySelector('[data-field="exposure"]')?.value);
      const gain = parseFloat(el.querySelector('[data-field="gain"]')?.value);
      const resize = parseInt(el.querySelector('[data-field="resize-width"]')?.value, 10);
      const trigger = { source: mapped };
      if (Number.isFinite(delay)) trigger.delay_ms = delay;
      const input = { cameras, camera_id };
      if (Number.isFinite(exposure)) input.exposure = exposure;
      if (Number.isFinite(gain)) input.gain = gain;
      const fragment = { trigger, input };
      if (Number.isFinite(resize)) fragment.preprocess = { resize_width: resize };
      return fragment;
    }
    if (this.step === 4) {
      const el = this.contentEl;
      const trerrOn = el?.querySelector('[data-toggle="trerr"] .is-active')?.dataset?.val === "on";
      const condSel = el?.querySelector('[data-field="comprehensive-condition"]');
      const condLogic = condSel ? parseInt(condSel.value, 10) : NaN;
      const logic = Number.isFinite(condLogic) ? condLogic : (this._comprehensiveLogic ?? 1);
      this._comprehensiveLogic = logic;

      const outputAssignments = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) => {
        const sel = el?.querySelector(`[data-field="out-assign-${i}"]`);
        return sel?.value || this._outputAssignments[i] || "off";
      });
      const inputAssignments = Array.from({ length: IO_CHANNEL_COUNT }, (_, i) => {
        const sel = el?.querySelector(`[data-field="in-assign-${i}"]`);
        return sel?.value || this._inputAssignments[i] || "off";
      });
      this._outputAssignments = outputAssignments;
      this._inputAssignments = inputAssignments;

      const ioEnabled = el?.querySelector('[data-toggle="io-enabled"] .is-active')?.dataset?.val === "on";
      const transport = el?.querySelector('[data-field="io-transport"]')?.value || "rtu";
      const serialPort = el?.querySelector('[data-field="io-serial-port"]')?.value?.trim() || "COM4";
      const baudrate = parseInt(el?.querySelector('[data-field="io-baudrate"]')?.value, 10);
      const bytesize = parseInt(el?.querySelector('[data-field="io-bytesize"]')?.value, 10);
      const parity = el?.querySelector('[data-field="io-parity"]')?.value || "N";
      const stopbits = parseInt(el?.querySelector('[data-field="io-stopbits"]')?.value, 10);
      const unitId = parseInt(el?.querySelector('[data-field="io-unit-id"]')?.value, 10);
      const pollInterval = parseInt(el?.querySelector('[data-field="io-poll-interval"]')?.value, 10);
      const outputPulseMs = parseInt(el?.querySelector('[data-field="io-output-pulse-ms"]')?.value, 10);
      const reconnectInterval = parseFloat(el?.querySelector('[data-field="io-reconnect-interval"]')?.value);
      const host = el?.querySelector('[data-field="io-host"]')?.value?.trim() || "127.0.0.1";
      const port = parseInt(el?.querySelector('[data-field="io-port"]')?.value, 10);

      const io = {
        enabled: ioEnabled,
        transport,
        serial_port: serialPort,
        unit_id: Number.isFinite(unitId) ? unitId : 1,
        poll_interval_ms: Number.isFinite(pollInterval) ? pollInterval : 50,
        reconnect_interval_s: Number.isFinite(reconnectInterval) ? reconnectInterval : 3,
        output_assignments: outputAssignments,
        input_assignments: inputAssignments,
        trerr_enabled: trerrOn,
        comprehensive_logic: logic,
        host,
        port: Number.isFinite(port) ? port : 502,
      };
      if (Number.isFinite(outputPulseMs)) io.output_pulse_ms = Math.max(0, outputPulseMs);
      if (Number.isFinite(baudrate)) io.baudrate = baudrate;
      if (Number.isFinite(bytesize)) io.bytesize = bytesize;
      io.parity = parity;
      if (Number.isFinite(stopbits)) io.stopbits = stopbits;

      this._ioConfig = io;
      return {
        io,
        output: {
          save_policy: el?.querySelector('[data-field="save-policy"]')?.value || "none",
        },
      };
    }
    if (this.step === 3) {
      this._readToolEditor();
      this._renumberToolIds();
      return { tools: structuredClone(this._tools) };
    }
    return {};
  }
}

/** SET 模式四步设定向导 */

import { confirmModal, infoModal, showToast } from "./layout.js";

const STEP_TITLES = {
  1: { title: "STEP1 拍摄条件", desc: "设定拍摄与触发相关条件。" },
  2: { title: "STEP2 注册主控", desc: "将用作判断标准的检测对象图像注册为主控图像。" },
  3: { title: "STEP3 工具设定", desc: "设定判断使用的工具。请单击[追加工具]或选择工具后单击[编辑]。" },
  4: { title: "STEP4 输出分配", desc: "在输出线上设定输出内容。" },
};

const DEFAULT_TOOL = () => ({
  id: String(Date.now()).slice(-2),
  name: "色彩识别",
  type: "hsv_roi",
  enabled: true,
  roi: { shape: "rect", x: 100, y: 100, w: 120, h: 80 },
  params: { h_lower: [0, 50, 50], h_upper: [180, 255, 255] },
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export class Wizard {
  constructor({ onExit, onComplete }) {
    this.step = 1;
    this.tab = "output";
    this.contentEl = document.querySelector("#wizard-content");
    this.stepNav = document.querySelector("#wizard-step-nav");
    this.footer = document.querySelector("#wizard-footer");
    this.btnBack = document.querySelector("#wizard-back");
    this.btnNext = document.querySelector("#wizard-next");
    this.btnExit = document.querySelector("#wizard-exit");
    this.onExit = onExit;
    this.onComplete = onComplete;

    this._tools = [];
    this._step3Loaded = false;
    this._selectedToolId = null;

    this._bindNav();
    this._render();
  }

  _bindNav() {
    this.stepNav?.querySelectorAll(".wizard-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = parseInt(btn.dataset.step, 10);
        if (s <= this.step) this.goToStep(s);
      });
    });

    this.btnBack?.addEventListener("click", () => {
      if (this.step > 1) this.goToStep(this.step - 1);
    });

    this.btnNext?.addEventListener("click", async () => {
      await this._saveCurrentStep();
      if (this.step < 4) this.goToStep(this.step + 1);
      else this.onComplete?.();
    });

    this.btnExit?.addEventListener("click", () => this.onExit?.());
  }

  goToStep(step) {
    this.step = step;
    if (step < 4) this.tab = "output";
    this._render();
  }

  show() {
    this.stepNav.hidden = false;
    this.footer.hidden = false;
    this.contentEl.hidden = false;
    this._render();
  }

  hide() {
    this.stepNav.hidden = true;
    this.footer.hidden = true;
    this.contentEl.hidden = true;
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
    if (this.step === 3) this._hydrateStep3();
  }

  _renderStep1(meta) {
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-accordion">
        <div class="wizard-accordion__item is-open">
          <button type="button" class="wizard-accordion__head is-active" data-acc="ai">AI拍摄</button>
          <div class="wizard-accordion__body">
            <p>生成 AI 拍摄推荐的拍摄条件。按下「AI拍摄」按钮开始处理。</p>
            <button type="button" class="btn btn-primary btn-ai-shoot" data-action="ai-shoot">✨ AI拍摄</button>
          </div>
        </div>
        <div class="wizard-accordion__item">
          <button type="button" class="wizard-accordion__head" data-acc="trigger">
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
          </div>
        </div>
        <div class="wizard-accordion__item">
          <button type="button" class="wizard-accordion__head" data-acc="brightness">调节亮度/焦点</button>
          <div class="wizard-accordion__body">
            <div class="wizard-form-row"><label>曝光</label><input type="number" value="50" min="0" max="100" /></div>
            <div class="wizard-form-row"><label>增益</label><input type="number" value="1" min="0" max="10" step="0.1" /></div>
          </div>
        </div>
        <div class="wizard-accordion__item">
          <button type="button" class="wizard-accordion__head" data-acc="ext">扩展功能</button>
          <div class="wizard-accordion__body"><p>扩展功能（Phase 2）</p></div>
        </div>
      </div>
    `;
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
        <p>从获取的图像注册。也可使用图像历史或文件注册主控。</p>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;max-width:320px">
          <button type="button" class="btn btn-secondary" data-action="register-history">注册图像历史的图像</button>
          <button type="button" class="btn btn-secondary" data-action="register-file">注册文件的图像</button>
        </div>
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
      </div>
      <div class="wizard-tool-list" id="wizard-tool-list"></div>
      <div class="wizard-tool-editor" id="wizard-tool-editor" style="margin-top:12px"></div>
    `;
  }

  _renderStep4(meta) {
    return `
      <div class="wizard-panel__title">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <div class="wizard-tabs">
        <button type="button" class="wizard-tab ${this.tab === "output" ? "is-active" : ""}" data-tab="output">输出分配</button>
        <button type="button" class="wizard-tab ${this.tab === "logic" ? "is-active" : ""}" data-tab="logic">综合判断</button>
        <button type="button" class="wizard-tab ${this.tab === "autoswitch" ? "is-active" : ""}" data-tab="autoswitch">自动切换程序</button>
        <button type="button" class="wizard-tab ${this.tab === "ext1" ? "is-active" : ""}" data-tab="ext1">扩展功能 1</button>
        <button type="button" class="wizard-tab ${this.tab === "ext2" ? "is-active" : ""}" data-tab="ext2">扩展功能 2</button>
      </div>
      <div class="wizard-tab-panel ${this.tab === "output" ? "is-active" : ""}" data-panel="output">
        <div class="wizard-form-row"><label>OUT1</label><select><option>综合判断NG</option><option>综合判断OK</option></select></div>
        <div class="wizard-form-row"><label>OUT2</label><select><option>工具01: 轮廓</option></select></div>
        <div class="wizard-form-row"><label>OUT3</label><select><option>工具02: 彩色识别</option></select></div>
        <div class="wizard-form-row"><label>I/O1</label><select><option>OFF</option></select></div>
        <div class="wizard-form-row"><label>I/O2</label><select><option>OFF</option></select></div>
        <div class="wizard-form-row"><label>I/O3</label><select><option>OFF</option></select></div>
        <div class="wizard-form-row"><label>触发错误</label>
          <div class="toggle-group" data-toggle="trerr">
            <button type="button" class="is-active" data-val="on">有效</button>
            <button type="button" data-val="off">无效</button>
          </div>
        </div>
      </div>
      <div class="wizard-tab-panel ${this.tab === "logic" ? "is-active" : ""}" data-panel="logic">
        <div class="wizard-form-row"><label>综合判断条件</label><select><option>全部OK</option><option>任一NG</option></select></div>
        <p>定义逻辑判断条件：</p>
        <div class="wizard-logic-btns">
          <button type="button" class="btn btn-secondary" data-action="logic" data-n="1">逻辑 1</button>
          <button type="button" class="btn btn-secondary" data-action="logic" data-n="2">逻辑 2</button>
          <button type="button" class="btn btn-secondary" data-action="logic" data-n="3">逻辑 3</button>
          <button type="button" class="btn btn-secondary" data-action="logic" data-n="4">逻辑 4</button>
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
      <div class="wizard-tab-panel ${this.tab === "ext1" ? "is-active" : ""}" data-panel="ext1"><p>扩展功能 1（Phase 2）</p></div>
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
        this.tab = tab.dataset.tab;
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

    // STEP3 tools
    if (this.step === 3) {
      this.contentEl?.querySelector('[data-action="tool-add"]')?.addEventListener("click", () => {
        this._tools = [...this._tools, DEFAULT_TOOL()];
        this._selectedToolId = this._tools.at(-1)?.id || null;
        this._renderStep3ListAndEditor();
        showToast("已追加工具", "ok");
      });

      this.contentEl?.querySelector('[data-action="tool-copy"]')?.addEventListener("click", () => {
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        const copy = structuredClone(src);
        copy.id = String(Date.now()).slice(-2);
        copy.name = `${copy.name || "工具"}_copy`;
        this._tools = [...this._tools, copy];
        this._selectedToolId = copy.id;
        this._renderStep3ListAndEditor();
        showToast("已复制工具", "ok");
      });

      this.contentEl?.querySelector('[data-action="tool-delete"]')?.addEventListener("click", async () => {
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        const ok = await confirmModal(`确定要删除工具 ${src.id}: ${src.name} 吗？`);
        if (!ok) return;
        this._tools = this._tools.filter((t) => t.id !== src.id);
        this._selectedToolId = this._tools[0]?.id || null;
        this._renderStep3ListAndEditor();
        showToast("已删除工具", "warn");
      });

      this.contentEl?.querySelector('[data-action="tool-edit"]')?.addEventListener("click", async () => {
        const src = this._tools.find((t) => t.id === this._selectedToolId);
        if (!src) return;
        await infoModal("编辑提示", "请在下方表单直接修改工具参数。ROI 画框与 HSV 取样将在下一步加入。");
      });

      this.contentEl?.querySelector("#wizard-tool-list")?.addEventListener("click", (e) => {
        const card = e.target.closest(".tool-card");
        if (!card) return;
        this._selectedToolId = card.dataset.id;
        this._renderStep3ListAndEditor();
      });

      this.contentEl?.querySelector("#wizard-tool-editor")?.addEventListener("input", () => {
        this._readToolEditor();
        this._renderStep3ListAndEditor({ keepEditorFocus: true });
      });

      this.contentEl?.querySelector("#wizard-tool-editor")?.addEventListener("click", (e) => {
        const action = e.target.closest("[data-editor-action]")?.dataset.editorAction;
        if (!action) return;
        const idx = this._tools.findIndex((t) => t.id === this._selectedToolId);
        if (idx < 0) return;
        const t = this._tools[idx];
        const viewer = window.__markeyeApp?.imageViewer;

        if (action === "roi-edit-on") {
          if (!viewer?.enableRoiEditor) return;
          const roi = t.roi || { shape: "rect", x: 100, y: 100, w: 120, h: 80 };
          viewer.enableRoiEditor({
            roi,
            shape: roi.shape === "circle" ? "circle" : "rect",
            allowPick: false,
            onRoiChange: (newRoi) => {
              this._tools[idx].roi = newRoi;
              this._renderStep3ListAndEditor();
            },
          });
          showToast("ROI 编辑已开启（Shift+拖拽=画框，拖拽=移动）", "ok");
        }
        if (action === "roi-edit-off") {
          viewer?.disableRoiEditor?.();
          showToast("ROI 编辑已关闭", "warn");
        }
        if (action === "hsv-pick-on") {
          if (!viewer?.enableRoiEditor) return;
          const roi = t.roi || { shape: "rect", x: 100, y: 100, w: 120, h: 80 };
          viewer.enableRoiEditor({
            roi,
            shape: roi.shape === "circle" ? "circle" : "rect",
            allowPick: true,
            onRoiChange: (newRoi) => {
              this._tools[idx].roi = newRoi;
              this._renderStep3ListAndEditor();
            },
            onPickPixel: ({ hsv }) => {
              const [h, s, v] = hsv;
              const dh = 10, ds = 40, dv = 40;
              this._tools[idx].params = this._tools[idx].params || {};
              this._tools[idx].params.h_lower = [clamp(h - dh, 0, 180), clamp(s - ds, 0, 255), clamp(v - dv, 0, 255)];
              this._tools[idx].params.h_upper = [clamp(h + dh, 0, 180), clamp(s + ds, 0, 255), clamp(v + dv, 0, 255)];
              this._renderStep3ListAndEditor();
              showToast(`已取样 HSV=${h},${s},${v}`, "ok");
            },
          });
          showToast("HSV 取样已开启（点击图像取样）", "ok");
        }
        if (action === "hsv-pick-off") {
          viewer?.disableRoiEditor?.();
          showToast("HSV 取样已关闭", "warn");
        }
      });
    }
  }

  async _hydrateStep3() {
    const { isMockMode } = await import("./api-client.js");
    if (isMockMode()) {
      if (!this._tools.length) {
        this._tools = [
          { id: "01", name: "色彩识别", type: "hsv_roi", enabled: true, roi: { shape: "rect", x: 100, y: 100, w: 120, h: 80 }, params: { h_lower: [0, 50, 50], h_upper: [180, 255, 255] } },
          { id: "02", name: "轮廓识别", type: "contour_roi", enabled: true, roi: { shape: "rect", x: 260, y: 120, w: 180, h: 140 }, params: { target_shape: "rect", size_tolerance: 0.15, position_tolerance: 10, expected: { center: [350, 190], size: [120, 80] } } },
        ];
      }
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      return;
    }

    if (this._step3Loaded) {
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
      return;
    }

    try {
      const data = await window.__markeyeApp?.api?.get?.("/api/wizard/step/3");
      this._tools = Array.isArray(data?.tools) ? data.tools : [];
      this._step3Loaded = true;
      this._selectedToolId = this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
    } catch {
      this._tools = this._tools.length ? this._tools : [];
      this._selectedToolId = this._selectedToolId || this._tools[0]?.id || null;
      this._renderStep3ListAndEditor();
    }
  }

  _renderStep3ListAndEditor({ keepEditorFocus = false } = {}) {
    const listEl = this.contentEl?.querySelector("#wizard-tool-list");
    const editorEl = this.contentEl?.querySelector("#wizard-tool-editor");
    if (!listEl || !editorEl) return;

    if (!this._selectedToolId && this._tools.length) this._selectedToolId = this._tools[0].id;
    const sel = this._tools.find((t) => t.id === this._selectedToolId) || null;

    listEl.innerHTML = "";
    for (const t of this._tools) {
      const selected = t.id === this._selectedToolId ? " is-selected" : "";
      const card = document.createElement("article");
      card.className = `tool-card${selected}`;
      card.dataset.id = t.id;
      card.dataset.state = "ok";
      card.innerHTML = `
        <header class="tool-card__header">
          <span class="tool-card__id">${t.id || "—"}</span>
          <span class="tool-card__name">${t.name || t.type || "tool"}</span>
          <span class="tool-card__value">${t.enabled === false ? "OFF" : t.type}</span>
        </header>
        <input type="range" disabled min="0" max="100" value="70" style="width:100%" />
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
    const hLower = params.h_lower || [0, 0, 0];
    const hUpper = params.h_upper || [180, 255, 255];
    const expected = params.expected || {};
    const expCenter = expected.center || ["", ""];
    const expSize = expected.size || ["", ""];

    const active = document.activeElement?.id;
    editorEl.innerHTML = `
      <div class="wizard-form-row" style="gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary" data-editor-action="roi-edit-on">画 ROI / 移动 ROI</button>
        <button type="button" class="btn btn-secondary" data-editor-action="roi-edit-off">关闭 ROI 编辑</button>
        ${sel.type === "hsv_roi" ? `<button type="button" class="btn btn-primary" data-editor-action="hsv-pick-on">点击取 HSV</button>
        <button type="button" class="btn btn-secondary" data-editor-action="hsv-pick-off">关闭 HSV 取样</button>` : ""}
      </div>
      <div class="wizard-form-row"><label>启用</label>
        <select data-tool-field="enabled">
          <option value="true" ${sel.enabled === false ? "" : "selected"}>ON</option>
          <option value="false" ${sel.enabled === false ? "selected" : ""}>OFF</option>
        </select>
      </div>
      <div class="wizard-form-row"><label>ID</label><input data-tool-field="id" value="${sel.id || ""}" /></div>
      <div class="wizard-form-row"><label>名称</label><input data-tool-field="name" value="${sel.name || ""}" /></div>
      <div class="wizard-form-row"><label>类型</label>
        <select data-tool-field="type">
          <option value="hsv_roi" ${sel.type === "hsv_roi" ? "selected" : ""}>色彩识别（HSV）</option>
          <option value="contour_roi" ${sel.type === "contour_roi" ? "selected" : ""}>轮廓识别</option>
        </select>
      </div>

      <div class="wizard-form-row"><label>ROI 形状</label>
        <select data-roi-field="shape">
          <option value="rect" ${roiRect ? "selected" : ""}>矩形</option>
          <option value="circle" ${roi.shape === "circle" ? "selected" : ""}>圆形</option>
        </select>
      </div>
      <div class="wizard-form-row"><label>ROI X</label><input type="number" data-roi-field="x" value="${roi.x ?? 0}" ${roiRect ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI Y</label><input type="number" data-roi-field="y" value="${roi.y ?? 0}" ${roiRect ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI W</label><input type="number" data-roi-field="w" value="${roi.w ?? 10}" ${roiRect ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI H</label><input type="number" data-roi-field="h" value="${roi.h ?? 10}" ${roiRect ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI CX</label><input type="number" data-roi-field="cx" value="${roi.cx ?? 0}" ${roi.shape === "circle" ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI CY</label><input type="number" data-roi-field="cy" value="${roi.cy ?? 0}" ${roi.shape === "circle" ? "" : "disabled"} /></div>
      <div class="wizard-form-row"><label>ROI R</label><input type="number" data-roi-field="r" value="${roi.r ?? 10}" ${roi.shape === "circle" ? "" : "disabled"} /></div>

      <hr style="opacity:.3;margin:12px 0" />
      ${sel.type === "hsv_roi"
        ? `
        <div class="wizard-form-row"><label>H lower</label><input type="number" data-param-field="h_lower_0" value="${hLower[0] ?? 0}" /></div>
        <div class="wizard-form-row"><label>S lower</label><input type="number" data-param-field="h_lower_1" value="${hLower[1] ?? 0}" /></div>
        <div class="wizard-form-row"><label>V lower</label><input type="number" data-param-field="h_lower_2" value="${hLower[2] ?? 0}" /></div>
        <div class="wizard-form-row"><label>H upper</label><input type="number" data-param-field="h_upper_0" value="${hUpper[0] ?? 180}" /></div>
        <div class="wizard-form-row"><label>S upper</label><input type="number" data-param-field="h_upper_1" value="${hUpper[1] ?? 255}" /></div>
        <div class="wizard-form-row"><label>V upper</label><input type="number" data-param-field="h_upper_2" value="${hUpper[2] ?? 255}" /></div>
        `
        : `
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
        `
      }
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
      else t[k] = el.value;
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

    this._tools[idx] = t;
  }

  async _saveCurrentStep() {
    const { isMockMode } = await import("./api-client.js");
    if (isMockMode()) return;

    const fragment = this._collectStepFragment();
    if (!fragment || !window.__markeyeApp?.api?.put) return;
    try {
      await window.__markeyeApp.api.put(`/api/wizard/step/${this.step}`, fragment);
    } catch {
      /* 保存失败不阻断向导 */
    }
  }

  _collectStepFragment() {
    const el = this.contentEl;
    if (!el) return null;

    if (this.step === 1) {
      const source = el.querySelector('[data-field="trigger-source"]')?.value || "internal";
      const mapped = source === "software" ? "internal" : source === "external" ? "external" : source;
      const resize = parseInt(el.querySelector('[data-field="resize-width"]')?.value, 10);
      return {
        trigger: { source: mapped },
        preprocess: Number.isFinite(resize) ? { resize_width: resize } : {},
      };
    }
    if (this.step === 4) {
      const trerrOn = el.querySelector('[data-toggle="trerr"] .is-active')?.dataset?.val === "on";
      return {
        io: { trerr_enabled: trerrOn },
        output: {
          save_policy: el.querySelector('[data-field="save-policy"]')?.value || "none",
        },
      };
    }
    if (this.step === 3) {
      // 仅保存 tools（运行中右侧检测项目完全由 tools 决定）
      return { tools: this._tools };
    }
    return {};
  }
}

/** SET 模式四步设定向导 */

const STEP_TITLES = {
  1: { title: "STEP1 拍摄条件", desc: "设定拍摄与触发相关条件。" },
  2: { title: "STEP2 注册主控", desc: "将用作判断标准的检测对象图像注册为主控图像。" },
  3: { title: "STEP3 工具设定", desc: "设定判断使用的工具。请单击[追加工具]或选择工具后单击[编辑]。" },
  4: { title: "STEP4 输出分配", desc: "在输出线上设定输出内容。" },
};

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

    this.btnNext?.addEventListener("click", () => {
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
      <div class="wizard-tool-list">
        <article class="tool-card is-selected" data-state="ok">
          <header class="tool-card__header">
            <span class="tool-card__id">01</span>
            <span class="tool-card__name">轮廓</span>
            <span class="tool-card__value">70</span>
          </header>
          <input type="range" disabled min="0" max="100" value="70" style="width:100%" />
        </article>
        <article class="tool-card" data-state="ok" style="margin-top:8px">
          <header class="tool-card__header">
            <span class="tool-card__id">02</span>
            <span class="tool-card__name">彩色识别</span>
            <span class="tool-card__value">70</span>
          </header>
          <input type="range" disabled min="0" max="100" value="70" style="width:100%" />
        </article>
      </div>
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
  }
}

/** 设定模式：阈值编辑表单（静态骨架） */

const DEFAULT_CONFIG = {
  color_check: true,
  color_tolerance: 0.1,
  size_check: true,
  size_tolerance: 0.15,
  position_check: true,
  position_tolerance: 10,
};

export class ConfigEditor {
  constructor(panelEl) {
    this.panel = panelEl;
    this.config = { ...DEFAULT_CONFIG };
    this._render();
  }

  _render() {
    if (!this.panel) return;
    const c = this.config;
    this.panel.innerHTML = `
      <form class="settings-form" id="config-form">
        <h2>检测参数设定</h2>
        <div class="form-group">
          <label><input type="checkbox" name="color_check" ${c.color_check ? "checked" : ""} /> 启用颜色检查</label>
        </div>
        <div class="form-group">
          <label for="color_tolerance">颜色容差 (0~1)</label>
          <input type="number" id="color_tolerance" name="color_tolerance" step="0.01" min="0" max="1" value="${c.color_tolerance}" />
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="size_check" ${c.size_check ? "checked" : ""} /> 启用大小检查</label>
        </div>
        <div class="form-group">
          <label for="size_tolerance">面积容差比例 (0~1)</label>
          <input type="number" id="size_tolerance" name="size_tolerance" step="0.01" min="0" max="1" value="${c.size_tolerance}" />
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="position_check" ${c.position_check ? "checked" : ""} /> 启用位置检查</label>
        </div>
        <div class="form-group">
          <label for="position_tolerance">位置偏移容差 (px)</label>
          <input type="number" id="position_tolerance" name="position_tolerance" step="1" min="0" value="${c.position_tolerance}" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">保存并返回</button>
          <button type="button" class="btn btn-secondary" id="config-cancel">取消</button>
        </div>
      </form>
    `;

    this.panel.querySelector("#config-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this._readForm();
      this.onSave?.(this.config);
    });

    this.panel.querySelector("#config-cancel")?.addEventListener("click", () => {
      this.onCancel?.();
    });
  }

  _readForm() {
    const form = this.panel.querySelector("#config-form");
    if (!form) return;
    const fd = new FormData(form);
    this.config = {
      color_check: fd.get("color_check") === "on",
      color_tolerance: parseFloat(fd.get("color_tolerance")),
      size_check: fd.get("size_check") === "on",
      size_tolerance: parseFloat(fd.get("size_tolerance")),
      position_check: fd.get("position_check") === "on",
      position_tolerance: parseInt(fd.get("position_tolerance"), 10),
    };
  }

  getConfig() {
    return { ...this.config };
  }
}

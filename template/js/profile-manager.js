/** 配方管理弹窗 */

import { confirmModal, promptModal, showToast } from "./layout.js";

const DEFAULT_PROFILE = "config.yaml";
const NAME_RE = /^[A-Za-z0-9_-]+$/;

function normalizeProfileInput(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\.yaml$/i, "");
  if (!NAME_RE.test(base)) return null;
  return `${base}.yaml`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class ProfileManager {
  constructor({ api, onProfilesChanged, onSwitchProfile }) {
    this.api = api;
    this.onProfilesChanged = onProfilesChanged;
    this.onSwitchProfile = onSwitchProfile;
    this.overlay = document.querySelector("#recipe-overlay");
    this.tbody = document.querySelector("#recipe-table-body");
    this._profiles = [];
    this._selected = null;
    this._bound = false;
  }

  _bindOnce() {
    if (this._bound) return;
    this._bound = true;
    document.querySelector("#recipe-close")?.addEventListener("click", () => this.close());
    document.querySelector("#recipe-add")?.addEventListener("click", () => this._onAdd());
    document.querySelector("#recipe-copy")?.addEventListener("click", () => this._onCopy());
    document.querySelector("#recipe-rename")?.addEventListener("click", () => this._onRename());
    document.querySelector("#recipe-delete")?.addEventListener("click", () => this._onDelete());
    this.overlay?.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  async open() {
    this._bindOnce();
    this.overlay?.classList.add("is-open");
    await this._refreshList();
  }

  close() {
    this.overlay?.classList.remove("is-open");
    this._selected = null;
  }

  async _refreshList() {
    try {
      const res = await this.api.get("/api/config/list");
      this._profiles = res.profiles || [];
      if (this._selected && !this._profiles.some((p) => p.name === this._selected)) {
        this._selected = null;
      }
      if (!this._selected && this._profiles.length) {
        const active = this._profiles.find((p) => p.active);
        this._selected = active?.name || this._profiles[0].name;
      }
      this._renderTable();
    } catch {
      showToast("加载配方列表失败", "err");
    }
  }

  _renderTable() {
    if (!this.tbody) return;
    if (!this._profiles.length) {
      this.tbody.innerHTML = `<tr><td colspan="3">暂无配方</td></tr>`;
      return;
    }
    this.tbody.innerHTML = this._profiles
      .map((p) => {
        const selected = p.name === this._selected;
        const status = p.active ? "使用中" : "—";
        return `<tr class="${selected ? "is-selected" : ""}${p.active ? " is-active" : ""}" data-name="${escapeHtml(p.name)}">
          <td>${escapeHtml(p.id)}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(status)}</td>
        </tr>`;
      })
      .join("");

    this.tbody.querySelectorAll("tr[data-name]").forEach((row) => {
      row.addEventListener("click", () => {
        this._selected = row.dataset.name;
        this._renderTable();
      });
    });
  }

  _requireSelection() {
    if (!this._selected) {
      showToast("请先选择一条配方", "warn");
      return null;
    }
    return this._selected;
  }

  async _promptProfileName(title, { defaultValue = "", hint = "" } = {}) {
    const raw = await promptModal(title, {
      defaultValue,
      hint: hint || "仅允许字母、数字、下划线、连字符；可省略 .yaml 后缀",
    });
    if (raw === null) return null;
    const name = normalizeProfileInput(raw);
    if (!name) {
      showToast("无效配方名称", "err");
      return null;
    }
    return name;
  }

  async _afterMutation(switchTo, { forceReload = false } = {}) {
    await this._refreshList();
    await this.onProfilesChanged?.();
    if (switchTo) {
      await this.onSwitchProfile?.(switchTo, { forceReload });
    }
  }

  async _onAdd() {
    const name = await this._promptProfileName("添加配方", {
      defaultValue: "prog_001",
      hint: "将基于 config.yaml 默认配方复制创建",
    });
    if (!name) return;
    if (name === DEFAULT_PROFILE) {
      showToast("不能使用保留名 config.yaml", "err");
      return;
    }
    try {
      await this.api.post("/api/config/create", { name });
      this._selected = name;
      showToast(`已添加配方: ${name}`, "ok");
      await this._afterMutation();
    } catch (err) {
      showToast(err?.message?.includes("409") ? "配方名称已存在" : "添加配方失败", "err");
    }
  }

  async _onCopy() {
    const from = this._requireSelection();
    if (!from) return;
    const stem = from.replace(/\.yaml$/i, "");
    const name = await this._promptProfileName("复制配方", {
      defaultValue: `${stem}_copy`,
    });
    if (!name) return;
    try {
      await this.api.post("/api/config/copy", { from, name });
      this._selected = name;
      showToast(`已复制配方: ${name}`, "ok");
      await this._afterMutation();
    } catch {
      showToast("复制配方失败", "err");
    }
  }

  async _onRename() {
    const from = this._requireSelection();
    if (!from) return;
    if (from === DEFAULT_PROFILE) {
      showToast("不能重命名默认配方 config.yaml", "err");
      return;
    }
    const stem = from.replace(/\.yaml$/i, "");
    const to = await this._promptProfileName("重命名配方", { defaultValue: stem });
    if (!to || to === from) return;
    const profile = this._profiles.find((p) => p.name === from);
    const wasActive = !!profile?.active;
    try {
      await this.api.post("/api/config/rename", { from, to });
      this._selected = to;
      showToast(`已重命名为: ${to}`, "ok");
      await this._afterMutation(wasActive ? to : null, { forceReload: wasActive });
    } catch {
      showToast("重命名失败", "err");
    }
  }

  async _onDelete() {
    const name = this._requireSelection();
    if (!name) return;
    if (name === DEFAULT_PROFILE) {
      showToast("不能删除默认配方 config.yaml", "err");
      return;
    }
    const profile = this._profiles.find((p) => p.name === name);
    if (profile?.active) {
      showToast("不能删除当前使用中的配方", "err");
      return;
    }
    if (this._profiles.length <= 1) {
      showToast("不能删除最后一个配方", "err");
      return;
    }
    const ok = await confirmModal(`确定删除配方「${name}」吗？\n将同时删除对应主控图像目录。`);
    if (!ok) return;
    try {
      await this.api.post("/api/config/delete", { name });
      this._selected = null;
      showToast(`已删除配方: ${name}`, "ok");
      await this._afterMutation();
    } catch {
      showToast("删除配方失败", "err");
    }
  }
}

let _instance = null;

export function openProfileManager(options) {
  if (!_instance) {
    _instance = new ProfileManager(options);
  } else {
    _instance.api = options.api;
    _instance.onProfilesChanged = options.onProfilesChanged;
    _instance.onSwitchProfile = options.onSwitchProfile;
  }
  return _instance.open();
}

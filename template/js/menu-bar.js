/** 顶栏菜单：下拉项定义与动作分发 */

import { isMockMode } from "./api-client.js";
import { openProfileManager } from "./profile-manager.js";
import {
  confirmModal,
  infoModal,
  infoModalHtml,
  showMenuPopup,
  showToast,
  toggleFullscreen,
} from "./layout.js";
import { resetMockStats, createIdleFrame } from "./mock-data.js";

function mark(label, on) {
  return on ? `✓ ${label}` : label;
}

function buildMenus(app) {
  const iv = app.imageViewer;
  const processMode = iv?.processMode || "overlay";
  const overlayOn = iv?.overlayVisible !== false;
  const continuousOn = !!app._continuousTrigger;
  const fullscreen = !!document.fullscreenElement;

  return {
    "menu-file": [
      { action: "file-profiles", label: "配方程序管理…" },
      { action: "file-reload", label: "重新加载当前程序" },
      { separator: true },
      {
        action: "file-open-image",
        label: "打开图片…",
        disabled: true,
        title: "Web 产线模式暂不支持从本地打开图片",
      },
      {
        action: "file-export",
        label: "导出检测履历…",
        disabled: true,
        title: "Phase 2 尚未实现",
      },
      { separator: true },
      { action: "file-restart", label: "重启软件…" },
    ],
    "menu-view": [
      {
        action: "view-original",
        label: mark("原图", processMode === "original"),
        checked: processMode === "original",
      },
      {
        action: "view-overlay",
        label: mark("处理叠加", processMode === "overlay"),
        checked: processMode === "overlay",
      },
      {
        action: "view-binary",
        label: mark("二值化", processMode === "binary"),
        checked: processMode === "binary",
      },
      { separator: true },
      {
        action: "view-toggle-overlay",
        label: overlayOn ? "隐藏检测叠加层" : "显示检测叠加层",
        checked: overlayOn,
      },
      { action: "view-fit", label: "适应屏幕" },
    ],
    "menu-sensor": [
      { action: "sensor-switch", label: "切换连接的传感器" },
      { action: "sensor-reconnect", label: "重新连接传感器" },
      { action: "sensor-disconnect", label: "断开传感器…" },
      { separator: true },
      { action: "sensor-step1", label: "拍摄条件设定 (STEP1)…" },
      { action: "sensor-modbus", label: "Modbus 重新连接" },
      { separator: true },
      {
        action: "sensor-monitor",
        label: "连接监控器…",
        disabled: true,
        title: "Phase 2 尚未实现",
      },
    ],
    "menu-image": [
      { action: "image-trigger", label: "软触发\tSpace" },
      { action: "image-save", label: "保存当前帧" },
      {
        action: "image-continuous",
        label: mark("连续触发", continuousOn),
        checked: continuousOn,
      },
      { separator: true },
      { action: "image-reset-stats", label: "复位 OK/NG 统计…" },
    ],
    "menu-settings": [
      { action: "settings-home", label: "传感器设定首页" },
      { action: "settings-navi", label: "传感器设定向导 (NAVI)…" },
      { separator: true },
      { action: "settings-step3", label: "工具设定 (STEP3)…" },
      { action: "settings-step4", label: "I/O 输入输出设定 (STEP4)…" },
    ],
    "menu-window": [
      {
        action: "window-fullscreen",
        label: fullscreen ? "退出全屏" : "全屏显示",
        checked: fullscreen,
      },
      {
        action: "window-always-on-top",
        label: "窗口置顶",
        disabled: true,
        title: "浏览器 Web 应用不支持窗口置顶",
      },
    ],
    "menu-help": [
      { action: "help-status", label: "版本与连接状态…" },
      { action: "help-guide", label: "操作说明…" },
      { action: "help-about", label: "关于 MarkEye…" },
    ],
  };
}

function setProcessMode(app, mode) {
  const sel = document.querySelector("#process-mode");
  if (sel) sel.value = mode;
  if (app.imageViewer) {
    app.imageViewer.processMode = mode;
    app.imageViewer._applyDisplayMode();
  }
}

async function restartSoftware(app) {
  const ok = await confirmModal("确定要重启软件吗？");
  if (!ok) return;
  try {
    await app.api?.post("/api/system/restart");
    showToast("正在重启软件…", "ok");
    setTimeout(() => location.reload(), 1500);
  } catch {
    showToast("重启请求失败", "err");
  }
}

async function disconnectSensor(app) {
  const ok = await confirmModal("确定要断开传感器连接吗？");
  if (!ok) return;
  try {
    if (!isMockMode()) {
      await app.api?.post("/api/cameras/disconnect");
    }
    app.api?.stop();
    app.statusBar.setIdle();
    showToast("传感器已断开", "warn");
  } catch {
    showToast("断开传感器失败", "err");
  }
}

async function resetStats(app) {
  const ok = await confirmModal("确定要复位 OK/NG 统计计数吗？");
  if (!ok) return;
  if (isMockMode()) {
    resetMockStats();
    app.toolPanel.history = { learn: [], color: [], size: [], position: [] };
  }
  await app.api?.post("/api/stats/reset");
  if (isMockMode()) app._onFrame(createIdleFrame());
  showToast("统计已复位", "ok");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function showHealthStatus(app) {
  if (isMockMode()) {
    await infoModal(
      "版本与连接状态",
      "MarkEye Web UI — Mock 模式 (?mock=1)\n\n后端 API 未连接，数据为本地模拟。",
    );
    return;
  }

  try {
    const h = await app.api.get("/api/health");
    const appMeta = h.app || {};
    const git = appMeta.git || {};
    const io = h.io || {};
    const lines = [
      `<p><strong>版本</strong>：${escapeHtml(appMeta.version || "—")}</p>`,
      `<p><strong>Git</strong>：${escapeHtml(git.branch || "—")} @ ${escapeHtml(git.commit || "—")}${git.dirty ? " (有未提交修改)" : ""}</p>`,
      `<p><strong>相机</strong>：${h.camera ? "已连接" : "未连接"}${h.using_fallback ? "（回退源）" : ""}</p>`,
      `<p><strong>可用相机</strong>：${escapeHtml((h.available_cameras || []).join(", ") || "—")}</p>`,
      `<p><strong>Modbus IO</strong>：${io.enabled ? (io.connected ? "已连接" : "未连接") : "未启用"}</p>`,
    ];
    if (io.last_error) {
      lines.push(`<p><strong>IO 最近错误</strong>：${escapeHtml(io.last_error)}</p>`);
    }
    await infoModalHtml("版本与连接状态", lines.join(""));
  } catch {
    await infoModal("版本与连接状态", "无法获取 /api/health，请确认后端服务已启动。");
  }
}

async function showOperationGuide() {
  const html = `
    <p><strong>运行模式</strong></p>
    <ul>
      <li><kbd>Space</kbd> — 软触发单帧检测</li>
      <li>图像工具栏 — 缩放、处理视图、保存当前帧</li>
      <li>程序栏 — 切换配方、查看 Tool 判定结果</li>
    </ul>
    <p><strong>设定模式</strong></p>
    <ul>
      <li>点击「设定」或菜单「设定」进入传感器设定首页</li>
      <li>NAVI 向导 — STEP1 拍摄 → STEP2 主控 → STEP3 工具 → STEP4 输出/IO</li>
      <li><kbd>Esc</kbd> — 退出向导或返回运行模式</li>
    </ul>
    <p><strong>显示与窗口</strong></p>
    <ul>
      <li>Alt+V — 显示菜单（原图 / 处理叠加 / 二值化）</li>
      <li><kbd>F11</kbd> — 全屏 / 退出全屏</li>
    </ul>
    <p><strong>顶栏快捷键</strong></p>
    <ul>
      <li>Alt+F / V / R / I / S / W / H — 打开对应菜单</li>
    </ul>
  `;
  await infoModalHtml("操作说明", html);
}

async function showAbout() {
  await infoModal(
    "关于 MarkEye",
    "MarkEye — 产品标记视觉检测系统\n\n基于 Python + OpenCV，用于产线标记的颜色 / 面积 / 位置判定。\n\n详细说明请参阅项目 README.md。",
  );
}

async function handleMenuAction(action, app) {
  switch (action) {
    case "file-profiles":
      openProfileManager({
        api: app.api,
        onProfilesChanged: () => app._loadProfiles(),
        onSwitchProfile: (name, opts) => app._onProfileSwitch(name, opts),
      });
      break;
    case "file-reload": {
      const name = app._getActiveProfileName();
      try {
        await app._onProfileSwitch(name, { forceReload: true });
        showToast(`已重新加载程序: ${name}`, "ok");
      } catch {
        showToast("重新加载程序失败", "err");
      }
      break;
    }
    case "file-restart":
      await restartSoftware(app);
      break;

    case "view-original":
      setProcessMode(app, "original");
      break;
    case "view-overlay":
      setProcessMode(app, "overlay");
      break;
    case "view-binary":
      setProcessMode(app, "binary");
      break;
    case "view-toggle-overlay":
      app.imageViewer?.setOverlayVisible(!app.imageViewer?.overlayVisible);
      break;
    case "view-fit":
      app.imageViewer?.fitToScreen();
      break;

    case "sensor-switch":
      try {
        await app.api?.post("/api/camera/switch");
        showToast("已切换连接的传感器", "ok");
      } catch {
        showToast("切换传感器失败", "err");
      }
      break;
    case "sensor-reconnect":
      try {
        const res = await app.api?.post("/api/cameras/reconnect");
        showToast(res?.ok !== false ? "传感器已重新连接" : res?.error || "重新连接失败", res?.ok !== false ? "ok" : "err");
      } catch {
        showToast("重新连接传感器失败", "err");
      }
      break;
    case "sensor-disconnect":
      await disconnectSensor(app);
      break;
    case "sensor-step1":
      app._enterWizard(1);
      break;
    case "sensor-modbus":
      try {
        const res = await app.api?.post("/api/io/reconnect");
        if (res?.ok) showToast("Modbus 已重新连接", "ok");
        else showToast(res?.error || res?.last_error || "Modbus 重连失败", "err");
      } catch {
        showToast("Modbus 重连请求失败", "err");
      }
      break;

    case "image-trigger":
      await app._doTrigger();
      break;
    case "image-save":
      await app.saveCurrentFrame();
      break;
    case "image-continuous":
      app._toggleContinuousTrigger();
      break;
    case "image-reset-stats":
      await resetStats(app);
      break;

    case "settings-home":
      app._setView("set");
      break;
    case "settings-navi":
      app._enterWizard(1);
      break;
    case "settings-step3":
      app._enterWizard(3, { resetMaster: false });
      break;
    case "settings-step4":
      app._enterWizard(4, { resetMaster: false });
      break;

    case "window-fullscreen":
      toggleFullscreen();
      break;

    case "help-status":
      await showHealthStatus(app);
      break;
    case "help-guide":
      await showOperationGuide();
      break;
    case "help-about":
      await showAbout();
      break;
    default:
      break;
  }
}

export function bindMenuBar(app) {
  document.querySelectorAll(".menu-item[data-action]").forEach((el) => {
    el.addEventListener("click", async () => {
      const menuId = el.dataset.action;
      const items = buildMenus(app)[menuId];
      if (!items?.length) return;
      const action = await showMenuPopup(el, items);
      if (!action) return;
      await handleMenuAction(action, app);
    });
  });
}

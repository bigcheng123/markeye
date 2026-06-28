/** 自动模拟所有功能按键，验证 UI 交互流程 */

import { showToast } from "./layout.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (msg) => {
  console.log(`[ui-demo] ${msg}`);
};

/**
 * @param {import('./app.js').MarkEyeApp | { clickMode: Function, clickEl: Function, getView: Function }} app
 */
export async function runUiDemo(app) {
  const results = [];
  const step = async (name, fn) => {
    try {
      log(`▶ ${name}`);
      await fn();
      results.push({ name, ok: true });
      log(`✓ ${name}`);
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
      log(`✗ ${name}: ${err.message}`);
    }
    await delay(400);
  };

  showToast("开始 UI 自动演示…", "ok");
  await delay(800);

  await step("RUN 模式 — 软触发", async () => {
    app.clickMode("run");
    await delay(300);
    await app.clickEl("#btn-trigger");
  });

  await step("RUN 模式 — 放大/缩小/适应", async () => {
    app.clickEl("#btn-zoom-in");
    await delay(200);
    app.clickEl("#btn-zoom-out");
    await delay(200);
    app.clickEl("#btn-fit");
  });

  await step("RUN 模式 — 处理视图切换", async () => {
    const sel = document.querySelector("#process-mode");
    if (sel) {
      sel.value = "binary";
      sel.dispatchEvent(new Event("change"));
      await delay(200);
      sel.value = "overlay";
      sel.dispatchEvent(new Event("change"));
    }
  });

  await step("RUN 模式 — 追加学习", async () => {
    app.clickEl("#btn-learn-add");
  });

  await step("RUN 模式 — 调节阈值", async () => {
    app.clickEl("#btn-threshold");
    const slider = document.querySelector("#detail-threshold");
    if (slider) {
      slider.value = "65";
      slider.dispatchEvent(new Event("input"));
    }
  });

  await step("RUN 模式 — 保存帧", async () => {
    app.clickEl("#btn-save-frame");
  });

  await step("RUN 模式 — 切换输入源", async () => {
    app.clickEl("#btn-switch");
  });

  await step("全局 — 快捷工具栏", async () => {
    app.clickEl("#btn-sensor-switch");
    await delay(300);
    app.clickEl("#btn-connect-monitor");
  });

  await step("全局 — ProgramBar 按钮", async () => {
    app.clickEl("#btn-details");
    await delay(600);
    document.querySelector("#info-close")?.click();
    await delay(300);
    app.clickEl("#btn-image-history");
    await delay(300);
    app.clickEl("#btn-io-settings");
    await delay(300);
    app.clickEl("#btn-extended");
  });

  await step("SET 模式 — 设定首页", async () => {
    app.clickMode("settings");
    await delay(400);
    if (app.getView() !== "set") throw new Error("未能进入设定模式");
  });

  await step("SET 模式 — NAVI 向导入口", async () => {
    app.clickEl("#btn-navi-wizard");
    await delay(500);
    if (app.getView() !== "wizard") throw new Error("未能进入向导");
  });

  await step("向导 STEP1 — AI拍摄", async () => {
    document.querySelector('[data-action="ai-shoot"]')?.click();
    await delay(300);
    document.querySelector("#wizard-next")?.click();
    await delay(400);
  });

  await step("向导 STEP2 — 注册主控", async () => {
    document.querySelector('[data-action="register-history"]')?.click();
    await delay(300);
    document.querySelector("#wizard-next")?.click();
    await delay(400);
  });

  await step("向导 STEP3 — 工具操作", async () => {
    document.querySelector('[data-action="tool-add"]')?.click();
    await delay(200);
    document.querySelector('[data-action="tool-edit"]')?.click();
    await delay(200);
    document.querySelector("#wizard-next")?.click();
    await delay(400);
  });

  await step("向导 STEP4 — 输出分配 Tab", async () => {
    const tabs = ["logic", "autoswitch", "ext1", "output"];
    for (const t of tabs) {
      document.querySelector(`.wizard-tab[data-tab="${t}"]`)?.click();
      await delay(250);
    }
    document.querySelector('[data-action="logic"][data-n="1"]')?.click();
    await delay(300);
  });

  await step("向导 — 完成", async () => {
    document.querySelector("#wizard-next")?.click();
    await delay(600);
    document.querySelector("#info-close")?.click();
    await delay(400);
  });

  await step("返回 RUN 模式", async () => {
    app.clickMode("run");
    await delay(400);
    if (app.getView() !== "run") throw new Error("未能返回运行模式");
  });

  await step("RUN 模式 — 复位统计", async () => {
    app.clickEl("#btn-reset");
    await delay(300);
    document.querySelector("#modal-ok")?.click();
    await delay(300);
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  const summary = `UI 演示完成: ${passed}/${results.length} 通过`;
  log(summary);
  if (failed.length) {
    console.error("[ui-demo] 失败项:", failed);
    showToast(`${summary}（${failed.length} 项失败，见控制台）`, "err");
  } else {
    showToast(`${summary} — 全部通过`, "ok");
  }

  return { passed, total: results.length, failed, results };
}

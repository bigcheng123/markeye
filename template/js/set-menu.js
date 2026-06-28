/** SET 模式首页 */

export class SetMenu {
  constructor({ onEnterWizard }) {
    this.panel = document.querySelector("#view-set-menu");
    this.onEnterWizard = onEnterWizard;
    document.querySelector("#btn-navi-wizard")?.addEventListener("click", () => {
      this.onEnterWizard?.();
    });
  }
}

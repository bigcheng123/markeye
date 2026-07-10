# MarkEye 模式切换验收（UI 一键切换）

## 前置（已执行安装脚本）

```bash
sudo ./deploy/install-kiosk.sh
```

本机若无 `ubuntu` 用户（如开发机使用 `trg-327`），先执行：

```bash
sudo ./deploy/apply-dev-user.sh trg-327
```

## 验收 1：helper 与 sudoers 已安装

```bash
ls -la /etc/systemd/system/markeye-mode-switch@.service
ls -la /etc/sudoers.d/markeye-mode-switch
sudo visudo -c
```

## 验收 2：后端接口存在（本机调用）

```bash
curl -fsS -X POST "http://127.0.0.1:8080/api/system/mode" \
  -H "Content-Type: application/json" \
  -d '{"mode":"dev"}'
```

> 注意：该接口会触发系统重启。

## 验收 3：切到生产模式（prod）

重启后应自动登录 `markeye` 用户并全屏打开 `http://127.0.0.1:8080/template/`。

```bash
systemctl status markeye-web --no-pager
ls -la /home/markeye/.config/autostart | rg -n "markeye-kiosk"
rg -n "AutomaticLoginEnable|AutomaticLogin" /etc/gdm3/custom.conf
```

## 验收 4：切到开发模式（dev）

重启后应自动登录开发用户（默认 `ubuntu`；本机可用 `trg-327`，见 `deploy/apply-dev-user.sh`）；后端由 XDG autostart 后台启动（不走 systemd）；Chrome 以普通窗口打开页面（非 kiosk）。

```bash
# 应自动登录开发用户（ubuntu 或 trg-327）
rg -n "AutomaticLoginEnable|AutomaticLogin" /etc/gdm3/custom.conf
# 应存在 dev autostart，且无 kiosk
ls -la /home/ubuntu/.config/autostart 2>/dev/null | rg -n "markeye-dev" || \
ls -la /home/trg-327/.config/autostart | rg -n "markeye-dev"
ls -la /home/markeye/.config/autostart | rg -n "markeye-kiosk" || true
# 后端不走 systemd，但 health 应就绪
systemctl is-enabled markeye-web || true
curl -fsS http://127.0.0.1:8080/api/health
# 浏览器应已打开（手动确认普通窗口，非全屏 kiosk）
```

开发模式后端日志：`/home/markeye/.local/share/markeye/dev-web.log`

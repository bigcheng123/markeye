# MarkEye 模式切换验收（UI 一键切换）

## 前置（已执行安装脚本）

```bash
sudo ./deploy/install-kiosk.sh
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

重启后应自动登录 kiosk 用户并全屏打开 `http://127.0.0.1:8080/template/`。

```bash
systemctl status markeye-web --no-pager
ls -la /home/markeye/.config/autostart | rg -n "markeye-kiosk"
rg -n "AutomaticLoginEnable|AutomaticLogin" /etc/gdm3/custom.conf
```

## 验收 4：切到开发模式（dev）

重启后不自动登录、不自动 kiosk；后端不走 systemd，自行手动启动：

```bash
systemctl is-enabled markeye-web || true
ls -la /home/markeye/.config/autostart | rg -n "markeye-kiosk" || true
rg -n "AutomaticLoginEnable|AutomaticLogin" /etc/gdm3/custom.conf

cd /opt/markeye
./start_app.sh
```


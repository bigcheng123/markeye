# MODBUS / 相机异常退出与资源清理方案

> **版本**: v1.0  
> **日期**: 2026-07-02  
> **定位**: 异常退出后 COM/相机资源释放与重启可靠性  
> **关联**: [modbus_io.md](modbus_io.md) · [src/resource_cleanup.py](../src/resource_cleanup.py) · [src/process_lock.py](../src/process_lock.py)

---

## 1. 问题结论

**会出现无法连接的情况，但通常是暂时性的，不是永久损坏。**

| 资源 | 进程已完全退出后 | 立即重启 / 进程仍存活 | 典型症状 |
|------|------------------|----------------------|----------|
| **MODBUS (COM4)** | OS 释放串口，新进程一般可连 | 旧进程或外部工具仍占用 COM → `PermissionError` | `serial_permission_error`，Y1 可能保持 ON |
| **相机 (DSHOW/V4L2)** | OS/驱动回收句柄，通常可连 | Windows DSHOW 句柄滞留数秒～数十秒 | `_probe_camera` 失败、打开超时、设备显示「使用中」 |

**根本原因**：原先唯一可靠的清理路径是 FastAPI `lifespan` 的 shutdown 段。以下场景**不会**执行 `camera.disconnect()` / `io.disconnect()`：

- `stop_app.bat` 使用 `taskkill /F` 强杀
- `stop_app.sh` 使用 `fuser -k`（SIGKILL）
- 软件卡死、原生崩溃（如 MSMF 0xC0000005）
- `POST /api/system/restart` 经 `os.execv` 原地替换进程，不经过 lifespan yield 之后的清理

---

## 2. 分层解决方案（已实现）

### 层 1：统一资源清理 — `src/resource_cleanup.py`

- `register_hardware_cleanup(camera, io)` — 注册 `atexit` + `SIGTERM`/`SIGINT` 回调
- `cleanup_hardware(camera, io, reason)` — 幂等释放相机与 Modbus，并删除进程锁

### 层 2：优雅停机 API + 改进停止脚本

- `POST /api/system/shutdown` — 停止后台任务 → 释放硬件 → flush 数据 → `os._exit(0)`
- `POST /api/system/restart` — `execv` 前同步 `cleanup_hardware`
- `stop_app.bat` / `stop_app.sh` — 先 HTTP shutdown（3s 超时），等待 2s，端口仍占用再强杀

### 层 3：连接逻辑加固

**MODBUS**（`src/io/modbus_client.py`）：

- `_mark_disconnected()` 释放 client 与脉冲 Timer（与 `disconnect()` 共用 `_release_client()`）
- `connect()` 支持 `io.connect_retries` / `io.connect_retry_delay_s` 退避重试

**相机**（`src/camera_service.py` + `src/web_server.py`）：

- `_camera_health_loop` — 周期性 `reconnect_unhealthy_slots()`
- `_startup_hardware` — 相机连接指数退避重试（1/2/4s）
- `POST /api/cameras/disconnect` — 服务端释放相机；菜单「断开传感器」调用此 API

### 层 4：进程互斥 — `src/process_lock.py`

- 锁文件：`%TEMP%/markeye.lock`（Linux: `/tmp/markeye.lock`）
- 启动时检测陈旧锁；存活 PID 则拒绝双开

### 层 5：CLI 路径 — `src/main.py`

- 相机模式 `try/finally` 确保 `cap.release()`

---

## 3. 配置项

```yaml
io:
  reconnect_interval_s: 3        # 轮询断线重连间隔（已有）
  connect_retries: 3             # 单次 connect 重试次数
  connect_retry_delay_s: 1.0     # 重试基础间隔（秒）

input:
  camera_reconnect_interval_s: 5 # 健康检查重连间隔
  camera_connect_retries: 3      # 启动时相机连接重试次数
```

---

## 4. 运维说明

- **停止软件**：优先使用 `stop_app.bat` / `stop_app.sh`（改进后会先调用 `/api/system/shutdown`）
- **仍无法连接**：
  1. 任务管理器确认无残留 `python` 进程
  2. 等待 5～10 秒再启动（Windows DSHOW 驱动释放）
  3. 检查 Modbus Poll、串口助手等是否占用 COM4
- **Windows 相机异常**：默认已禁用 MSMF；必要时确认未设置 `MARKEYE_ENABLE_MSMF=1`
- **双开**：第二个实例会提示「已有 MarkEye 实例运行」并退出

---

## 5. 测试验证

| 场景 | 验证方式 |
|------|----------|
| 优雅停机 | 关闭 `start_app.bat` 窗口 → 日志含 disconnect → 立即重启可连 |
| `stop_app.bat` | shutdown API 后进程退出 → COM/相机可连 |
| `os.execv` 重启 | `POST /api/system/restart` 后无资源滞留 |
| MODBUS 通信中断 | `_mark_disconnected` 释放 client → 插回后自动重连 |
| 相机 fallback | health loop 自动 `connect_slot` |
| 双开防护 | 第二个实例启动被拒绝 |
| 单元测试 | `pytest tests/test_resource_cleanup.py` |

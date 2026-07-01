# MarkEye 产线冒烟测试

部署机 **Web 服务已运行** 后，用本目录脚本快速验证环境、REST 与 WebSocket 通路。默认 **不触发检测**、不修改配方与履历。

## 前置条件

1. 已安装依赖：`pip install -r requirements.txt`（建议激活 `.venv`）
2. Web 服务已启动：
   - Windows: `start_app.bat`
   - Linux: `./start_app.sh`
3. 浏览器可访问 `http://localhost:8080/template/`

## 运行

在仓库根目录执行：

```bash
# Linux / Ubuntu 产线
./smoke/run_smoke.sh

# Windows 开发机
smoke\run_smoke.bat

# 或直接调用 Python（跨平台）
python smoke/run_smoke.py
```

### 常用参数

| 参数 / 环境变量 | 说明 |
|-----------------|------|
| `--base-url URL` | 服务地址，默认 `http://127.0.0.1:8080` |
| `MARKEYE_BASE_URL` | 同上，环境变量形式 |
| `--timeout N` | HTTP 超时秒数，默认 10 |
| `--ws-timeout N` | WebSocket 等待首帧秒数，默认 20 |
| `--with-trigger` | 启用 S4：POST `/api/trigger`（**履历 +1**） |
| `-q` / `--quiet` | 仅输出失败项 |

维护窗口或空跑工位示例：

```bash
python smoke/run_smoke.py --with-trigger
```

**生产连续跑线请勿使用 `--with-trigger`。**

## 检查项

| 阶段 | 内容 | 说明 |
|------|------|------|
| S0 环境 | Python ≥3.10、cv2/httpx/fastapi 等 | 本机依赖，不连服务 |
| S1 存活 | `/api/health`、`/`、`/template/index.html` | 服务与静态页 |
| S2 只读API | device、config、profiles、camera、master、wizard 1–4 | 仅 GET，非破坏性 |
| S3 WebSocket | `/ws/frame` 收首帧 | 验证实时推帧 |
| S4 触发 | `POST /api/trigger` | **默认跳过**，需 `--with-trigger` |

### 通过标准

- 退出码 `0`，全部 `[PASS]`
- 任一 `[FAIL]` → 退出码 `1`
- 无相机时 `using_fallback: true` **仍可通过** S1–S3

## 常见 FAIL 与处理

| 现象 | 可能原因 |
|------|----------|
| S0 import 失败 | 未激活 `.venv` 或未 `pip install -r requirements.txt` |
| S1 连接拒绝 | 服务未启动或端口非 8080 |
| S3 WS 超时 | 防火墙/代理未转发 WebSocket；预览循环异常 |
| S4 trigger 500 | `fallback_image` 无效且无相机 |

## 与单元测试的分工

| 场景 | 命令 |
|------|------|
| 开发合并前完整回归 | `pytest tests/` |
| 产线上线 / 重启后通路检查 | `smoke/run_smoke.py` |

详细 API 说明见项目根目录 [README.md](../README.md)。

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MarkEye** — 基于 Python + OpenCV 的产品标记视觉检测系统。
检测产品上的标记是否合格，涵盖：颜色、大小、位置等维度。

## Environments

- **开发**: Windows (PowerShell) / Linux（可选）
- **部署**: Ubuntu 24.04.4 LTS

## 跨平台要求（Windows + Linux）

MarkEye **必须**在 Windows（开发调参）与 Linux（产线部署，Ubuntu 24.04 LTS）上均可运行。新增或修改代码时请遵守：

| 类别 | 规范 |
|------|------|
| **路径** | 一律使用 `pathlib.Path`；禁止硬编码 `\` 或盘符路径；对外 JSON/API 路径用正斜杠（`str(p).replace("\\", "/")` 或 `as_posix()`） |
| **文件 IO** | 文本文件 `encoding="utf-8"`；图像读写使用 `utils.imread` / `utils.imwrite`（支持中文路径） |
| **相机** | 平台相关逻辑集中在 `camera_service._capture_backends()`：Windows → DSHOW/MSMF，Linux → V4L2；CLI 相机模式复用 `_probe_camera` |
| **进程/脚本** | 启动脚本分平台提供，核心入口统一为 `python -m src.web_server` 或 `python src/main.py` |
| **前端** | 浏览器 SPA，不依赖 OS；仅通过 `http://` 访问后端 |
| **可选依赖** | `pymodbus` 未安装时 IO 降级为日志模式，不得导致启动失败 |
| **禁止** | `os.system` 调用平台命令、`shell=True` 拼接路径、假定当前工作目录 |

### 启动脚本对照

| 用途 | Windows | Linux / macOS |
|------|---------|---------------|
| 开发启动 Web | `start_app.bat` | `start_app.sh` |
| 停止 Web（8080） | `stop_app.bat` | `stop_app.sh` |
| 产线 kiosk | — | `deploy/kiosk.sh` |

### 平台差异与限制

- **产线主入口**为 Web 服务（无桌面 GUI 依赖）；CLI 的 `--debug` / `--camera` 使用 `cv2.imshow`，需要图形显示环境（Linux 需 `DISPLAY`，产线 kiosk 不依赖此项）。
- **Linux 相机**需 V4L2 驱动；**Windows** 使用 DirectShow / Media Foundation。
- **版本号**（`version.py`）依赖本机 `git`；无 git 时回退默认版本，不影响运行。
- 单元测试应在两平台均可通过：`pytest tests/`（CI 建议在 Windows 与 Ubuntu 各跑一遍）。

### Environment

```powershell
# Windows 开发 — 创建/激活虚拟环境
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip freeze > requirements.txt
```

```bash
# Ubuntu 部署 — 创建/激活虚拟环境
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip freeze > requirements.txt

# 启动 Web 服务（与 Windows 等效）
./start_app.sh
```

### Run

```bash
# 图片模式
python src/main.py --image path/to/image.jpg

# 相机实时模式
python src/main.py --camera 0

# Web UI 服务（产线）
python -m src.web_server

# 指定配置
python src/main.py --image path/to/image.jpg --config config/config.yaml

# 批量处理
python src/main.py --batch data/samples/

# 调试模式（显示中间处理步骤）
python src/main.py --image path/to/image.jpg --debug
```

### Test

```bash
pytest tests/
pytest tests/test_detector.py -v
pytest tests/ --cov=src
```

### Lint & Format

```bash
ruff check src/
ruff format src/
```

## Project Architecture

```
markeye/
├── src/                    # 源码
│   ├── main.py             # 入口：CLI 解析、调度
│   ├── detector.py         # 检测器：标记识别核心逻辑
│   ├── preprocessor.py     # 图像预处理（去噪、增强、透视校正）
│   ├── inspector.py        # 检查器：颜色/大小/位置判定
│   ├── utils.py            # 通用工具：绘图、IO、日志
│   └── __init__.py
├── config/                 # YAML 配置文件
│   └── config.yaml         # 检测参数模板（颜色阈值、ROI、公差）
├── data/                   # 样本图像 / 测试数据
├── tests/                  # 单元测试
├── requirements.txt
└── README.md
```

### Data Flow

```
Input Image → Preprocessor → Detector → Inspector → Output Result
                                   ↓              ↓
                            ROI 定位     颜色/大小/位置判定
```

- **Preprocessor** (`preprocessor.py`): 灰度化、二值化、滤波、透视校正、ROI 提取
- **Detector** (`detector.py`): 定位标记区域，输出标记轮廓/坐标信息
- **Inspector** (`inspector.py`): 根据配置的阈值，对标记的颜色（HSV范围）、大小（面积/宽高）、位置（偏移量）逐项判定，输出 Pass/Fail

## Key Patterns

- **配置驱动**: 所有检测阈值（颜色范围、面积范围、位置公差）写入 `config/config.yaml`，不硬编码
- **模块化**: 预处理 → 检测 → 检查 三阶段解耦，每阶段可独立替换或扩展
- **可调试**: 每个处理步骤支持中间结果输出（`--debug` 参数），方便调参

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MarkEye** — 基于 Python + OpenCV 的产品标记视觉检测系统。
检测产品上的标记是否合格，涵盖：颜色、大小、位置等维度。

## Environments

- **开发**: Windows (PowerShell)
- **部署**: Ubuntu 24.04.4 LTS

## Commands

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

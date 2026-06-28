# MarkEye — 产品标记视觉检测系统

基于 **Python + OpenCV** 的视觉检测系统，用于检测产品上的标记是否合格。

## 功能

- ✅ 标记**颜色**检测（HSV 色彩空间匹配）
- ✅ 标记**大小**检测（面积偏差判定）
- ✅ 标记**位置**检测（中心偏移量判定）
- ✅ 图片模式 / 相机实时模式 / 批量模式
- ✅ YAML 配置驱动，无需改代码调参
- ✅ 调试模式显示中间处理步骤

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 单张图片检测
python src/main.py --image data/sample.jpg

# 相机实时检测
python src/main.py --camera 0

# 批量处理
python src/main.py --batch data/samples/

# 调试模式（显示中间图像）
python src/main.py --image data/sample.jpg --debug
```

## 项目结构

```
markeye/
├── src/
│   ├── main.py              # 入口（CLI 解析、调度）
│   ├── preprocessor.py      # 预处理（灰度、去噪、二值化、透视校正）
│   ├── detector.py           # 检测器（轮廓提取、标记定位）
│   ├── inspector.py          # 检查器（颜色/大小/位置判定）
│   └── utils.py             # 工具函数（绘图、文件IO、日志）
├── config/
│   └── config.yaml          # 检测参数配置（颜色阈值、面积范围、位置公差）
├── tests/                   # 单元测试
├── requirements.txt
└── CLAUDE.md
```

## 检测流程

```
输入图像 → 预处理(Preprocessor) → 检测(Detector) → 检查(Inspector) → 结果
                                    ↓                   ↓
                             轮廓/ROI定位      颜色/大小/位置判定
```

- **Preprocessor**: 灰度化 → 高斯去噪 → 二值化(Otsu/自适应) → 形态学去噪
- **Detector**: 轮廓查找 → 面积/尺寸过滤 → 输出标记位置信息
- **Inspector**: HSV 颜色匹配 → 面积偏差 → 中心偏移 → 输出 Pass/Fail

## 配置

见 `config/config.yaml`。主要参数：

| 参数 | 说明 |
|------|------|
| `inspect.colors` | 定义每种颜色的 HSV 上下界 |
| `inspect.size_tolerance` | 允许的面积偏差比例 |
| `inspect.position_tolerance` | 允许的中心偏移像素数 |
| `detector.min_area` / `max_area` | 标记面积过滤范围 |
| `preprocess.resize_width` | 统一缩放到目标宽度 |

产线部署时复制为 `config.local.yaml` 并根据实际样品调参。

## 环境

| | 开发 | 部署 |
|---|---|---|
| OS | Windows | Ubuntu 24.04.4 LTS |
| Python | >= 3.10 | >= 3.10 |
| 依赖 | pip + venv | pip + venv |

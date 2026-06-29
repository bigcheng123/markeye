# MarkEye — 产品标记视觉检测系统

基于 **Python + OpenCV** 的视觉检测系统，用于检测产品上的标记是否合格。

## 系统边界

MarkEye 是产线上的**视觉检测子系统**，负责采图、检测、结果显示与履历记录，**不包含**印记加工设备的控制。步骤 1 为产线整体流程背景；MarkEye 负责步骤 2–5。

## 使用场景

| 步骤 | 内容 |
|------|------|
| 1. 加工标记（产线背景） | 作业员将未打标记的产品放入定位治具，按下启动按钮；外部设备自动对产品加工标记 |
| 2. 拍摄图像 | 标记加工完毕后，CAMERA 捕获标记位置的图片 |
| 3. 检测目标 | 检测图像中标记的**颜色**是否正确、**面积**是否达标、**位置**（中心偏移）是否在允许范围内 |
| 4. 返回结果 | UI 在 Tool 行 verdict 与 RunFooter 触发统计表显示 **OK** / **NG**（无独立大 OK 方块）；Tool 详情可查看面积与颜色 HSV；NG 时发出报警声音 |
| 5. 记录结果 | 统计检查总数、OK 数量、NG 数量；可选保存图像（仅 OK / 仅 NG / 全部） |

### 履历统计说明

| 字段 | 含义 |
|------|------|
| 检查总数 | 成功完成一次「触发 → 采图 → 判定」的次数 |
| OK / NG | 视觉判定合格 / 不合格的次数 |
| TrERR（触发错误） | 触发后未能完成检测（如相机断连、采图失败），**不计入** OK/NG |
| NG 数量 | 与「检查失败次数（视觉 NG）」为同一指标；TrERR 单独统计 |

图像默认保存目录与命名规则见 `config/config.yaml` 中 `output.save_dir`；是否自动保存由 `output.save_result` 控制，产线 UI 可覆盖为「仅 NG 保存」等策略。

## 实际生产中的运行平台

- OS：Ubuntu 24.04.4 LTS
- CPU：Intel J1900，4 核心 2.0 GHz
- 内存：DDR3 2 GB
- 硬盘：SATA 120 GB
- 测试样品图片：`data/sample.jpg`（需自行放置；仓库暂未附带 `data/` 目录）
- IO 控制：Modbus 协议（详见下方 [IO 与 STEP4](#io-与-step4)）

> **性能提示**：2 GB 内存环境下建议关闭 `--debug` 窗口，按 [`plan/UI设计稿.md`](plan/UI设计稿.md) 目标控制预览帧率（≥15 fps）与处理分辨率。

## 软件形态

| 形态 | 用途 | 状态 |
|------|------|------|
| **Web UI**（`template/`） | 产线触摸屏操作：设定模式向导、自动运行、履历与 IO | 原型 / 开发中 |
| **Python CLI**（`src/main.py`） | 开发调参、单张/批量/相机验证检测算法 | 已实现 |
| **Web 服务**（`src/web_server.py`） | 产线部署：静态 UI + WebSocket 推帧 + REST API | 已实现 |

产线部署以 Web UI 为主；CLI 用于离线验证与 CI 测试。UI 交互与布局详见 [`plan/UI设计稿.md`](plan/UI设计稿.md)，参考截图见 `ui/ui_sample/`。

## 软件使用方法

### 1. 两种模式

APP 共有 **设定模式** 与 **自动运行** 两种模式：

- **设定模式**：CAMERA 停止连续采集，人工配置当前程序（配方）参数
- **自动运行**：生产模式；收到启动信号（内部软触发或外部 IO）后触发拍照与检查

### 2. 设置产品配方（程序）

每个**程序**对应一份配方配置文件（如 `config/config.yaml` 或 `config.local.yaml`）。

2.1 进入 **设定模式** → 选择程序 → **传感器设定** 进入向导

2.2 向导共 4 个环节：

| 步骤 | 内容 |
|------|------|
| STEP1 拍摄条件 | 曝光时间、触发方式（内部 / 外部 IO）等 |
| STEP2 注册主控 | 注册主控图片，供 STEP3 设定各检测区域的 ROI 与参考位置 |
| STEP3 工具设定 | 配置 MVP 三项检查（见下表） |
| STEP4 输出分配 | OUT/I/O 映射、综合判定逻辑、OK/NG 程序切换等（详见 [UI 设计稿 — STEP4](plan/UI设计稿.md)） |

**STEP3 — MVP 检测项**（与 `config/config.yaml` 中 `inspect.*` 对应）：

| 检查项 | 说明 | 配置字段 |
|--------|------|----------|
| 颜色 | 指定区域内颜色是否在 HSV/RGB 阈值内 | `inspect.colors`、`color_space` |
| 面积 | 标记面积是否在允许偏差内 | `inspect.size_tolerance` |
| 位置 | 标记中心相对主控参考点的偏移是否在容差内 | `inspect.position_tolerance` |

> STEP3 中的「轮廓」用于 **ROI 定位与标记区域提取**（`detector` 阶段），形状匹配（矩形/圆、匹配度阈值）为**规划中**能力，与上述「位置偏移」检查不同。

2.3 **保存设置**：向导完成后自动存储当前程序配方参数。

### 3. 运行检测

- **内部触发**：点击主页「触发」按钮，捕获当前帧并判定
- **外部触发**：由 Modbus/IO 启动信号触发（与 STEP4 输入映射一致）

### IO 与 STEP4

MarkEye 通过 **Modbus** 与 PLC/IO 模块通信（具体主从角色与寄存器地址在产线联调时定稿）。典型信号如下：

| 方向 | 信号 | 说明 |
|------|------|------|
| 输入 | 启动 / 触发 | 外部触发拍照与检测（对应 UI「外部触发」） |
| 输入 | 急停等 | 可选，由 STEP4 I/O 映射配置 |
| 输出 | OK / NG | 综合判定结果驱动产线分拣或报警 |
| 输出 | 就绪 / 忙 | 可选，表示系统可接受下一次触发 |

STEP4 完整能力（OUT1~3、I/O1~3、综合判定逻辑 1~4、OK/NG 自动切换程序等）见 [`plan/UI设计稿.md`](plan/UI设计稿.md) 中 STEP4 章节与 `ui/ui_sample/set-4*.PNG`。

## 检测项（MVP）

| 维度 | 判定方式 | 配置 |
|------|----------|------|
| 颜色 | HSV（或 RGB）阈值匹配 | `inspect.colors` |
| 面积 | 相对标准面积的偏差比例 | `inspect.size_tolerance` |
| 位置 | 中心点像素偏移 | `inspect.position_tolerance` |

## 功能

- ✅ 标记**颜色**检测（HSV 色彩空间匹配）
- ✅ 标记**大小**检测（面积偏差判定）
- ✅ 标记**位置**检测（中心偏移量判定）
- ✅ 图片模式 / 相机实时模式 / 批量模式（CLI）
- ✅ YAML 配置驱动，无需改代码调参
- ✅ 调试模式显示中间处理步骤
- 🚧 Web UI 设定向导与产线运行界面（`template/`）— 联调中
- ✅ Web 服务（`web_server.py`）+ REST/WebSocket
- 🚧 Modbus IO 联调（占位实现）
- ✅ NG 报警音（WebAudio）
- ✅ 履历统计持久化（JSON）

## 实现状态

| 模块 | 状态 |
|------|------|
| 预处理 / 检测 / 检查（CLI） | 已实现 |
| 颜色、面积、位置判定 | 已实现 |
| 检测管线 `pipeline.py` | 已实现 |
| Web 服务 `web_server.py` | 已实现 |
| Tool 聚合 / 统计 / 标定 | 已实现 |
| 形状匹配 Tool | 规划中 |
| Web UI | 原型 / 联调中 |
| Modbus IO | 占位（联调定址） |
| NG 报警音 | 已实现（前端 WebAudio） |
| 履历统计持久化 | 已实现（JSON） |

## 快速开始

以下命令用于**开发环境**验证算法（Windows / Ubuntu 均可）：

```bash
# 安装依赖
pip install -r requirements.txt

# 单张图片检测（需先放置 data/sample.jpg）
python src/main.py --image data/sample.jpg

# 相机实时检测
python src/main.py --camera 0

# 批量处理
python src/main.py --batch data/samples/

# 调试模式（显示中间图像）
python src/main.py --image data/sample.jpg --debug

# Web UI 服务（产线部署）
python -m src.web_server
# 浏览器打开 http://localhost:8080/template/ ；开发 Mock：?mock=1
```

### Web 服务模式

产线以 `python -m src.web_server` 启动（默认端口 8080），提供：

- 静态资源：`template/`、`icon/`
- WebSocket：`/ws/frame` — 实时帧与检测结果（见 UI 设计稿 §9）
- REST：`/api/trigger`、`/api/config`、`/api/stats/reset` 等

CLI 与 Web 服务共用 `src/pipeline.py` 检测管线。

## 项目结构

```
markeye/
├── src/                     # 检测算法（CLI 入口）
│   ├── main.py              # 入口（CLI 解析、调度）
│   ├── preprocessor.py      # 预处理（灰度、去噪、二值化、透视校正）
│   ├── detector.py          # 检测器（轮廓提取、标记定位）
│   ├── inspector.py         # 检查器（颜色/大小/位置判定）
│   └── utils.py             # 工具函数（绘图、文件 IO、日志）
├── template/                # Web UI 原型（HTML/JS/CSS）
├── ui/ui_sample/            # UI 参考截图（对标 Keyence IV3）
├── plan/                    # 设计文档（UI设计稿.md 等）
├── config/
│   └── config.yaml          # 检测参数配置（颜色阈值、面积范围、位置公差）
├── data/                    # 样本图像（需自行添加）
├── tests/                   # 单元测试
├── requirements.txt
└── CLAUDE.md
```

## 检测流程

```
输入图像 → 预处理(Preprocessor) → 检测(Detector) → 检查(Inspector) → 结果
                                    ↓                   ↓
                             轮廓/ROI 定位        颜色/面积/位置判定
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
| `output.save_result` / `save_dir` | 是否保存结果图及目录 |

产线部署时复制为 `config.local.yaml` 并根据实际样品调参。

## 相关文档

- [UI 设计稿](plan/UI设计稿.md) — SET/RUN 界面、四步向导、STEP4 IO 与综合判定
- [主干开发计划](plan/主干开发计划.md) — 冲突决议、M0–M5 里程碑、前后端模块与任务
- [CLAUDE.md](CLAUDE.md) — 开发命令与架构说明

## 环境

| | 开发 | 部署 |
|---|---|---|
| OS | Windows | Ubuntu 24.04.4 LTS |
| Python | >= 3.10 | >= 3.10 |
| 依赖 | pip + venv | pip + venv |

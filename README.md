# MarkEye — 产品标记视觉检测系统

基于 **Python + OpenCV** 的产线视觉检测系统，用于检测产品上的标记是否合格（颜色 / 面积 / 位置）。

## 系统边界

MarkEye 是产线上的**视觉检测子系统**，负责采图、检测、结果显示与履历记录，**不包含**印记加工设备的控制。

## 软件形态

| 形态 | 入口 | 用途 | 状态 |
|------|------|------|------|
| **Web 服务** | `python -m src.web_server` | 产线部署：双路相机采集、WebSocket 实时推帧、REST API、四步设定向导 | ✅ 已实现 |
| **Web UI** | `template/index.html` | 产线触摸屏操作：RUN/SET 模式切换、工具面板、履历统计、IO 监控 | ✅ 已实现 |
| **Python CLI** | `python src/main.py` | 开发调参、单张/批量/相机验证检测算法 | ✅ 已实现 |

产线部署以 Web 服务为主；CLI 用于离线验证与 CI 测试。

## 快速开始

### 开发环境（Windows）

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 部署环境（Ubuntu 24.04.4 LTS）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 使用方式

```bash
# Web 服务（产线模式）
python -m src.web_server
# 浏览器打开 http://localhost:8080 ；开发 Mock 附加 ?mock=1

# 单张图片检测
python src/main.py --image data/sample.jpg

# 相机实时检测
python src/main.py --camera 0

# 批量处理
python src/main.py --batch data/samples/

# 调试模式（显示中间处理步骤）
python src/main.py --image data/sample.jpg --debug

# 指定配置文件
python src/main.py --image test.jpg --config config/config.yaml
```

### 测试

```bash
pytest tests/
pytest tests/test_detector.py -v
pytest tests/ --cov=src
```

## 使用场景

| 步骤 | 内容 |
|------|------|
| 1. 加工标记 | 作业员将产品放入定位治具，按下启动按钮；外部设备自动加工标记 |
| 2. 拍摄图像 | 标记加工完毕后，相机捕获标记位置图片 |
| 3. 检测目标 | 检测标记的**颜色**（HSV 匹配面积）、**面积**（是否达标）、**位置**（中心偏移） |
| 4. 返回结果 | UI 显示 OK / NG 判定，Tool 面板展示各工具详情，NG 时触发报警音 |
| 5. 记录结果 | 持久化统计总数、OK、NG、TrERR，支持按策略保存检测图像 |

### 履历统计

| 字段 | 含义 |
|------|------|
| 检查总数 | 成功完成「触发 → 采图 → 判定」的次数 |
| OK / NG | 视觉判定合格 / 不合格的次数 |
| TrERR | 触发后未能完成检测（相机断连、采图失败等），不计入 OK/NG |

## 两种运行模式

### 设定模式（SET）

停止连续采集，进入四步向导配置当前程序：

| 步骤 | 内容 | 关键配置项 |
|------|------|-----------|
| **STEP1** 拍摄条件 | 曝光时间、触发方式（内部/外部 IO）、相机设备号 | `input.cameras`, `input.exposure`, `trigger.source` |
| **STEP2** 注册主控 | 拍摄/上传主控图像（CAM#0 / CAM#1 分槽位），按程序存档 | `calibration.masters` |
| **STEP3** 工具设定 | 配置检测工具：HSV 色彩识别 / 轮廓形状匹配，设定 ROI 与判定阈值 | `tools[]` |
| **STEP4** 输出分配 | OUT 线圈映射、综合判定逻辑、OK/NG 自动切换程序 | `io.outputs`, `io.comprehensive_logic` |

### 自动运行（RUN）

生产模式。收到触发信号（UI 软触发或外部 IO）后执行：采图 → 运行全部检测工具 → 综合判定 → 输出 IO 信号 → 更新履历。

## 检测工具

系统采用 **工具（Tool）模型**，每个工具独立配置 ROI、判定参数，按 `cam` 字段绑定相机槽位：

| 工具类型 | 说明 | 配置字段 |
|---------|------|----------|
| `hsv_roi` | ROI 内 HSV 颜色匹配面积判定 | `h_lower`, `h_upper`, `match_area_min`, `match_area_max` |
| `contour_roi` | ROI 内形状检测（矩形/圆），含尺寸与位置容差判定 | `target_shape`, `min_area`, `size_tolerance`, `position_tolerance` |

工具结果按 `io.comprehensive_logic` 综合判定：
- **逻辑 1/2**：全部工具 OK 则综合 OK
- **逻辑 3**：任一工具 OK 即综合 OK（占位）

## 双路相机架构

```
CAM #1 (slot1)  ──→  采集线程 (daemon)  ──→  slot0.latest_frame
CAM #2 (slot2)  ──→                         ──→  slot1.latest_frame
                                              ↓
                              WebSocket /ws/frame 实时推送
                              REST /api/trigger 触发检测
```

- 两路逻辑槽位（slot 0/1），每槽位映射一个 OpenCV 设备号
- 后台守护线程持续抓帧，预览约 10fps
- API 可动态切换设备号、重连相机
- 无相机时自动回退到 `fallback_image`（测试用）

## IO 与 STEP4

通过 **Modbus TCP** 与 PLC/IO 模块通信（联调前 Mock 线圈写入）：

| 方向 | 信号 | 说明 |
|------|------|------|
| 输入 | 启动 / 触发 | 外部触发拍照与检测 |
| 输出 | OK / NG | 综合判定结果驱动分拣或报警 |
| 输出 | 就绪 / 忙 | 系统状态指示 |
| 输出 | TrERR | 触发错误（采图失败等）不计入 OK/NG |

联调前 IO 以日志模式运行（`io.enabled: false`，写入 `logging.DEBUG`）。

## 多程序（配方）管理

- 每个程序对应 `config/` 目录下一个 `.yaml` 文件
- 主控图像按程序分目录存档：`data/masters/<程序名>/master_cam{0,1}.jpg`
- API 支持切换程序：`POST /api/config/switch { "name": "program.yaml" }`
- 切换后自动重载相机、管线、IO 服务

## 项目结构

```
markeye/
├── src/                         # 源码
│   ├── main.py                  # CLI 入口（单张/相机/批量模式）
│   ├── web_server.py            # FastAPI Web 服务（REST + WebSocket）
│   ├── pipeline.py              # 检测管线（CLI 与 Web 共用）
│   ├── preprocessor.py          # 图像预处理（灰度/去噪/二值化/形态学）
│   ├── detector.py              # 轮廓检测与标记定位
│   ├── inspector.py             # 颜色/大小/位置判定
│   ├── calibration.py           # 主控图像注册与管理（按程序分槽位）
│   ├── camera_config.py         # 双相机槽位配置与迁移
│   ├── camera_service.py        # 双路相机采集服务（后台抓帧线程）
│   ├── config_store.py          # YAML 配置读写与多程序管理
│   ├── stats_store.py           # 检测统计与 JSON 持久化
│   ├── tool_builder.py          # Pipeline 结果 → Web UI inspections 聚合
│   ├── display_images.py        # 工具二值化/HSV命中叠加图生成
│   ├── frame_codec.py           # 帧编解码（Base64 JPEG）、结果保存
│   ├── version.py               # 应用版本号（基于 git 提交数）
│   ├── utils.py                 # 通用工具（绘图/IO/日志）
│   ├── tools/
│   │   ├── __init__.py
│   │   └── roi_tools.py         # ROI 工具执行（HSV 面积 / 轮廓形状）
│   └── io/
│       ├── __init__.py
│       └── modbus_client.py     # Modbus IO 客户端（联调前占位）
├── config/
│   └── config.yaml              # 默认配方（检测参数/工具/IO/输出）
├── template/                    # Web UI 前端
│   ├── index.html               # SPA 入口（RUN/SET 模式）
│   ├── js/                      # 前端模块
│   │   ├── app.js               # 主应用
│   │   ├── api-client.js        # REST 客户端
│   │   ├── wizard.js            # 四步向导
│   │   ├── tool-panel.js        # 工具面板
│   │   ├── image-viewer.js      # 图像查看器
│   │   ├── config-editor.js     # 配置编辑器
│   │   ├── set-menu.js          # 设定菜单
│   │   ├── ng-alert.js          # NG 报警音
│   │   ├── status-bar.js        # 状态栏
│   │   ├── mock-data.js         # 开发 Mock 数据
│   │   ├── ui-demo.js           # UI 演示
│   │   └── layout.js            # 布局管理
│   ├── css/
│   │   ├── variables.css        # CSS 变量
│   │   ├── layout.css           # 布局样式
│   │   ├── components.css       # 组件样式
│   │   └── theme-industrial.css # 工业风主题
│   └── test-autodemo.mjs        # 自动演示测试
├── icon/                        # SVG 图标（菜单/模式/状态/操作）
├── data/                        # 样本图像与主控存档（需自行添加）
│   └── masters/                 # 主控图像（按程序分目录）
├── tests/                       # 单元测试（Pytest）
│   ├── test_detector.py
│   ├── test_inspector.py
│   ├── test_preprocessor.py
│   ├── test_pipeline.py
│   ├── test_web_server.py
│   ├── test_web_master.py
│   ├── test_roi_tools.py
│   ├── test_tool_builder.py
│   ├── test_calibration_masters.py
│   ├── test_camera_config.py
│   ├── test_camera_service.py
│   ├── test_config_store.py
│   ├── test_display_images.py
│   └── test_frame_codec.py
├── plan/                        # 设计文档
├── requirements.txt
├── CLAUDE.md
└── README.md
```

## 检测流程

```
输入图像（BGR）
    │
    ├──→ Preprocessor: 灰度化 → 高斯去噪 → 二值化(Otsu) → 形态学去噪
    │         ↓
    ├──→ Detector: 轮廓查找 → 面积/尺寸过滤 → 输出标记位置
    │         ↓
    ├──→ Inspector: HSV 颜色匹配 → 面积偏差 → 中心偏移 → Pass/Fail
    │
    └──→ ROI Tools: 按 cam 取帧 → ROI 裁剪 → 工具判定
              ↓
        综合判定（comprehensive_logic）
              ↓
        结果输出（UI / IO / 履历）
```

## 配置

默认配置见 `config/config.yaml`。产线部署时复制为独立程序文件并按实际样品调参。

### 主要配置段

| 段 | 说明 |
|----|------|
| `input` | 相机设备号列表、曝光、增益、回退图片 |
| `preprocess` | 缩放、灰度方法、滤波核、二值化方法 |
| `calibration` | 主控图像路径（分槽位）、标定参数 |
| `trigger` | 触发源（internal/external）、延迟 |
| `detector` | 轮廓检测参数（面积/边长范围） |
| `inspect` | 颜色/面积/位置检查阈值 |
| `tools[]` | 检测工具列表（hsv_roi / contour_roi） |
| `io` | Modbus 连接、综合逻辑、输出映射 |
| `output` | 结果保存策略、日志级别、JPEG 质量 |

## Web API 概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查（相机状态/版本） |
| `/api/config` | GET/PUT | 读写完整配置 |
| `/api/config/list` | GET | 列出所有程序文件 |
| `/api/config/switch` | POST | 切换活动程序 |
| `/api/wizard/step/{1-4}` | GET/PUT | 向导步骤读写 |
| `/api/trigger` | POST | 触发检测 |
| `/api/stats/reset` | POST | 重置履历统计 |
| `/api/calibration/master` | POST | 注册主控图像 |
| `/api/calibration/master/status` | GET | 主控注册状态（分槽位） |
| `/api/calibration/master/image` | GET | 获取主控图像（Base64） |
| `/api/tools/hsv-area` | POST | 计算 ROI HSV 匹配面积 |
| `/api/tools/hsv-sample-roi` | POST | ROI 内 HSV 取样 |
| `/api/tools/hsv-match-preview` | POST | HSV 命中像素预览图 |
| `/api/tools/image` | GET | 按工具返回 ROI 裁剪图 |
| `/api/cameras/live` | GET | 获取实时画面 |
| `/api/cameras/reconnect` | POST | 重连相机 |
| `/api/camera/switch` | POST | 切换预览相机 |
| `/api/camera/select` | POST | 选择相机设备号 |
| `/api/camera/options` | GET | 可切换设备号列表 |
| `/api/frame/current` | GET | 最近一次 WebSocket 帧 |
| `/api/device` | GET | 设备信息 |
| `/ws/frame` | WebSocket | 实时帧推送（含检测叠加） |

## 生产环境

| 项目 | 规格 |
|------|------|
| OS | Ubuntu 24.04.4 LTS |
| CPU | Intel J1900, 4 核 2.0 GHz |
| 内存 | DDR3 2 GB |
| 硬盘 | SATA 120 GB |
| IO | Modbus TCP（联调中） |

> 2 GB 内存环境建议关闭 `--debug` 窗口。预览帧率目标 ≥ 15fps。

## 环境要求

| | 开发 | 部署 |
|---|---|---|
| OS | Windows | Ubuntu 24.04.4 LTS |
| Python | ≥ 3.10 | ≥ 3.10 |
| 依赖 | pip + venv | pip + venv |

## 相关文档

- [CLAUDE.md](CLAUDE.md) — 开发命令与架构说明
- [UI 设计稿](plan/UI设计稿.md) — SET/RUN 界面、四步向导、STEP4 IO 与综合判定
- [主干开发计划](plan/主干开发计划.md) — M0–M5 里程碑与任务追踪

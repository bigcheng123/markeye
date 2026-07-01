"""通用工具模块：图像绘制、文件IO、日志等。"""

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np


def setup_logger(name: str = "markeye", level: str = "INFO") -> logging.Logger:
    """配置日志"""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("[%(levelname)s] %(asctime)s - %(message)s", datefmt="%H:%M:%S")
        )
        logger.addHandler(handler)

    return logger


def dated_archive_dir(base: Path, when: datetime | None = None) -> Path:
    """在存档根目录下创建并返回按日期命名的子目录（YYYYMMDD）。"""
    when = when or datetime.now()
    day_dir = base / when.strftime("%Y%m%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    return day_dir


def json_safe(value: Any) -> Any:
    """将 numpy 标量/数组转为 JSON 可序列化的原生 Python 类型。"""
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    return value


def imread(path: str, flags: int = cv2.IMREAD_COLOR) -> Optional[np.ndarray]:
    """安全读取图片，支持中文路径"""
    if not Path(path).exists():
        return None
    # 中文路径使用 np.fromfile
    buf = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(buf, flags)


def imwrite(path: str, img: np.ndarray) -> bool:
    """安全写入图片，支持中文路径"""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    ext = Path(path).suffix
    success, buf = cv2.imencode(ext, img)
    if not success:
        return False
    buf.tofile(path)
    return True


def open_dir_in_file_manager(path: str | Path) -> None:
    """在系统文件管理器中打开目录（Windows / macOS / Linux）。"""
    import platform
    import subprocess

    folder = Path(path).resolve()
    if not folder.is_dir():
        folder = folder.parent
    folder.mkdir(parents=True, exist_ok=True)
    system = platform.system()
    try:
        if system == "Windows":
            subprocess.Popen(["explorer", str(folder)])
        elif system == "Darwin":
            subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
    except OSError:
        logging.getLogger("markeye").warning("无法打开目录: %s", folder, exc_info=True)


def draw_detection(
    img: np.ndarray,
    contour: np.ndarray,
    color: tuple = (0, 255, 0),
    label: str = "",
    thickness: int = 2,
) -> np.ndarray:
    """在图像上绘制检测结果（轮廓 + 标签）"""
    result = img.copy()
    cv2.drawContours(result, [contour], -1, color, thickness)
    if label:
        x, y, w, h = cv2.boundingRect(contour)
        cv2.putText(
            result,
            label,
            (x, y - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1,
        )
    return result


def overlay_result(
    img: np.ndarray,
    passed: bool,
    details: Optional[list[str]] = None,
) -> np.ndarray:
    """在图像上叠加最终检测结果（Pass / Fail）"""
    result = img.copy()
    h, w = result.shape[:2]
    color = (0, 200, 0) if passed else (0, 0, 200)
    status = "PASS" if passed else "FAIL"

    # 顶部状态栏
    overlay = result.copy()
    cv2.rectangle(overlay, (0, 0), (w, 40), (30, 30, 30), -1)
    result = cv2.addWeighted(overlay, 0.6, result, 0.4, 0)

    cv2.putText(result, status, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

    # 详细失败信息
    if details:
        for i, d in enumerate(details):
            cv2.putText(
                result,
                d,
                (12, 60 + i * 20),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 50, 200),
                1,
            )

    return result

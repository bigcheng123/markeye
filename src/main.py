"""MarkEye — 产品标记视觉检测系统入口。

Usage:
    python src/main.py --image path/to/image.jpg
    python src/main.py --camera 0
    python src/main.py --batch data/samples/
    python src/main.py --image test.jpg --debug
"""

import argparse
import sys
from pathlib import Path

import cv2
import yaml

from .pipeline import DetectionPipeline
from .utils import imread, imwrite, setup_logger

logger = setup_logger()


def load_config(path: str = "config/config.yaml") -> dict:
    """加载 YAML 配置"""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def process_image(
    img_path: str,
    cfg: dict,
    debug: bool = False,
) -> bool:
    """处理单张图片"""
    logger.info(f"处理: {img_path}")

    img = imread(img_path)
    if img is None:
        logger.error(f"无法读取图片: {img_path}")
        return False

    pipeline = DetectionPipeline(cfg)
    result = pipeline.run(img)

    if debug:
        preprocessor_cfg = cfg.get("preprocess", {})
        from .preprocessor import Preprocessor

        binary = Preprocessor(cfg).process(img)
        cv2.imshow("Binary", binary)

    for r in result.inspections:
        if not r.passed:
            logger.warning(f"  {r.mark.label}: {' | '.join(r.fail_reasons)}")

    output_cfg = cfg.get("output", {})
    if output_cfg.get("save_result", False) and result.result_image is not None:
        save_dir = output_cfg.get("save_dir", "output")
        out_path = Path(save_dir) / f"result_{Path(img_path).name}"
        imwrite(str(out_path), result.result_image)
        logger.info(f"结果保存: {out_path}")

    if debug or output_cfg.get("show_debug", False):
        if result.result_image is not None:
            cv2.imshow("Result", result.result_image)
            logger.info("按任意键关闭窗口...")
            cv2.waitKey(0)
            cv2.destroyAllWindows()

    status = "✅ PASS" if result.passed else "❌ FAIL"
    logger.info(f"{status} — {img_path} ({result.process_ms}ms)")
    return result.passed


def process_camera(camera_id: int, cfg: dict):
    """实时相机检测循环"""
    cap = cv2.VideoCapture(camera_id)
    if not cap.isOpened():
        logger.error(f"无法打开相机 {camera_id}")
        return

    pipeline = DetectionPipeline(cfg)
    logger.info(f"相机 {camera_id} 已启动，按 'q' 退出")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        result = pipeline.run(frame)
        display = result.result_image if result.result_image is not None else frame

        cv2.imshow("MarkEye — 实时检测", display)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


def batch_process(path: str, cfg: dict):
    """批量处理目录下所有图片"""
    p = Path(path)
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tiff"}
    files = [f for f in p.iterdir() if f.suffix.lower() in exts]

    if not files:
        logger.warning(f"目录中没有图片: {path}")
        return

    logger.info(f"批量处理 {len(files)} 张图片")
    passed = 0
    for f in sorted(files):
        if process_image(str(f), cfg):
            passed += 1

    logger.info(f"批量完成: {passed}/{len(files)} PASS")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MarkEye — 产品标记视觉检测系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python src/main.py --image test.jpg
  python src/main.py --image test.jpg --debug
  python src/main.py --camera 0
  python src/main.py --batch data/samples/
  python src/main.py --image test.jpg --config custom_config.yaml
        """,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", help="单张图片路径")
    group.add_argument("--camera", type=int, default=None, help="相机ID")
    group.add_argument("--batch", help="批量处理目录")

    parser.add_argument("--config", default="config/config.yaml", help="配置文件路径")
    parser.add_argument("--debug", action="store_true", help="显示中间处理步骤")
    return parser.parse_args()


def main():
    args = parse_args()

    cfg = load_config(args.config)
    logger.setLevel(cfg.get("output", {}).get("log_level", "INFO"))

    if args.image:
        success = process_image(args.image, cfg, debug=args.debug)
        sys.exit(0 if success else 1)

    elif args.camera is not None:
        process_camera(args.camera, cfg)

    elif args.batch:
        batch_process(args.batch, cfg)


if __name__ == "__main__":
    main()

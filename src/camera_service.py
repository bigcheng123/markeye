"""相机采集与软触发采图（双槽位 CAM#0 / CAM#1）。"""

from __future__ import annotations

import grp
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

from .camera_config import NUM_CAMERA_SLOTS, slot_device_ids
from .utils import imread

ROOT = Path(__file__).resolve().parent.parent


def _capture_backends() -> list[int | None]:
    if sys.platform == "win32":
        # MSMF 在部分 Windows 机器/驱动组合下会出现抓帧失败甚至原生崩溃（0xC0000005）。
        # 默认优先使用 DSHOW；若确实需要 MSMF，可显式设置环境变量启用。
        enable_msmf = os.environ.get("MARKEYE_ENABLE_MSMF", "").strip() in {"1", "true", "TRUE", "True"}
        return [cv2.CAP_DSHOW, cv2.CAP_MSMF, None] if enable_msmf else [cv2.CAP_DSHOW, None]
    return [cv2.CAP_V4L2, None]


def _read_frame_with_timeout(cap: cv2.VideoCapture, timeout_s: float = 2.0) -> tuple[bool, Optional[np.ndarray]]:
    """避免 Windows MSMF 在 read() 上长时间阻塞。"""
    box: list = [False, None]

    def _work() -> None:
        box[0], box[1] = cap.read()

    thread = threading.Thread(target=_work, daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive():
        return False, None
    return bool(box[0]), box[1]


def probe_camera_diagnostic(
    cam_id: int, *, timeout_s: float = 2.0
) -> tuple[dict[str, Any], Optional[cv2.VideoCapture]]:
    """探测单路相机，返回诊断信息与成功时的 VideoCapture。"""
    diag: dict[str, Any] = {
        "device_id": int(cam_id),
        "opened": False,
        "read_ok": False,
        "backend": None,
        "reason": "not_found",
    }
    deadline = time.monotonic() + max(timeout_s, 0.5)
    for backend in _capture_backends():
        if time.monotonic() >= deadline:
            diag["reason"] = "timeout"
            break
        cap = (
            cv2.VideoCapture(cam_id)
            if backend is None
            else cv2.VideoCapture(cam_id, backend)
        )
        if not cap.isOpened():
            cap.release()
            diag["reason"] = "open_failed"
            continue
        diag["opened"] = True
        try:
            diag["backend"] = cap.getBackendName() or None
        except cv2.error:
            diag["backend"] = None
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        remaining = max(0.2, deadline - time.monotonic())
        ret, frame = _read_frame_with_timeout(cap, remaining)
        if ret and frame is not None:
            diag["read_ok"] = True
            diag["reason"] = "ok"
            return diag, cap
        diag["reason"] = "read_timeout" if remaining <= 0.05 else "read_failed"
        cap.release()
    return diag, None


def _probe_camera(cam_id: int, *, timeout_s: float = 2.0) -> Optional[cv2.VideoCapture]:
    """尝试打开设备并读取一帧；成功则返回已打开的 VideoCapture。"""
    _diag, cap = probe_camera_diagnostic(cam_id, timeout_s=timeout_s)
    return cap


def _linux_v4l2_sysfs_nodes() -> list[dict[str, Any]]:
    """解析 /sys/class/video4linux，列出内核注册的 V4L2 节点。"""
    base = Path("/sys/class/video4linux")
    if not base.is_dir():
        return []
    nodes: list[dict[str, Any]] = []
    for entry in sorted(base.iterdir(), key=lambda p: p.name):
        if not entry.name.startswith("video"):
            continue
        try:
            device_id = int(entry.name[5:])
        except ValueError:
            continue
        name = ""
        name_path = entry / "name"
        if name_path.is_file():
            try:
                name = name_path.read_text(encoding="utf-8").strip()
            except OSError:
                name = ""
        nodes.append({
            "device_id": device_id,
            "dev_path": f"/dev/{entry.name}",
            "name": name or "—",
        })
    return nodes


def _linux_video_access_hint() -> Optional[dict[str, str]]:
    """Linux：检查 /dev/video* 是否存在及当前用户是否有访问权限。"""
    if sys.platform != "linux":
        return None
    video_devs = sorted(Path("/dev").glob("video*"))
    if not video_devs:
        return {
            "reason": "no_video_nodes",
            "message": "系统未识别到 /dev/video* 设备，请检查相机连接与驱动。",
        }
    try:
        group_names = {grp.getgrgid(g).gr_name for g in os.getgroups()}
    except (KeyError, OSError):
        group_names = set()
    if "video" not in group_names:
        blocked = [p for p in video_devs if not os.access(p, os.R_OK | os.W_OK)]
        if blocked:
            return {
                "reason": "permission_denied",
                "message": (
                    "当前用户未加入 video 组，无法访问相机设备。"
                    "请执行 sudo usermod -aG video $USER 后重新登录。"
                ),
            }
    return None


def _device_model(cap: cv2.VideoCapture) -> str:
    for prop in (
        getattr(cv2, "CAP_PROP_DEVICE_DESCRIPTION", None),
        getattr(cv2, "CAP_PROP_GUID", None),
    ):
        if prop is None:
            continue
        try:
            val = cap.get(prop)
        except cv2.error:
            continue
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, (int, float)) and val:
            return str(int(val) if float(val).is_integer() else val)
    try:
        backend = cap.getBackendName()
        if backend:
            return f"Camera ({backend})"
    except cv2.error:
        pass
    return "—"


def _device_info_from_cap(device_id: int, cap: cv2.VideoCapture) -> dict:
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    try:
        backend = cap.getBackendName() or "—"
    except cv2.error:
        backend = "—"
    return {
        "device_id": int(device_id),
        "model": _device_model(cap),
        "backend": backend,
        "width": w,
        "height": h,
        "accessible": True,
    }


def enumerate_camera_devices(
    *, max_probe: int = 10, timeout_s: float = 2.0
) -> list[dict]:
    """探测本机可打开的 OpenCV 相机（设备索引 0 .. max_probe-1）。"""
    return enumerate_camera_devices_detail(max_probe=max_probe, timeout_s=timeout_s)["devices"]


def enumerate_camera_devices_detail(
    *, max_probe: int = 10, timeout_s: float = 2.0
) -> dict[str, Any]:
    """枚举相机并附带逐索引诊断信息。"""
    limit = max(1, int(max_probe))
    devices: list[dict] = []
    diagnostics: list[dict] = []
    for device_id in range(limit):
        diag, cap = probe_camera_diagnostic(device_id, timeout_s=timeout_s)
        diagnostics.append(diag)
        if cap is None:
            continue
        try:
            devices.append(_device_info_from_cap(device_id, cap))
        finally:
            cap.release()
    return _build_enumerate_payload(devices, diagnostics)


def _build_enumerate_payload(
    devices: list[dict], diagnostics: list[dict]
) -> dict[str, Any]:
    hints: list[dict[str, str]] = []
    v4l2_nodes: list[dict[str, Any]] = []
    if sys.platform == "linux":
        v4l2_nodes = _linux_v4l2_sysfs_nodes()
        access_hint = _linux_video_access_hint()
        if access_hint:
            hints.append(access_hint)
        if not devices and v4l2_nodes:
            opened_any = any(d.get("opened") for d in diagnostics)
            if opened_any:
                hints.append({
                    "reason": "metadata_or_read_failed",
                    "message": (
                        "检测到 V4L2 节点但未能读到有效帧；部分索引可能为元数据节点。"
                        "请尝试「深度扫描」或手动填写可采集的 device_id。"
                    ),
                })
            elif not access_hint:
                hints.append({
                    "reason": "index_mismatch",
                    "message": (
                        "系统存在 V4L2 设备节点，但 OpenCV 未能打开。"
                        "请确认相机未被占用，或尝试「深度扫描」扩大索引范围。"
                    ),
                })
    devices.sort(key=lambda d: d["device_id"])
    return {
        "count": len(devices),
        "devices": devices,
        "diagnostics": diagnostics,
        "hints": hints,
        "v4l2_nodes": v4l2_nodes,
    }


@dataclass
class _SlotState:
    device_id: int = 0
    cap: Optional[cv2.VideoCapture] = None
    connected: bool = False
    using_fallback: bool = False
    latest_frame: Optional[np.ndarray] = None
    last_frame: Optional[np.ndarray] = None
    frame_seq: int = 0


class CameraService:
    """管理两路逻辑相机槽位，每槽位映射一个 OpenCV 设备号。"""

    def __init__(self, config: dict):
        self.config = config
        self._slots: list[_SlotState] = [_SlotState() for _ in range(NUM_CAMERA_SLOTS)]
        self._lock = threading.Lock()
        # 保护每个槽位 VideoCapture 的生命周期（read / get / release / open）。
        # OpenCV 的 VideoCapture 非线程安全：抓帧线程 read() 与重连时的 release()
        # 若并发会触发 V4L2 VIDIOC_DQBUF 失败并导致原生段错误。
        self._cap_lock = threading.RLock()
        self._grab_stop = threading.Event()
        self._grab_thread: Optional[threading.Thread] = None
        # 兼容旧测试/旧代码：曾直接使用 _connected/_latest_frame/_frame_seq（单路相机模型）
        # 现在统一映射到 slot0 状态，通过 property 维持可读写行为。

    @property
    def _connected(self) -> bool:  # noqa: SLF001 - legacy compat
        return self._slots[0].connected

    @_connected.setter
    def _connected(self, v: bool) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].connected = bool(v)

    @property
    def _latest_frame(self) -> Optional[np.ndarray]:  # noqa: SLF001 - legacy compat
        return self._slots[0].latest_frame

    @_latest_frame.setter
    def _latest_frame(self, frame: Optional[np.ndarray]) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].latest_frame = frame
        if frame is not None:
            self._slots[0].last_frame = frame

    @property
    def _frame_seq(self) -> int:  # noqa: SLF001 - legacy compat
        return self._slots[0].frame_seq

    @_frame_seq.setter
    def _frame_seq(self, n: int) -> None:  # noqa: SLF001 - legacy compat
        self._slots[0].frame_seq = int(n or 0)

    @property
    def connected(self) -> bool:
        return self.is_connected(0)

    @property
    def using_fallback(self) -> bool:
        return self._slots[0].using_fallback

    @property
    def frame_seq(self) -> int:
        with self._lock:
            return self._slots[0].frame_seq

    def is_connected(self, slot: int = 0) -> bool:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return False
        return self._slots[slot].connected

    def slot_status(self) -> list[dict]:
        devices = slot_device_ids(self.config)
        out = []
        for i in range(NUM_CAMERA_SLOTS):
            s = self._slots[i]
            out.append({
                "slot": i,
                "device_id": devices[i] if i < len(devices) else i,
                "connected": s.connected,
                "using_fallback": s.using_fallback,
            })
        return out

    def describe_connected_devices(self) -> list[dict]:
        """返回当前已连接槽位对应的 OpenCV 设备信息（无需重新 open）。"""
        seen: set[int] = set()
        devices: list[dict] = []
        with self._cap_lock:
            for state in self._slots:
                if not state.connected or state.cap is None:
                    continue
                dev_id = int(state.device_id)
                if dev_id in seen:
                    continue
                seen.add(dev_id)
                devices.append(_device_info_from_cap(dev_id, state.cap))
        return devices

    def _probe_timeout_s(self) -> float:
        inp = self.config.get("input", {})
        raw = inp.get("probe_timeout_s", 2.0)
        try:
            return max(0.5, float(raw))
        except (TypeError, ValueError):
            return 2.0

    def enumerate_devices_detail(
        self, *, max_probe: int = 10, timeout_s: float | None = None
    ) -> dict[str, Any]:
        """枚举相机：先合并已连接槽位，再探测其余索引，附带诊断。"""
        limit = max(1, int(max_probe))
        probe_timeout = self._probe_timeout_s() if timeout_s is None else max(0.5, float(timeout_s))
        devices = self.describe_connected_devices()
        seen = {d["device_id"] for d in devices}
        diagnostics: list[dict] = []
        device_by_id = {d["device_id"]: d for d in devices}

        for device_id in range(limit):
            if device_id in seen:
                connected = device_by_id[device_id]
                diagnostics.append({
                    "device_id": device_id,
                    "opened": True,
                    "read_ok": True,
                    "backend": connected.get("backend"),
                    "reason": "connected",
                })
                continue
            diag, cap = probe_camera_diagnostic(device_id, timeout_s=probe_timeout)
            diagnostics.append(diag)
            if cap is None:
                continue
            try:
                devices.append(_device_info_from_cap(device_id, cap))
                seen.add(device_id)
            finally:
                cap.release()

        return _build_enumerate_payload(devices, diagnostics)

    def enumerate_devices(
        self, *, max_probe: int = 10, timeout_s: float | None = None
    ) -> list[dict]:
        return self.enumerate_devices_detail(max_probe=max_probe, timeout_s=timeout_s)["devices"]

    def _open_capture(self, cam_id: int) -> Optional[cv2.VideoCapture]:
        return _probe_camera(cam_id)

    def connect(self, camera_id: Optional[int] = None) -> bool:
        """兼容旧 API：连接全部槽位；camera_id 仅更新 slot0 设备号。"""
        if camera_id is not None:
            inp = self.config.setdefault("input", {})
            cameras = list(slot_device_ids(self.config))
            cameras[0] = int(camera_id)
            inp["cameras"] = cameras
            inp["camera_id"] = int(camera_id)
        return any(self.connect_all().values())

    def connect_all(self, cameras: Optional[list[int]] = None) -> dict[int, bool]:
        devices = cameras if cameras is not None else slot_device_ids(self.config)
        results: dict[int, bool] = {}
        for slot in range(NUM_CAMERA_SLOTS):
            dev = int(devices[slot]) if slot < len(devices) else slot
            results[slot] = self.connect_slot(slot, dev)
        if any(results.values()) and (self._grab_thread is None or not self._grab_thread.is_alive()):
            self._start_grabber()
        if not any(results.values()):
            self._stop_grabber()
        return results

    def connect_slot(self, slot: int, device_id: int) -> bool:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return False
        self.disconnect_slot(slot)
        # 在锁外完成设备探测/打开（可能较慢），再在锁内挂载 cap，避免与抓帧线程竞争。
        cap = self._open_capture(int(device_id))
        state = self._slots[slot]
        with self._cap_lock:
            state.device_id = int(device_id)
            state.cap = cap
            state.connected = cap is not None
            state.using_fallback = not state.connected
        return state.connected

    def disconnect_slot(self, slot: int) -> None:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            return
        state = self._slots[slot]
        with self._cap_lock:
            if state.cap is not None:
                state.cap.release()
                state.cap = None
            state.connected = False
            state.using_fallback = False
        with self._lock:
            state.latest_frame = None

    def disconnect(self) -> None:
        self._stop_grabber()
        for slot in range(NUM_CAMERA_SLOTS):
            self.disconnect_slot(slot)

    def reconnect_unhealthy_slots(self) -> dict[int, bool]:
        """重连未连接或抓帧失败（fallback）的槽位。"""
        devices = slot_device_ids(self.config)
        results: dict[int, bool] = {}
        for slot in range(NUM_CAMERA_SLOTS):
            state = self._slots[slot]
            if state.connected and not state.using_fallback:
                continue
            dev = int(devices[slot]) if slot < len(devices) else slot
            results[slot] = self.connect_slot(slot, dev)
        if any(results.values()) and (self._grab_thread is None or not self._grab_thread.is_alive()):
            self._start_grabber()
        return results

    def switch(self) -> bool:
        """RUN 模式快捷切换：交换 slot0 / slot1 的设备映射并重连。"""
        inp = self.config.setdefault("input", {})
        cameras = list(slot_device_ids(self.config))
        cameras[0], cameras[1] = cameras[1], cameras[0]
        inp["cameras"] = cameras
        inp["camera_id"] = cameras[0]
        results = self.connect_all(cameras)
        return results.get(0, False)

    def update_cameras_config(self, cameras: list[int]) -> dict[int, bool]:
        inp = self.config.setdefault("input", {})
        normalized = [int(cameras[i]) for i in range(NUM_CAMERA_SLOTS)]
        inp["cameras"] = normalized
        inp["camera_id"] = normalized[0]
        return self.connect_all(normalized)

    def _resolve_fallback_path(self) -> Optional[Path]:
        inp = self.config.get("input", {})
        fallback = inp.get("fallback_image", "data/sample.jpg")
        path = Path(fallback)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            return path
        for candidate in (
            ROOT / "data" / "sample.jpg",
            ROOT / "ui" / "ui_sample" / "target.PNG",
        ):
            if candidate.exists():
                return candidate
        return None

    def _start_grabber(self) -> None:
        if self._grab_thread and self._grab_thread.is_alive():
            return
        self._grab_stop.clear()
        thread = threading.Thread(target=self._grabber_loop, name="markeye-camera-grabber", daemon=True)
        self._grab_thread = thread
        thread.start()

    def _stop_grabber(self) -> None:
        self._grab_stop.set()
        thread = self._grab_thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._grab_thread = None

    def _grabber_loop(self) -> None:
        while not self._grab_stop.is_set():
            any_read = False
            for slot in range(NUM_CAMERA_SLOTS):
                state = self._slots[slot]
                # 在持有 _cap_lock 的前提下读取，确保 read() 期间 cap 不会被 release()。
                with self._cap_lock:
                    cap = state.cap
                    if not state.connected or cap is None:
                        continue
                    ret, frame = cap.read()
                if ret and frame is not None:
                    with self._lock:
                        state.latest_frame = frame
                        state.last_frame = frame
                        state.frame_seq += 1
                        state.using_fallback = False
                    any_read = True
                else:
                    state.using_fallback = True
            if not any_read:
                time.sleep(0.02)

    def _capture_fallback_unlocked(self, slot: int) -> Optional[np.ndarray]:
        state = self._slots[slot]
        if state.last_frame is not None:
            return state.last_frame.copy()
        fallback_path = self._resolve_fallback_path()
        if fallback_path is not None:
            img = imread(str(fallback_path))
            if img is not None:
                state.last_frame = img
                state.using_fallback = True
                return img.copy()
        return None

    def get_live_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            if state.latest_frame is not None:
                return state.latest_frame.copy()
            return self._capture_fallback_unlocked(slot)

    def capture_for_trigger(self, slot: int = 0, *, max_wait_s: float = 0.2) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            start_seq = state.frame_seq

        deadline = time.monotonic() + max_wait_s
        while time.monotonic() < deadline:
            time.sleep(0.005)
            with self._lock:
                if state.frame_seq > start_seq and state.latest_frame is not None:
                    return state.latest_frame.copy()

        with self._lock:
            if state.latest_frame is not None:
                return state.latest_frame.copy()
            return self._capture_fallback_unlocked(slot)

    def capture_all_for_trigger(self, slots: Optional[set[int]] = None) -> dict[int, Optional[np.ndarray]]:
        if slots is None:
            target = set(range(NUM_CAMERA_SLOTS))
        else:
            target = {max(0, min(NUM_CAMERA_SLOTS - 1, int(s))) for s in slots}
            if not target:
                target = {0}
        return {slot: self.capture_for_trigger(slot) for slot in sorted(target)}

    def capture_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        return self.get_live_frame(slot)

    def capture_latest_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        return self.capture_for_trigger(slot)

    def get_last_frame(self, slot: int = 0) -> Optional[np.ndarray]:
        if slot < 0 or slot >= NUM_CAMERA_SLOTS:
            slot = 0
        state = self._slots[slot]
        with self._lock:
            if state.last_frame is None:
                return None
            return state.last_frame.copy()

    def capture_device_snapshot(self, device_id: int) -> tuple[Optional[np.ndarray], Optional[int]]:
        """按 OpenCV 设备号单帧抓拍；优先已连接槽位，否则临时打开设备。"""
        dev = int(device_id)
        devices = slot_device_ids(self.config)
        for slot in range(NUM_CAMERA_SLOTS):
            if slot < len(devices) and int(devices[slot]) == dev:
                frame = self.get_live_frame(slot)
                if frame is not None:
                    return frame, slot
        cap = _probe_camera(dev)
        if cap is None:
            return None, None
        ret, frame = cap.read()
        cap.release()
        if ret and frame is not None:
            return frame, None
        return None, None

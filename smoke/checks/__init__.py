"""MarkEye 产线冒烟检查项。"""

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass
class SmokeContext:
    base_url: str
    timeout: float
    ws_timeout: float
    quiet: bool = False

    @property
    def ws_url(self) -> str:
        parsed = urlparse(self.base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if scheme == "wss" else 80)
        if (scheme == "ws" and port == 80) or (scheme == "wss" and port == 443):
            netloc = host
        else:
            netloc = f"{host}:{port}"
        return f"{scheme}://{netloc}/ws/frame"


CheckResult = tuple[bool, str]

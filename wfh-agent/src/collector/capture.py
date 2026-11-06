"""Capture primitives: screenshots (all monitors), foreground window, idle time.

Windows-only. Imports are guarded so the module can be imported for inspection
on non-Windows, but capture functions require Windows at runtime.
"""
from __future__ import annotations

import ctypes
import io
from typing import List, Optional, Tuple

try:  # Windows-only deps
    import mss
    import psutil
    import win32gui
    import win32process
    from PIL import Image
    _HAVE_WIN = True
except Exception:  # pragma: no cover - non-Windows inspection
    _HAVE_WIN = False


def idle_seconds() -> float:
    """Seconds since the last keyboard/mouse input for this session."""
    if not _HAVE_WIN:
        return 0.0

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    millis = ctypes.windll.kernel32.GetTickCount() - info.dwTime
    return max(0.0, millis / 1000.0)


def foreground_info() -> Tuple[Optional[str], Optional[str]]:
    """(process_name, window_title) of the foreground window."""
    if not _HAVE_WIN:
        return None, None
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None, None
        title = win32gui.GetWindowText(hwnd) or None
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        app = None
        if pid:
            try:
                app = psutil.Process(pid).name()
            except Exception:
                app = None
        return app, title
    except Exception:
        return None, None


def grab_screens(webp_quality: int = 60) -> List[Tuple[int, bytes]]:
    """Return [(display_no, webp_bytes), ...] for every physical monitor.

    display_no is 1-based. mss monitor[0] is the virtual "all monitors" rect,
    so real monitors start at index 1.
    """
    if not _HAVE_WIN:
        raise RuntimeError("Screen capture requires Windows.")
    out: List[Tuple[int, bytes]] = []
    with mss.mss() as sct:
        for i, mon in enumerate(sct.monitors[1:], start=1):
            raw = sct.grab(mon)
            img = Image.frombytes("RGB", raw.size, raw.rgb)
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=webp_quality, method=4)
            out.append((i, buf.getvalue()))
    return out

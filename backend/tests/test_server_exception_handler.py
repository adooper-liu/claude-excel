"""server._ignore_proactor_reset：Windows Proactor 下客户端中断连接的良性噪音抑制。

只吞掉「回调里 _call_connection_lost 的 shutdown() 抛 ConnectionReset/Aborted」这一种，
其余（包括用户代码里的同异常、回调里的其他异常）一律交给默认处理器，不静默吞错。
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from server import _ignore_proactor_reset  # noqa: E402

PROACTOR_MSG = "Exception in callback _ProactorBasePipeTransport._call_connection_lost()"


class _FakeLoop:
    def __init__(self):
        self.calls = []

    def default_exception_handler(self, context):
        self.calls.append(context)


def test_swallows_proactor_connection_reset():
    loop = _FakeLoop()
    ctx = {"exception": ConnectionResetError(10054, "connection reset"), "message": PROACTOR_MSG}
    _ignore_proactor_reset(loop, ctx)
    assert loop.calls == []


def test_swallows_proactor_connection_aborted():
    loop = _FakeLoop()
    ctx = {"exception": ConnectionAbortedError(10053, "connection aborted"), "message": PROACTOR_MSG}
    _ignore_proactor_reset(loop, ctx)
    assert loop.calls == []


def test_delegates_same_exception_outside_proactor_callback():
    loop = _FakeLoop()
    ctx = {"exception": ConnectionResetError(10054, "connection reset"), "message": "a user-code error"}
    _ignore_proactor_reset(loop, ctx)
    assert len(loop.calls) == 1


def test_delegates_other_exceptions_in_callback():
    loop = _FakeLoop()
    ctx = {"exception": ValueError("boom"), "message": PROACTOR_MSG}
    _ignore_proactor_reset(loop, ctx)
    assert len(loop.calls) == 1


def test_delegates_when_exception_missing():
    loop = _FakeLoop()
    ctx = {"message": PROACTOR_MSG}
    _ignore_proactor_reset(loop, ctx)
    assert len(loop.calls) == 1

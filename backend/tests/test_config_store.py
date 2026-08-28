"""config_store: CONFIG_DIR honors SHEETWISE_USER_HOME (for service mode)."""

import importlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import config_store  # noqa: E402


def test_config_dir_default_is_user_home(monkeypatch):
    # 未设 SHEETWISE_USER_HOME 时 = expanduser("~")/.claude-excel-web
    assert config_store.CONFIG_DIR == Path.home() / ".claude-excel-web"


def test_config_dir_honors_env_in_fresh_process(tmp_path):
    # 服务模式：SHEETWISE_USER_HOME 指向真实用户目录。用子进程保证 config_store
    # 在设了 env 的情况下全新 import（CONFIG_DIR 是 import 时冻结的）。
    code = (
        "import sys; sys.path.insert(0, 'backend'); "
        "import config_store; print(config_store.CONFIG_DIR)"
    )
    env = {"SHEETWISE_USER_HOME": str(tmp_path)}
    # 保留 PYTHONPATH 所需的最小环境
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(tmp_path / ".claude-excel-web")

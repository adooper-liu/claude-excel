"""recipe/hosts/*.yml and recipe/sheets/*.yml loaders."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import fetch_recipe as fr  # noqa: E402
from recipe_hosts import HOSTS_DIR, SHEETS_DIR, load_host_templates, load_sheet_templates  # noqa: E402


def test_host_yml_files_exist():
    assert (HOSTS_DIR / "amazon.com.yml").is_file()
    assert (HOSTS_DIR / "1688.com.yml").is_file()


def test_load_host_templates_has_amazon_project():
    tpl = load_host_templates()["amazon.com"]
    assert "排名" in tpl["project"]["targets"]
    cols = tpl["project"]["columns"]
    assert any(c.get("as") == "售价" and c.get("merge") for c in cols)


def test_fetch_recipe_module_uses_yaml_templates():
    assert fr.HOST_TEMPLATES["amazon.com"]["project"]["headerless"] is True
    assert "1688.product" in fr.DATA_SHEET_TEMPLATES


def test_sheet_templates_loaded():
    sheet = load_sheet_templates()["sif.keyword"]
    assert sheet["targets"][0] == "关键词"

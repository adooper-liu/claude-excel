"""Storage contract for user-authored document recipes."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import doc_recipe  # noqa: E402
from doc_recipe import (  # noqa: E402
    delete_doc_recipe,
    list_doc_recipes,
    load_doc_recipe,
    save_doc_recipe,
    validate_doc_recipe,
)


def recipe(**overrides):
    value = {
        "name": " 增值税发票 ",
        "description": "表头第一行，金额为欧式数字。",
        "fields": [
            {"name": "品名", "type": "text", "source": "数据区第1列"},
            {
                "name": "金额",
                "type": "number",
                "source": "数据区第4列",
                "format": {
                    "numberStyle": "eu",
                    "stripSymbols": ["€"],
                    "nullValues": ["N/A"],
                    "unknown": "drop-me",
                },
            },
        ],
    }
    value.update(overrides)
    return value


def test_save_load_list_delete_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(doc_recipe, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(doc_recipe, "DOC_RECIPES_DIR", tmp_path / "doc-recipes")
    saved = save_doc_recipe(recipe())

    assert saved["name"] == "增值税发票"
    assert saved["updatedAt"]
    assert load_doc_recipe("增值税发票") == saved
    listed = list_doc_recipes()
    assert listed == [
        {
            "name": "增值税发票",
            "description": "表头第一行，金额为欧式数字。",
            "fieldCount": 2,
            "updatedAt": saved["updatedAt"],
        }
    ]

    delete_doc_recipe("增值税发票")
    try:
        load_doc_recipe("增值税发票")
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("deleted template remained loadable")
    assert list_doc_recipes() == []


def test_validate_doc_recipe_rejects_invalid_shape():
    for raw in (
        recipe(name=""),
        recipe(fields=[{"type": "number", "source": "col 1"}]),
        recipe(fields=[{"name": "金额", "type": "currency", "source": "col 1"}]),
    ):
        try:
            validate_doc_recipe(raw)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid template accepted: " + repr(raw))


def test_validate_doc_recipe_drops_unknown_format_keys():
    clean = validate_doc_recipe(recipe())
    field = clean["fields"][1]
    assert field["format"] == {
        "numberStyle": "eu",
        "stripSymbols": ["€"],
        "nullValues": ["N/A"],
    }


def test_save_doc_recipe_stores_sample_and_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(doc_recipe, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(doc_recipe, "DOC_RECIPES_DIR", tmp_path / "doc-recipes")
    saved = save_doc_recipe(recipe(), sample_data=b"%PDF-sample", sample_filename="invoice.pdf")
    assert saved["sample"] == "增值税发票.pdf"
    assert (tmp_path / "doc-recipes" / "samples" / "增值税发票.pdf").read_bytes() == b"%PDF-sample"

    try:
        save_doc_recipe(
            recipe(fields=[{"name": "品名", "type": "text", "source": ""}]),
            sample_data=b"ignored",
            sample_filename="../../invoice.png",
        )
    except ValueError:
        pass
    else:
        raise AssertionError("sample traversal accepted")


def test_sample_metadata_rejects_path_separators():
    try:
        validate_doc_recipe(recipe(sample="../invoice.png"))
    except ValueError:
        pass
    else:
        raise AssertionError("sample traversal metadata accepted")

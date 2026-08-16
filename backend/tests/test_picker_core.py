"""Node require specs for picker-core pure extractors."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / "extension" / "picker-core.js"


def _node(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        text=True,
        check=False,
        env={**__import__("os").environ, "PICKER_CORE": str(CORE)},
    )


def test_picker_core_file_exists():
    assert CORE.is_file()


def test_merge_grids_via_require():
    script = r"""
const { mergeGrids } = require(process.env.PICKER_CORE);
const g = mergeGrids([ [["A","B"],["1","2"]], [["A","B"],["3","4"]] ]);
if (g.length !== 3 || g[2][0] !== "3") { console.error(JSON.stringify(g)); process.exit(1); }
console.log("ok");
"""
    r = _node(script)
    assert r.returncode == 0, r.stderr or r.stdout


def test_cells_to_grid_via_require():
    script = r"""
const { cellsToGrid } = require(process.env.PICKER_CORE);
const grid = cellsToGrid([
  { x: 10, y: 10, w: 40, h: 12, t: "A" },
  { x: 60, y: 10, w: 40, h: 12, t: "B" },
  { x: 10, y: 30, w: 40, h: 12, t: "C" },
  { x: 60, y: 30, w: 40, h: 12, t: "D" },
]);
if (!grid || grid.length !== 2 || grid[0][0] !== "A" || grid[1][1] !== "D") {
  console.error(JSON.stringify(grid)); process.exit(1);
}
console.log("ok");
"""
    r = _node(script)
    assert r.returncode == 0, r.stderr or r.stdout


def test_looks_like_header_row_via_require():
    script = r"""
const { looksLikeHeaderRow } = require(process.env.PICKER_CORE);
const cards = ["+14", "Bedsure PureWove", "选项:", "CNY 67.29", "4.4 颗星"];
if (looksLikeHeaderRow(cards, ["+8","BEDELITE","选项:","CNY 50.00","4.3 颗星"])) process.exit(1);
if (!looksLikeHeaderRow(["店铺","订单号","金额","日期"], ["A店","123","12.5","2024-01-01"])) process.exit(1);
console.log("ok");
"""
    r = _node(script)
    assert r.returncode == 0, r.stderr or r.stdout

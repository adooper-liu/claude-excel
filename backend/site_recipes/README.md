# 站点提取模板（引擎数据，不是代码）

跟手点选前的**默认列映射**与 **DOM 查询**在此维护。不要写进 `picker.js` 选择器逻辑，也不要把行业口径塞进来。

## 与用户 recipe 的区别

| 位置 | 内容 |
|---|---|
| `backend/site_recipes/{host}.json` | 仓库内、可评审的**内置模板**（`extract.fields[].query`） |
| `~/.claude-excel-web/fetch-recipes/{host}.json` | 用户跟手采集后保存的 recipe（优先级更高） |
| `recipe/hosts/{host}.yml` | 进簿后的 **project 列规整**（reshape），不是 DOM 选择器 |

## 新增站点

1. 复制 `amazon.json`，改 `host` / `match.hostSuffix` / `extract`
2. 跑 `pytest backend/tests/test_fetch_recipe.py -k site_template`
3. 模板是**默认预填**，用户仍可点选改列、撤销、框选

## 字段

- `fields[].as` — Excel 列名
- `fields[].query` — 相对列表项的 CSS 查询
- `fields[].type` — `text | attr | link`
- `extract.listQuery` — 列表项容器（点选同类时优先）

picker 纯函数行为测在 `extension/picker-core.js` + `addin/test/unit/picker-core.test.js`；`similarItems` 仍 DOM 耦合，留在 `picker.js`。

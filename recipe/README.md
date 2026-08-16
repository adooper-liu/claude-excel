# Recipe 数据（引擎加载，非代码）

站点列映射、iterate 默认参数、project 目标列在此维护，**不要**写进 `picker.js` 选择器或核心 TypeScript。

## hosts/

浏览器取数跟手采集后的规整模板。文件名 = `recipe_host_key`（如 `amazon.com.yml`）。

引擎：`backend/fetch_recipe.py` → `recipe_hosts.load_host_templates()`  
用户采集结果：`~/.claude-excel-web/fetch-recipes/{host}.json`（含 `extract.fields`）

## sheets/

粘贴/API 导入表的 header 映射（表名关键字触发，非 URL）。

## 新增站点

1. 复制 `hosts/walmart.com.yml` 改 `host` / `targets` / `iterate`
2. 跑 `pytest backend/tests/test_recipe_hosts.py`
3. 用户在网页点选写入后，`fields` 进用户 recipe JSON；`columns` 可后续补全

picker 行为（点选同类/框选）在 `extension/picker-core.js`，用 vm 测试覆盖，不在此目录放选择器。

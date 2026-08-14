# Skills 契约

产品只有 **Excel 加载项**。工具声明与执行都在加载项内。

当前主路径：**inspect → ensure_table → reconcile_tables / reshape_table / calculate_table**。对账、整形、活公式都只写新表。

| | 路径 |
|---|---|
| 声明 | `addin/skills/core/*/manifest.json` |
| 执行器 | `addin/src/services/skill-handlers.ts` 的 `switch` |
| 登记 | `HANDLED_TOOLS` 与 `ADDIN_HANDLERS` |
| 对账说明 | `addin/skills/core/reconcile/SKILL.md` |

## 纪律

**manifest 里出现的每个 `tools[].name`，必须有对应 executor。否则启动失败。**

- 后端：`python backend/server.py` 在 FastAPI `startup` 校验 `addin/skills/core`。缺 executor 则 `SystemExit`。
- 加载项：`skill-loader.ts` 读取本地 manifest，调用 `assertManifestExecutors`。缺 handler 则抛错。
- 模型拿到的工具列表来自这些本地 manifest，不再走 pandas/Web 清单。

## 新增工具

1. `addin/skills/core/<name>/manifest.json`
2. 同一提交里：`executeHandler` 增加 `case`，名字写入 `HANDLED_TOOLS` 与 `ADDIN_HANDLERS`
3. 把新 manifest 加入 `skill-loader.ts` 的 import 列表
4. 跑 `python -m pytest backend/tests/test_skill_registry.py`，重启后端确认能起来

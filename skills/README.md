# Skills 契约

产品分三层：**Excel 底座**（取数/洗表/提取选中列/对账/活公式/透视/改假设）→ **`/拆解` + `/skill-creator`** → **行业技能包**（清关、跨境电商等，不进核心 manifest）。

斜杠是加速器，默认对话是通用 Excel Agent。对账/整形只写新表；改假设用 `write_inputs`。

**算子要通用，口令不要堆。** 洗表做成 `reshape_table` / `extract_selection` 这类带参数的工具；不要为「提取店铺列」「继续去重」加专用正则。多轮靠对话历史选已有参数。见 `CLAUDE.md`。

汲取外部技能：能力做成自己的中文 `SKILL.md` 与 Office JS；不要拷贝对方原文。见 `CLAUDE.md`。

## 用户技能怎么编排算子

用户技能是**步骤清单**，不能新增 executor。`/skill-creator` 必须按 `addin/src/services/skill-create-guide.ts` 起草：每步点名已有工具，表体不进模型。

- 洗表/对账/公式/透视/假设：`extract_selection` `reshape_table` `reconcile_tables` `calculate_table` `create_pivot` `write_inputs`
- 禁止：发明工具名；整列读进对话再 `write_to_sheet`；用手写格子伪造对账/整形结果
- 目录里没有的动作标 🟡/🔴，不要假装能全自动

创建回合只 `inspect`，不改表。装好的技能运行时才调用上面的算子。

| | 路径 |
|---|---|
| 声明 | `addin/skills/core/*/manifest.json` |
| 执行器 | `addin/src/services/skill-handlers.ts` 的 `switch` |
| 登记 | `HANDLED_TOOLS` 与 `ADDIN_HANDLERS` |

## 纪律

**manifest 里出现的每个 `tools[].name`，必须有对应 executor。否则启动失败。**

- 后端：`python backend/server.py` 在 FastAPI `startup` 校验 `addin/skills/core`。缺 executor 则 `SystemExit`。
- 加载项：`skill-loader.ts` 读取本地 manifest，调用 `assertManifestExecutors`。缺 handler 则抛错。

## 新增工具

1. `addin/skills/core/<name>/manifest.json`
2. 同一提交里：`executeHandler` 增加 `case`，名字写入 `HANDLED_TOOLS` 与 `ADDIN_HANDLERS`
3. 把新 manifest 加入 `skill-loader.ts` 的 import 列表
4. 跑 `python -m pytest backend/tests/test_skill_registry.py`，重启后端确认能起来

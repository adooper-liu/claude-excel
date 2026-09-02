---
status: review          # design | coding | review | fix | blocked | done
branch: feat/tools-for-request-finance-allowlist
---

# 任务：tools-for-request finance-reconciliation 工具白名单

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/tools-for-request-finance-allowlist.md` · `feat/tools-for-request-finance-allowlist`

```bash
git checkout master && git pull && git checkout -b feat/tools-for-request-finance-allowlist
```

> 复制本文件为 `docs/tasks/tools-for-request-finance-allowlist.md`，作为 Claude Code × Cursor 的**唯一交接载体**。
> 禁止在聊天里互贴长方案/状态；另一方 `git pull` 后读此文件。
>
> **状态** 以文件顶部 frontmatter 的 `status` / `branch` 为准（机器可读；`./scripts/git-flow.sh status` 据此校验串行化与「done 需验证证据」）。改状态就改 frontmatter，别在正文另写一份。

- **主责（当前阶段）**：Claude Code（design 阶段） → Cursor（coding） → Claude Code（review） → Cursor（fix）

## 目标

`/跨境业财` 斜杠（skillId = `finance-reconciliation`）触发时，`addin/src/services/tools-for-request.ts` 当前的 `selectToolsForRequest()` 会走到 `if (!nativeSkill && !NATIVE_HINT.test(userText)) return tools;` 分支，**返回完整 tools 列表**——把 8 步强模板未用到的 `find_replace` / `web_fetch` 等**无关工具也暴露给 LLM**，8 步之外的工具面不受控。本任务在该文件加一个 `finance-reconciliation` 分支，建白名单 allow 8 步所需核心算子，把"工具面"从**全量**收窄为**SKILL.md 所需的封闭集合**（`docs/reliability-critique.md` §6-8 已警告行为规则有天花板，白名单是结构隔离）。

> **诚实口径（2026-09-01 审查修订）**：8 步强模板**本身需要多个写格工具**（SKILL.md 步骤 4 用 `write_to_sheet` 建表头 + `write_inputs` 写 B2-B10；步骤 5 用 `write_formula` + `fill_range` 回退），所以本任务的真实效果是**挡掉 8 步之外的无关写格工具（`find_replace` / `web_fetch`），并把工具面钉死在封闭集合**——不是"禁止 LLM 写格"（那部分由"只写新表"算子与源表保护承担）。验收与叙事均按此口径。

## 边界 / 不做

- **不动** `NATIVE_HINT` / `NATIVE_BLOCKED` / `nativeSkill` 四个 skillId（reconcile/reshape/calculate/pivot）—— 保持现有拦截行为
- **不动** 其它 skillId 分支（skill-creator/assume/fetch/research/knowledge/calculator）
- **不动** 核心算子实现，只改前端 tools 路由
- **不引入** user.* 工具白名单——`user.*` 走独立注册表（见 `docs/user-extensions-security.md` §4），与本任务无关
- **不改** SKILL.md / pack.json —— 本任务只修前端路由层

## 验收

- [x] 后端 `pytest backend/tests` 全绿
- [x] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [x] **任务特有**：
  - [x] `addin/test/unit/tools-for-request.test.js` 新增 ≥ 3 个 case：
    1. `skillId="finance-reconciliation"` + 任意 userText → 返回的白名单**不含** `find_replace` / `web_fetch`（8 步未用且危险，应被禁；修正 v1：`write_to_sheet` / `write_formula` / `write_inputs` / `fill_range` 是 SKILL.md 明确需要的，**应含**）
    2. `skillId="finance-reconciliation"` → 返回的白名单**含** `reconcile_tables` / `calculate_table` / `create_pivot` / `append_pack_audit` / `ensure_table` / `format_range` / `sort_filter`（8 步必需 7 个算子）
    3. `skillId="finance-reconciliation"` → 返回的白名单**含** `get_sheet_names` / `inspect_table` / `inspect_workbook` / `complete`（探路+收尾）
    4. `skillId="finance-reconciliation"` → 返回的白名单**含** `write_to_sheet` / `write_inputs` / `write_formula` / `fill_range`（SKILL.md 步骤 4/5 必需；修正 v1 的误判）
  - [x] 现有 4 个 nativeSkill（reconcile/reshape/calculate/pivot）的 case 全部仍绿（无回归）
  - [x] 现有 `NATIVE_HINT` 命中时的 case 仍绿

## 方案（Claude Code 填，design 阶段）

### 1. 改动文件清单

| 文件 | 改动 |
|---|---|
| `addin/src/services/tools-for-request.ts` | 加一个 `if (skillId === "finance-reconciliation")` 分支，建 `Set<string>` allow 白名单 |
| `addin/test/unit/tools-for-request.test.js` | 新增 3 个 mocha case（见验收） |
| `docs/user-packs.md` | §5 加一行："`/跨境业财` 走 `tools-for-request.ts` finance-reconciliation 白名单；新增 Pack skill 的工具 allowlist 应同步在 `tools-for-request.ts` 注册对应分支" |

### 2. `tools-for-request.ts` 改动骨架（设计参考，最终实现由 Cursor 决定）

**位置**：在 `if (skillId === "calculator" || ...)` 之后、`const nativeSkill = ...` 之前插入新分支。

```typescript
// 8 步强模板：探路→取数→建表→对账→假设→口径→透视→筛选→审计→结论
// SKILL.md 文档：samples/packs/cross-border-ecommerce-finance/skills/finance-reconciliation/SKILL.md
if (skillId === "finance-reconciliation") {
  const allow = new Set<string>([
    // 探路/检查
    "get_sheet_names",
    "inspect_workbook",
    "inspect_table",
    "inspect_formulas",
    "scan_formula_errors",
    "read_range",
    "read_selection",
    // 写表（仅新表/指定格）
    "write_to_sheet",      // 写 Pack_订单/广告 + 假设参数头
    "write_to_range",      // SKILL.md 步骤 5 fallback 单格写入
    "ensure_table",        // 建表
    "write_inputs",        // 假设参数区值
    "write_formula",       // 利润口径活公式
    "format_range",        // 黄底/红字
    "data_validation",     // 下拉约束假设区
    // 8 步核心算子
    "reconcile_tables",    // 对账
    "calculate_table",     // 算骨架
    "create_pivot",        // 透视
    "sort_filter",         // 风险筛选
    "append_pack_audit",   // 审计
    "fill_range",          // 公式向下填充
    // 收尾
    "complete",
  ]);
  return tools.filter((t) => allow.has(t.name));
}
```

**关键设计判断**：
- **白名单**而非黑名单——8 步路径明确，allow 集合是封闭的（新增核心算子需评审同步加）
- **保留** `fill_range`——SKILL.md 步骤 5 明确说"横向批量写失败时回退单格写入 + `fill_range` 向下填充"
- **保留** `write_to_sheet` / `write_inputs` / `write_formula` / `write_to_range`——SKILL.md 步骤 4（建假设参数头 + 写 B2-B10）与步骤 5（活公式）明确需要；见验收 case 4
- **不保留** `find_replace` / `web_fetch`——SKILL.md 8 步未要求；若未来需要，单独评审加
- **不列** user.* 工具——独立注册表

### 3. 测试骨架

```javascript
// addin/test/unit/tools-for-request.test.js 新增
describe("selectToolsForRequest - finance-reconciliation", () => {
  const fakeTools = [
    { name: "write_to_sheet" }, { name: "write_formula" },
    { name: "write_inputs" }, { name: "fill_range" },
    { name: "find_replace" }, { name: "web_fetch" },
    { name: "reconcile_tables" }, { name: "calculate_table" },
    { name: "create_pivot" }, { name: "append_pack_audit" },
    { name: "ensure_table" }, { name: "format_range" },
    { name: "sort_filter" }, { name: "get_sheet_names" },
    { name: "inspect_table" }, { name: "inspect_workbook" },
    { name: "complete" },
  ];
  it("blocks write primitives not in 8-step recipe", () => {
    const out = selectToolsForRequest("跑对账", fakeTools, "finance-reconciliation");
    const names = new Set(out.map((t) => t.name));
    assert.isFalse(names.has("find_replace"));
    assert.isFalse(names.has("web_fetch"));
  });
  it("keeps SKILL.md-required write primitives", () => {
    // SKILL.md 步骤 4/5 需要这些写格工具（v1 曾误判应禁，已修正）
    const out = selectToolsForRequest("跑对账", fakeTools, "finance-reconciliation");
    const names = new Set(out.map((t) => t.name));
    ["write_to_sheet", "write_inputs", "write_formula", "fill_range"].forEach((n) => {
      assert.isTrue(names.has(n), `missing ${n}`);
    });
  });
  it("exposes 8-step required core tools", () => {
    const out = selectToolsForRequest("跑对账", fakeTools, "finance-reconciliation");
    const names = new Set(out.map((t) => t.name));
    ["reconcile_tables", "calculate_table", "create_pivot", "append_pack_audit",
     "ensure_table", "format_range", "sort_filter"].forEach((n) => {
      assert.isTrue(names.has(n), `missing ${n}`);
    });
  });
  it("exposes probe + finalization tools", () => {
    const out = selectToolsForRequest("跑对账", fakeTools, "finance-reconciliation");
    const names = new Set(out.map((t) => t.name));
    ["get_sheet_names", "inspect_table", "inspect_workbook", "complete"].forEach((n) => {
      assert.isTrue(names.has(n), `missing ${n}`);
    });
  });
});
```

### 4. 风险与回退

- **风险**：白名单漏写某个 8 步必需工具 → LLM 报错"tool not available" → 录屏断
- **缓解**：测试断言覆盖 8 步所需全部 allowlist 工具名（方案§2 骨架中的 21 个：`reconcile_tables` / `calculate_table` / `create_pivot` / `append_pack_audit` / `ensure_table` / `format_range` / `sort_filter` / `get_sheet_names` / `inspect_table` / `inspect_workbook` / `inspect_formulas` / `scan_formula_errors` / `read_range` / `read_selection` / `write_to_sheet` / `write_to_range` / `write_inputs` / `write_formula` / `fill_range` / `data_validation` / `complete`）
- **回退**：若白名单过严导致 SKILL.md 步骤失败，先合白名单增项（不改逻辑）；白名单过松（漏 block）= 走 `reliability-critique §6-8` 标准由 review 重审

## Review notes（Claude Code 填，review 阶段，只读不改代码）

**结论：实现与 brief 骨架逐项一致，无阻塞缺陷，可合入。** 以下按严重度排序，均为非阻塞项。

1. **[低] `startsWith("user.")` 会放行未授权 user.* 工具进工具面** — `user-skills.ts` `fetchUserTools()`（L180-204）对 `authorized !== false` 只改 description 后缀（「未授权，需重新安装授权」），**不过滤**，未授权工具仍在 `getAllTools()` 列表里。因此 finance-reconciliation 路径下未授权 user.* 仍对 LLM 可见（调用时才被信任门拒）。这与默认对话路径行为**一致**（`return tools` 全量），非本任务引入；若要求「金融路径只暴露已授权 user.*」，应在 `fetchUserTools` 层过滤（单独立项），不在本文件。
2. **[低] 白名单与 brief 骨架 21 个工具名完全一致** — 抽查逐一比对：探路 7 + 写表 7 + 核心 6 + 收尾 1 = 21 个，与方案§2 `allow` 集合相同（顺序不同，无影响）。
3. **[已确认正确] 关键设计点**：（a）`NATIVE_HINT` 正则/`NATIVE_BLOCKED`/`nativeSkill`（reconcile/reshape/calculate/pivot）未动，回归风险低；（b）测试 4+native 存量 case 全在，`deepStrictEqual` 断言精确（不仅含/不含，且**全等**——比 brief 要求的「含/不含」更严，可防 allow 多漏一个工具名静默通过）；（c）`docs/user-packs.md` §5 已加白名单说明行（brief 改动清单第三项）；（d）branch 前置：本任务在 `getAllTools` 缓存里带 `user.*`，实现保留前缀放行是**必需**的（SKILL.md 步骤 1 `user.connector_load_feed` 走独立注册表）。

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-09-01 | design | Claude Code | (待 commit) | 初稿 brief；P0 白名单结构修复 |
| 2026-09-01 | review | Claude Code | (待 commit) | 审查修订：验收 v1 误判 write_to_sheet/write_formula/write_inputs/fill_range 应禁 → 改为 SKILL.md 步骤 4/5 必需，保留；目标/叙事改诚实口径；测试补 case 4 与"保留写格工具"断言；风险缓解 12→21 个工具名 |
| 2026-09-01 | coding | Codex CLI | `8d9f832` | 认领 P0；开始实现 finance-reconciliation 工具白名单与回归测试 |
| 2026-09-01 | review | Codex CLI | (本次提交) | 实现核心工具白名单并保留独立 user.* 注册表；前端 314 tests + typecheck 全绿，后端 353 passed / 2 skipped |
| 2026-09-02 | review | Claude Code | (本次提交) | 只读评审无阻塞；对照 brief 逐项核对实现/测试/文档 3 项一致（skillId=finance-reconciliation、21 工具、user.* 保留）；确认 getAllTools 缓存含 user.* 故前缀放行必需；2 条非阻塞 note（未授权 user.* 不过滤、与默认路径一致）+ 3 个已确认设计点 |

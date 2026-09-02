---
status: review          # design | coding | review | fix | blocked | done
branch: feat/finance-e2e-test-design
---

# 任务：finance-reconciliation 端到端集成测试设计

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/finance-e2e-test-design.md` · `feat/finance-e2e-test-design`

```bash
git checkout master && git pull && git checkout -b feat/finance-e2e-test-design
```

> 复制本文件为 `docs/tasks/finance-e2e-test-design.md`，作为 Claude Code × Cursor 的**唯一交接载体**。
> 禁止在聊天里互贴长方案/状态；另一方 `git pull` 后读此文件。
>
> **状态** 以文件顶部 frontmatter 的 `status` / `branch` 为准。改状态就改 frontmatter，别在正文另写一份。

- **主责（当前阶段）**：Claude Code（design） → Cursor（coding） → Claude Code（review） → Cursor（fix）

## 目标

`docs/gate-1b-mvp-closed-loop.md` §3 三件套（"业财利润透视 sheet 可见" / "`_pack_audit` 有记录" / "净利与手工差 ≤ 0.01"）目前只在 2026-08-16 录屏 + 5 行抽查自证，**没有自动化回归测试**。本任务出**端到端集成测试**（mocha + `office-addin-mock`）覆盖三件套，让 "Gate 1b MVP done" 有机器可校验的证据，**同时为 P0 白名单（`tools-for-request-finance-allowlist`）提供回归保护**。

> **路径修正（2026-09-01 审查）**：`gate-1b-mvp-closed-loop.md` 位于**仓库根 `docs/`**（不在 `docs/tasks/` 下）。

## 边界 / 不做

- **不动** `reconcile-core` / `calculate-core` / `pivot-core` 等单测（已存在）
- **不引入** E2E 浏览器自动化（Excel headless 太重）—— 走 `office-addin-mock` mock Office.js
- **不测** user.* 子进程执行（`user_fn_runner.py` 已有 pytest，本任务不重做）
- **不重做** dev-tools/gen_dirty_fixtures.py——5/4 行干净 fixture 即可（脏数据演示是商业录屏用，不进自动化）
- **不**新加 npm 依赖——`office-addin-mock` 已在 `addin/package.json` devDependencies

## 验收

- [x] 后端 `pytest backend/tests` 全绿
- [x] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [x] **任务特有**：
  - [x] `addin/test/integration/finance-reconciliation-e2e.test.ts`（或 .js，看现成约定）**新增 ≥ 4 个 case**：
    1. **三件套 #1**（透视可见）：跑 8 步 → 断言工作簿存在 sheet `业财利润透视` 且含 ≥ 1 行透视数据
    2. **三件套 #2**（审计记录）：跑 8 步 → 断言 sheet `_pack_audit` 第 2 行的**14 列表头与记录**（对齐 `addin/src/excel/pack-audit.ts` `auditHeaders()`，snake_case）：`timestamp` / `packId` / `packVersion` / `runType` / `matched` / `left_only` / `right_only` / `conflict` / `review_pending` / `sourceHash_orders` / `sourceHash_ads` / `note` / `assumption_snapshot` / `match_rate`（修正 v1：错误地写了 9 个 camelCase 字段如 `leftOnly`/`sourceHashOrders`/`assumptionSnapshot`/`matchRate`——实际 header 以 snake_case 为准，且含 `timestamp`+`review_pending`）
    3. **三件套 #3**（净利容差）：跑 5/4 行 fixture → 手工算 SKU 净利 → 差 ≤ 0.01（与 `reconcile-core.ts` `compareTolerance=0.01` 对齐）
    4. **白名单回归**（P0 已合入）：`selectToolsForRequest` 拦截 `find_replace` / `web_fetch` 在 `finance-reconciliation` 路径下不可见；case 直接运行，不 `skip`
  - [x] **不依赖** Windows 真实 Excel：纯 mocha + mock，跑在 `ubuntu-latest` CI
  - [x] **总耗时** ≤ 30s（CI 预算）
  - [x] 测试不修改仓库内任何 `samples/packs/.../connector/fixtures/*.csv`（用临时 fixture 复制到 OS tmpdir）

## 方案（Claude Code 填，design 阶段）

### 1. 测试架构

```
addin/test/integration/
  finance-reconciliation-e2e.test.js   # 4 个 Gate/P0 回归 case
  finance-reconciliation-harness.js   # 真实 core + office-addin-mock 内存工作簿
  fixtures/
    orders.csv                         # 历史 Gate 5 行干净 fixture
    ads.csv                            # 历史 Gate 4 行干净 fixture
addin/package.json                     # test:unit 纳入 integration glob
```

**关键设计判断**：
- **不真调 Office.js**——`office-addin-mock` 提供 `Excel.RequestContext` 假实现，但功能不全；本任务**只测调度层**（参数 / 返回值 / 审计字段），不验公式真在 Excel 里算出数
- **真算容差**——步骤 3 净利容差是 **手算的公式值** 与 **mock 算子返回值** 的差，不是与真 Excel 的差
- **业务真值靠录屏自证**（不可自动化），自动化只验"管道没漏"——这是设计原则，不接受反驳

### 2. 测试 case 骨架（设计参考，最终实现由 Cursor 决定）

```typescript
// addin/test/integration/finance-reconciliation-e2e.test.ts
import { importFinanceCsvFiles } from "../../src/services/finance-csv-import";
import { reconcileTables } from "../../src/excel/reconcile";
import { calculateTable } from "../../src/excel/calculate";
import { createPivot } from "../../src/excel/pivot";
import { appendPackAudit } from "../../src/excel/pack-audit";
import { selectToolsForRequest } from "../../src/services/tools-for-request";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

const FIXTURE_DIR = path.resolve(__dirname, "../../../samples/packs/cross-border-ecommerce-finance/connector/fixtures");

async function tmpFixture(name: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tmp = path.join(os.tmpdir(), `e2e-${Date.now()}-${name}`);
  await fs.mkdir(tmp, { recursive: true });
  return { path: tmp, cleanup: () => fs.rm(tmp, { recursive: true, force: true }) };
}

describe("finance-reconciliation end-to-end (gate-1b-mvp §3)", () => {
  let mockWorkbook: { sheets: Record<string, { rows: any[][]; tables: string[] }> };
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const f = await tmpFixture("finance");
    cleanup = f.cleanup;
    mockWorkbook = { sheets: {}, tables: {} as any };
  });
  afterEach(async () => { await cleanup(); });

  it("§3.1 透视 sheet 可见", async () => {
    // 1. 复制 fixture 到 tmpdir
    // 2. 调 importFinanceCsvFiles（mock loadConnectorFeed 返回 fixture 内容）
    // 3. 调 reconcileTables → calculateTable → createPivot
    // 4. 断言 mockWorkbook.sheets["业财利润透视"] 存在且 length >= 2
  });

  it("§3.2 _pack_audit 字段齐", async () => {
    // 跑 8 步 → appendPackAudit → 断言 _pack_audit row 2 记录存在
    // 表头对齐 addin/src/excel/pack-audit.ts auditHeaders()（14 列 snake_case）：
    //   timestamp/packId/packVersion/runType/matched/left_only/right_only/conflict/
    //   review_pending/sourceHash_orders/sourceHash_ads/note/assumption_snapshot/match_rate
    // 注：matched 至少 1，match_rate ∈ [0,1]，sourceHash_orders 长度 64（SHA-256）
  });

  it("§3.3 净利容差 ≤ 0.01", async () => {
    // 历史 5/4 行 fixture 的 widget-b：1 × 15 USD，无广告、无退款、COGS=0。
    // 收入 108；佣金 16.2；FBA 23.99544；仓储 10.8；手续费 2.7。
    // 独立手工真值：108 - 16.2 - 23.99544 - 10.8 - 2.7 = 54.30456。
    // 跑公开 core 链 → 取该 SKU 行净利 → 断言 |actual - 54.30456| <= 0.01
  });

  it("白名单回归（P0 已合入，不 skip）", async function () {
    const tools = [{ name: "write_to_sheet" }, { name: "find_replace" },
                   { name: "web_fetch" }, { name: "reconcile_tables" }];
    const out = selectToolsForRequest("跑", tools, "finance-reconciliation");
    const names = new Set(out.map((t) => t.name));
    assert.isFalse(names.has("find_replace"));
    assert.isFalse(names.has("web_fetch"));
    // 注意：write_to_sheet 在白名单内（P0 设计），不 assert.has
  });
});
```

### 3. mock 实现要点

- **fixture 边界**：历史 Gate 5/4 行 CSV 先复制到 OS tmpdir，再按 connector 的 SKU 小写/日期字段规则归一；不调用 `user.*` 子进程
- **`Excel.RequestContext` mock**：用 `office-addin-mock` 维护内存工作簿，真实调用 `appendPackAudit`
- **`sourceHash`**：`crypto.createHash("sha256").update(rawCsv).digest("hex")` 计算，验长度 64
- **`reconcile_tables` 真跑**（`reconcile-core.ts` 是纯 JS，无 Office.js 依赖）
- **`calculate_table` 真跑**（`calculate-core.ts` 是纯 JS）
- **`create_pivot` 边界**：真实 `planPivot` 校验字段/聚合，内存工作簿承接透视输出（不依赖 Excel 桌面）

### 4. CI 集成

- `package.json` `test:unit` 加入 `"test/integration/**/*.test.js"`
- CI 不变（已 `npm run test:unit`）
- integration case 实测 < 1s，符合 < 30s CI 预算

## Review notes（Claude Code 填，review 阶段，只读不改代码）

（待 review 时填）

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-09-01 | design | Claude Code | (待 commit) | 初稿 brief；3 件套端到端回归 |
| 2026-09-01 | review | Claude Code | (待 commit) | 审查修订：路径改 docs/ 根；_pack_audit 断言改 14 列 snake_case；§3.3 期望值去掉伪示例 SKU-A、改完整公式+注明以执行器实测为准 |
| 2026-09-02 | coding | Codex CLI | (本次提交) | 认领任务；按公开算子链与 `selectToolsForRequest` seams 开始端到端集成测试。 |
| 2026-09-02 | review | Codex CLI | (本次提交) | 4 个 integration case 落地：date_window(7) 5/4 fixture、透视、14 列审计、净利容差、P0 白名单；前端 318 passing + typecheck，后端 353 passed / 2 skipped。 |

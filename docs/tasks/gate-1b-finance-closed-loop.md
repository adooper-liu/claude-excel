# Gate 1b：跨境电商业财闭环（CSV → 对账 → 假设 → 透视）

> ERP 是上游水厂；本 Gate **不接** ERP API。connector 用 `csv_local` 产出与 Phase 2 ERP 同构的 `Pack_*` 表。  
> 与 Gate 1a-选品（现有 `/亚马逊选品`）**并行**，不混为一个 demo。

- **分支**：`feat/gate-1b-finance`
- **状态**：`design`
- **Pack**：`cross-border-ecommerce` + `connector/feeds/*.schema.json`

## 目标

30 分钟内（不含加载项安装）：CSV/fixture → 临时 sheet → 预编排对账 → 参数 sheet → 利润透视 → 审计行；**零手改数据格**。

## 边界 / 不做

- ERP OAuth / 积加领星 API → **Phase 2 v1.1**
- LLM 自由选 tool 拼对账 → 必须 **recipe 预编排**（SKILL.md 固定 steps，调核心算子；**不写 `scripts/*.py`**）
- 核心出现 ERP 名 → 只许 `connector/implementations/`
- 归因窗口（广告点击日 vs 订单成交日，0–7 天）→ **只标注不解决**，写进 `_pack_audit`

## 前置（不计时）

- 加载项 + Pack（含 extensions 同意）已安装
- `fixtures/orders.csv` + `ads.csv`（+ 可选 `inventory.csv`）就位 — **真实卖家脱敏**，见 connector README

## 计时

**起点**：空白簿 + fixture 就绪  
**终点**：透视 sheet 可见 + `_pack_audit` 有本次 run 记录

## 交付 checklist

- [ ] `connector/implementations/csv_local`（或 `user.*`）写出 `Pack_订单` / `Pack_广告`
- [ ] 新 Skill `/跨境业财`（名待定）：固定 steps → `reconcile_tables` → `write_inputs` / `calculate_table` → `create_pivot`
- [ ] 参数 sheet 约定（命名区域）
- [ ] 写格审计 `_pack_audit`（Phase 1 必做）
- [ ] 录屏 + 内部 5 行抽查

## Gate 1b 通过 → 才做

- Phase 2 ERP connector（换实现，recipe 不动）
- 对外话术：「已接积加/领星…」

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-16 | design | — | — | brief + connector schema 落盘 |

---
status: pending
---
# AI 解读对话化：对话为主 + 结构化工具（2026-08-31）

> 依据：OCR 已进入维护态（`docs/ocr-layout-design.md` 冻结决策 + roadmap ⛔维护态）。
> 本 plan 不动任何 OCR 启发式——只把「解读」这个 LLM 交互从「独立按钮自动跑」迁到
> **对话**，结构化提取保留为**对话可调用的工具**。

## Goal

把 AI 解读从「解析完成自动跑固定结构化 dump」改为**对话驱动**：
- 用户自然问「解读这张发票」「明细整理成表」「金额对不对」
- 对话 agent 需要结构化结果时**调 `interpret_document` 工具**（返回 kvs/items/totals/notes，可写表/建模板）
- 少一套并行 UI/SSE 流程；追问自然；LLM 吸收语言/版式差异（正合冻结决策）

**保留（不删）：** `/api/doc/interpret`、`/api/doc/propose-recipe` 端点 + `doc_interpret.py` 逻辑——它们降级为**工具的后端实现**。结构化 schema（kvs/items/type/source/group）不降级。

## Architecture

```
解析（RapidOCR/模板，不变）
  → OCR 文本进「文档上下文」（对话可见，按需注入/可折叠，控制 token）
  → 用户对话：「解读…」
      → agent 调 interpret_document 工具（走现有 /api/doc/interpret）
      → 结构化结果回对话：自然语言呈现 / 用户可要求「写入工作簿」
  → 用户可追问（合计、税率、格式），无需重新解析
```

## Files

- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`（去掉自动 runInterpret；「AI 解读」按钮改为「去对话解读」→ 把 OCR 文本注入对话；保留「进工作簿(解读)」入口走工具结果）
- Modify: `addin/src/taskpane/components/ChatInput.tsx`（接收文档上下文注入：新增 prop/callback `onAttachDocument(text, rows?)` → 追加一条 user 消息「（OCR 文档）请解读：…」；或设置 docContext 状态）
- Modify: `addin/src/services/skill-registry.ts`（HANDLED_TOOLS 加 `interpret_document`、`propose_recipe`——三方锁步之一）
- Modify: `addin/src/services/skill-handlers.ts`（executeHandler 加 `interpret_document`/`propose_recipe` 分支，调用现有 /api/doc/interpret、/api/doc/propose-recipe；锁步之二）
- Modify: `addin/src/services/skill-manifests.ts`（工具 manifest/描述，供 agent 知道何时调用；锁步之三）
- Modify: `backend/server.py`（如需为工具加轻量非流式包装；现有端点可复用）
- 不改：`doc_interpret.py`、`layout_extract.py`（冻结区）

## Tasks

- [x] **Task 1: 工具注册（三方锁步）** — 新增 `addin/skills/core/doc/manifest.json`（interpret_document +
      propose_recipe），skill-manifests / skill-registry / skill-handlers 同步，后端 skill_registry.ADDIN_HANDLERS
      同步；锁步测试 6 passed、前端 typecheck ✓ / unit 309 passing、后端全量 353 passed + 2 skip。
- [x] **Task 2: 文档上下文注入对话** — ChatInput 新增 `attachDocumentToChat`（截断头+尾 6000 字，
      预填输入框 + 聚焦 + 自动增高，不自动发送）；PdfAttachSection 新增「去对话解读」按钮
      + `onInterpretToChat` prop。旧 AI 解读/自动解读路径保留（Task 3 移除）。
      typecheck ✓ / unit 309 passing。
- [x] **Task 3: 对话触发解读** — 移除解析后自动 runInterpret 与旧 AI 解读面板/解读进工作簿/重试
      （PdfAttachSection -189 行）；解读入口收敛为「去对话解读」→ 对话 agent 经 interpret_document
      工具返回结构化结果并可按用户要求写表（write_to_sheet 已存在）。typecheck ✓ / unit 309 passing。
- [ ] **Task 4: 单测 + 前端门禁** — 前端 typecheck + test:unit；后端现有 interpret 测试保持绿。
- [ ] **Task 5: 真机验收（管理员）** — 上传发票 → 去对话解读 → 追问「合计多少」→
      「整理成表写入工作簿」→ 结果正确。

## Constraints

- **不碰 OCR 启发式**（冻结决策）：本 plan 只动 LLM 交互层。
- **结构化 schema 不降级**：工具返回与现在 interpret 相同的 kvs/items/totals/notes。
- **token 控制**：文档文本注入需截断/折叠，不默认全量进上下文。
- **向后兼容**：旧「AI 解读」按钮路径在 Task 3 完成前保留；端点不删。

## 收尾

`cd backend && python -m pytest tests -q` → exit 0；`cd addin && npm run typecheck && npm run test:unit` → 全绿；
提交 `git commit -m "feat(ai): AI 解读对话化（对话为主 + interpret_document 工具）"`。

## 进度 log

- 2026-08-31 Task 1 完成（分支 feat/ai-interpret-chat-tools）：工具已注册，待 Task 2（文档上下文注入对话）。
- 2026-08-31 Task 2 完成（分支 feat/ai-interpret-chat-inject）：文档注入对话就绪，待 Task 3（移除自动解读 + 工具触发落地）。
- 2026-08-31 Task 3 完成（分支 feat/ai-interpret-chat-land）：对话化解读就绪；Task 4 门禁随各 Task 已跑，Task 5 真机验收留管理员。

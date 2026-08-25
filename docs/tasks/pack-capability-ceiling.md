# Pack 能力天花板分析与 L3 落地方案

> 2026-08-24 | Claude Code 只读评审 + 方案落盘 | 状态：方案待确认

## 0. 核心判断

**Pack 能否在 Excel 插件界面完成引导式新建与安装，决定了它是"开发者工具"还是"人人可用的平台"。**

当前天花板卡在 **L3**：用户能安装、能导出分享、甚至能用 LLM 生成单个 Skill，但**不能在 UI 里创建一个完整 Pack**（含 pack.json 元数据、知识文件、connector 配置）。L3 缺口不大（后端管线已通，差一层 UX 编排），但它是"用户自造场景包"的能力门槛——过了这条线，Pack 从"官方发什么用什么"变成"用户自己造、自己分享"。

---

## 1. 能力分层现状（逐条对照代码）

| 层级 | 能力 | 代码落点 | 状态 |
|---|---|---|---|
| **L0** 开发者发布 | 仓库 `samples/packs/` + taxonomy | `user_packs_store.py: list_packs()` | ✅ 落地 |
| **L1** 用户安装/卸载 | PackMenu 一键安装 + 扩展同意 + 安全校验 | `PackMenu.tsx` + `install_pack()` + `uninstall_pack()` | ✅ 落地 |
| **L2** LLM 生成 Skill | `/skill-creator` inspect → 输出 SKILL.md → 自动安装 | `builtin-skills.ts: skillCreatorSkill` + `App.tsx:427-438` | ✅ 落地 |
| **L3** 用户创建完整 Pack | 对话引导 → pack.json + 知识 + connector → 打包安装 | S1–S3 ✅；S4 手工验收待做 | 进行中 |
| **L4** 导出 zip 分享 | export_pack_zip() → 下载 → 对方 import_pack_zip() | `PackMenu.tsx:233-244` + `user-skills.ts:285-295` | ✅ 落地 |
| **L5** 市场分发 | 云端目录、版本管理、升级推送 | **无** | ❌ 未规划 |

**当前天花板线在 L2→L3 之间。L4 已通但被 L3 阻塞**——能分享，但没有"自造的 Pack"可分享。

---

## 2. L3 缺口拆解（差什么 vs 有什么）

### 已有基础（管道已通）

| 组件 | 位置 | 能力 |
|---|---|---|
| `/skill-creator` | `builtin-skills.ts` | LLM 读表结构 → 输出 SKILL.md（frontmatter + 编排步骤）→ `App.tsx:429-438` 自动 `installUserSkill(md)` |
| `install_pack()` | `user_packs_store.py:329-439` | 完整安装管线：validate schema → install_skill (rollback) → copy extensions → copy connector → record |
| `import_pack_zip()` | `user_packs_store.py:113-133` | zip 解压 → 路径遍历防护 → pack.json 校验 → 落盘 → 可安装 |
| `export_pack_zip()` | `user_packs_store.py:147-155` | 打包目录 → zip → 下载 |
| PackMenu UI | `PackMenu.tsx` | 列表/安装/卸载/导入/导出/扩展同意/CSV 导入 |
| pack.json schema | `user-packs.md §4` | id / category / title / version / skills / knowledge / deps.recipes / extensions |

### 缺口（不大，是 UX 编排层）

| 缺口 | 说明 | 量级 |
|---|---|---|
| **G1 /skill-creator 只出 Skill 不出 Pack** | LLM 生成的 SKILL.md 直接 `installUserSkill()`，不经过 pack.json 包装 | 核心缺口 |
| **G2 无 pack.json 元数据生成** | 用户没有入口填写 category / title / description / gate / deps.recipes | 表单 + LLM 生成 |
| **G3 无知识文件上传** | PackMenu 没有"给 Pack 附加 .md 知识文件"的 UI | 文件上传组件 |
| **G4 无 connector 配置引导** | 业财类 Pack 的 connector/ (schemas + fixtures + handler.py) 无引导创建 | 可选/进阶 |
| **G5 无"打包安装"闭环** | 没有把上述组件组装成 zip → import → install 的一键流程 | 编排逻辑 |

---

## 3. L3 落地方案（两条路线）

### 路线 A：对话式 Pack Builder（推荐，符合产品定位）

**原理**：扩展 `/skill-creator`，让 LLM 在对话里引导用户完成 Pack 创建，而不是加一堆表单。

**用户流程**：
```
用户："把刚才的利润分析打包成行业包"
  ↓
LLM (skill-creator 模式)：
  1. 读已有表结构（inspect_workbook）
  2. 生成 SKILL.md 编排步骤（已有能力）
  3. 生成 pack.json（新增：LLM 从对话推断 category/title/description）
  4. 询问：要不要附加知识文件？→ 用户拖 .md 文件
  5. 询问：有没有 connector？（CSV 结构 → 自动生成 schema）
  6. 调用 create_pack（新算子）→ 落盘 → 自动安装
  7. 回复：已创建并安装 /xxx 行业包，输入 /xxx 使用
```

**改动点**：
| 文件 | 改动 | 类型 |
|---|---|---|
| `builtin-skills.ts` | skillCreator skill 增补"Pack 模式"分支（生成 pack.json + 组装 zip） | TS 代码 |
| `backend/server.py` | 新增 `POST /api/user-skills/create-pack`（接收 zip bytes → import_pack_zip → install_pack） | 后端 API |
| `PackMenu.tsx` | 新增"创建 Pack"入口按钮 → 触发 `/skill-creator pack` | UI |
| `App.tsx` | /skill-creator 输出含 pack.json 时走 create_pack 路径 | TS 代码 |

**好处**：
- 零新 UI 组件——PackMenu 只加一个按钮，创建过程全在对话里
- 符合产品定位（"用自然语言做 Excel 业财"）
- `/skill-creator` 已有 80% 逻辑（inspect → 生成 SKILL.md），只需补 pack.json 生成和组装

**风险**：
- LLM 生成的 pack.json 可能不规范 → 对策：后端 `import_pack_zip()` 已有完整校验（schema 不一致、路径遍历、大小限制），不通过就报错让 LLM 修正

### 路线 B：表单式 Pack Builder（备选，交互重）

**原理**：在 PackMenu 里加一个多步表单向导。

**步骤**：① 填元数据 → ② 粘贴/生成 SKILL.md → ③ 上传知识文件 → ④ 配 connector（可选）→ ⑤ 预览 → ⑥ 打包安装

**否决理由**：UI 交互重，违反产品"对话驱动"定位，且 `/skill-creator` 已经做了最难的部分（LLM 生成编排步骤），表单只是重新包装。

---

## 4. 落地顺序（路线 A）

| 步骤 | 干什么 | 量级 | 门禁 |
|---|---|---|---|
| **S1** | `POST /api/user-skills/create-pack`：接收 zip bytes，复用 `import_pack_zip()` + `install_pack()`，一次调用完成创建+安装 | 半天 | backend pytest ✅ `create_pack()` + `/api/user-skills/create-pack` |
| **S2** | `builtin-skills.ts`：skillCreator 增补 Pack 分支——当用户说"打包/做成行业包"时，输出 `pack.json` + `SKILL.md` + 可选 `knowledge/*.md` 的 zip 结构 | 1-2 天 | typecheck + test:unit ✅ |
| **S3** | `PackMenu.tsx`：加"创建 Pack"按钮 → `handleSend('/skill-creator pack')` | 半天 | 手工验收（按钮已接） |
| **S4** | 验收：用户在对话里说"把刚才的分析打包成行业包" → 系统创建并安装 Pack → PackMenu 出现新卡片 → 可卸载/导出 | — | 见下方 §4.1 手工用例 |

---

## 4.1 S4 手工验收用例（L3 闭环）

**前置**

1. 后端 `:8765` 与加载项已启动（`launch.bat` 或等价）；本机有可用模型 Key。
2. 加载项已热更到含「创建 Pack」按钮与 `create-pack` 客户端的版本。
3. 准备一张简单工作簿（至少一张有表头的表，便于 inspect），或复用当前打开的簿。
4. 卸载/删除测试用第三方包（若上次试跑留下 `local-*`），避免「已存在同名包」干扰。

**用例 A — 安装菜单入口创建并安装**

| # | 步骤 | 期望 |
|---|---|---|
| A1 | 任务窗格点「安装」→ 点 **创建 Pack** | 菜单关闭；对话发出 `/skill-creator pack`（或等价用户可见消息） |
| A2 | 模型若追问意图：用一句话说清流程，例如「按客户编号对账，结果写新表，斜杠叫 /客户对账」 | 只读 inspect；**不**写格、不 ensure/reconcile |
| A3 | 模型回复含路径围栏：`` ```pack.json `` 与 `` ```skills/<name>/SKILL.md ``；`pack.json` 的 `id` 以 `local-` 开头；`skills` 与目录名一致 | 围栏信息行是路径，不是 `json`/`markdown` |
| A4 | 等待回合结束 | 回复末尾出现「已创建并安装场景包…」；给出可用斜杠（如 `/客户对账`） |
| A5 | 再开「安装」菜单 | 出现该第三方包卡片（标题/斜杠可见，带第三方标记或来源为 third-party） |
| A6 | 输入 A4 给出的斜杠（空簿或带表头的簿均可） | 技能能唤起；按 SKILL 步骤调核心算子（不要求本用例跑完整业务结果） |

**用例 B — 自然语言补充进入 Pack 模式**

| # | 步骤 | 期望 |
|---|---|---|
| B1 | 发送 `/skill-creator 做成行业包：按店铺列提取并去重` | 进入 Pack 模式（不走「只装单技能」） |
| B2 | 同 A3–A5 | 自动 create-pack 安装；菜单可见新卡 |

**用例 C — 坏稿不半装**

| # | 步骤 | 期望 |
|---|---|---|
| C1 | `/skill-creator pack`，若模型只给了 SKILL.md、没有 `pack.json` 围栏 | **不会**误调 create-pack；若有合法单技能围栏则可能只装技能（可接受）；若两者都无则无「已安装场景包」 |
| C2 | （可选）故意让模型交冲突 id / skills 与目录不一致 | 回复含「没有安装场景包：…」；安装菜单**不**出现半成品；`~/.claude-excel-web/packs-imported` 下无该失败 id |

**用例 D — 卸载后场景消失（L3 专项）**

| # | 步骤 | 期望 |
|---|---|---|
| D1 | 对用例 A 装上的包点「卸载」 | 成功；卡片变为未安装或从已装态消失 |
| D2 | 输入该包斜杠 | 斜杠列表中**不再**出现该技能（或调用失败/不走该 SKILL） |
| D3 | （若仍保留第三方来源目录）可再「安装」或「删除来源」 | 与现有第三方 Pack 行为一致，无残留技能目录 |

**用例 E — 导出 → 另一侧 import（L3+L4）**

| # | 步骤 | 期望 |
|---|---|---|
| E1 | 重新装上用例 A 的包（或新建一个 `local-*`） | 已安装 |
| E2 | 在安装菜单对该包 **导出** | 得到 `<packId>.zip` |
| E3 | 先卸载该包；若提示先卸载再删来源，按提示清掉，避免同名冲突 | 本机无同名已装记录 |
| E4 | 「导入」选 E2 的 zip，再安装（无 extensions 则无需同意） | 导入成功并可安装；斜杠可用 |
| E5 | （可选）把同一 zip 拷到另一用户目录/另一台本机，重复 E4 | 同样可装可用（L4 分享最小闭环） |

**用例 F — 回归：单技能模式未坏**

| # | 步骤 | 期望 |
|---|---|---|
| F1 | 发送 `/skill-creator`（不带 pack），要求「只做单技能、不要 Pack」 | 只输出一份 SKILL.md 代码块 |
| F2 | 回合结束 | 「已安装，输入 /…」装的是**单技能**，不是 create-pack；安装菜单不强制出现新 Pack 卡 |

**通过标准**

- A、D、E、F 必过；B、C 建议过。
- 任一「已创建并安装场景包」后，`create-pack` 失败不得留下已装技能半成品（与后端回滚一致）。
- 创建回合禁止写格（inspect 除外）。

**验收记录（勾选后把本段 status 改为 done）**

- [ ] A 通过
- [ ] B 通过
- [ ] C 通过
- [ ] D 通过
- [ ] E 通过
- [ ] F 通过
- [ ] 验收人 / 日期：________

---

## 5. L3 通了之后的天花板

L3 是关键拐点：

- **L3 通 + L4 已通** = 用户自造 Pack → 导出 zip → 分享给同事 → 同事 import → 立即可用。**这是一个完整的"Excel 里的 Pack 生态"最小闭环**，不需要云端市场。
- **L5（市场）是商业决策不是技术决策**：要不要做云端目录、版本管理、付费分发，取决于 L3+L4 跑起来后的真实用户量和分享频率。先有用户自造自分享，再决定是否做市场。

---

## 6. 与已有 brief 的关系

| Brief | 关系 |
|---|---|
| `gate-1b-pack-ization.md` | Pack 化先行（把 finance-run.ts 的编排挪进 SKILL.md），是 L3 的前置：SKILL.md 已经是编排层了，L3 只是让它可被用户自造 |
| `gate-1b-value-implementation.md` | 价值实施（口径表/把关/结论）做进 SKILL.md，L3 让这种 SKILL.md 可被用户自己生成和分享 |
| `gate-1b-gap-roadmap.md` | 缺口路线图，L3 不影响 A/B/C 类缺口的优先级，但 L3 通了之后 C 类"不该自己做"可以变成"用户自己造 Pack 补" |

---

## 7. 开工前依赖确认

1. `/skill-creator` 当前只调 `inspect_workbook` / `inspect_table` / `inspect_formulas`（只读），S2 增补 Pack 分支不需要新增工具调用权限——`create-pack` 是后端 API 不是 Office JS 算子，符合"创建回合不写表"的约束。
2. `import_pack_zip()` 的安全校验（5MB 上限、200 条上限、路径遍历防护、pack.json 必须在根目录）已覆盖 L3 用户生成场景，无需额外加固。
3. PackMenu 已有 `onImportPack` / `onRemoveImportedPack` 处理器，S3 加按钮复用现有 handler 链路。

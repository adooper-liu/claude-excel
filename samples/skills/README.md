# 可选技能包（不进核心）

仓库内的 **示例 SKILL.md**，供用户安装到本机技能目录。核心 **不** 加载、不写入 `builtin-skills.ts`。

## 安装

### 方式 A：任务窗格一键安装

空状态点 **「安装 Amazon 选品示例」**，或调用本机 API：

```http
POST https://localhost:8765/api/user-skills/install-sample
Content-Type: application/json

{"id": "amazon-research"}
```

### 方式 B：手动复制

```powershell
Copy-Item -Recurse samples\skills\amazon-research $env:USERPROFILE\.claude-excel-web\skills\amazon-research
```

### 方式 C：粘贴 SKILL.md

打开 `amazon-research/SKILL.md`，在任务窗格输入 `/安装` 粘贴全文。

## 包列表

| 目录 | 斜杠 | 说明 |
|---|---|---|
| `amazon-research/` | `/亚马逊选品` | 取数表 project 规整 + 透视；方法论见 `samples/industry-deconstruct-appendix.md` |

新增包：在此目录加 `{name}/SKILL.md`，遵循 `skill-create-guide.ts` 算子清单，跑 `pytest backend/tests/test_user_skills_store.py`。

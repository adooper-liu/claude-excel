# user.* 本地函数安全边界（P1 设计）

> 状态：**设计定稿，代码未动**。Pack 组织层（P0）见 [user-packs.md](user-packs.md)。
> 范围：本机后端 `user.*` Python 插件。核心 Office JS 算子、`HANDLED_TOOLS`、`skill_registry` 三方锁步**不在此设计范围**，物理隔离。

---

## 0. 为什么需要这个设计

P0 的 Pack 只做「装箱」：SKILL + knowledge + recipe，全部是**数据/文本**，不引入可执行代码。
P1 引入 `user.*` **本地函数**（后端 Python handler），这是第一个「用户扩展里带可执行代码」的形态。
它的本质是**本机任意 Python**——`require_loopback` 只防外网调 API，不防 handler 读盘、打内网、耗 CPU。

**前提事实（由代码推出）**：`config_store.get_api_key()` 先读环境变量 `DEEPSEEK_API_KEY` / `ANTHROPIC_AUTH_TOKEN`，再读 `~/.claude-excel-web/config.json` 明文。所以：
- 主 LLM key 同时存在于**进程 env** 和**已知路径明文文件**；
- 任何继承环境的子进程 / 任何以用户权限跑的进程都能拿到它。

因此 `user.*` 的设计核心不是「把函数关进沙箱」，而是 **「信任门 + 能力声明 + 主 key 永不进函数 + 最小权限纵深」**。

---

## 1. 威胁模型

| 威胁 | 严重度 | 现实性 | 应对 |
|---|---|---|---|
| 恶意/被篡改 pack 偷走 LLM API key | 🔴 高 | 高（key 就在明文文件 + env） | 信任门 + clean_env + 不传 key + cwd 隔离 |
| 函数读用户本地文件（Excel、其它密钥） | 🔴 高 | 中 | 信任门 + 文档禁止 + cwd 内限制 |
| 函数外联 exfil（POST 到外部） | 🟠 中 | 中 | `network` 声明 + `ce_http` 走 `safe_http_url` |
| 函数破坏本地文件 | 🟠 中 | 低-中 | 信任门 + 文档禁止 |
| 函数 DoS 本机（死循环/占资源） | 🟢 低 | 低 | timeout + 并发上限 |

**诚实声明**：对「任意第三方 Python」在 Windows 桌面做**强隔离**，唯一可靠手段是独立低权限账户或容器（Docker），对单机工具过重。本设计做「信任门 + 纵深防御」，不做 OS 级沙箱。
**第一道防线是「你不该装不信任的 pack」**——这必须写进安装时的用户提示。

---

## 2. 执行模型

**决策：子进程 + 超时，不用同进程 import。**

- `subprocess.run([sys.executable, handler.py], cwd=扩展目录, stdin=PIPE, stdout=PIPE, stderr=PIPE, timeout=min(声明,20s), env=clean_env)`
- **每次调用全新进程，无状态**——最简隔离，天然免疫「记住上次状态」。
- **并发上限**：全局同时最多 2（asyncio.Semaphore）。
- **输出上限**：stdout 解析单个 JSON，>64KB 截断报错。
- **参数只走 stdin(JSON)**，绝不过命令行（防参数注入/日志泄漏）。

**为什么不是 import**：同进程会共享 `config_store._config` 全局和 `sys.path`，用户函数能 import 到内部模块并读配置；子进程从物理上隔离。先例：`web_browser.py` 已是子进程级隔离（Playwright）。

---

## 3. 能力白名单（拒绝式）

**决策：拒绝式（deny by default）——不做「允许 import 白名单」，因为 Python import 无法可靠沙箱。**

| 允许 | 禁止（manifest 声明 + runner 预检 + 文档纪律） |
|---|---|
| 纯计算：`math`、`json`、内置 | `subprocess` / `os.system` / `socket` |
| `cwd` 内的文件读取 | `pathlib.Path` 读 `~` 之外路径 |
| 经 `ce_http` 助手联网（走 `safe_http_url`） | 直接 `requests`（不注入；文档禁止） |

**诚实标注**：`requests` 不是「装了就封死」，是「不注入 + 文档禁止 + 信任门兜底」。真正的网络硬隔离是 P1 之后的「OS 级沙箱」选项（文档标注为 v2）。

---

## 4. 工具发现（独立命名空间）

**决策：`user.*` 独立 tool list，不进核心任何注册表。**

- 后端 `user_extension_registry` 扫 `~/.claude-excel-web/packs/*/extensions/*/manifest.json`。
- `GET /api/user-fn` 返回注册表 → addin `getAllTools()` **追加** `user.*`（带前缀，描述标「本机函数」）。
- `App.tsx` `onToolUse` 先判断 `startsWith("user.")` → 走后端，否则走 `executeHandler`。
- `skill_create_guide.ts` / `operator-catalog.ts` 只含核心算子，`user.*` 天然不在其中。

**对现有锁步校验零改动**：`skill_registry.py` 三方校验只查核心 manifest，`user.*` 走独立注册表，两边物理隔离。

**函数 manifest schema**：

```jsonc
{
  "name": "user.profit_assumptions",      // 必须 ^user\.[a-z][a-z0-9_]*$
  "description": "利润 11 项假设值（参数化，不写格）",
  "entry": "handler.py",
  "params": { "type": "object", "properties": { "asins": {"type":"array"} }, "required": ["asins"] },
  "returns": "json",
  "network": false,                        // 默认关，开要用户重新同意
  "secrets": ["hs_key"],                   // 可选，声明才注入
  "timeoutMs": 20000,
  "category": "跨境电商"
}
```

---

## 5. 安装信任（信任门）

**决策：装 Pack 时一次确认「含本地代码」，能力声明变化 → 重新同意。**

- 任务窗格展示：「此 pack 含 N 个本机函数：profit_assumptions（可联网、会读取你的 HS 密钥）」。
- 用户点「允许这些函数在本机运行」才落 `installed_packs.json`（记录 pack id、版本、能力声明哈希、同意时间）。
- `user_extension_registry` 每次扫描比对能力声明哈希；变了 → 拒绝执行 + 提示重新授权。

**这是整个 P1 的轴心**：信任不是「装了就永远信」，而是「每次能力升级都重新确认」。

---

## 6. API key / secret 传递

**主 LLM key：永不进函数。** 三处都断：不 env、不入参、cwd 不指向 config 目录。

**扩展自己的密钥**（HS 编码库 key、行情 key 等）：
- 单独存 `~/.claude-excel-web/extension-secrets.json`（**不在 pack 目录**，分享 pack 不带出密钥）。
- 结构：`{ "user.profit_assumptions": { "hs_key": "..." } }`。
- 传递：仅当 `manifest.secrets` 声明了 `hs_key`，才作为 `CE_SECRET_HS_KEY` 注入子进程 env。
- 写入途径：任务窗格「扩展密钥」区 → `POST /api/user-fn/{name}/secret`（require_loopback）。

**为什么不给函数主 key**：主 key 是「聊天的钱」，不该被用户函数消耗或暴露；函数要调外部 API 取数，应该**自带自己的 key**。

**SKILL 正文永不写密钥**（延续 `skill-create-guide.ts`「禁止写 Python/VBA」纪律）。

---

## 7. 明确不做（v1 边界）

- ❌ OS 级沙箱 / 容器 / 独立低权限账户（文档标注为 v2 选项）
- ❌ 函数间共享状态 / 常驻进程（保持无状态）
- ❌ 让函数直接拿主 LLM key
- ❌ 网络硬隔离（`ce_http` 是引导，靠信任门兜底）

---

## 8. P1 实施清单（最小闭环）

| 组件 | 交付 |
|---|---|
| `backend/user_extension_registry.py` | 扫描 + 校验 manifest + 能力声明哈希 |
| `backend/user_fn_runner.py` | 子进程执行 + clean_env + timeout + 并发上限 + `ce_http` 助手 |
| `backend/extension_secrets.py` | secrets 存储（独立文件，不进 pack） |
| `backend/server.py` | `/api/user-fn`（list）+ `/api/user-fn/{name}`（执行）+ `/api/user-fn/{name}/secret`，全部 require_loopback |
| `addin` | `onToolUse` 前缀路由 + `getAllTools` 追加 user.* |
| 安装同意 | `installed_packs.json` + 能力变化重同意 |
| 示例 | `user.profit_assumptions`（纯计算，network:false，无 secrets） |
| 测试 | `test_user_fn_runner.py`：clean_env 无 key、stdin/stdout 协议、超时、非法名、network 声明 |

---

## 9. 与本仓库现有纪律的关系

- `skill_registry.py` 三方锁步：**不涉及**（`user.*` 独立注册表）。
- `web_tools.safe_http_url`：**复用**（`ce_http` 助手走它）。
- `require_loopback`：**沿用**（所有 user-fn 端点）。
- `CLAUDE.md`「行业不进核心」：**强化**（`user.*` 是行业口径的合法落点，但必须走独立命名空间）。

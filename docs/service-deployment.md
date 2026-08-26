# 服务化部署（借鉴 ClaudeOfficeGateway + 本项目落地映射）

> **消费者**：实施者（Codex 按 plan 实施）、评审者（Claude code-review 对照）、后续维护者。
> **何时读**：把后端 :8765 从「手动 launch.bat 黑框」升级为「Windows 服务常驻」前，先读本文理解借鉴与边界。
> **性质**：参考文档（尽力准确）。实施以 `docs/superpowers/specs/2026-08-26-service-deployment-design.md` 与对应 plan 为准。

**一句话**：本项目后端 `server.py`（uvicorn :8765）服务化，直接借鉴 `C:\ClaudeOfficeGateway` 用过、踩过、并已把解法写进注释的**同一套 Windows 服务模式**（NSSM 包装 + 崩溃自愈 + 端口归属健康检查 + 单实例互斥），只映射到我们的单进程 uvicorn。

---

## 1. 借鉴来源与已验证结论

来源项目：`C:\ClaudeOfficeGateway` —— Claude Office LLM 网关，服务化跑 LiteLLM + injector + Nginx（三进程），全部用注释记录了踩坑与解法。以下结论**已在那个项目实际运行验证**，可直接照抄到本项目（我们的后端比它简单得多：单进程 uvicorn）。

### 1.1 为什么用 NSSM 而不是裸 sc.exe / New-Service

Windows SCM 要求被拉起的进程**自己调用 `StartServiceCtrlDispatcher()` 并应答控制管道**。裸 `powershell.exe -File start.ps1` 不会这么做 → `Start-Service` 必然报 **错误 1053（服务未及时响应）**，这不是时序问题，是**协议不匹配**，改 `ServicesPipeTimeout` 也没用。

**NSSM**（nssm.cc）是真实的 Win32 服务，正确应答 SCM；它把服务起停/重启语义转发给我们的启动脚本作为普通子进程。→ **本项目采用 NSSM 包装 `python server.py`。**

### 1.2 PowerShell 调用原生命令的两个深坑（照抄其解法）

| 坑 | 现象 | 解法（已验证） |
|---|---|---|
| **PS 5.1/7 把原生命令 stderr 当 ErrorRecord** | `$ErrorActionPreference="Stop"` 下，pip/sc 打印一行无害 WARNING 到 stderr 就**升级成终止异常**，整脚本中断 | `$PSNativeCommandUseErrorActionPreference=$false` 只管退出码、**不管 stderr 文本**；对 stderr 用 `Start-Process -RedirectStandardOutput/Error`（流重定向不进 PS 错误机制，才真正免疫） |
| **`Unblock-File` 必须** | `Invoke-WebRequest` 下载的 nssm.exe 带 Mark-of-the-Web（Zone.Identifier），Windows 静默拒跑（无输出、退码 1） | 下载后 `Unblock-File`，且每次跑都幂等再 Unblock（现有文件复制过来也可能带 MOTW） |

### 1.3 服务崩溃自愈（商用核心）

| NSSM 配置 | 值 | 作用 |
|---|---|---|
| `AppExit Default Restart` | — | 进程退出自动重启 |
| `AppRestartDelay` | 5000 ms | 崩后 5 秒拉起 |
| `AppThrottle` | 30000 ms | 防自启风暴（频繁崩时节流，避免 SCM 判定服务挂死） |
| `AppRotateFiles` + `AppRotateBytes` | 10 MB | 日志轮转，防单文件涨爆 |

### 1.4 健康检查：按「端口归属」而非「PID 存活」（本项目要抄的）

来源项目最深的坑：LiteLLM 是 pip-shim 分叉**子孙进程树**——查顶层 PID `HasExited` 会误判（shim 退了、真 worker 还在听端口，结果疯狂误重启）。解法：

- **`Test-PortOwnedBySelf`**：用 `Get-NetTCPConnection -LocalPort X -State Listen` 拿 OwningProcess → `Get-Process` 取 StartTime，`>= 本脚本启动时戳` 才算「我起的」——区分自己进程 vs 残留孤儿占端口。
- **连续 N 次 miss 才判不健康**（N=3）——吸收 shim 交接瞬间的端口空窗。
- **特意不用 WMI**（`Get-CimInstance`）：这台机器 WMI 间歇静默返回空，曾导致误判重启——用 `Get-NetTCPConnection`/`Get-Process`（纯 Win32 API）更稳。
- `status.ps1` 查端口也用 **`netstat -ano`**（同样避开 WMI），输出 `OK / DEGRADED / DOWN` 裁决，区分「服务 Running 但端口缺（分脑）」与「服务没跑」。

### 1.5 单实例互斥锁（防「分脑」）

睡眠唤醒/连续两次触发会跑两个 start 副本，各自清理+启动，谁抢到端口谁赢 → 组件来自副本 A 的、副本 B 的混在一起，另一半成**无人监管的孤儿进程**。解法：**命名互斥锁**（`Global\<name>_start_ps1`），`WaitOne(0)` 拿不到就直接退出，不碰任何进程/端口。

### 1.6 服务账号选择

用 LocalSystem（免目录 ACL / LogonRight 配置），避免专用用户需要的 `SeServiceLogonRight`（secedit inf）+ 目录 grant。来源项目最终切到 LocalSystem 就是这个理由。→ 本项目同样 **LocalSystem**。

---

## 2. 本项目落地映射

### 2.1 服务对象（比来源简单）

只有**一个进程**：`python backend/server.py` → `uvicorn.run(app, host="127.0.0.1", port=8765)`（[server.py:848-867](backend/server.py#L848-L867)）。
不涉及 LiteLLM / injector / Nginx 三件套。

- **生产模式**：后端托管 `addin/dist`（[server.py:67](backend/server.py#L67) `ADDIN_DIR`），Excel 加载项从 `https://localhost:8765` 拉 taskpane → **用户只需开 Excel，不跑任何启动脚本** —— 这是服务化的收益点。
- **开发模式**：`npm start`（webpack dev-server :3000）仍是开发工具，**不服务化**。双轨保留。
- 扩展 ingest 端口 8766（[server.py:36](backend/server.py#L36)）随 server.py 一起常驻，无需额外处理。

### 2.2 文件布局（新增）

```
scripts/service/
├── setup-service.ps1        # 管理员一次性：NSSM 安装 + 服务创建 + 启动（借鉴来源 setup-service.ps1）
├── start-service.ps1        # 服务入口（NSSM 拉起）＝证书自检 → 起 uvicorn → 健康循环
├── stop.ps1                 # 停服务（照抄来源 stop.ps1 语义）
├── status-service.ps1       # 只读体检：服务状态 + 8765 端口归属 + /api/health 裁决
└── logs/                    # 运行时日志（start 自身 stdout/stderr + NSSM 转发）
```

### 2.3 start-service.ps1 的启动步骤（照抄来源逻辑，缩成单进程）

1. **互斥锁**（`Global\SheetWiseBackend_start_ps1`）——拿不到立刻退出，防双启分脑。
2. **证书自检**：`backend/cert.pem`+`key.pem`（[server.py:803-804](backend/server.py#L803-L804)）；不存在或有效期 <7 天 → 调 `npx office-addin-dev-certs install` 重生成并拷到 backend/（复用现有 launch.bat 逻辑，但**必须在服务里也能跑**：NSSM 以 LocalSystem 运行，需给 npx 可执行的环境）。
3. **残留清理**：启动前杀干净已占 8765 的旧进程（来源「残余清理」逻辑）。
4. **起 uvicorn**：`Start-Process python server.py`（RedirectStandardOutput/Error → logs，避过 PS stderr 深坑），`-WindowStyle Hidden`。
5. **健康循环**：`Test-PortOwnedBySelf :8765`（StartTime 归属法）连续 3 miss → 记录日志并 `exit 1`（NSSM 收到退出码 → AppExit Restart 自愈）。不做 PID 存活判断。

### 2.4 status-service.ps1（只读，无管理员）

- 服务状态（Get-Service）
- 8765 端口归属（netstat -ano，避开 WMI）
- `/api/health` HTTP 裁决（自签证书用 `curl.exe -k`，借鉴来源 Test-GatewayHttps）
- 输出 `OK / DEGRADED / DOWN` + 最近错误日志

### 2.5 安装

- `setup-service.ps1`（管理员）：下载/解压 NSSM（Unblock-File）→ 建服务（DisplayName "SheetWise Backend"）→ `AppExit Default Restart` + `AppRestartDelay 5000` + `AppThrottle 30000` → LocalSystem → 起服务。
- 并入 `install.bat` 作为可选步骤；`launch.bat` 保留（开发模式 + 手动调试）。

### 2.6 边界与安全（本项目特殊，来源没有）

- **只绑 127.0.0.1**（[server.py:861,867](backend/server.py#L861-L867)）——服务化后**不变**，禁止 0.0.0.0。LocalSystem 跑在 loopback 上，无外部暴露面。
- config/apiKey 仍在 `~/.claude-excel-web/`（用户目录，非服务代码目录），LocalSystem 跑 server.py 读得到吗？——**要点**：`Path.home()` 在 LocalSystem 下解析为 `C:\Windows\System32\config\systemprofile`，不再是用户目录！**服务化后 config.sjon 路径会错**。这是本项目落地映射的**关键差异**，必须处理：服务模式下 CONFIG_DIR 需显式指到真实用户目录（启动时注入环境变量 `EXCEL_ADDIN_USER_HOME` 或改 `config_store.py` 支持覆盖）。→ 写进 plan 为必做项，不可随 NSSM 照抄。

---

## 3. 交付顺序

1. 文档（本文 + spec + plan）→ 二段协同交 Codex 按 plan 实施
2. Codex 实现 2.2-2.5 + 2.6 的 CONFIG_DIR 修复 + 测试
3. Claude code-review 对照 plan 逐粒核对
4. 实测：`setup-service.ps1` 装上 → `status-service.ps1` OK → Excel 开插件直连 :8765 不跑脚本
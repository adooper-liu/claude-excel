# 服务化部署（Service Deployment）设计

> 状态：已定（2026-08-26）。消费者：实现者（Codex 按此实施）、评审者（Claude code-review 对照核对）、后续维护者。
> 借鉴记录与落地映射：`docs/service-deployment.md`。本文是 spec，落地以本文为准，service-deployment.md 是参考。

## 1. 背景与目标

后端 `server.py`（uvicorn :8765）目前靠 `launch.bat` 手动拉起（一个黑框常驻）。商用形态应让用户**只开 Excel 就能用**：后端做成 Windows 服务常驻（开机自启、崩溃自愈），生产模式下 Excel 加载项从 `https://localhost:8765` 拉 dist。借鉴 `C:\ClaudeOfficeGateway` 用过并踩过坑的同一套 NSSM 服务模式（详见 `docs/service-deployment.md`），映射到本项目的**单进程 uvicorn**。

已确认的关键约束（来自代码）：
- 后端只绑 **127.0.0.1**（[server.py:861,867](backend/server.py#L861-L867)），服务化后**不变**。
- `CONFIG_DIR = Path.home() / ".claude-excel-web"`（[config_store.py:11](backend/config_store.py#L11)）被 10+ 模块共享（config/知识库/技能/场景包/模板/取数/密钥/表格结构/备份）。**服务化后 LocalSystem 的 `Path.home()` 解析到 `C:\Windows\System32\config\systemprofile`，不再是用户目录** → config/API Key/知识库全跑偏。这是服务化**必须**同步解决的关键差异，不可照抄 NSSM 而不处理。
- 后端生产模式托管 `addin/dist`（[server.py:67](backend/server.py#L67)），Excel 从 :8765 拉 taskpane。
- 扩展 ingest 端口 8766 随 server.py 一起常驻，无需单独处理。
- 开发模式 `npm start`（webpack dev-server :3000）**不服务化**，保持双轨。

## 2. 范围

**含**（服务化本次交付）：
- NSSM 包装 `python server.py`（单进程 uvicorn）为 Windows 服务
- 服务崩溃自愈（`AppExit Default Restart` + `AppThrottle`）
- 健康自愈（`Test-PortOwnedBySelf :8765`，连续 3 miss 才判不健康）
- 单实例互斥锁（防双启分脑）
- 证书启动自检 + 过期重生成
- **CONFIG_DIR 在服务模式下指向真实用户目录**（关键差异修复）
- `status.ps1` 只读体检
- 安装/卸载/启停脚本

**不含**（YAGNI，本次不做）：
- 多实例 / 多用户 profile 切换
- 远程访问（坚持 loopback-only）
- webpack dev-server 服务化
- 日志采集聚合 / 集中监控

## 3. 关键设计决策

### 3.1 CONFIG_DIR 的服务模式路径（必做，本项目独特）

`config_store.py` 的 `CONFIG_DIR` 目前 `import` 时冻结为 `Path.home()/".claude-excel-web"`。服务模式下 `Path.home()` 跑偏，需让它在服务启动时**显式覆盖到真实用户目录**。

方案：`start-service.ps1` 启动 server.py 前设置环境变量，并让 `config_store.py` 支持它：

```python
# config_store.py 顶部，替代硬编码：
import os
_USER_HOME = os.environ.get("SHEETWISE_USER_HOME") or os.path.expanduser("~")
CONFIG_DIR = Path(_USER_HOME) / ".claude-excel-web"
```

- 手动模式（`launch.bat` / `npm`）不设该变量 → 退回 `expanduser("~")`＝当前用户目录，**行为不变**。
- 服务模式：`setup-service.ps1` 在服务启动脚本里注入真实用户目录（安装时询问/探测 `%USERPROFILE%`），或由 `start-service.ps1` 设 `env:SHEETWISE_USER_HOME = <安装时记录的路径>`。

> 服务以 LocalSystem 跑，用户目录路径必须在**安装时**探测并固化（写进服务配置/环境变量），因为 LocalSystem 自己解析 `~` 是错的。安装脚本用一个必填 `-UserHome` 参数（或探测登录用户 `C:\Users\<用户名>`）写入。

> 注意：`~/.claude-excel-web` 在 `D:\Github\CLAUDE.md` 与多处 docs 都写成「用户目录」，本设计不改位置，只改「服务模式下从哪解析」。位置仍是用户目录。

### 3.2 NSSM 包装（借鉴 1.1/1.3）

- NSSM（nssm.cc）拉 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <root>\scripts\service\start-service.ps1`。
- 服务名：`SheetWiseBackend`；DisplayName `SheetWise Backend`。
- `AppExit Default Restart` + `AppRestartDelay 5000` + `AppThrottle 30000`。
- `AppStdout/AppStderr` → `logs\service-stdout.log` / `logs\service-stderr.log`；`AppRotateFiles 1` + `AppRotateBytes 10485760`（10MB）。
- 服务账号：`LocalSystem`（免目录 ACL / LogonRight，借鉴 1.6）。
- 安装脚本用 `setup-service.ps1`（管理员），借鉴来源的 `Ensure-Nssm`（下载 + `Unblock-File`）与 `Invoke-Nssm`（`Start-Process -RedirectStandardOutput/Error` 避开 PS stderr 深坑，借鉴 1.2）。

### 3.3 start-service.ps1 启动步骤（借鉴 1.4/1.5/1.7 缩成单进程）

1. **互斥锁**（`Global\SheetWiseBackend_start_ps1`）——拿不到立刻退出，防双启分脑（借鉴 1.5）。
2. **证书自检**：`backend/cert.pem`+`key.pem`；不存在或有效期 <7 天 → `npx office-addin-dev-certs install` 重生成并拷贝到 backend/（复用现有 `launch.bat` 逻辑）。失败不阻塞（server.py 无证书时回退 http:8765，功能仍可用）。
3. **残留清理**：启动前杀干净已占 8765 的进程（借鉴来源「残余清理」）。
4. **起 uvicorn**：`Start-Process python server.py -RedirectStandardOutput/Error <log> -WindowStyle Hidden`（借 1.2 避 PS stderr 深坑）。
5. **健康循环**：`Test-PortOwnedBySelf :8765`（`Get-NetTCPConnection`+`Get-Process` StartTime，不用 WMI，借 1.4）连续 3 miss → 记录日志 + `exit 1`（NSSM 收到退出码 → AppExit Restart 自愈）。

### 3.4 status-service.ps1（只读，无管理员）

- 服务状态：`Get-Service`。
- 8765 端口归属：`netstat -ano`（借 1.4，避 WMI）。
- `/api/health`：`curl.exe -k https://localhost:8765/api/health`（自签证书，借来源 Test-GatewayHttps）。
- 裁决输出 `OK / DEGRADED / DOWN` + 最近错误日志（借来源 status.ps1）。

### 3.5 证书续期并入服务启动（借鉴 1.7 → 本项目）

来源项目证书是自签+`curl -k`。本项目服务模式下证书自检放进 `start-service.ps1` 第 2 步（每次服务启动检查，过期重生成），NSSM 崩溃自愈重启时**自动续期**。

## 4. 文件布局

```
scripts/service/
├── setup-service.ps1        # 管理员：NSSM 安装 + 服务创建 + 启动（-UserHome 必填）
├── uninstall-service.ps1    # 停 + 卸载服务（管理员）
├── start-service.ps1        # 服务入口（NSSM 拉起）＝证书自检 → 起 uvicorn → 健康循环
├── status-service.ps1       # 只读体检（无管理员）
└── logs/                    # 运行时日志
```

## 5. 测试计划

ps1 脚本为主，仓库无 ps1 测试设施。用幂等 + 状态裁决验证，人工/手动触发覆盖：
- 安装 → `Get-Service SheetWiseBackend` 为 Running → `status-service.ps1` 出 OK。
- 杀 server.py 进程（模拟崩溃）→ 等 NSSM 重启窗口 → 服务回到 Running，8765 可连（验证 AppExit Restart）。
- `start-service.ps1` 双开（连跑两次）→ 第二个立即退出（互斥锁生效，不碰端口）。
- 证书删除 → 重启服务 → 自动重生成，8765 恢复 https。
- 卸载 → 服务消失、8765 释放。
- **CONFIG_DIR 验证（关键）**：服务模式下 `config.json` 落在 `-UserHome/.claude-excel-web/`（非 systemprofile）；已有用户配置/知识库可见。

## 6. 文档

- `docs/service-deployment.md`（借鉴记录 + 映射）——已建，作为参考文档挂进 `docs/document-usage.md` 消费链。
- `docs/migration.md`：无需大改（迁移流程仍是产品内导出/导入；服务化不影响用户数据位置）。
- README：如有必要补「服务模式」一句（可选，放最后）。

## 7. 需要动到的文件（预估）

- 新增 `scripts/service/setup-service.ps1` / `uninstall-service.ps1` / `start-service.ps1` / `status-service.ps1`
- 修改 `scripts/launch.bat`（可选标注，不加 NSSM 依赖）
- 修改 `backend/config_store.py`（`CONFIG_DIR` 读 `SHEETWISE_USER_HOME` 环境变量）
- `install.bat`：加入「可选装服务」提示（或独立跑 setup-service.ps1，不强制并入）
- `docs/document-usage.md`：挂 service-deployment.md 行
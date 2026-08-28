# SheetWise 首次安装与使用指南（小白版）

> 给从没用过的人看的。跟着走，不跳步，10 分钟搞定。

---

## 安装有三种方式，先选一种

| | 方式 A：完整安装（推荐） | 方式 B：开发安装 | 方式 C：服务化安装 |
|---|---|---|---|
| **适合谁** | 纯使用者，拿来就用 | 要改代码或做开发的人 | 长期日常使用、不想每次弹黑框的人 |
| **前端跑在哪** | 后端托管（:8765） | 开发服务器（:3000），热重载 | 后端托管（:8765），Windows 服务常驻 |
| **日常启动** | 双击 `launch.bat` | 后端 + `npm start` 两个窗口 | **直接开 Excel 就有侧边栏**，不用跑任何脚本 |
| **开机自启** | 否 | 否 | ✅ 是，服务自动随系统启动 |
| **后台无窗口** | 否（有黑框） | 否（有两个窗口） | ✅ 是，无黑框无窗口 |
| **崩溃自愈** | 否 | 否 | ✅ 是，NSSM 5 秒自动重启 |
| **需要构建** | 是（`npm run build`） | 否（开发模式实时编译） | 是（`npm run build`） |
| **改代码后** | 重新 build 再 launch | 自动刷新，不用重启 | 重新 build 后重启服务 |
| **额外要求** | 无 | 无 | 管理员 PowerShell + 安装 NSSM（脚本自动下载） |

> 不知道选哪个？先选 **方式 A** 用起来。觉得每次双击 launch.bat 麻烦了，再升级成 **方式 C**（服务化），一次装好以后开机即用。要改代码才选 **方式 B**。

> **方式 C 是方式 A 的升级版**：前端构建、后端托管模式完全一样，只是把后端从"手动 launch.bat 黑框"升级为"Windows 后台服务常驻"。

---

## 你需要准备什么（两种方式通用）

| 准备项 | 怎么确认 | 没有怎么办 |
|---|---|---|
| Windows 电脑 | 你现在用的是 Windows 就行 | 本项目不支持 Mac |
| Python 3.10+ | 打开命令行输入 `python --version`，能看到版本号就行 | 去 [python.org](https://www.python.org/downloads/) 下载安装，安装时勾选 "Add Python to PATH" |
| Node.js 18+ | 打开命令行输入 `node --version`，能看到版本号就行 | 去 [nodejs.org](https://nodejs.org/) 下载 LTS 版安装 |
| 一个 API Key | 注册 DeepSeek / 阿里百炼 / 智谱 GLM 任选一个 | DeepSeek 注册最简单：[platform.deepseek.com](https://platform.deepseek.com/)，充 10 块能用很久 |

> **API Key 是什么？** 就是 AI 大脑的"通行证"。SheetWise 不绑任何付费账号，你填自己的 Key，用多少花多少，数据不出本机。

---

## 第一步：下载项目（两种方式通用）

如果还没下载，用 git 拉一份：

```
git clone https://github.com/你的仓库地址/claude-excel.git
```

或者直接下载 ZIP 压缩包，解压到任意盘（比如 `D:\claude-excel`）。

> 放哪个盘都行，路径别有中文和空格就行。

---

## 第二步：首次安装（只做一次）

### 公共步骤（三种方式都要做）

**2.1 一键安装后端：右键 `install.bat` → 以管理员身份运行**

这一个脚本会自动做三件事：

1. 生成并信任 HTTPS 证书（让 Excel 信任本地服务），复制到 backend 目录
2. **pip 自动安装 Python 依赖**，并下载 Chromium 浏览器内核（ERP 取数功能用）
3. 把 SheetWise 插件注册进 Excel

看到 `安装完成！` 就行。

> **如果报错"npx 不是内部或外部命令"**：说明 Node.js 没装好，回到"准备"步骤重装。
>
> **如果 pip 下载很慢卡住**：先关掉这个窗口，用**管理员**身份打开命令行，手动换源装一遍（装过的会自动跳过）：
> ```
> pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
> ```
> 装完再右键 `install.bat` 管理员运行一次，让它把证书和注册做完。

**2.2 装前端依赖**

打开命令行（按 `Win + R`，输入 `cmd` 回车），进到项目目录：

```
cd /d D:\claude-excel\addin
npm install
```

第一次会比较久（3-5 分钟），看到 `added xxx packages` 就 OK。

> `install.bat` 只管后端（Python 那边），前端这两个命令需要自己跑。

---

### 方式 A：完整安装（再跑一条命令）

上一步已经在 `addin` 目录里了，接着执行：

```
npm run build
```

看到 `built` 之类的提示就行。这一步把 Excel 插件界面打包好，让后端能托管。

> 这一步只做一次。以后除非改了代码需要重新构建，否则不用再跑。

**✅ 方式 A 安装到此完成**：右键 `install.bat`（管理员）→ `npm install` → `npm run build`，就这三下。日常启动见下方"第三步 A"。

---

### 方式 B：开发安装（无需构建）

不需要 `npm run build`，开发模式下代码实时编译。

但开发模式用的 manifest 指向 `localhost:3000`（不是 :8765），所以你需要确认 `addin/manifest.xml` 的 `SourceLocation` 指向 `https://localhost:3000`（通常默认就是）。

**✅ 方式 B 安装到此完成。** 日常启动见下方"第三步 B"。

---

### 方式 C：服务化安装（方式 A 之上多一步）

先完成方式 A 的全部步骤（包括 `npm run build`），然后：

**2.3 装成 Windows 服务**

**右键** PowerShell → **以管理员身份运行**，执行：

```powershell
cd D:\claude-excel
.\scripts\service\setup-service.ps1 -UserHome C:\Users\你的用户名
```

> 把 `你的用户名` 换成实际的用户名（如 `zhangsan`）。

脚本会自动：
1. 下载 NSSM（把 Python 后端包装成 Windows 服务的工具）
2. 创建名为 `SheetWiseBackend` 的 Windows 服务
3. 配置崩溃自愈（崩了 5 秒自动重启）
4. 启动服务

看到 `Service started` 之类的提示就 OK。

> **`-UserHome` 是什么？** 服务以系统身份（LocalSystem）运行，它不知道你的用户目录在哪。这个参数告诉它你的 `config.json` 和知识库在哪个目录下，必须填对。

**验证服务状态**（非管理员也行）：

```powershell
.\scripts\service\status-service.ps1
```

看到 `OK` 就说明服务正常运行。如果显示 `DEGRADED` 或 `DOWN`，看下面的"常见问题"。

**✅ 方式 C 安装到此完成。** 日常启动见下方"第三步 C"。

> **卸载服务**：管理员 PowerShell 运行 `.\scripts\service\uninstall-service.ps1`

---

## 第三步：日常启动

### 第三步 A：方式 A 的启动方式

**双击 `launch.bat`**。它会自动做：

| 步骤 | 它在干嘛 | 你要做什么 |
|---|---|---|
| [1/5] 检查环境 | 看看 Python 和 Node 都在不在 | 等就行 |
| [2/5] 检查证书 | 证书过期了会自动更新 | 等就行 |
| [3/5] 启动后端 | 在 127.0.0.1:8765 跑起来一个本地服务 | 等就行 |
| [4/5] 等待后端 | 反复探测直到后端回 "ok" | 等就行 |
| [5/5] 打开 Excel | 启动 Excel 并加载插件侧边栏 | 等 Excel 弹出来 |

> 如果 Excel 弹出来但侧边栏是空白：看下面的"常见问题"。

### 第三步 B：方式 B 的启动方式

**分两步走：**

**①** 先启动后端（开一个命令行窗口）：

```
cd /d D:\claude-excel\backend
python server.py
```

**②** 再启动前端开发服务器（另开一个命令行窗口）：

```
cd /d D:\claude-excel\addin
npm start
```

`npm start` 会自动打开 Excel 并加载插件。修改代码后会自动热重载，不用重启。

> 两个窗口都不能关。关了就停了。

### 第三步 C：方式 C 的启动方式

**直接开 Excel 就行。** 不用跑任何脚本、不用双击任何 .bat。

服务已经在后台跑着了（开机自启），Excel 一开，侧边栏自动连上 `https://localhost:8765`。

> 如果侧边栏空白：可能是服务还没起来（刚开机稍等几秒），或者看"常见问题"排查服务状态。

---

## 第四步：配置 API Key（三种方式都一样，只做一次）

Excel 打开后，右侧侧边栏顶部有一个 **⚙ 齿轮图标**，点开。

填三样东西：

| 字段 | 填什么 | 举例 |
|---|---|---|
| API Key | 你的模型供应商密钥 | `sk-xxxxxxxxxxxx` |
| Base URL | 模型供应商的接口地址（见下表） | `https://api.deepseek.com/anthropic` |
| Model | 模型名称 | `deepseek-chat` |

**各供应商填什么：**

| 供应商 | Base URL | Key 开头 | 备注 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/anthropic` | `sk-` | 便宜，推荐入门用 |
| 阿里百炼 | `https://dashscope.aliyuncs.com/compatible-mode/anthropic` | 无固定前缀 | 通义千问 |
| 智谱 GLM | `https://open.bigmodel.cn/api/anthropic` | 无固定前缀 | GLM-4 |

> 也可以用文件配置：在 `C:\Users\你的用户名\.claude-excel-web\` 下建 `config.json`，内容见 README.md。

填完点保存。侧边栏聊天框能正常回复就说明通了。

---

## 第五步：开始用

### 基本操作逻辑

```
选数据 → 打字说话 → 结果写回 Excel
```

就这么简单。

### 具体怎么操作

**1. 选中数据**

用鼠标选中你要处理的表格区域（比如 A1:D100）。

**2. 用快捷按钮（不花 Token）**

侧边栏顶部有一排按钮，这些是本地算的，不耗 AI 额度：

- **清洗**：去空格、统一大小写
- **排序**：升降序
- **加粗**：给选区加粗
- **数据条**：给数字加可视化数据条

**3. 用自然语言（花 Token）**

在聊天框里直接打字，比如：

| 你说 | 它做 |
|---|---|
| 按金额降序排列 | 把选中的数据按金额列降序排 |
| 给 B 列加数据条 | 给 B 列数字加可视化条 |
| 大于 100 的标红，写入 C 列 | 筛选大于 100 的行，C 列标红 |
| 创建销售额柱状图 | 插入一张柱状图 |
| 去重 | 去掉重复行 |
| 统计每个部门的平均工资 | 透视汇总 |

**4. 用斜杠口令（高级加速器）**

在聊天框打 `/` 会弹出口令列表：

| 口令 | 干什么 |
|---|---|
| `/整形` | 清洗表格（去空格、统一格式） |
| `/对账` | 两个表对比找差异（源表只读，不乱改） |
| `/计算` | 写活公式（INDEX/MATCH、SUMIFS），合计自动变 |
| `/透视` | 数据透视、切片、趋势 |
| `/假设` | 改税率/运费/广告费等假设值，下游自动重算 |
| `/取数` | 从网页或 ERP 拉结构化数据进表 |
| `/调研` | 核实信息、多源对比 |
| `/知识` | 搜本机知识库 |
| `/拆解` | 把复杂业务流拆成步骤 |

> 不想记口令也行，直接打字说需求就好，AI 会自动选工具。

---

## 常见问题

### Q：Excel 弹出来但侧边栏空白

关掉 Excel，重新双击 `launch.bat`。还不行的话，手动在 Excel 里操作：
1. 点 **插入** → **我的加载项**（或 **获取加载项**）
2. 找到 SheetWise，点添加

### Q：提示"证书不安全"

以管理员身份打开命令行，运行一次：

```
npx office-addin-dev-certs install
```

然后重启 Excel。

### Q：聊天框不回复 / 报错

1. 检查 API Key 填对了没有（DeepSeek 以 `sk-` 开头，阿里/智谱没有固定前缀）
2. 检查 Key 有没有余额（去供应商平台看）
3. 检查后端窗口有没有报错（方式 A/B：`launch.bat` 或命令行窗口；方式 C：看服务日志 `scripts\service\logs\`）

### Q：后端窗口报错 "Address already in use"

说明 8765 端口被占了。打开任务管理器，结束掉之前的 `python.exe`，再重新启动。

> 方式 C 用户：如果装了服务又手动跑了 `launch.bat`，会端口冲突。服务化后不需要再跑 `launch.bat`。

### Q：安装时 pip install 很慢

换国内源：

```
pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### Q：npm install 很慢

换国内源：

```
npm config set registry https://registry.npmmirror.com
```

然后重新 `npm install`。

### Q：方式 C 服务状态异常（status-service.ps1 显示 DOWN）

1. 管理员 PowerShell 重启服务：`Restart-Service SheetWiseBackend`
2. 查看日志：`scripts\service\logs\service-stderr.log` 最后几行
3. 确认 `-UserHome` 填对了（config.json 所在的目录）
4. 确认 8765 端口没被别的进程占用

### Q：从方式 A 升级到方式 C

先确保方式 A 跑通（launch.bat 能正常启动且侧边栏能用），再跑 `setup-service.ps1`。升级后日常不用再双击 launch.bat，直接开 Excel。

---

## 快速对照卡（打印贴桌上）

```
┌────────────────────────────────────────────┐
│  SheetWise 速查                             │
├────────────────────────────────────────────┤
│  三种安装方式：                             │
│    A = 完整安装（推荐普通用户）              │
│    B = 开发安装（推荐改代码的）              │
│    C = 服务化安装（A + 常驻，开机即用）      │
│                                             │
│  ── 公共步骤（三种方式都做）──              │
│    1. 右键 install.bat 管理员运行           │
│       (证书+Python依赖+Excel注册 全自动)    │
│    2. cd addin && npm install              │
│                                             │
│  ── 方式 A 再一步 ──                        │
│    3. npm run build                        │
│    日常启动：双击 launch.bat                │
│                                             │
│  ── 方式 B 无需构建 ──                      │
│    日常启动：                               │
│      窗口1: python backend\server.py       │
│      窗口2: cd addin && npm start          │
│                                             │
│  ── 方式 C 在 A 之上 ──                     │
│    4. setup-service.ps1 -UserHome ...      │
│    日常启动：直接开 Excel，无需任何脚本      │
│    状态检查：status-service.ps1             │
│                                             │
│  配 Key：侧边栏 ⚙ → 填 Key+URL+Model       │
│                                             │
│  基本用法：选数据 → 打字 → 结果写回         │
│                                             │
│  口令（打 / 触发）：                        │
│    /整形 /对账 /计算 /透视 /假设            │
│    /取数 /调研 /知识 /拆解                  │
└────────────────────────────────────────────┘
```

---

## 下一步

- **装场景包**：跨境电商财务核算等预制模板，见 `samples/packs/`
- **自定义技能**：重复操作录制成可复用技能，打 `/skill-creator`
- **拆解业务流**：打 `/拆解` 把复杂流程拆成步骤，自动标出哪些能自动化
- **详细文档**：`README.md`（技术细节）、`docs/` 目录（架构与开发规范）

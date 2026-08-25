# Claude Excel

AI 驱动的 Excel 加载项。在工作簿侧边栏用自然语言读写、格式化、做图；结果直接写回单元格。

## 快速启动

### 1. 首次安装（仅一次）
右键 `install.bat` → **以管理员身份运行**。
- 安装 Python 依赖
- 生成并信任 Office 开发者证书 (HTTPS)
- 将插件注册到 Excel

首次还需：`cd addin && npm install && npm run build`

日常也可以在仓库根目录执行 `npm start`（会转到加载项）。完整链路（后端 + Excel）请用 `launch.bat`。

### 2. 日常启动
双击 `launch.bat`：
- 检查证书
- 启动后端（:8765）
- 打开 Excel 并加载插件

在侧边栏 ⚙ 中配置 API Key（或写 `C:\Users\<用户名>\.claude-excel-web\config.json`）。

## 使用

1. 在 Excel 中选中数据区域
2. 一键按钮：分析 / 报告（走 AI）；清洗 / 排序 / 加粗 / 数据条（本地，不耗 Token）
3. 聊天框输入自然语言，例如：
   - 按金额降序排列
   - 给 B 列加数据条
   - 大于 100 的标红，写入 C 列
   - 创建销售额柱状图

## API Key

```json
{
  "apiKey": "sk-你的key",
  "baseUrl": "https://api.deepseek.com/anthropic",
  "model": "deepseek-v4-pro[1m]",
  "smallFastModel": "deepseek-v4-flash"
}
```

- DeepSeek: `https://api.deepseek.com/anthropic`
- 阿里百炼: `https://dashscope.aliyuncs.com/apps/anthropic`
- 智谱 GLM: `https://open.bigmodel.cn/api/anthropic`

环境变量 `DEEPSEEK_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 优先于文件。

## 目录结构

```
claude-excel/
├── backend/           ← LLM 代理 + 配置 + 托管加载项 dist
├── addin/             ← Excel 加载项
│   ├── manifest.xml
│   └── skills/core/   ← 工具声明（必须有 executor）
├── skills/README.md   ← Skill 契约
└── launch.bat
```

## 常见问题

**Q: Excel 加载项安全警告？**  
A: 管理员运行一次 `npx office-addin-dev-certs install`。

**Q: Key 验证失败？**  
A: Key 格式因供应商而异（DeepSeek 以 `sk-` 开头；智谱 GLM / 通义 Qwen 等无前缀），确认填的是对应供应商的 API Key 且能访问。

**Q: 如何加新工具？**  
A: 见 `skills/README.md`。manifest 没有 executor 时后端会拒绝启动。

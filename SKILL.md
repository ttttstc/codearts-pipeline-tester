---
name: huawei-pipeline-tester
description: 华为云 CodeArts 流水线自动化测试专家。支持一键执行、批量并发、实时监控、自动重试与报告生成。
---

# 🚀 Huawei Pipeline Tester

这是一个专为华为云 CodeArts (DevCloud) 设计的自动化测试工具，基于 Playwright 实现。它能帮你自动登录、点击执行、处理弹窗、监控状态并生成报告。

## 👨‍💻 人类使用指南 (Human Guide)

### 快速开始
1.  **环境准备**：首次使用请双击 `安装依赖.bat`。
2.  **配置账号**：修改 `config/config.json` (参考下方示例)。
3.  **启动工具**：双击 `开始自动化测试.bat`。

### 配置文件 (`config/config.json`)
```json
{
  "credentials": {
    "tenant": "租户名",
    "username": "用户名",
    "password": "密码"
  },
  "headless": false,  // true=后台运行, false=显示浏览器
  "pipelines": {
    "L0冒烟": "https://devcloud.../detail/...",
    "L1回归": "https://devcloud.../detail/..."
  }
}
```

### 核心功能
*   **⚡️ 批量并发**：同时拉起多条流水线，效率翻倍。
*   **🛡️ 智能自愈**：自动处理“确定”弹窗，遇到并发限制自动重试。
*   **📊 详细报告**：运行结束后在 `report/` 目录生成 Markdown 报告。
*   **🔐 免密登录**：登录一次后自动保存 Session，后续免验证码。

---

## 🤖 Claude 使用指南 (AI Instructions)

**当用户请求涉及以下内容时，请使用此 Skill：**
*   "运行华为云流水线"
*   "执行 CodeArts 测试"
*   "批量跑流水线"
*   "监控流水线状态"

### 🛠️ 执行策略

1.  **环境切换**：
    *   支持通过 `--env=xxx` 切换配置文件（`config.xxx.json`）。
    *   不同环境的登录态（`auth.xxx.json`）相互隔离。

2.  **单条执行**：
    *   若用户提供 URL：直接调用 `node scripts/run_pipeline.js "URL" "任务名"`
    *   若用户提供名称（且在配置中）：读取配置后执行。支持分组路径，如 `冒烟测试/L0_01`。

3.  **批量执行**：
    *   推荐使用 `node launcher.js` 进入交互模式。
    *   支持分组展示，方便管理海量用例。
    *   支持无头模式：`node launcher.js --headless`。

3.  **故障排查**：
    *   如果日志显示 `DEVPIPE.00011104`，告知用户“并发受限，正在自动重试”。
    *   如果日志显示 `Waiting for selector...` 超时，建议用户检查页面元素是否变更。

### 🔍 关键文件路径
*   启动脚本：`C:\Users\泥巴猪\huawei-pipeline-tester\launcher.js`
*   核心逻辑：`C:\Users\泥巴猪\huawei-pipeline-tester\scripts\run_pipeline.js`
*   配置文件：`C:\Users\泥巴猪\huawei-pipeline-tester\config\config.json`
*   报告目录：`C:\Users\泥巴猪\huawei-pipeline-tester\report\`

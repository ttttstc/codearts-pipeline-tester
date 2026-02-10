# 华为云 CodeArts Pipeline Tester (Web UI 版)

> **✨ 全新升级**：引入 Apple macOS 风格的 Web 控制台，支持可视化管理、实时监控与历史报告查看。

本项目是一套基于 Playwright 的自动化测试工具，专为华为云 CodeArts 流水线设计。它能模拟用户行为自动登录、触发流水线、处理弹窗、监控状态，并生成详细的测试报告。

---

## 🚀 快速开始 (30秒上手)

### 1. 环境准备
确保电脑已安装 [Node.js](https://nodejs.org/) (推荐 v16+)。
首次使用，请双击项目根目录下的脚本安装依赖：
👉 **`安装依赖.bat`**

### 2. 配置账号与用例
编辑 `config/config.json` 文件（参考 `config/config.sample.json`）：
```json
{
  "global": {
    "headless": false,    // false=弹窗显示浏览器, true=后台静默运行
    "webPort": 3000       // Web 控制台端口
  },
  "envs": {
    "default": {
      "label": "默认环境",
      "credentials": {
        "tenant": "您的租户名",
        "username": "您的IAM用户名",
        "password": "您的密码"
      },
      "suites": {
        "冒烟测试": {
          "pipelines": {
            "L0_01": "https://devcloud.../detail/..."
          }
        }
      }
    }
  }
}
```

### 3. 启动控制台
双击项目根目录下的启动脚本：
👉 **`启动Web控制台.bat`**

浏览器将自动打开 `http://localhost:3000`。
*(如果未自动打开，请手动访问该地址)*

---

## ✨ 核心功能

### 🖥️ 可视化 Web 控制台
*   **Apple 风格 UI**：采用 SF Pro 字体、毛玻璃特效与极简设计。
*   **多环境切换**：顶部下拉框一键切换不同环境（如 Dev/Prod）。
*   **用例管理**：支持按“测试套件 (Suite)”分组展示，支持全选/反选。
*   **实时状态**：列表实时显示流水线运行状态（⏳等待, 🔄运行中, ✅成功, ❌失败, ⚠️错误）。

### ⚡️ 自动化执行
*   **并发执行**：支持同时拉起多条流水线，互不干扰。
*   **智能重试**：
    *   **并发限制自愈**：遇到 `DEVPIPE.00011104` 错误自动排队重试。
    *   **弹窗自动处理**：自动识别并点击“确定/确认”按钮，支持多种选择器。
    *   **超时控制**：默认 60秒 启动超时容错。

### 📊 报告与日志
*   **实时日志**：点击界面上的“📜 实时日志”查看后台运行详情。
*   **历史报告**：点击“🕒 历史报告”侧边栏，直接在 Web 端查看之前的 Markdown 报告。
*   **错误截图**：如发生异常（如选择器找不到），系统会自动截图保存到 `report/` 目录。

---

## 🛠️ 进阶使用 (命令行模式)

如果您习惯使用命令行，仍然可以使用遗留的 CLI 启动器：

```bash
# 启动交互式 CLI
node launcher.js

# 仅执行特定环境
node launcher.js --env=prod

# 强制静默运行
node launcher.js --headless
```

---

## 📂 项目结构

*   `server.js` - Web 服务器核心 (Node.js + HTTP)
*   `web/` - 前端资源 (HTML/CSS/JS)
*   `scripts/run_pipeline.js` - Playwright 自动化核心脚本
*   `config/` - 配置文件目录
*   `report/` - 测试报告与截图存储目录

---

## ⚠️ 常见问题

1.  **Q: 启动后报错 `taskId is not defined`?**
    *   A: 请确保您使用的是最新版本的 `server.js`。尝试关闭窗口后重新运行 `启动Web控制台.bat`。

2.  **Q: 浏览器一闪而过?**
    *   A: 请检查 `config.json` 中的 `headless` 设置。如果是 `true`，浏览器将在后台运行。

3.  **Q: 登录卡在验证码?**
    *   A: 工具会自动保存 Session。如果 Session 过期且触发了滑块验证码，请在弹出的窗口中**手动完成滑块**，脚本会自动检测并继续。

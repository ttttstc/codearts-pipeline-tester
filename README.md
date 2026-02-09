# 华为云CodeArts流水线自动化测试工具 (CodeArts Pipeline Tester)

本项目是一套基于 Playwright 开发的自动化脚本，旨在帮助测试同学一键触发华为云 CodeArts 流水线，并实时监控运行状态，最终生成测试报告。

---

## 🛠 预装动作 (使用前必读)

在运行工具之前，请确保您的电脑已完成以下环境准备：

### 1. 安装 Node.js
*   请前往 [Node.js 官网](https://nodejs.org/) 下载并安装 **LTS (长期支持)** 版本（建议 v16.0.0 及以上）。
*   安装完成后，在终端输入 `node -v` 确认安装成功。

### 2. 安装 Playwright 依赖
本工具依赖 Playwright 驱动浏览器。请在项目根目录下打开终端（CMD 或 PowerShell），执行以下命令：
```bash
npm install playwright
npx playwright install chromium
```
> **注意**：如果项目目录下已有 `node_modules` 且包含 playwright，则可跳过此步。

---

## ⚙️ 配置文件说明

请编辑项目中的 `config/config.json` 文件，配置您的登录凭证和流水线地址：

```json
{
  "credentials": {
    "tenant": "您的租户名",
    "username": "您的IAM用户名",
    "password": "您的密码"
  },
  "headless": false,
  "pipelines": {
    "L0用例": "https://devcloud.cn-north-4.huaweicloud.com/...",
    "L1用例": "https://devcloud.cn-north-4.huaweicloud.com/..."
  }
}
```
*   **credentials**: 您的华为云 IAM 登录信息。
*   **headless**: 是否开启无头模式（`true` 为后台静默运行，`false` 为显示浏览器窗口）。
*   **pipelines**: 键值对格式，Key 为用例名称，Value 为流水线详情页的完整 URL。

---

## 🚀 如何启动

### 方式一：Windows 一键启动 (推荐)
1.  **首次运行**：双击 **`安装依赖.bat`**，等待环境安装完成。
2.  **日常使用**：双击 **`开始自动化测试.bat`**。

### 方式二：命令行启动
在项目根目录下执行：
```bash
node launcher.js
```

**高级参数**：
*   `--env <name>`：切换环境。例如 `--env=prod` 将读取 `config/config.prod.json` 并保存登录态到 `auth.prod.json`。
*   `--headless`：开启无头模式（后台静默运行）。

**示例**：
```bash
# 使用生产环境配置并后台运行
node launcher.js --env=prod --headless
```

---

## ⚙️ 配置文件说明

请编辑项目中的 `config/config.json` 文件。现在支持**分组配置**：

```json
{
  "credentials": { ... },
  "headless": false,
  "pipelines": {
    "冒烟测试": {
      "L0_01": "https://...",
      "L0_02": "https://..."
    },
    "回归测试": {
      "L1_01": "https://..."
    },
    "其他": "https://..."
  }
}
```
*   **分组模式**：在交互界面中会按文件夹图标显示，方便管理大量用例。
*   **多环境**：你可以创建 `config.dev.json`, `config.prod.json` 等，通过 `--env` 参数切换。

---

## 📖 交互指南

启动后，您将看到如下交互界面：
1.  **选择用例**：输入数字编号（如 `1`）选择对应流水线。
2.  **批量执行**：输入多个数字并用空格分隔（如 `1 2`）可同时并行拉起多条流水线。
3.  **全量执行**：输入 `A` 运行配置文件中的所有流水线。
4.  **退出**：输入 `Q` 退出工具。

---

## ✨ 核心特性

*   **免密登录 (Session 复用)**：首次登录成功后，工具会自动保存登录状态到 `config/auth.json`。后续运行将直接跳过登录过程，**无需再次输入验证码**。
*   **Stealth 规避检测**：内置指纹隐藏技术，防止被华为云识别为自动化工具而拦截。
*   **智能重试与自愈**：
    *   若流水线因并发受限（DEVPIPE.00011104/05）启动失败，工具将每 10 秒自动重试一次，最大重试 50 次。
    *   **弹窗自愈**：自动识别并点击“确定/确认”弹窗，支持多重选择器和 JS 暴力点击，确保启动成功。
*   **实时监控与日志**：
    *   每 10 秒打印一次流水线当前状态，使用**彩色日志**区分状态（💛RUNNING, 💚COMPLETED, ❤️FAILED）。
*   **Markdown 测试报告**：
    *   所有任务完成后，自动在 `report/` 目录下生成详细的 Markdown 报告。
    *   报告包含：执行时间、耗时、RunID、执行人、以及**直达详情页的跳转链接**。

---

## ⚠️ 注意事项
*   **验证码**：如果 Session 过期或首次登录触发了滑动验证码，请在弹出的浏览器窗口中**手动完成滑动**，脚本会自动检测并继续。
*   **浏览器窗口**：运行期间请勿手动关闭弹出的浏览器窗口，否则会导致监控中断。
*   **超时**：单条流水线的默认监控上限为 30 分钟。

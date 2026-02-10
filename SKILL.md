---
name: huawei-pipeline-tester
description: 华为云 CodeArts 流水线自动化测试专家。支持 Web UI 可视化管理、批量并发、智能自愈。
---

# 🚀 Huawei Pipeline Tester (Agentic Skill)

这是一个专为华为云 CodeArts (DevCloud) 设计的自动化测试系统。它采用了 **Web Server + Automation Script** 的分离架构，既支持人类通过 Web UI 操作，也支持 LLM 通过文件或 API 进行控制。

---

## 🧠 LLM 使用指南 (For AI Agents)

**当用户请求涉及以下内容时，请参考本指南：**
*   "运行流水线" / "启动测试"
*   "修改测试配置"
*   "排查测试报错"
*   "分析测试报告"

### 1. 系统架构认知
*   **Frontend**: `web/` (HTML/CSS/JS) - 纯静态页面，通过 API 与后端交互。
*   **Backend**: `server.js` (Node.js HTTP Server) - 负责 API 响应、任务调度、SSE 推送。
*   **Worker**: `scripts/run_pipeline.js` (Playwright) - 实际执行浏览器自动化任务的子进程。
*   **Config**: `config/config.json` - 核心配置源。

### 2. 核心操作指令

#### A. 读取配置
不要直接 cat 整个文件，建议优先通过 API 获取（如果服务已启动）或读取 JSON 结构：
*   **API**: `GET http://localhost:3000/api/config`
*   **File**: `config/config.json` (注意：结构包含 `global` 和 `envs`)

#### B. 启动测试
LLM 可以通过构造 HTTP 请求来触发测试（如果在 Web 环境中）：
*   **POST** `/api/run`
*   **Body**: `{ "env": "default", "pipelines": [{ "name": "L0_01" }] }`
*   **注意**: 必须指定有效的 `env` 名称和 `pipelines` 列表。

#### C. 故障排查
如果用户反馈报错，请按以下顺序检查：
1.  **查看服务日志**: `server_error.log` (记录了 server.js 的未捕获异常)。
2.  **查看运行日志**: 检查控制台输出，关注 `DEVPIPE` 开头的错误码。
    *   `DEVPIPE.00011104`: 并发限制（正常现象，脚本会自动重试）。
    *   `STARTUP_TIMEOUT`: 启动超时（网络卡顿或元素未找到）。
3.  **检查截图**: `report/error_*.png` (Headless 模式下的错误现场)。

### 3. 代码修改注意事项
*   **server.js**: 修改逻辑时务必小心 `taskState` 和 `activeTasks` 的状态管理。**不要删除 `taskId` 的定义**。
*   **run_pipeline.js**: 这是核心脚本。修改选择器 (`locator`) 时需考虑到页面加载延迟。已内置 `createLogger`，请使用 `log('INFO', ...)` 统一输出。
*   **config.json**: 修改配置结构时，请保持 `envs -> suites -> pipelines` 的层级，以兼容前端渲染。

---

## 👨‍💻 人类使用指南 (For Humans)

### 快速指令
*   **启动 UI**: 双击 `启动Web控制台.bat`
*   **安装依赖**: 双击 `安装依赖.bat`
*   **配置环境**: 编辑 `config/config.json`

### 功能特性
*   **Apple Style UI**: 极简、美观、高效。
*   **静默/弹窗模式**: 通过 `config.json` 中的 `headless` 字段全局控制。
    *   `false`: 弹窗模式（推荐调试用，可看到浏览器操作）。
    *   `true`: 静默模式（推荐日常用，不打扰工作）。
*   **智能监控**: 不仅能触发流水线，还能实时获取运行结果状态。

### 进阶：如何添加新环境？
在 `config.json` 的 `envs` 节点下新增 Key：
```json
"envs": {
  "prod": {
    "label": "生产环境",
    "credentials": { ... },
    "suites": {
       "主流程": { "pipelines": { ... } }
    }
  }
}
```
保存后刷新 Web 页面，顶部下拉框即可切换。

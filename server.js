console.log('[DEBUG] server.js: module loading...');
const http = require('http');
const fs = require('fs');
const path = require('path');
console.log('[DEBUG] server.js: requiring run_pipeline...');
const { runPipeline } = require('./scripts/run_pipeline');
console.log('[DEBUG] server.js: run_pipeline loaded.');

const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const REPORT_DIR = path.join(BASE_DIR, 'report');
const WEB_DIR = path.join(BASE_DIR, 'web');
const ERROR_LOG = path.join(BASE_DIR, 'server_error.log');

// 全局错误捕获，防止闪退无法看清报错
process.on('uncaughtException', (err) => {
    const msg = `[${new Date().toISOString()}] Uncaught Exception: ${err.message}\n${err.stack}\n\n`;
    console.error(msg);
    fs.appendFileSync(ERROR_LOG, msg);
});

// ==================== 运行状态管理 ====================
const activeTasks = new Map();  // taskId -> { status, results, ... }
const sseClients = new Set();   // SSE 连接池

function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(msg); } catch (e) { sseClients.delete(res); }
    }
}

// ==================== 配置读取（支持新旧格式 + suites） ====================
function readConfig() {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const result = { global: raw.global || {}, envs: {} };

    if (raw.envs) {
        for (const [envName, envData] of Object.entries(raw.envs)) {
            const env = {
                label: envData.label || envName,
                suites: {}
            };
            // 新版 suites 结构
            if (envData.suites) {
                for (const [suiteName, suiteData] of Object.entries(envData.suites)) {
                    env.suites[suiteName] = {
                        description: suiteData.description || '',
                        pipelines: suiteData.pipelines || {}
                    };
                }
            }
            // 兼容旧版 pipelines 扁平/分组结构
            if (envData.pipelines && !envData.suites) {
                const pipelines = {};
                for (const [k, v] of Object.entries(envData.pipelines)) {
                    if (typeof v === 'string') pipelines[k] = v;
                    else if (typeof v === 'object') Object.assign(pipelines, v);
                }
                env.suites['默认套件'] = { description: '从旧版配置自动迁移', pipelines };
            }
            result.envs[envName] = env;
        }
    }
    return result;
}

// ==================== MIME 类型 ====================
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

// ==================== HTTP 服务器 ====================
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
        // ---- API 路由 ----
        if (pathname === '/api/config') {
            const config = readConfig();
            // 不返回密码
            const safeConfig = JSON.parse(JSON.stringify(config));
            for (const env of Object.values(safeConfig.envs)) {
                if (env.credentials) env.credentials.password = '***';
            }
            json(res, safeConfig);
        }
        else if (pathname === '/api/run' && req.method === 'POST') {
            const body = await readBody(req);
            const { env: envName, pipelines: selectedPipelines } = JSON.parse(body);

            if (!envName || !selectedPipelines || selectedPipelines.length === 0) {
                json(res, { error: '请选择环境和至少一条流水线' }, 400);
                return;
            }

            const config = readConfig();
            const envConfig = config.envs[envName];

            if (!envConfig) {
                json(res, { error: `环境 [${envName}] 不存在` }, 404);
                return;
            }

            const tasks = [];
            // 从 suites 中查找匹配的流水线
            if (envConfig.suites) {
                for (const suite of Object.values(envConfig.suites)) {
                    if (suite.pipelines) {
                        for (const [pName, pUrl] of Object.entries(suite.pipelines)) {
                            if (selectedPipelines.some(sp => sp.name === pName)) {
                                tasks.push({ name: pName, url: pUrl });
                            }
                        }
                    }
                }
            }

            if (tasks.length === 0) {
                json(res, { error: '未找到匹配的流水线配置' }, 404);
                return;
            }

            const taskId = `RUN_${Date.now()}`;
            const taskState = {
                id: taskId,
                env: envConfig.label || envName,
                status: 'RUNNING',
                total: tasks.length,
                completed: 0,
                results: [],
                startTime: new Date().toISOString()
            };
            activeTasks.set(taskId, taskState);
            broadcast('task_start', { taskId, total: tasks.length, env: envName });

            // 异步执行，不阻塞响应
            (async () => {
                let browser;
                try {
                    const pw = require('playwright');
                    const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
                    // Priority: Request Param > Config > Default false
                    const headless = fullConfig.global?.headless ?? false;
                    console.log(`[INFO] Launching browser, Headless: ${headless}`);

                    browser = await pw.chromium.launch({ headless });
                } catch (e) {
                    console.error('Browser Launch Error:', e);
                    const errorMsg = e.message.includes('playwright')
                        ? '依赖缺失: Playwright 未安装或损坏。请运行安装依赖脚本。'
                        : `浏览器启动失败: ${e.message}`;

                    taskState.status = 'ERROR';
                    taskState.results.push({ name: 'System', status: 'ERROR', error: errorMsg });
                    broadcast('task_done', { taskId, results: taskState.results, error: errorMsg });
                    return;
                }

                try {
                    // 设置环境变量供 runPipeline 使用
                    process.env.PROJECT_ROOT = BASE_DIR;
                    process.env.ENV_NAME = envName;

                    const promises = tasks.map(async (task) => {
                        try {
                            const result = await runPipeline(task.url, task.name, {
                                browser,
                                onLog: (logItem) => {
                                    broadcast('task_log', {
                                        taskId,
                                        taskName: task.name,
                                        ...logItem
                                    });
                                },
                                onUpdate: (updateData) => {
                                    // 实时状态推送
                                    broadcast('task_progress', {
                                        taskId,
                                        name: task.name,
                                        status: updateData.status,
                                        completed: taskState.completed, // 这里不增加完成计数，只更新状态
                                        total: taskState.total,
                                        result: updateData
                                    });
                                }
                            });
                            taskState.completed++;
                            taskState.results.push(result);
                            broadcast('task_progress', {
                                taskId,
                                name: task.name,
                                status: result.status,
                                completed: taskState.completed,
                                total: taskState.total,
                                result
                            });
                        } catch (err) {
                            taskState.completed++;
                            const errorResult = { name: task.name, status: 'ERROR', error: err.message };
                            taskState.results.push(errorResult);
                            broadcast('task_progress', {
                                taskId,
                                name: task.name,
                                status: 'ERROR',
                                completed: taskState.completed,
                                total: taskState.total,
                                result: errorResult
                            });
                        }
                    });

                    await Promise.all(promises);
                } finally {
                    await browser.close().catch(() => { });
                }

                taskState.status = 'DONE';
                taskState.endTime = new Date().toISOString();

                // 生成报告
                const reportFile = generateReport(taskState);
                taskState.reportFile = reportFile;
                broadcast('task_done', { taskId, results: taskState.results, reportFile });
            })();

            json(res, { taskId, message: `已启动 ${tasks.length} 条流水线` });
        }
        else if (pathname === '/api/tasks') {
            const taskList = [];
            for (const [id, t] of activeTasks) {
                taskList.push({ id, status: t.status, env: t.env, total: t.total, completed: t.completed, startTime: t.startTime });
            }
            json(res, taskList);
        }
        else if (pathname === '/api/reports') {
            const reports = [];
            if (fs.existsSync(REPORT_DIR)) {
                const files = fs.readdirSync(REPORT_DIR).filter(f => f.endsWith('.md')).sort().reverse();
                for (const file of files.slice(0, 20)) {
                    const content = fs.readFileSync(path.join(REPORT_DIR, file), 'utf-8');
                    reports.push({ filename: file, content });
                }
            }
            json(res, reports);
        }
        else if (pathname === '/api/events') {
            // SSE 实时推送
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
        }
        // ---- 静态文件 ----
        else {
            let filePath = pathname === '/' ? '/index.html' : pathname;
            filePath = path.join(WEB_DIR, filePath);

            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }

            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (err) {
        console.error('Server Error:', err);
        json(res, { error: err.message }, 500);
    }
});

// ==================== 辅助函数 ====================
function json(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return 'N/A';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function generateReport(taskState) {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `RPT_${Date.now()}_${ts}.md`;
    const filepath = path.join(REPORT_DIR, filename);

    const passCount = taskState.results.filter(r => r.status === 'COMPLETED').length;
    let md = `# 自动化测试报告\n\n`;
    md += `- **环境**: ${taskState.env}\n`;
    md += `- **时间**: ${taskState.startTime} → ${taskState.endTime}\n`;
    md += `- **用例数**: ${taskState.results.length}\n`;
    md += `- **通过率**: ${passCount}/${taskState.results.length} (${Math.round(passCount / taskState.results.length * 100)}%)\n\n`;
    md += `| 用例 | 状态 | 耗时 | RunID | 执行人 | 链接 |\n|---|---|---|---|---|---|\n`;

    for (const r of taskState.results) {
        const dur = r.startTime && r.updateTime ? formatDuration(r.updateTime - r.startTime) : 'N/A';
        const emoji = r.status === 'COMPLETED' ? '✅' : '❌';
        const link = r.detailUrl ? `[查看](${r.detailUrl})` : '-';
        md += `| ${r.name} | ${emoji} ${r.status} | ${dur} | ${r.runId || '-'} | ${r.executor || '-'} | ${link} |\n`;
    }

    fs.writeFileSync(filepath, md);
    return filename;
}

// ==================== 启动 ====================
function startServer(port) {
    console.log('[DEBUG] startServer() called with port:', port);
    const p = port || 3000;

    // 清理旧监听器
    server.removeAllListeners('error');
    server.once('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`\x1b[33m%s\x1b[0m`, `⚠️ 端口 ${p} 被占用，尝试使用端口 ${p + 1}...`);
            server.close();
            setTimeout(() => startServer(p + 1), 500);
        } else {
            console.error('SERVER ERROR:', e);
        }
    });

    server.listen(p, () => {
        const url = `http://localhost:${p}`;
        console.log('\x1b[36m%s\x1b[0m', '╔══════════════════════════════════════════╗');
        console.log('\x1b[36m%s\x1b[0m', '║   CodeArts Pipeline Tester — Web UI      ║');
        console.log('\x1b[36m%s\x1b[0m', `║   🌐 ${url}               ║`);
        console.log('\x1b[36m%s\x1b[0m', '╚══════════════════════════════════════════╝');
        console.log('\x1b[90m%s\x1b[0m', '  (如未自动弹窗，请手动复制上方链接访问)');

        // 自动打开浏览器
        console.log('正在自动打开浏览器...');
        let command;
        if (process.platform === 'win32') {
            command = `start "" "${url}"`;
        } else if (process.platform === 'darwin') {
            command = `open "${url}"`;
        } else {
            command = `xdg-open "${url}"`;
        }

        require('child_process').exec(command, (err) => {
            if (err) console.error('❌ 自动打开失败:', err.message);
        });
    });
}

module.exports = { startServer };

// 直接运行
if (require.main === module) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        startServer(config.global?.webPort || 3000);
    } catch (e) {
        startServer(3000);
    }
}

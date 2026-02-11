// const { chromium } = require('playwright'); // 移至 runPipeline 内部延迟加载
const fs = require('fs');
const path = require('path');

// ==================== 路径配置 ====================
const BASE_DIR = process.env.PROJECT_ROOT || path.join(__dirname, '..');
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const AUTH_PATH = process.env.AUTH_PATH || path.join(BASE_DIR, 'config', 'auth.json');
const ENV_NAME = process.env.ENV_NAME || 'default';

// ==================== 日志模块 (支持回调) ====================
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

function createLogger(options = {}) {
  return function log(level, taskName, message, extra = null) {
    if (LOG_LEVELS[level] < CURRENT_LOG_LEVEL) return;

    const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
    const icons = { DEBUG: '🔍', INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌' };
    const colors = { DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };
    const reset = '\x1b[0m';

    // 控制台输出
    const prefix = `${colors[level]}${icons[level]} [${timestamp}] [${taskName}]${reset}`;
    console.log(`${prefix} ${message}`);
    if (extra) console.log(`${colors[level]}   └─ 详情: ${JSON.stringify(extra)}${reset}`);

    // 回调输出 (用于 Web UI)
    if (typeof options.onLog === 'function') {
      options.onLog({
        level,
        taskName,
        message,
        timestamp,
        extra
      });
    }
  };
}

// ==================== 配置读取 ====================
function getConfig() {
  try {
    const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    // 兼容新版 envs 结构和旧版扁平结构
    if (fullConfig.envs && fullConfig.envs[ENV_NAME]) {
      return {
        global: fullConfig.global || {},
        env: fullConfig.envs[ENV_NAME]
      };
    }
    // 回退：旧版扁平结构 → 自动适配为新结构
    if (fullConfig.credentials) {
      console.warn('[WARN] [CONFIG] 检测到旧版配置格式，建议迁移到 envs 结构');
      return {
        global: { headless: fullConfig.headless || false },
        env: {
          credentials: fullConfig.credentials,
          pipelines: fullConfig.pipelines || {}
        }
      };
    }
    return null;
  } catch (e) {
    console.error(`[ERROR] [CONFIG] 读取配置文件失败: ${e.message}`);
    return null;
  }
}

// ==================== 可配置参数 ====================
function getSettings(config) {
  const defaults = {
    maxRetries: 50,
    retryIntervalMs: 10000,
    monitorTimeoutMs: 1800000,  // 30 分钟
    loginTimeoutMs: 300000,     // 5 分钟
    pageLoadWaitMs: 2000,
    dialogWaitMs: 2000,
  };
  const overrides = (config && config.global && config.global.settings) || {};
  return { ...defaults, ...overrides };
}

// ==================== 核心函数 ====================

/**
 * 执行单条流水线的自动化测试
 * @param {string} pipelineUrl - 流水线详情页 URL
 * @param {string} taskName - 任务名称（用于日志标识）
 * @param {object} [options] - 可选参数
 * @param {import('playwright').Browser} [options.browser] - 共享浏览器实例（P1优化：避免每次新建）
 * @returns {Promise<object>} 测试结果报告数据
 */
async function runPipeline(pipelineUrl, taskName = 'Pipeline', options = {}) {
  // 延迟加载 playwright，防止未安装依赖时导致整个程序启动失败
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    if (!options.browser) throw new Error('未安装 playwright 依赖，无法启动浏览器。请运行安装依赖脚本。');
  }

  const { headless: optionsHeadless = false, maxRetries: optionsMaxRetries = 3, timeout: optionsTimeout = 60000 } = options;

  // 初始化日志记录器
  const log = createLogger(options);

  log('INFO', taskName, '启动自动化流程...');

  const config = getConfig();
  if (!config || !config.env) {
    throw new Error(`无法加载环境 [${ENV_NAME}] 的配置`);
  }

  const settings = getSettings(config);
  const headless = process.env.HEADLESS === 'true' || (config.global && config.global.headless === true);
  log('INFO', taskName, `环境: ${ENV_NAME}, Headless: ${headless ? '开启' : '关闭'}`);

  // P1优化：支持共享浏览器实例，减少资源消耗
  const sharedBrowser = options.browser || null;
  const browser = sharedBrowser || await chromium.launch({ headless });
  const ownsBrowser = !sharedBrowser; // 标记是否由本函数创建（决定是否需要关闭）

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  if (fs.existsSync(AUTH_PATH)) {
    contextOptions.storageState = AUTH_PATH;
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  let reportData = {
    name: taskName,
    status: 'UNKNOWN',
    startTime: 0,
    updateTime: 0,
    duration: '0s',
    runId: 'N/A',
    executor: 'N/A',
    detailUrl: pipelineUrl
  };

  try {
    // ============ 阶段1: 导航与登录 ============
    await page.goto(pipelineUrl, { waitUntil: 'networkidle' });

    if (page.url().includes('auth.huaweicloud.com')) {
      log('WARN', taskName, '需要登录...');
      const iamSwitchBtn = page.locator('#IAMLinkDiv').first();
      if (await iamSwitchBtn.isVisible()) {
        await iamSwitchBtn.click({ force: true });
        await page.waitForTimeout(1000);
      }

      const creds = config.env.credentials;
      if (creds) {
        await page.locator('#IAMAccountInputId').first().fill(creds.tenant, { force: true });
        await page.locator('#IAMUsernameInputId').first().fill(creds.username, { force: true });
        await page.locator('#IAMPasswordInputId').first().fill(creds.password, { force: true });
        await page.click('#btn_submit', { force: true });
        await page.waitForURL(url => url.href.includes('cicd/project'), { timeout: settings.loginTimeoutMs });
        await context.storageState({ path: AUTH_PATH });
        log('INFO', taskName, '登录成功，Session 已保存');
      } else {
        log('ERROR', taskName, '配置文件中缺少 credentials，无法自动登录');
        reportData.status = 'LOGIN_ERROR';
        return reportData;
      }
    }

    // ============ 阶段2: 点击执行按钮 ============
    log('INFO', taskName, '寻找【执行】按钮...');
    await page.waitForTimeout(settings.pageLoadWaitMs);
    const runBtn = page.locator('button:has-text("执行"), .run-btn, button:has-text("运行")').first();
    await runBtn.waitFor({ state: 'visible', timeout: 15000 });
    await runBtn.click({ force: true });

    // 等待弹窗渲染
    await page.waitForTimeout(settings.dialogWaitMs);

    // ============ 阶段3: 处理确认弹窗与重试 ============
    log('INFO', taskName, '正在处理确认弹窗与重试逻辑 (API 监控模式)...');

    // P1需求：30s 启动超时控制 -> 改为 1分钟
    const startupStartTime = Date.now();
    const STARTUP_TIMEOUT = 60000; // 60s

    const confirmSelectors = [
      '.devui-modal-container button:has-text("确定")',
      '.devui-modal-container button:has-text("确认")',
      '.modal-footer button:has-text("确定")',
      '.modal-footer button:has-text("确认")',
      'd-button[content="确定"]',
      'button:has-text("确定")',
      'button:has-text("确认")'
    ];

    let confirmed = false;
    let retryCount = 0;

    while (retryCount < settings.maxRetries) {
      // 超时检查
      if (Date.now() - startupStartTime > STARTUP_TIMEOUT) {
        log('ERROR', taskName, `启动超时 (>${STARTUP_TIMEOUT / 1000}s)，判定为失败`);
        reportData.status = 'STARTUP_TIMEOUT';
        break;
      }

      // 检查是否已跳转成功
      if (page.url().includes('pipeline-runs/detail')) {
        log('INFO', taskName, '检测到页面已跳转，启动成功');
        confirmed = true;
        break;
      }

      const runResponsePromise = page.waitForResponse(response =>
        response.url().includes('/run') && response.request().method() === 'POST',
        { timeout: 10000 }
      ).catch(() => null);

      let clicked = false;

      // 尝试1: Playwright 选择器点击弹窗确定
      for (const selector of confirmSelectors) {
        const btn = page.locator(selector).filter({ hasText: /确定|确认/ }).first();
        if (await btn.isVisible()) {
          log('DEBUG', taskName, `点击弹窗按钮: ${selector}`);
          await btn.click({ force: true });
          clicked = true;
          break;
        }
      }

      // 尝试2: JS 暴力点击弹窗确定
      if (!clicked) {
        clicked = await page.evaluate(() => {
          function isVisible(elem) {
            if (!elem) return false;
            const style = window.getComputedStyle(elem);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && elem.offsetWidth > 0;
          }
          const candidates = [
            ...Array.from(document.querySelectorAll('button')),
            ...Array.from(document.querySelectorAll('d-button')),
            ...Array.from(document.querySelectorAll('.devui-btn'))
          ];
          const target = candidates.find(b => {
            const text = b.innerText.trim();
            return (text === '确定' || text === '确认') && isVisible(b);
          });
          if (target) { target.click(); return true; }
          return false;
        });
        if (clicked) log('DEBUG', taskName, '触发 JS 暴力点击 (弹窗)');
      }

      // 尝试3: 重新点击"执行"按钮
      if (!clicked) {
        const retryRunBtn = page.locator('button:has-text("执行"), .run-btn, button:has-text("运行")').first();
        if (await retryRunBtn.isVisible()) {
          log('DEBUG', taskName, '未发现弹窗，重试点击"执行"按钮...');
          await retryRunBtn.click({ force: true });
        }
      }

      const response = await runResponsePromise;
      if (response) {
        try {
          const data = await response.json();
          const result = data.result || data;
          const errorCode = data.error_code || (data.error && data.error.code);

          if (result.pipeline_run_id || result.id) {
            log('INFO', taskName, `启动成功 (RunID: ${result.pipeline_run_id || result.id})`);
            confirmed = true;
            break;
          }

          if (errorCode === 'DEVPIPE.00011104' || errorCode === 'DEVPIPE.00011105') {
            retryCount++;
            log('WARN', taskName, `并发受限 (${errorCode})，第 ${retryCount}/${settings.maxRetries} 次重试...`);
            await page.waitForTimeout(settings.retryIntervalMs);
            continue;
          }

          if (errorCode) {
            log('ERROR', taskName, `流水线启动异常`, { errorCode, message: data.error_msg || data.message || '未知' });
            reportData.status = `STARTUP_ERROR (${errorCode})`;
            break;
          }
        } catch (parseError) {
          log('WARN', taskName, `解析 API 响应失败: ${parseError.message}`);
        }
      } else {
        log('DEBUG', taskName, '等待响应超时，准备重试...');
      }
      retryCount++;
      await page.waitForTimeout(settings.pageLoadWaitMs);
    }

    // ============ 阶段4: 监听运行状态 ============
    if (confirmed) {
      log('INFO', taskName, '流水线已启动，开始监听运行状态...');
      const finalResult = await new Promise((resolve, reject) => {
        let lastStatus = 'WAITING';
        const timeout = setTimeout(() => {
          log('ERROR', taskName, `监控超时 (${settings.monitorTimeoutMs / 60000} 分钟)`);
          reportData.status = 'MONITOR_TIMEOUT';
          resolve(reportData);
        }, settings.monitorTimeoutMs);

        page.on('response', async response => {
          if (response.url().includes('pipeline-runs/detail')) {
            try {
              const data = await response.json();
              const result = data.result || data;
              const status = result.status;
              if (status) {
                // 跳过首次就收到的历史终态
                if (lastStatus === 'WAITING' && (status === 'COMPLETED' || status === 'FAILED')) return;

                // 更新 reportData
                if (result.start_time) reportData.startTime = result.start_time;
                if (result.update_time) reportData.updateTime = result.update_time;
                if (result.pipeline_run_id || result.id) reportData.runId = result.pipeline_run_id || result.id;
                if (result.executor_name) reportData.executor = result.executor_name;

                // 构造跳转链接
                if (reportData.runId !== 'N/A' && !reportData.detailUrl.includes(reportData.runId)) {
                  try {
                    const urlObj = new URL(pipelineUrl);
                    const host = urlObj.host;
                    const projectId = result.project_id;
                    const pipelineId = result.pipeline_id;
                    const runId = reportData.runId;
                    if (projectId && pipelineId && runId) {
                      reportData.detailUrl = `https://${host}/cicd/project/${projectId}/pipeline/detail/${pipelineId}/${runId}?v=1`;
                    }
                  } catch (urlError) {
                    log('WARN', taskName, `构造详情链接失败: ${urlError.message}`);
                  }
                }

                if (status !== lastStatus) {
                  lastStatus = status;
                  reportData.status = status; // 实时更新 status

                  let color = '\x1b[0m';
                  if (status === 'RUNNING' || status === 'INIT') color = '\x1b[33m';
                  else if (status === 'COMPLETED') color = '\x1b[32m';
                  else if (status === 'FAILED') color = '\x1b[31m';
                  console.log(`📊 [${taskName}] 状态: ${color}${status}\x1b[0m`);

                  // 回调通知状态变更
                  if (typeof options.onUpdate === 'function') {
                    options.onUpdate({ ...reportData });
                  }
                }
                if (status === 'COMPLETED' || status === 'FAILED' || status === 'ABORTED') {
                  reportData.status = status;
                  clearTimeout(timeout);
                  setTimeout(() => resolve(reportData), 1000);
                }
              }
            } catch (parseError) {
              log('DEBUG', taskName, `解析监控响应失败: ${parseError.message}`);
            }
          }
        });
      });
      return finalResult;
    } else {
      if (reportData.status === 'UNKNOWN') reportData.status = 'RETRY_LIMIT_EXCEEDED';
      log('ERROR', taskName, `启动失败: ${reportData.status}`);
      return reportData;
    }
  } catch (error) {
    log('ERROR', taskName, `流程异常: ${error.message}`, { stack: error.stack?.split('\n').slice(0, 3) });


    reportData.status = 'ERROR';
    return reportData;
  } finally {
    await context.close().catch(() => { });
    // 只有自己创建的浏览器才关闭（共享模式下由调用方管理）
    if (ownsBrowser) {
      await browser.close().catch(() => { });
    }
  }
}

module.exports = { runPipeline };
if (require.main === module) { runPipeline(process.argv[2]); }

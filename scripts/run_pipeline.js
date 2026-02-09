const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 动态获取配置路径 (优先使用环境变量 CONFIG_PATH/AUTH_PATH，否则回退到默认路径)
const BASE_DIR = process.env.PROJECT_ROOT || path.join(__dirname, '..');
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const AUTH_PATH = process.env.AUTH_PATH || path.join(BASE_DIR, 'config', 'auth.json');
const ENV_NAME = process.env.ENV_NAME || 'default';

function getConfig() {
  try {
    const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      global: fullConfig.global || {},
      env: fullConfig.envs ? fullConfig.envs[ENV_NAME] : null
    };
  } catch (e) { return null; }
}

async function runPipeline(pipelineUrl, taskName = 'Pipeline') {
  console.log(`🚀 [${taskName}] 启动自动化流程...`);
  
  const config = getConfig();
  if (!config || !config.env) {
      throw new Error(`无法加载环境 [${ENV_NAME}] 的配置`);
  }

  // 优先读取环境变量，其次读取全局配置，默认 false
  const headless = process.env.HEADLESS === 'true' || (config.global && config.global.headless === true);
  console.log(`⚙️ [${taskName}] 环境: ${ENV_NAME}, Headless模式: ${headless ? '开启' : '关闭'}`);
  
  const browser = await chromium.launch({ headless: headless });
  
  let contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };
  
  if (fs.existsSync(AUTH_PATH)) {
    contextOptions.storageState = AUTH_PATH;
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
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
    await page.goto(pipelineUrl, { waitUntil: 'networkidle' });

    if (page.url().includes('auth.huaweicloud.com')) {
      console.log(`⚠️ [${taskName}] 需要登录...`);
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
        await page.waitForURL(url => url.href.includes('cicd/project'), { timeout: 300000 });
        await context.storageState({ path: AUTH_PATH });
      }
    }

async function runPipeline(pipelineUrl, taskName = 'Pipeline') {
  console.log(`🚀 [${taskName}] 启动自动化流程...`);
  
  const config = getConfig();
  // 优先读取环境变量，其次读取配置文件，默认 false
  const headless = process.env.HEADLESS === 'true' || (config && config.headless === true);
  console.log(`⚙️ [${taskName}] Headless模式: ${headless ? '开启' : '关闭'}`);
  
  const browser = await chromium.launch({ headless: headless });
  
  let contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };
  
  if (fs.existsSync(AUTH_PATH)) {
    contextOptions.storageState = AUTH_PATH;
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
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
    await page.goto(pipelineUrl, { waitUntil: 'networkidle' });

    if (page.url().includes('auth.huaweicloud.com')) {
      console.log(`⚠️ [${taskName}] 需要登录...`);
      const iamSwitchBtn = page.locator('#IAMLinkDiv').first();
      if (await iamSwitchBtn.isVisible()) {
        await iamSwitchBtn.click({ force: true });
        await page.waitForTimeout(1000);
      }

      const creds = config ? config.credentials : null;
      if (creds) {
        await page.locator('#IAMAccountInputId').first().fill(creds.tenant, { force: true });
        await page.locator('#IAMUsernameInputId').first().fill(creds.username, { force: true });
        await page.locator('#IAMPasswordInputId').first().fill(creds.password, { force: true });
        await page.click('#btn_submit', { force: true });
        await page.waitForURL(url => url.href.includes('cicd/project'), { timeout: 300000 });
        await context.storageState({ path: AUTH_PATH });
      }
    }

    console.log(`🔍 [${taskName}] 寻找【执行】按钮...`);
    await page.waitForTimeout(2000);
    const runBtn = page.locator('button:has-text("执行"), .run-btn, button:has-text("运行")').first();
    await runBtn.waitFor({ state: 'visible', timeout: 15000 });
    await runBtn.click({ force: true });
    
    // 增加等待，给弹窗渲染时间，避免立即进入重试逻辑
    await page.waitForTimeout(2000);

    console.log(`⏳ [${taskName}] 正在处理确认弹窗与重试逻辑 (API 监控模式)...`);
    
    // 增强的选择器列表
    const confirmSelectors = [
      '.devui-modal-container button:has-text("确定")',
      '.devui-modal-container button:has-text("确认")',
      '.modal-footer button:has-text("确定")',
      '.modal-footer button:has-text("确认")',
      'd-button[content="确定"]', // DevUI 特有
      'button:has-text("确定")',
      'button:has-text("确认")'
    ];
    
    let confirmed = false;
    let retryCount = 0;
    const MAX_RETRIES = 50;

    while (retryCount < MAX_RETRIES) {
      // 0. 检查是否已经跳转成功 (URL 包含 pipeline-runs/detail)
      if (page.url().includes('pipeline-runs/detail')) {
         console.log(`🎯 [${taskName}] 检测到页面已跳转，启动成功`);
         confirmed = true;
         break;
      }

      const runResponsePromise = page.waitForResponse(response => 
        response.url().includes('/run') && response.request().method() === 'POST',
        { timeout: 10000 }
      ).catch(() => null);

      let clicked = false;
      
      // 1. 尝试 Playwright 选择器点击 (弹窗确定)
      for (const selector of confirmSelectors) {
        // 只查找可见的按钮
        const btn = page.locator(selector).filter({ hasText: /确定|确认/ }).first();
        if (await btn.isVisible()) { 
          console.log(`👆 [${taskName}] 尝试点击弹窗按钮: ${selector}`);
          await btn.click({ force: true }); 
          clicked = true; 
          break; 
        }
      }

      if (!clicked) {
        // 2. 尝试 JS 暴力点击 (弹窗确定)
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
        if (clicked) console.log(`👆 [${taskName}] 触发 JS 暴力点击 (弹窗)`);
      }

      // 3. 如果没点到弹窗确定，尝试点击主界面的“执行”按钮 (重试点击)
      if (!clicked) {
         const runBtn = page.locator('button:has-text("执行"), .run-btn, button:has-text("运行")').first();
         if (await runBtn.isVisible()) {
             console.log(`👆 [${taskName}] 未发现弹窗，重试点击“执行”按钮...`);
             await runBtn.click({ force: true });
             // 这里不标记 clicked = true，因为我们希望继续等待响应，或者下一轮继续尝试
         }
      }

      const response = await runResponsePromise;
      if (response) {
        try {
          const data = await response.json();
          const result = data.result || data;
          const errorCode = data.error_code || (data.error && data.error.code);
          
          if (result.pipeline_run_id || result.id) {
            console.log(`🎯 [${taskName}] 启动成功 (RunID: ${result.pipeline_run_id || result.id})`);
            confirmed = true;
            break;
          } 
          
          if (errorCode === 'DEVPIPE.00011104' || errorCode === 'DEVPIPE.00011105') {
            retryCount++;
            console.log(`⚠️ [${taskName}] 并发受限 (${errorCode})，正在进行第 ${retryCount}/${MAX_RETRIES} 次重试...`);
            await page.waitForTimeout(10000);
            continue;
          }

          if (errorCode) {
            console.error(`❌ [${taskName}] 流水线启动异常 (错误码: ${errorCode})，请用户自查。`);
            reportData.status = `STARTUP_ERROR (${errorCode})`;
            break; 
          }
        } catch (e) {}
      } else {
        // 响应超时，不盲目信任，继续重试
        console.log(`⚠️ [${taskName}] 等待响应超时，准备重试...`);
      }
      retryCount++;
      await page.waitForTimeout(2000);
    }

    if (confirmed) {
      console.log(`🎉 [${taskName}] 流水线已启动，开始监听运行状态...`);
      const finalResult = await new Promise((resolve, reject) => {
        let lastStatus = 'WAITING';
        const timeout = setTimeout(() => reject(new Error('监控超时')), 1800000);
        page.on('response', async response => {
          if (response.url().includes('pipeline-runs/detail')) {
            try {
              const data = await response.json();
              const result = data.result || data;
              const status = result.status;
              if (status) {
                if (lastStatus === 'WAITING' && (status === 'COMPLETED' || status === 'FAILED')) return;
                if (result.start_time) reportData.startTime = result.start_time;
                if (result.update_time) reportData.updateTime = result.update_time;
                
                // 提取额外信息
                if (result.pipeline_run_id || result.id) reportData.runId = result.pipeline_run_id || result.id;
                if (result.executor_name) reportData.executor = result.executor_name;
                
                // 构造跳转链接
                if (reportData.runId !== 'N/A') {
                    try {
                        const urlObj = new URL(pipelineUrl);
                        const host = urlObj.host;
                        const projectId = result.project_id;
                        const pipelineId = result.pipeline_id;
                        const runId = reportData.runId;
                        
                        if (projectId && pipelineId && runId) {
                            reportData.detailUrl = `https://${host}/cicd/project/${projectId}/pipeline/detail/${pipelineId}/${runId}?v=1`;
                        }
                    } catch (e) {
                        console.warn(`⚠️ [${taskName}] 构造详情链接失败: ${e.message}`);
                    }
                }

                if (status !== lastStatus) { 
                  lastStatus = status; 
                  let color = '\x1b[0m';
                  if (status === 'RUNNING' || status === 'INIT') color = '\x1b[33m'; // Yellow
                  else if (status === 'COMPLETED') color = '\x1b[32m'; // Green
                  else if (status === 'FAILED') color = '\x1b[31m'; // Red
                  console.log(`📊 [${taskName}] 状态: ${color}${status}\x1b[0m`); 
                }
                if (status === 'COMPLETED' || status === 'FAILED' || status === 'ABORTED') {
                  reportData.status = status;
                  clearTimeout(timeout);
                  setTimeout(() => resolve(reportData), 1000);
                }
              }
            } catch (e) {}
          }
        });
      });
      return finalResult;
    } else {
      if (reportData.status === 'UNKNOWN') reportData.status = 'RETRY_LIMIT_EXCEEDED';
      return reportData;
    }
  } catch (error) {
    console.error(`❌ [${taskName}] 错误:`, error.message);
    reportData.status = 'ERROR';
    return reportData;
  } finally {
    await browser.close();
  }
}

module.exports = { runPipeline };
if (require.main === module) { runPipeline(process.argv[2]); }

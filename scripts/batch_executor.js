const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./run_pipeline');

// ==================== 路径配置 ====================
const BASE_DIR = process.env.PROJECT_ROOT || process.cwd();
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const ENV_NAME = process.env.ENV_NAME || 'default';

// ==================== 日志模块 (与 run_pipeline 保持一致) ====================
function log(level, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const icons = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌' };
  const colors = { INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };
  const reset = '\x1b[0m';
  console.log(`${colors[level] || ''}${icons[level] || ''} [${timestamp}] [Batch]${reset} ${message}`);
}

function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

async function batchExecute() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    log('ERROR', '请提供要执行的流水线名称');
    process.exit(1);
  }

  // ============ 读取配置 ============
  let fullConfig;
  try {
    fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    log('ERROR', `无法读取配置文件: ${e.message}`);
    process.exit(1);
  }

  // 兼容新旧配置格式
  let envConfig;
  if (fullConfig.envs && fullConfig.envs[ENV_NAME]) {
    envConfig = fullConfig.envs[ENV_NAME];
  } else if (fullConfig.credentials) {
    // 旧版扁平格式回退
    log('WARN', '检测到旧版配置格式，建议迁移到 envs 结构');
    envConfig = {
      credentials: fullConfig.credentials,
      pipelines: fullConfig.pipelines || {}
    };
  }

  if (!envConfig) {
    log('ERROR', `找不到环境 [${ENV_NAME}] 的配置`);
    if (fullConfig.envs) {
      console.log('可用环境:', Object.keys(fullConfig.envs).join(', '));
    }
    process.exit(1);
  }

  // ============ 匹配流水线 ============
  const taskEntries = [];
  for (const key of args) {
    let url;
    if (key.includes('/')) {
      const [group, name] = key.split('/');
      url = envConfig.pipelines[group] ? envConfig.pipelines[group][name] : null;
    } else {
      url = envConfig.pipelines[key];
    }

    if (url) {
      log('INFO', `📌 匹配到 [${key}]: ${url}`);
      taskEntries.push({ name: key, url });
    } else {
      log('WARN', `配置文件中未找到 [${key}]，跳过`);
    }
  }

  if (taskEntries.length === 0) {
    log('ERROR', '没有匹配到任何有效的流水线');
    process.exit(1);
  }

  // ============ P1优化：共享浏览器实例 ============
  const headless = process.env.HEADLESS === 'true' ||
    (fullConfig.global && fullConfig.global.headless === true) ||
    fullConfig.headless === true;

  log('INFO', `🚀 正在启动共享浏览器 (Headless: ${headless ? '开启' : '关闭'})...`);
  const browser = await chromium.launch({ headless });
  log('INFO', `🚀 并行拉起 ${taskEntries.length} 条流水线...`);

  try {
    // 并行执行，传入共享浏览器
    const results = await Promise.all(
      taskEntries.map(entry =>
        runPipeline(entry.url, entry.name, { browser })
          .catch(err => {
            log('ERROR', `[${entry.name}] 执行异常: ${err.message}`);
            return {
              name: entry.name,
              status: 'ERROR',
              startTime: 0,
              updateTime: 0,
              runId: 'N/A',
              executor: 'N/A',
              detailUrl: entry.url
            };
          })
      )
    );

    // ============ 控制台报告 ============
    console.log('\n\x1b[36m%s\x1b[0m', '============================================================');
    console.log('\x1b[36m%s\x1b[0m', '                🚀 CodeArts流水线测试完整报告                ');
    console.log('\x1b[36m%s\x1b[0m', '============================================================');

    console.log(String('名称').padEnd(20), String('状态').padEnd(15), String('执行时长').padEnd(15));
    console.log('-'.repeat(60));

    results.forEach(res => {
      let durationStr = 'N/A';
      if (res.startTime && res.updateTime) {
        durationStr = formatDuration(res.updateTime - res.startTime);
      }

      let statusColor = '\x1b[31m'; // 默认红色
      if (res.status === 'COMPLETED') statusColor = '\x1b[32m';
      else if (res.status === 'RUNNING' || res.status === 'INIT') statusColor = '\x1b[33m';
      console.log(
        res.name.padEnd(20),
        `${statusColor}${res.status}\x1b[0m`.padEnd(25),
        durationStr.padEnd(15)
      );
    });

    // ============ Markdown 报告 ============
    const reportId = `RPT_${Date.now()}`;
    const reportDir = path.join(BASE_DIR, 'report');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    const reportFileName = `${reportId}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
    const reportFile = path.join(reportDir, reportFileName);

    const passCount = results.filter(r => r.status === 'COMPLETED').length;
    let mdContent = `# 自动化测试报告\n\n`;
    mdContent += `- **报告ID**: ${reportId}\n`;
    mdContent += `- **生成时间**: ${new Date().toLocaleString()}\n`;
    mdContent += `- **环境**: ${ENV_NAME}\n`;
    mdContent += `- **总用例数**: ${results.length}\n`;
    mdContent += `- **通过率**: ${passCount}/${results.length} (${Math.round(passCount / results.length * 100)}%)\n\n`;

    mdContent += `| 用例名称 | 状态 | 耗时 | RunID | 执行人 | 开始时间 | 结束时间 | 链接 |\n`;
    mdContent += `|---|---|---|---|---|---|---|---|\n`;

    results.forEach(res => {
      const duration = res.startTime && res.updateTime ? formatDuration(res.updateTime - res.startTime) : 'N/A';
      const startTime = res.startTime ? new Date(res.startTime).toLocaleString() : 'N/A';
      const endTime = res.updateTime ? new Date(res.updateTime).toLocaleString() : 'N/A';
      const link = res.detailUrl ? `[跳转](${res.detailUrl})` : 'N/A';
      const statusEmoji = res.status === 'COMPLETED' ? '✅' : (res.status === 'RUNNING' ? '🔄' : '❌');

      mdContent += `| ${res.name} | ${statusEmoji} ${res.status} | ${duration} | ${res.runId || 'N/A'} | ${res.executor || 'N/A'} | ${startTime} | ${endTime} | ${link} |\n`;
    });

    fs.writeFileSync(reportFile, mdContent);
    log('INFO', `📄 报告已生成: ${reportFile}`);

    console.log('\x1b[36m%s\x1b[0m', '============================================================');

    const allSuccess = results.every(r => r.status === 'COMPLETED');
    if (allSuccess) {
      console.log('\x1b[32m%s\x1b[0m', '✅ 结论: 所有测试用例均已通过！');
    } else {
      const failedNames = results.filter(r => r.status !== 'COMPLETED').map(r => r.name).join(', ');
      console.log('\x1b[31m%s\x1b[0m', `❌ 结论: 以下用例未通过: ${failedNames}`);
    }
  } finally {
    // 共享浏览器在此统一关闭
    await browser.close().catch(err => {
      log('WARN', `关闭浏览器时出错: ${err.message}`);
    });
  }
}

batchExecute();

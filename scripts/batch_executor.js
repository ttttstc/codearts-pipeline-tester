const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./run_pipeline');

// 优先使用环境变量 CONFIG_PATH 定位配置文件
const BASE_DIR = process.env.PROJECT_ROOT || process.cwd();
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const ENV_NAME = process.env.ENV_NAME || 'default';

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
    console.error('❌ 错误: 请提供要执行的流水线名称');
    process.exit(1);
  }

  let fullConfig;
  try {
    fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('❌ 错误: 无法读取配置文件 config.json');
    process.exit(1);
  }

  const envConfig = fullConfig.envs ? fullConfig.envs[ENV_NAME] : null;
  if (!envConfig) {
      console.error(`❌ 错误: 找不到环境 [${ENV_NAME}] 的配置`);
      process.exit(1);
  }

  const tasks = [];
  for (const key of args) {
    let url;
    if (key.includes('/')) {
      const [group, name] = key.split('/');
      url = envConfig.pipelines[group] ? envConfig.pipelines[group][name] : null;
    } else {
      url = envConfig.pipelines[key];
    }

    if (url) {
      console.log(`📌 匹配到 [${key}]: ${url}`);
      tasks.push(runPipeline(url, key));
    } else {
      console.warn(`⚠️ 警告: 配置文件中未找到 [${key}]，跳过。`);
    }
  }

  if (tasks.length === 0) {
    console.error('❌ 错误: 没有匹配到任何有效的流水线。');
    process.exit(1);
  }

  console.log(`🚀 正在并行拉起 ${tasks.length} 条流水线...`);
  
  // 收集所有任务结果
  const results = await Promise.all(tasks);

  // 生成报告
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
    
    let statusColor = '\x1b[31m'; // Default Red
    if (res.status === 'COMPLETED') statusColor = '\x1b[32m'; // Green
    else if (res.status === 'RUNNING' || res.status === 'INIT') statusColor = '\x1b[33m'; // Yellow
    console.log(
      res.name.padEnd(20),
      `${statusColor}${res.status}\x1b[0m`.padEnd(25), 
      durationStr.padEnd(15)
    );
  });

  // 生成 Markdown 报告
  const reportId = `RPT_${Date.now()}`;
  const reportDir = path.join(BASE_DIR, 'report');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  
  const reportFileName = `${reportId}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
  const reportFile = path.join(reportDir, reportFileName);
  
  let mdContent = `# 自动化测试报告\n\n`;
  mdContent += `- **报告ID**: ${reportId}\n`;
  mdContent += `- **生成时间**: ${new Date().toLocaleString()}\n`;
  mdContent += `- **总用例数**: ${results.length}\n`;
  mdContent += `- **通过率**: ${results.filter(r => r.status === 'COMPLETED').length}/${results.length}\n\n`;
  
  mdContent += `| 用例名称 | 状态 | 耗时 | RunID | 执行人 | 开始时间 | 结束时间 | 链接 |\n`;
  mdContent += `|---|---|---|---|---|---|---|---|\n`;
  
  results.forEach(res => {
    const duration = res.startTime && res.updateTime ? formatDuration(res.updateTime - res.startTime) : 'N/A';
    const startTime = res.startTime ? new Date(res.startTime).toLocaleString() : 'N/A';
    const endTime = res.updateTime ? new Date(res.updateTime).toLocaleString() : 'N/A';
    const link = res.detailUrl ? `[跳转](${res.detailUrl})` : 'N/A';
    
    mdContent += `| ${res.name} | ${res.status} | ${duration} | ${res.runId || 'N/A'} | ${res.executor || 'N/A'} | ${startTime} | ${endTime} | ${link} |\n`;
  });
  
  fs.writeFileSync(reportFile, mdContent);
  console.log(`\n📄 报告已生成: ${reportFile}`);

  console.log('\x1b[36m%s\x1b[0m', '============================================================');
  
  const allSuccess = results.every(r => r.status === 'COMPLETED');
  if (allSuccess) {
    console.log('\x1b[32m%s\x1b[0m', '✅ 结论: 所有测试用例均已通过！');
  } else {
    console.log('\x1b[31m%s\x1b[0m', '❌ 结论: 部分测试用例未通过，请检查上方报告。');
  }
}

batchExecute();

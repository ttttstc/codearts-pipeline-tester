const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * 路径优化：使用绝对路径模式
 * 确保无论从哪里启动，都能正确定位到项目根目录
 */
const BASE_DIR = __dirname;

// 解析命令行参数
console.log('[DEBUG] launcher.js started');
const args = process.argv.slice(2);
console.log('[DEBUG] args:', args);
const envArg = args.find(arg => arg.startsWith('--env=') || arg === '--env')
  ? (args[args.indexOf('--env') + 1] || args.find(arg => arg.startsWith('--env=')).split('=')[1])
  : args.find(arg => arg.startsWith('env='))?.split('=')[1];

const ENV_NAME = envArg || 'default';
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');
const AUTH_FILE_NAME = envArg ? `auth.${envArg}.json` : 'auth.json';
const AUTH_PATH = path.join(BASE_DIR, 'config', AUTH_FILE_NAME);



const webArg = args.includes('--web');

if (webArg) {
  console.log('[DEBUG] Mode: Web UI. Requiring server.js...');
  try {
    const { startServer } = require('./server');
    console.log('[DEBUG] server.js loaded. preparing to start...');
    // 读取配置端口
    let port = 3000;
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (config.global && config.global.webPort) port = config.global.webPort;
    } catch (e) {
      console.log('[DEBUG] Config read error, using default port 3000');
    }
    console.log('[DEBUG] Calling startServer...');
    startServer(port);
  } catch (err) {
    console.error('[CRITICAL ERROR] Failed to load/start server:', err);
  }
} else {
  // 仅在非 Web 模式下创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  start(rl);
}

async function start(rl) {
  console.log('\n\x1b[36m%s\x1b[0m', '==========================================');
  console.log('\x1b[36m%s\x1b[0m', '   CodeArts流水线自动化测试工具 (v1.3)   ');
  console.log('\x1b[36m%s\x1b[0m', `   当前环境: ${ENV_NAME}`);
  console.log('\x1b[36m%s\x1b[0m', '==========================================');

  // 1. 读取配置
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 错误: 找不到配置文件 config.json!');
    process.exit(1);
  }

  let fullConfig;
  try {
    fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 错误: 无法解析配置文件 config.json');
    process.exit(1);
  }

  // 提取当前环境配置
  const envConfig = fullConfig.envs ? fullConfig.envs[ENV_NAME] : null;
  if (!envConfig) {
    console.error('\x1b[31m%s\x1b[0m', `❌ 错误: 在 config.json 中找不到环境 [${ENV_NAME}] 的配置`);
    console.log('可用环境:', Object.keys(fullConfig.envs || {}).join(', '));
    process.exit(1);
  }

  // 解析流水线配置（支持平铺和分组）
  const allPipelines = {};
  const groups = [];

  if (envConfig.pipelines) {
    Object.entries(envConfig.pipelines).forEach(([key, value]) => {
      if (typeof value === 'string') {
        allPipelines[key] = value;
      } else if (typeof value === 'object') {
        groups.push({ name: key, items: Object.keys(value) });
        Object.entries(value).forEach(([subKey, subValue]) => {
          allPipelines[`${key}/${subKey}`] = subValue;
        });
      }
    });
  }

  const pipelineKeys = Object.keys(allPipelines);

  console.log('\n可用流水线列表:');
  if (groups.length > 0) {
    let globalIdx = 1;
    groups.forEach(group => {
      console.log(`\n📂 ${group.name}:`);
      group.items.forEach(item => {
        console.log(`  ${globalIdx}. ${item}`);
        globalIdx++;
      });
    });
    const ungrouped = pipelineKeys.filter(k => !k.includes('/'));
    if (ungrouped.length > 0) {
      console.log(`\n📂 未分组:`);
      ungrouped.forEach(k => {
        console.log(`  ${pipelineKeys.indexOf(k) + 1}. ${k}`);
      });
    }
  } else {
    pipelineKeys.forEach((key, index) => {
      console.log(`${index + 1}. ${key}`);
    });
  }

  console.log('\nA. 执行全部');
  console.log('Q. 退出');

  rl.question('\n请选择要执行的编号 (多个请用空格分隔): ', (answer) => {
    let selectedNames = [];
    if (answer.toUpperCase() === 'Q') { rl.close(); process.exit(0); }
    if (answer.toUpperCase() === 'A') {
      selectedNames = pipelineKeys;
    } else {
      const choices = answer.split(/\s+/);
      choices.forEach(c => {
        const idx = parseInt(c) - 1;
        if (pipelineKeys[idx]) selectedNames.push(pipelineKeys[idx]);
      });
    }

    if (selectedNames.length === 0) {
      console.log('\x1b[33m%s\x1b[0m', '⚠️ 未选择任何有效用例。');
      start(rl);
      return;
    }

    execute(selectedNames, rl);
  });
}

function execute(keys, rl) {
  console.log('\n\x1b[32m%s\x1b[0m', '🚀 准备执行: ' + keys.join(', '));

  const scriptsDir = path.join(BASE_DIR, 'scripts');
  const batchExecutorPath = path.join(scriptsDir, 'batch_executor.js');

  if (!fs.existsSync(batchExecutorPath)) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 错误: 找不到脚本文件 scripts/batch_executor.js');
    start(rl);
    return;
  }

  const env = {
    ...process.env,
    PROJECT_ROOT: BASE_DIR,
    ENV_NAME: ENV_NAME,
    AUTH_PATH: AUTH_PATH
  };

  const headlessArg = args.find(arg => arg === '--headless' || arg.startsWith('headless='));
  if (headlessArg) {
    if (headlessArg === '--headless') {
      env.HEADLESS = 'true';
    } else {
      const val = headlessArg.split('=')[1];
      if (val === 'true') env.HEADLESS = 'true';
    }
  }

  // 直接在 scripts 目录执行，不再拷贝文件
  const child = spawn('node', ['batch_executor.js', ...keys], {
    cwd: scriptsDir,
    stdio: 'inherit',
    shell: true,
    env: env
  });

  child.on('close', (code) => {
    console.log('\n\x1b[36m%s\x1b[0m', '==========================================');
    console.log('\x1b[32m%s\x1b[0m', '🏁 执行完毕 (退出码: ' + code + ')');
    console.log('\x1b[36m%s\x1b[0m', '==========================================');
    start(rl);
  });
}

start();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * 路径优化：使用绝对路径模式
 * 确保无论从哪里启动，都能正确定位到项目根目录
 */
const BASE_DIR = __dirname; 
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'config.json');

// 动态定位 Playwright 依赖目录
let SKILL_DIR = path.join(BASE_DIR, 'node_modules');
if (!fs.existsSync(path.join(SKILL_DIR, 'playwright'))) {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  SKILL_DIR = path.join(homeDir, '.config', 'opencode', 'skill', 'playwright-browser');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function start() {
  console.log('\n\x1b[36m%s\x1b[0m', '==========================================');
  console.log('\x1b[36m%s\x1b[0m', '   CodeArts流水线自动化测试工具 (v1.1)   ');
  console.log('\x1b[36m%s\x1b[0m', '==========================================');

  // 1. 读取配置
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 错误: 找不到配置文件!');
    console.error('\x1b[33m%s\x1b[0m', '预期路径: ' + CONFIG_PATH);
    console.error('\x1b[33m%s\x1b[0m', '当前工作目录: ' + process.cwd());
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 错误: 无法解析配置文件 ' + CONFIG_PATH);
    process.exit(1);
  }

  const pipelineKeys = Object.keys(config.pipelines);
  
  console.log('\n可用流水线列表:');
  pipelineKeys.forEach((key, index) => {
    console.log(`${index + 1}. ${key}`);
  });
  console.log('A. 执行全部');
  console.log('Q. 退出');

  rl.question('\n请选择要执行的编号 (多个请用空格分隔): ', (answer) => {
    let selectedKeys = [];
    if (answer.toUpperCase() === 'Q') { rl.close(); process.exit(0); }
    if (answer.toUpperCase() === 'A') {
      selectedKeys = pipelineKeys;
    } else {
      const choices = answer.split(/\s+/);
      choices.forEach(c => {
        const idx = parseInt(c) - 1;
        if (pipelineKeys[idx]) selectedKeys.push(pipelineKeys[idx]);
      });
    }

    if (selectedKeys.length === 0) {
      console.log('\x1b[33m%s\x1b[0m', '⚠️ 未选择任何有效用例。');
      start();
      return;
    }

    execute(selectedKeys);
  });
}

function execute(keys) {
  console.log('\n\x1b[32m%s\x1b[0m', '🚀 准备执行: ' + keys.join(', '));
  
  try {
    if (!fs.existsSync(SKILL_DIR)) fs.mkdirSync(SKILL_DIR, { recursive: true });
    
    // 确保源文件存在
    const runPipelineSrc = path.join(BASE_DIR, 'scripts', 'run_pipeline.js');
    const batchExecutorSrc = path.join(BASE_DIR, 'scripts', 'batch_executor.js');
    
    if (!fs.existsSync(runPipelineSrc)) {
        throw new Error(`找不到脚本文件: ${runPipelineSrc}`);
    }
    if (!fs.existsSync(batchExecutorSrc)) {
        throw new Error(`找不到脚本文件: ${batchExecutorSrc}`);
    }

    fs.copyFileSync(runPipelineSrc, path.join(SKILL_DIR, 'run_pipeline.js'));
    fs.copyFileSync(batchExecutorSrc, path.join(SKILL_DIR, 'batch_executor.js'));
  } catch (e) {
    console.error('\x1b[31m%s\x1b[0m', '❌ 环境同步失败: ' + e.message);
    start();
    return;
  }

  // 传递 BASE_DIR 给子进程，以便它们也能找到 config.json
  const env = { ...process.env, PROJECT_ROOT: BASE_DIR };
  
  // 传递 HEADLESS 环境变量
  const args = process.argv.slice(2);
  const headlessArg = args.find(arg => arg === '--headless' || arg.startsWith('headless='));
  if (headlessArg) {
    if (headlessArg === '--headless') {
      env.HEADLESS = 'true';
    } else {
      const val = headlessArg.split('=')[1];
      if (val === 'true') env.HEADLESS = 'true';
    }
  }

  const child = spawn('node', ['batch_executor.js', ...keys], {
    cwd: SKILL_DIR,
    stdio: 'inherit',
    shell: true,
    env: env
  });

  child.on('close', (code) => {
    console.log('\n\x1b[36m%s\x1b[0m', '==========================================');
    console.log('\x1b[32m%s\x1b[0m', '🏁 执行完毕 (退出码: ' + code + ')');
    console.log('\x1b[36m%s\x1b[0m', '==========================================');
    start(); // 重新开始循环
  });
}

start();

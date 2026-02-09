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
const args = process.argv.slice(2);
const envArg = args.find(arg => arg.startsWith('--env=') || arg === '--env') 
               ? (args[args.indexOf('--env') + 1] || args.find(arg => arg.startsWith('--env=')).split('=')[1])
               : args.find(arg => arg.startsWith('env='))?.split('=')[1];

const ENV_NAME = envArg || 'default';
const CONFIG_FILE_NAME = envArg ? `config.${envArg}.json` : 'config.json';
const AUTH_FILE_NAME = envArg ? `auth.${envArg}.json` : 'auth.json';

const CONFIG_PATH = path.join(BASE_DIR, 'config', CONFIG_FILE_NAME);
const AUTH_PATH = path.join(BASE_DIR, 'config', AUTH_FILE_NAME);

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
  console.log('\x1b[36m%s\x1b[0m', '   CodeArts流水线自动化测试工具 (v1.2)   ');
  console.log('\x1b[36m%s\x1b[0m', `   当前环境: ${ENV_NAME} (${CONFIG_FILE_NAME})`);
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

  // 解析流水线配置（支持平铺和分组）
  const allPipelines = {};
  const groups = [];
  
  if (config.pipelines) {
    Object.entries(config.pipelines).forEach(([key, value]) => {
      if (typeof value === 'string') {
        // 平铺模式
        allPipelines[key] = value;
      } else if (typeof value === 'object') {
        // 分组模式
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
    // 按分组显示
    let globalIdx = 1;
    groups.forEach(group => {
      console.log(`\n📂 ${group.name}:`);
      group.items.forEach(item => {
        console.log(`  ${globalIdx}. ${item}`);
        globalIdx++;
      });
    });
    // 显示未分组的
    const ungrouped = pipelineKeys.filter(k => !k.includes('/'));
    if (ungrouped.length > 0) {
      console.log(`\n📂 未分组:`);
      ungrouped.forEach(k => {
        console.log(`  ${pipelineKeys.indexOf(k) + 1}. ${k}`);
      });
    }
  } else {
    // 传统平铺显示
    pipelineKeys.forEach((key, index) => {
      console.log(`${index + 1}. ${key}`);
    });
  }
  
  console.log('\nA. 执行全部');
  console.log('Q. 退出');

  rl.question('\n请选择要执行的编号 (多个请用空格分隔): ', (answer) => {
    let selectedKeys = [];
    if (answer.toUpperCase() === 'Q') { rl.close(); process.exit(0); }
    if (answer.toUpperCase() === 'A') {
      selectedKeys = pipelineKeys.map(k => allPipelines[k]);
    } else {
      const choices = answer.split(/\s+/);
      choices.forEach(c => {
        const idx = parseInt(c) - 1;
        const key = pipelineKeys[idx];
        if (key) selectedKeys.push(allPipelines[key]);
      });
    }

    if (selectedKeys.length === 0) {
      console.log('\x1b[33m%s\x1b[0m', '⚠️ 未选择任何有效用例。');
      start();
      return;
    }

    // 注意：execute 现在接收的是 URL 列表，或者我们需要修改 execute 逻辑
    // 为了保持 batch_executor.js 的逻辑，我们应该传递“名称”而不是 URL
    // 但 batch_executor.js 内部会去读 config.json。
    // 如果我们支持分组，batch_executor.js 也得改。
    
    // 重新考虑：传递给 batch_executor.js 的应该是“全名”（含分组前缀）
    const selectedNames = [];
    if (answer.toUpperCase() === 'A') {
        selectedNames.push(...pipelineKeys);
    } else {
        const choices = answer.split(/\s+/);
        choices.forEach(c => {
            const idx = parseInt(c) - 1;
            if (pipelineKeys[idx]) selectedNames.push(pipelineKeys[idx]);
        });
    }
    execute(selectedNames);
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
  const env = { 
    ...process.env, 
    PROJECT_ROOT: BASE_DIR,
    CONFIG_PATH: CONFIG_PATH,
    AUTH_PATH: AUTH_PATH
  };
  
  // 传递 HEADLESS 环境变量
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

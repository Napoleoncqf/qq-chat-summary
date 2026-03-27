/**
 * Interactive CLI setup wizard for QQ Chat Summary Bot.
 * Generates a .env file from user input.
 *
 * Usage: npm run setup
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

const ENV_PATH = path.resolve(__dirname, '../.env');
const DANGEROUS_CHARS = /[\r\n`"'\\$]/g;

function sanitize(input: string): string {
  return input.replace(DANGEROUS_CHARS, '').trim();
}

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` (默认: ${defaultVal})` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => {
      const val = answer.trim();
      resolve(val || defaultVal || '');
    });
  });
}

function askChoice(rl: readline.Interface, question: string, options: string[], defaultIdx = 0): Promise<string> {
  const optStr = options.map((o, i) => i === defaultIdx ? `[${o}]` : o).join(' / ');
  return new Promise(resolve => {
    rl.question(`${question} (${optStr}): `, answer => {
      const val = answer.trim().toLowerCase();
      const matched = options.find(o => o.toLowerCase() === val);
      resolve(matched || options[defaultIdx]);
    });
  });
}

interface GroupConfig {
  groupId: string;
  sendMode: 'group' | 'private';
  schedule: '3x' | 'daily';
}

async function collectGroups(rl: readline.Interface): Promise<GroupConfig[]> {
  console.log('\n--- 群聊配置 ---');
  const groups: GroupConfig[] = [];

  while (true) {
    const groupId = sanitize(await ask(rl, `\n请输入群号${groups.length > 0 ? '（留空结束添加）' : ''}`));
    if (!groupId) {
      if (groups.length === 0) {
        console.log('  至少需要一个群号！');
        continue;
      }
      break;
    }

    if (!/^\d+$/.test(groupId)) {
      console.log('  群号必须是纯数字，请重新输入');
      continue;
    }

    const sendMode = await askChoice(rl, '  总结发送到哪里？ group=发到群里, private=私聊发给你', ['group', 'private'], 0) as 'group' | 'private';
    const schedule = await askChoice(rl, '  总结频率？ 3x=每天3次(7:30/17:30/22:30), daily=每天1次(17:30)', ['3x', 'daily'], 0) as '3x' | 'daily';

    groups.push({ groupId, sendMode, schedule });
    console.log(`  已添加: 群${groupId} → ${sendMode === 'group' ? '发群里' : '私聊'}, ${schedule === '3x' ? '每天3次' : '每天1次'}`);
  }

  return groups;
}

function formatGroupIds(groups: GroupConfig[]): string {
  return groups.map(g => {
    if (g.sendMode === 'group' && g.schedule === 'daily') return `${g.groupId}:group:daily`;
    if (g.sendMode === 'group') return `${g.groupId}:group`;
    if (g.schedule === 'daily') return `${g.groupId}:private:daily`;
    return g.groupId;
  }).join(',');
}

async function main() {
  console.log('========================================');
  console.log('  QQ Chat Summary Bot - 配置向导');
  console.log('========================================');

  // Check existing .env
  if (fs.existsSync(ENV_PATH)) {
    console.log(`\n检测到已有配置文件: ${ENV_PATH}`);
    const rl = createRL();
    const overwrite = await askChoice(rl, '是否覆盖？', ['y', 'n'], 1);
    if (overwrite === 'n') {
      console.log('已取消。');
      rl.close();
      process.exit(0);
    }
    rl.close();
  }

  const rl = createRL();

  // === Required fields ===
  const groups = await collectGroups(rl);
  const targetGroupIds = formatGroupIds(groups);

  console.log('\n--- API 配置 ---');
  const geminiApiKey = sanitize(await ask(rl, '请输入 Gemini API Key'));
  if (!geminiApiKey) {
    console.log('Gemini API Key 是必填项！');
    rl.close();
    process.exit(1);
  }

  // === Optional: NapCat ===
  console.log('\n--- NapCat 连接（通常不需要改） ---');
  const onebotHttpUrl = sanitize(await ask(rl, 'NapCat HTTP 地址', 'http://127.0.0.1:3000'));
  const onebotWsUrl = sanitize(await ask(rl, 'NapCat WebSocket 地址', 'ws://127.0.0.1:3001'));
  const onebotToken = sanitize(await ask(rl, 'NapCat AccessToken（没设置过就留空）', ''));

  // === Optional: Advanced ===
  const wantAdvanced = await askChoice(rl, '\n是否配置高级选项？(模型、备用LLM等)', ['y', 'n'], 1);

  let geminiModel = 'gemini-3-flash-preview';
  let botQq = '';
  let llmApiKey = '';
  let llmBaseUrl = 'https://api.siliconflow.cn/v1';
  let llmModel = 'deepseek-ai/DeepSeek-V3';

  if (wantAdvanced === 'y') {
    console.log('\n--- 高级选项 ---');
    geminiModel = sanitize(await ask(rl, 'Gemini 模型', geminiModel));
    botQq = sanitize(await ask(rl, '机器人 QQ 号（留空自动获取）', ''));
    llmApiKey = sanitize(await ask(rl, '备用 LLM API Key（留空不启用）', ''));
    if (llmApiKey) {
      llmBaseUrl = sanitize(await ask(rl, '备用 LLM Base URL', llmBaseUrl));
      llmModel = sanitize(await ask(rl, '备用 LLM 模型', llmModel));
    }
  }

  rl.close();

  // === Build .env content ===
  const lines: string[] = [
    '# QQ Chat Summary Bot - 由配置向导生成',
    `# 生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '# === 必填 ===',
    `TARGET_GROUP_IDS=${targetGroupIds}`,
    `GEMINI_API_KEY=${geminiApiKey}`,
    '',
    '# === NapCat 连接 ===',
    `ONEBOT_HTTP_URL=${onebotHttpUrl}`,
    `ONEBOT_WS_URL=${onebotWsUrl}`,
  ];

  if (onebotToken) lines.push(`ONEBOT_TOKEN=${onebotToken}`);
  else lines.push('# ONEBOT_TOKEN=');

  lines.push('');
  lines.push('# === 可选 ===');
  lines.push(`GEMINI_MODEL=${geminiModel}`);

  if (botQq) lines.push(`BOT_QQ=${botQq}`);
  else lines.push('# BOT_QQ=');

  if (llmApiKey) {
    lines.push(`LLM_API_KEY=${llmApiKey}`);
    lines.push(`LLM_BASE_URL=${llmBaseUrl}`);
    lines.push(`LLM_MODEL=${llmModel}`);
  } else {
    lines.push('# LLM_API_KEY=');
    lines.push('# LLM_BASE_URL=https://api.siliconflow.cn/v1');
    lines.push('# LLM_MODEL=deepseek-ai/DeepSeek-V3');
  }

  lines.push('');
  const content = lines.join('\n');

  // === Write .env ===
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  console.log(`\n配置已写入: ${ENV_PATH}`);

  // === Verify by reading back ===
  const parsed = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf-8'));
  const checks = [
    { key: 'TARGET_GROUP_IDS', expected: targetGroupIds },
    { key: 'GEMINI_API_KEY', expected: geminiApiKey },
    { key: 'ONEBOT_HTTP_URL', expected: onebotHttpUrl },
  ];

  let ok = true;
  for (const { key, expected } of checks) {
    if (parsed[key] !== expected) {
      console.log(`  校验失败: ${key} 写入值不匹配！`);
      ok = false;
    }
  }

  if (ok) {
    console.log('  校验通过 ✓');
  } else {
    console.log('  请手动检查 .env 文件内容');
  }

  // === Summary ===
  console.log('\n========================================');
  console.log('  配置完成！');
  console.log('========================================');
  console.log(`  监控群: ${groups.map(g => g.groupId).join(', ')}`);
  console.log(`  模型: ${geminiModel}`);
  console.log(`  NapCat: ${onebotHttpUrl}`);
  console.log('\n  启动命令: npm run dev');
  console.log('========================================\n');
}

main().catch(err => {
  console.error('配置向导出错:', err.message);
  process.exit(1);
});

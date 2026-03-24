# QQ Chat Summary Bot

QQ 群聊自动总结机器人 -- 基于 NapCat (OneBot v11) + Gemini AI，定时生成群聊摘要卡片、话题评分和群友锐评图片并发送。

![summary](https://img.shields.io/badge/AI-Gemini-blue) ![onebot](https://img.shields.io/badge/Protocol-OneBot%20v11-green) ![ts](https://img.shields.io/badge/Lang-TypeScript-blue)

## Features

- **定时自动总结** -- 支持每日3次（深夜/白天/晚间）或每日1次（前日全天总结）
- **三张卡片输出** -- 话题总结卡 + 话题评分卡 + 群友锐评卡
- **多群支持** -- 逗号分隔群号，每群独立配置发送方式和推送频率
- **串行处理** -- 多群按顺序逐一生成，避免 API 限频
- **明暗主题** -- 根据时段自动切换 light/dark 卡片风格
- **完整消息覆盖** -- 大批量拉取 + 反向分页，确保不遗漏
- **双 LLM 降级** -- Gemini 主力 + DeepSeek 备用，3 次重试
- **零配置启动** -- 群名、机器人QQ 自动获取，只需填群号和 API Key

## Output

每次总结生成 3 张卡片：

| 卡片 | 内容 |
|------|------|
| **总结卡** | 话题摘要 + 活跃排行 + 精华发言 |
| **评分卡** | 话题分布百分比 + 综合评分 + 总评点评 |
| **锐评卡** | 活跃用户诙谐个人点评 |

## Architecture

```
NapCat (OneBot) ──HTTP──▶ Bot ──▶ Gemini/DeepSeek ──▶ Playwright 渲染 ──▶ 发送图片
                          │
                     node-cron 定时触发
```

```
src/
├── index.ts                # 入口，统一 cron 调度
├── cron/
│   └── scheduler.ts        # 总结流水线（拉取→生成→渲染→发送）
├── summary/
│   ├── types.ts            # 数据类型定义
│   ├── prompt.ts           # 总结 / 锐评 / 评分 prompt
│   └── gemini-client.ts    # LLM 调用 (Gemini + DeepSeek fallback)
├── render/
│   └── card-renderer.ts    # EJS → HTML → PNG (Playwright)
├── sender/
│   └── onebot-sender.ts    # OneBot HTTP 发送图片/文字
├── db/
│   └── database.ts         # 消息类型定义
└── utils/
    ├── config.ts           # 环境变量配置
    └── logger.ts           # 日志

templates/
├── card.ejs                # 总结卡片模板
├── breakdown.ejs           # 话题评分卡片模板
└── roast.ejs               # 锐评卡片模板

scripts/
├── manual-trigger.ts       # 手动触发全部群
└── test-single.ts          # 单群测试
```

## Quick Start

### Prerequisites

- Node.js >= 18
- [NapCat](https://github.com/NapNeko/NapCatQQ) 或其他 OneBot v11 实现
- Gemini API Key

### Install

```bash
git clone https://github.com/Napoleoncqf/qq-chat-summary.git
cd qq-chat-summary
npm install
npx playwright install chromium
```

### Configure

复制 `.env.example` 创建 `.env`，只需填两项：

```env
TARGET_GROUP_IDS=123456789          # 多群用逗号分隔
GEMINI_API_KEY=your-gemini-api-key
```

群名、机器人QQ 自动获取，总结默认发送给机器人自己（私聊）。

#### 群号格式

`groupId[:sendMode[:schedule]]`

```env
TARGET_GROUP_IDS=111111111,222222222:group,333333333:group:daily
#                ↑ 发私聊,3次/天  ↑ 发群里,3次/天     ↑ 发群里,1次/天(17:30)
```

| 格式 | 发送方式 | 频率 |
|------|---------|------|
| `123456` | 私聊 | 每日 3 次 |
| `123456:group` | 群聊 | 每日 3 次 |
| `123456:group:daily` | 群聊 | 每日 1 次（17:30 总结前日） |

<details>
<summary>其他可选配置</summary>

```env
ONEBOT_HTTP_URL=http://127.0.0.1:3000   # NapCat 地址
BOT_QQ=                                  # 手动指定机器人QQ（留空自动获取）
GEMINI_MODEL=gemini-3-flash-preview      # Gemini 模型
LLM_API_KEY=                             # 备用 LLM API Key
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=deepseek-ai/DeepSeek-V3
```
</details>

### Run

```bash
# Development
npm run dev

# Production
npm run build && npm start

# PM2
pm2 start ecosystem.config.js
```

### Manual Test

```bash
# 测试第一个群（默认 daytime 时段）
npx tsx scripts/test-single.ts

# 指定群号和时段
npx tsx scripts/test-single.ts 123456 daily
```

## Schedule

| 时间 | 时段 | 覆盖范围 | 群组类型 |
|------|------|---------|---------|
| 07:30 | 深夜总结 | 前日 22:30 → 今日 07:30 | 3x |
| 17:30 | 白天总结 | 今日 07:30 → 17:30 | 3x |
| 17:30 | 每日总结 | 前日 00:00 → 23:59 | daily |
| 22:30 | 晚间总结 | 今日 17:30 → 22:30 | 3x |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **LLM**: Google Gemini (primary) + DeepSeek (fallback)
- **QQ Protocol**: OneBot v11 (NapCat)
- **Rendering**: EJS + Playwright (headless Chromium)
- **Scheduling**: node-cron

## License

ISC

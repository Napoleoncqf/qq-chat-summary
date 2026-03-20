# QQ Chat Summary Bot

QQ 群聊自动总结机器人 -- 基于 NapCat (OneBot v11) + Gemini AI，定时生成群聊摘要卡片和群友锐评图片并发送。

![summary](https://img.shields.io/badge/AI-Gemini-blue) ![onebot](https://img.shields.io/badge/Protocol-OneBot%20v11-green) ![ts](https://img.shields.io/badge/Lang-TypeScript-blue)

## Features

- **三时段自动总结** -- 深夜 (22:30-07:30)、白天 (07:30-17:30)、晚间 (17:30-22:30)
- **多群支持** -- 逗号分隔群号，每群可独立配置发送到群聊或私聊
- **串行处理** -- 多群按顺序逐一生成，避免 API 限频
- **AI 摘要卡片** -- 话题提取、高价值发言、活跃排行、资源链接、质量审核
- **群友锐评** -- 基于聊天内容为活跃用户生成诙谐点评
- **完整消息覆盖** -- 大批量拉取 + 反向分页，确保不遗漏
- **双 LLM 降级** -- Gemini 主力 + DeepSeek 备用，3 次重试
- **精美暗色卡片** -- Playwright 截图渲染，支持自动分页
- **零配置启动** -- 群名、机器人QQ 自动获取，只需填群号和 API Key

## Architecture

```
src/
├── index.ts                # 入口，统一 cron 调度，串行处理多群
├── bot/
│   ├── onebot-client.ts    # WebSocket 连接 NapCat
│   └── message-collector.ts # 消息收集
├── cron/
│   └── scheduler.ts        # 消息拉取 + 总结/锐评 pipeline
├── summary/
│   ├── types.ts            # 数据类型定义
│   ├── prompt.ts           # 总结 & 锐评 prompt
│   └── gemini-client.ts    # LLM 调用 (Gemini + DeepSeek fallback)
├── render/
│   └── card-renderer.ts    # EJS → HTML → PNG (Playwright)
├── sender/
│   └── onebot-sender.ts    # OneBot HTTP 发送图片/文字
├── db/
│   └── database.ts         # SQLite 消息存储
└── utils/
    ├── config.ts           # 环境变量配置
    └── logger.ts           # 日志
templates/
├── card.ejs                # 总结卡片模板
└── roast.ejs               # 锐评卡片模板
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

就这样，可以直接跑了。群名、机器人QQ 自动获取，总结默认发送给机器人自己（私聊）。

#### 每群独立发送模式

群号后加 `:group` 表示发到群里，不加默认发给自己：

```env
TARGET_GROUP_IDS=111111111,222222222:group,333333333:group
#                ↑ 发私聊    ↑ 发群里         ↑ 发群里
```

<details>
<summary>其他可选配置</summary>

```env
# NapCat 地址（默认 http://127.0.0.1:3000）
ONEBOT_HTTP_URL=http://127.0.0.1:3000

# 手动指定机器人QQ（留空自动获取）
BOT_QQ=

# 备用 LLM（Gemini 失败时降级）
LLM_API_KEY=
LLM_BASE_URL=https://api.siliconflow.cn/v1
```
</details>

### Run

```bash
# Development
npm run dev

# Production (PM2)
pm2 start ecosystem.config.js
```

## Schedule

每天 3 个时段自动触发，多群串行处理：

| 时间 | 时段 | 覆盖范围 |
|------|------|---------|
| 07:30 | 深夜总结 | 昨日 22:30 → 今日 07:30 |
| 17:30 | 白天总结 | 今日 07:30 → 今日 17:30 |
| 22:30 | 晚间总结 | 今日 17:30 → 今日 22:30 |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **LLM**: Google Gemini (primary) + DeepSeek (fallback)
- **QQ Protocol**: OneBot v11 (NapCat)
- **Rendering**: EJS + Playwright (headless Chromium)
- **Scheduling**: node-cron
- **Process Manager**: PM2

## License

ISC

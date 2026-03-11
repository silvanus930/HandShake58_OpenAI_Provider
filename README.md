# HS58-OpenAI Provider

AI services provider for the Handshake58 marketplace. Multi-service provider supporting OpenAI chat completions, research, document analysis, and web extraction. Payment via DRAIN protocol.

## Overview

- **OpenAI Chat** — Standard `/v1/chat/completions` API compatible with GPT models
- **AI Research** — Research queries with optional web context
- **Document Analysis** — PDF analysis and insight extraction
- **Data Extraction** — Hybrid extractor for static and JavaScript-rendered web pages

All services require an `X-DRAIN-Voucher` header for payment.

## Installation

```bash
cd providers/hs58-openai
npm install
cp .env.example .env
# Edit .env with your credentials
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `PROVIDER_PRIVATE_KEY` | Yes | Polygon wallet private key (hex, 0x...) |
| `PORT` | No | Server port (default: 3000) |
| `PROVIDER_WALLET` | No | Provider wallet address (optional) |
| `CHAIN_ID` | No | 137 (Polygon) or 80002 (Amoy testnet) |
| `CACHE_TTL` | No | Redis cache TTL in seconds (default: 3600) |
| `RATE_LIMIT_MAX` | No | Max requests per window (default: 100) |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window in ms (default: 60000) |
| `REDIS_URL` | No | Optional Redis URL for caching |
| `MARKETPLACE_URL` | No | Handshake58 marketplace URL |
| `TELEGRAM_BOT_TOKEN` | No | Bot token for traffic notifications |
| `TELEGRAM_CHAT_ID` | No | Chat ID to receive notifications |

## Monitoring

### Telegram traffic notifications

Get push notifications on your phone when paid traffic occurs. Messages are batched (every 60s or 10 requests) to avoid spam.

1. Create a bot: message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Get your chat ID: message [@userinfobot](https://t.me/userinfobot)
3. Set env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

### Other options

| Tool | Purpose |
|------|---------|
| [UptimeRobot](https://uptimerobot.com) | Free uptime monitoring, alerts on downtime |
| [Better Uptime](https://betteruptime.com) | Uptime + incident management |
| [Healthchecks.io](https://healthchecks.io) | Cron job pings, alerts if missed |
| Railway metrics | Built-in if deployed on Railway |
| `GET /health` | Manual or automated health checks |

## Available Services

| Service | Route | Method | Description |
|---------|-------|--------|-------------|
| AI Research | `/v1/research` | POST | AI-powered research queries |
| Document Analysis | `/v1/document` | POST | PDF analysis and insight extraction |
| Data Extraction | `/v1/extract` | POST | Web page extraction (static + dynamic) |

Discover services programmatically: `GET /services`

## Example Requests

### Research
```bash
curl -X POST http://localhost:3000/v1/research \
  -H "Content-Type: application/json" \
  -H "X-DRAIN-Voucher: '{\"channelId\":\"...\",\"amount\":\"...\",\"nonce\":\"...\",\"signature\":\"...\"}'" \
  -d '{"query": "AI regulation in Europe"}'
```

### Document Analysis
```bash
curl -X POST http://localhost:3000/v1/document \
  -H "X-DRAIN-Voucher: '{\"channelId\":\"...\",\"amount\":\"...\",\"nonce\":\"...\",\"signature\":\"...\"}'" \
  -F "file=@document.pdf"
```

### Web Extraction
```bash
curl -X POST http://localhost:3000/v1/extract \
  -H "Content-Type: application/json" \
  -H "X-DRAIN-Voucher: '{\"channelId\":\"...\",\"amount\":\"...\",\"nonce\":\"...\",\"signature\":\"...\"}'" \
  -d '{"url": "https://example.com"}'
```

## Documentation

Interactive API documentation (Swagger UI) is available at:

**http://localhost:3000/docs**

## Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "provider": "0x...",
  "providerName": "HS58-OpenAI"
}
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /docs` | Swagger UI documentation |
| `GET /services` | List available services with metadata |
| `GET /health` | Health check |
| `GET /v1/models` | List models |
| `GET /v1/pricing` | View pricing |
| `POST /v1/chat/completions` | OpenAI-compatible chat (requires X-DRAIN-Voucher) |
| `POST /v1/research` | AI research (requires X-DRAIN-Voucher) |
| `POST /v1/document` | Document analysis (requires X-DRAIN-Voucher) |
| `POST /v1/extract` | Web extraction (requires X-DRAIN-Voucher) |

## Deployment

Deploy to Railway with root directory `providers/hs58-openai`. Set environment variables in the Variables tab. Register your provider at [handshake58.com/become-provider](https://handshake58.com/become-provider).

# Solana Memecoin Monitor

⚠️ **IMPORTANT RISK WARNING** ⚠️

**This tool is for educational and research purposes only. Monitoring memecoins involves extremely high risk. DO NOT use this tool to make investment decisions. DO NOT engage in market manipulation. This tool does not provide trading advice or buy/sell recommendations. Memecoins are highly speculative and can result in total loss of investment.**

## Overview

A production-ready tool that monitors newly created and active memecoins on Solana, scores them for basic risks, and sends **Telegram alerts only when volume or liquidity thresholds are met**.

## Key Features

- **Real-time monitoring** of new token mints on Solana via WebSocket
- **Volume tracking** with cumulative USD trading volume calculation
- **Liquidity monitoring** of LP pools with USD value computation
- **Risk assessment** flags (honeypot, mintable, LP burned, etc.)
- **Telegram alerts** with configurable thresholds and cooldown
- **Zero liquidity filtering** to prevent spam alerts
- **Mock/test mode** for development and testing

## Alert Filtering Rules

**Critical**: Alerts are sent ONLY when:
- Token liquidity (USD) is **NOT zero**, AND
- **Either** cumulative volume ≥ `VOLUME_THRESHOLD_USD` (default: $50,000)
- **Or** liquidity ≥ `LIQUIDITY_THRESHOLD_USD` (default: $2,000)

## Installation

### Prerequisites
- Node.js 18+ 
- Telegram bot token and chat ID
- Solana RPC endpoint (WebSocket enabled)
- Optional: Pump.fun API key, GMGN API key

### Setup

1. Clone and install dependencies:
```bash
git clone <your-repo>
cd solana-memecoin-monitor
npm install
```

2. Configure environment:
```bash
cp config/config.example.json config/config.json
# Edit config/config.json with your settings
```

3. Set environment variables:
```bash
# Required
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
export SOLANA_RPC_WS="wss://your-rpc-endpoint"
export SOLANA_RPC_HTTP="https://your-rpc-endpoint"

# Optional
export PUMPPORTAL_KEY="your_pump_key"
export GMGN_KEY="your_gmgn_key"
```

## Configuration

All thresholds and settings are configurable in `config/config.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `VOLUME_THRESHOLD_USD` | 50000 | Minimum cumulative volume for alert |
| `LIQUIDITY_THRESHOLD_USD` | 2000 | Minimum liquidity for alert |
| `ALERT_COOLDOWN_SECONDS` | 3600 | Cooldown between alerts for same token |
| `MONITOR_MODE` | "since_first_trade" | Volume calculation mode |

## Usage

### Start monitoring:
```bash
npm start
```

### Test mode with mock data:
```bash
npm run test-mock
```

### Run unit tests:
```bash
npm test
```

## Alert Message Format

```
🚨 NEW MEME TOKEN: RocketDog (mint: ABc123...)
Flags: honeypot ⚠️ | mintable ✅ | LP not found ❌
Volume: $52,300
Liquidity: $1,800
Pump.fun page: https://pump.fun/coin/1234
GMGN: https://gmgn.ai/...
Quick notes: Cumulative volume threshold reached
```

## Architecture

- `src/monitor.js` - Main monitoring service
- `src/volume-tracker.js` - Volume and liquidity calculation
- `src/risk-assessor.js` - Token safety checks
- `src/telegram-bot.js` - Alert system
- `src/price-feeds.js` - USD conversion utilities
- `tests/` - Comprehensive test suite

## API Integrations

- **Solana RPC**: Real-time transaction monitoring
- **Price APIs**: CoinGecko, Jupiter for USD conversion
- **Pump.fun**: Token metadata and pages
- **GMGN**: Additional token information

## Security Considerations

- All API keys should be stored as environment variables
- No credentials are logged or exposed
- Rate limiting implemented for all external APIs
- WebSocket reconnection handling for reliability

## Development

### Project Structure
```
solana-memecoin-monitor/
├── src/
│   ├── monitor.js          # Main entry point
│   ├── volume-tracker.js   # Volume/liquidity calculation
│   ├── risk-assessor.js    # Safety checks
│   ├── telegram-bot.js     # Alert system
│   ├── price-feeds.js      # USD conversion
│   └── utils/
├── tests/                  # Unit and integration tests
├── config/
│   ├── config.json         # Your settings
│   └── config.example.json # Template
└── README.md
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Troubleshooting

### Common Issues

1. **No alerts received**: Check Telegram bot token and chat ID
2. **WebSocket disconnections**: Verify RPC endpoint supports WebSockets
3. **Price conversion errors**: Ensure price feed APIs are accessible
4. **High false positives**: Adjust volume/liquidity thresholds

### Logs

Enable debug logging:
```bash
DEBUG=solana-monitor:* npm start
```

## License

MIT License - See LICENSE file

## Disclaimer

This software is provided "as is" without warranty of any kind. The authors are not responsible for any financial losses or damages resulting from the use of this tool. Always do your own research and never invest more than you can afford to lose.
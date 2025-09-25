# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a production-ready **Solana Memecoin Monitor** that tracks newly created tokens on Solana, calculates their trading volume and liquidity, performs risk assessment, and sends Telegram alerts when configurable thresholds are met. The system uses WebSocket connections to monitor real-time blockchain activity and filters alerts based on strict criteria to prevent spam.

### Core Architecture

The system follows a modular event-driven architecture with five main components:

1. **Monitor (`src/monitor.js`)** - Main orchestrator that manages WebSocket connections to Solana, processes blockchain events, and coordinates other components
2. **Volume Tracker (`src/volume-tracker.js`)** - Tracks cumulative trading volume and liquidity for tokens, integrates with price feeds
3. **Risk Assessor (`src/risk-assessor.js`)** - Performs security checks (honeypot detection, mint authority analysis, LP token verification)
4. **Telegram Bot (`src/telegram-bot.js`)** - Sends formatted alerts to Telegram when tokens meet threshold criteria
5. **Price Feeds (`src/price-feeds.js`)** - Interfaces with multiple APIs (CoinGecko, Jupiter) for USD price conversion

### Key Business Logic

**Alert Filtering**: Alerts are sent ONLY when:
- Token liquidity (USD) is NOT zero, AND
- EITHER cumulative volume ≥ `VOLUME_THRESHOLD_USD` OR liquidity ≥ `LIQUIDITY_THRESHOLD_USD`
- AND the token is not in cooldown period

**Volume Calculation Modes**:
- `since_first_trade` (default): Tracks cumulative volume from first detected trade
- `24h`: Only counts trades within last 24 hours

## Common Development Commands

### Setup and Installation
```bash
# Initial setup
npm install
cp config/config.example.json config/config.json
# Edit config/config.json with your settings
```

### Running the Application
```bash
# Start monitoring (production)
npm start

# Start with development auto-reload
npm run dev

# Test with mock data (dry run)
npm run test-mock

# Interactive test mode for threshold logic
node tests/mock-runner.js --interactive
```

### Testing and Quality
```bash
# Run unit tests
npm test

# Run specific test file
npm test tests/threshold-logic.test.js

# Lint code
npm run lint

# Format code
npm run format
```

### Development and Debugging
```bash
# Enable debug logging
set DEBUG=solana-monitor:*
npm start

# Run in dry run mode (no alerts sent)
set DRY_RUN=true
npm start

# Mock mode for testing without blockchain connection
set MOCK_MODE=true
npm start
```

## Configuration Management

### Environment Variables (Required)
```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
SOLANA_RPC_HTTP=https://api.mainnet-beta.solana.com
SOLANA_RPC_WS=wss://api.mainnet-beta.solana.com
```

### Key Configuration Files
- `config/config.json` - Main application settings (thresholds, API keys, monitoring parameters)
- `.env` - Environment variables (copy from `.env.example`)
- `package.json` - Dependencies and npm scripts

### Critical Configuration Settings
- `VOLUME_THRESHOLD_USD` (50000) - Minimum cumulative trading volume for alerts
- `LIQUIDITY_THRESHOLD_USD` (2000) - Minimum liquidity pool value for alerts  
- `ALERT_COOLDOWN_SECONDS` (3600) - Prevents duplicate alerts for same token
- `MONITOR_MODE` - Volume calculation method (`since_first_trade` or `24h`)

## Code Architecture Patterns

### WebSocket Event Processing Pipeline
1. **Connection Management**: Auto-reconnection with exponential backoff
2. **Log Subscription**: Monitors Token Program and DEX program logs
3. **Event Classification**: Distinguishes mint events from trade events
4. **Data Extraction**: Parses transaction details to extract token mints and trade amounts
5. **Volume Tracking**: Updates cumulative volume and liquidity data
6. **Alert Evaluation**: Checks threshold conditions and cooldown status

### Component Communication Flow
```
Monitor (WebSocket) → VolumeTracker (Price Data) → RiskAssessor (Security Checks) → TelegramBot (Alerts)
```

### Key Data Structures
- `trackedTokens` Map: tokenMint → {volume, liquidity, discoveredAt, riskFlags}
- `alertedTokens` Map: tokenMint → lastAlertTimestamp (for cooldown tracking)
- Volume calculation uses Big.js for precise decimal arithmetic
- All USD conversions happen through price feed APIs with caching

### Risk Assessment System
The system performs multiple security checks on each token:
- **Mintable Check**: Verifies if mint authority has been renounced
- **Honeypot Detection**: Analyzes supply, decimal places, freeze authority
- **LP Token Verification**: Checks if liquidity provider tokens were burned
- **Holder Concentration**: Monitors whale dominance patterns
- **Transfer Hook Analysis**: Detects suspicious token transfer restrictions

### Error Handling and Resilience
- **Retry Logic**: All external API calls use exponential backoff retry
- **Rate Limiting**: Built-in rate limiters for all price feed APIs
- **Graceful Degradation**: System continues operating if individual components fail
- **WebSocket Reconnection**: Automatic reconnection with subscription restoration
- **Cache Management**: Price and assessment caches with TTL to reduce API load

## Testing Strategy

### Mock Testing System
Use `npm run test-mock` to test alert logic without blockchain connection:
- Simulates tokens with different volume/liquidity combinations
- Tests zero liquidity filtering (critical business rule)
- Validates threshold logic and cooldown behavior
- Interactive mode available for custom test scenarios

### Unit Tests
- Threshold logic tests cover all edge cases
- Mock data generation for consistent testing
- Isolated component testing with dependency injection
- Alert reason generation and message formatting validation

## Development Guidelines

### Adding New Features
1. **DEX Integration**: Add new DEX program IDs to `DEX_PROGRAMS` array in monitor.js
2. **Risk Checks**: Implement new assessment methods in `RiskAssessor` class
3. **Price Sources**: Add new price feed APIs in `price-feeds.js` with rate limiting
4. **Alert Formats**: Modify message templates in `TelegramBot.formatAlertMessage()`

### Database Schema (Redis)
- Token data: TTL 168 hours (7 days)
- Volume data: TTL 72 hours (3 days)  
- Alert history: TTL 24 hours (1 day)

### External API Dependencies
- **Solana RPC**: Primary data source for blockchain events
- **CoinGecko**: SOL/USD price conversion (free tier: 2 RPS limit)
- **Jupiter**: Alternative price aggregation (10 RPS limit)
- **Pump.fun**: Optional token metadata enhancement
- **GMGN**: Optional additional token analytics

### Performance Considerations
- Maximum 10,000 tokens tracked simultaneously (configurable)
- Price updates every 30 seconds (configurable)
- In-memory caching for frequent lookups
- Rate limiting prevents API quota exhaustion
- WebSocket subscriptions scale better than polling

### Deployment Requirements
- Node.js 18+
- Redis server (for persistence)
- Solana RPC endpoint with WebSocket support
- Telegram bot token and chat ID
- Optional: Enhanced RPC endpoints for better reliability (Helius, QuickNode)

## Critical Business Rules

1. **Zero Liquidity Filter**: Never send alerts for tokens with exactly $0 liquidity
2. **Threshold Logic**: Use OR condition between volume and liquidity thresholds
3. **Cooldown Enforcement**: Prevent spam by enforcing per-token alert cooldowns
4. **Price Accuracy**: Always convert to USD using latest price feeds before threshold comparison
5. **Error Recovery**: System must auto-recover from WebSocket disconnections without losing tracked tokens
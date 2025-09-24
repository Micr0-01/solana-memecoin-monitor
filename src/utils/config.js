const fs = require('fs');
const path = require('path');
require('dotenv').config();

class Config {
  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  loadConfig() {
    const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/config.json');
    const exampleConfigPath = path.join(__dirname, '../../config/config.example.json');
    
    let config;
    
    try {
      // Try to load user config first
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log(`✓ Loaded configuration from ${configPath}`);
      } else {
        // Fall back to example config
        console.warn(`⚠️  Config file not found at ${configPath}, using example config`);
        config = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
      }
    } catch (error) {
      console.error(`❌ Failed to load configuration: ${error.message}`);
      process.exit(1);
    }

    // Override with environment variables
    return this.applyEnvironmentOverrides(config);
  }

  applyEnvironmentOverrides(config) {
    // Monitoring settings
    if (process.env.VOLUME_THRESHOLD_USD) {
      config.monitoring.VOLUME_THRESHOLD_USD = parseFloat(process.env.VOLUME_THRESHOLD_USD);
    }
    if (process.env.LIQUIDITY_THRESHOLD_USD) {
      config.monitoring.LIQUIDITY_THRESHOLD_USD = parseFloat(process.env.LIQUIDITY_THRESHOLD_USD);
    }
    if (process.env.ALERT_COOLDOWN_SECONDS) {
      config.monitoring.ALERT_COOLDOWN_SECONDS = parseInt(process.env.ALERT_COOLDOWN_SECONDS);
    }
    if (process.env.MONITOR_MODE) {
      config.monitoring.MONITOR_MODE = process.env.MONITOR_MODE;
    }

    // Solana settings
    if (process.env.SOLANA_RPC_HTTP) {
      config.solana.RPC_HTTP_ENDPOINT = process.env.SOLANA_RPC_HTTP;
    }
    if (process.env.SOLANA_RPC_WS) {
      config.solana.RPC_WS_ENDPOINT = process.env.SOLANA_RPC_WS;
    }

    // Telegram settings
    if (process.env.TELEGRAM_BOT_TOKEN) {
      config.telegram.BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    }
    if (process.env.TELEGRAM_CHAT_ID) {
      config.telegram.CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    }

    // External API keys
    if (process.env.PUMPPORTAL_KEY) {
      config.external_apis.pumpfun.API_KEY = process.env.PUMPPORTAL_KEY;
    }
    if (process.env.GMGN_KEY) {
      config.external_apis.gmgn.API_KEY = process.env.GMGN_KEY;
    }

    // Database
    if (process.env.REDIS_URL) {
      config.database.REDIS_URL = process.env.REDIS_URL;
    }

    // Testing
    if (process.env.MOCK_MODE === 'true') {
      config.testing.MOCK_MODE = true;
    }
    if (process.env.DRY_RUN === 'true') {
      config.testing.DRY_RUN = true;
    }

    return config;
  }

  validateConfig() {
    const required = [
      'monitoring.VOLUME_THRESHOLD_USD',
      'monitoring.LIQUIDITY_THRESHOLD_USD',
      'monitoring.ALERT_COOLDOWN_SECONDS',
      'solana.RPC_HTTP_ENDPOINT',
      'solana.RPC_WS_ENDPOINT'
    ];

    const missing = [];
    
    for (const path of required) {
      if (!this.get(path)) {
        missing.push(path);
      }
    }

    // Check for critical environment variables
    if (!process.env.TELEGRAM_BOT_TOKEN && !this.config.testing.DRY_RUN) {
      console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
      console.error('   Please set your Telegram bot token: export TELEGRAM_BOT_TOKEN="your_token"');
      missing.push('TELEGRAM_BOT_TOKEN');
    }

    if (!process.env.TELEGRAM_CHAT_ID && !this.config.testing.DRY_RUN) {
      console.error('❌ TELEGRAM_CHAT_ID environment variable is required');
      console.error('   Please set your Telegram chat ID: export TELEGRAM_CHAT_ID="your_chat_id"');
      missing.push('TELEGRAM_CHAT_ID');
    }

    if (missing.length > 0) {
      console.error(`❌ Missing required configuration: ${missing.join(', ')}`);
      console.error('   Please check your config file and environment variables');
      process.exit(1);
    }

    // Validate thresholds
    if (this.config.monitoring.VOLUME_THRESHOLD_USD <= 0) {
      console.error('❌ VOLUME_THRESHOLD_USD must be greater than 0');
      process.exit(1);
    }

    if (this.config.monitoring.LIQUIDITY_THRESHOLD_USD <= 0) {
      console.error('❌ LIQUIDITY_THRESHOLD_USD must be greater than 0');
      process.exit(1);
    }

    console.log('✓ Configuration validated successfully');
    console.log(`  Volume Threshold: $${this.config.monitoring.VOLUME_THRESHOLD_USD.toLocaleString()}`);
    console.log(`  Liquidity Threshold: $${this.config.monitoring.LIQUIDITY_THRESHOLD_USD.toLocaleString()}`);
    console.log(`  Alert Cooldown: ${this.config.monitoring.ALERT_COOLDOWN_SECONDS}s`);
  }

  get(path) {
    return path.split('.').reduce((obj, key) => obj && obj[key], this.config);
  }

  getConfig() {
    return this.config;
  }

  // Helper methods for commonly accessed values
  getVolumeThreshold() {
    return this.config.monitoring.VOLUME_THRESHOLD_USD;
  }

  getLiquidityThreshold() {
    return this.config.monitoring.LIQUIDITY_THRESHOLD_USD;
  }

  getAlertCooldown() {
    return this.config.monitoring.ALERT_COOLDOWN_SECONDS;
  }

  getTelegramConfig() {
    return this.config.telegram;
  }

  getSolanaConfig() {
    return this.config.solana;
  }

  isDryRun() {
    return this.config.testing.DRY_RUN;
  }

  isMockMode() {
    return this.config.testing.MOCK_MODE;
  }
}

// Singleton instance
let configInstance = null;

function getConfig() {
  if (!configInstance) {
    configInstance = new Config();
  }
  return configInstance;
}

module.exports = { Config, getConfig };
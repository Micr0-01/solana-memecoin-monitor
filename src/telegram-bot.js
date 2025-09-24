const TelegramBot = require('node-telegram-bot-api');
const { getConfig } = require('./utils/config');
const logger = require('./utils/logger');
const { retryAsync, escapeMarkdown, formatLargeNumber } = require('./utils/helpers');

class TelegramAlertBot {
  constructor() {
    this.config = getConfig();
    this.telegramConfig = this.config.getTelegramConfig();
    this.bot = null;
    this.isInitialized = false;
    
    // Rate limiting
    this.messageQueue = [];
    this.isProcessingQueue = false;
    this.lastMessageTime = 0;
    this.minMessageInterval = 1000; // 1 second between messages
    
    // External API integrations for enhanced token info
    this.pumpfunConfig = this.config.get('external_apis.pumpfun');
    this.gmgnConfig = this.config.get('external_apis.gmgn');
  }

  /**
   * Initialize the Telegram bot
   */
  async initialize() {
    try {
      if (!this.telegramConfig.BOT_TOKEN) {
        throw new Error('Telegram bot token not provided');
      }

      if (!this.telegramConfig.CHAT_ID) {
        throw new Error('Telegram chat ID not provided');
      }

      this.bot = new TelegramBot(this.telegramConfig.BOT_TOKEN, { polling: false });
      
      // Test the bot connection
      const me = await this.bot.getMe();
      logger.info(`✅ Telegram bot connected: @${me.username}`);
      
      // Test message sending
      await this.sendTestMessage();
      
      this.isInitialized = true;
      this.startMessageProcessor();
      
    } catch (error) {
      logger.error('❌ Failed to initialize Telegram bot:', error);
      throw error;
    }
  }

  /**
   * Send a test message to verify connectivity
   */
  async sendTestMessage() {
    try {
      const testMessage = `🤖 Solana Memecoin Monitor Started
      
⚡ Bot initialized successfully
📊 Ready to monitor tokens
⏰ ${new Date().toLocaleString()}

Thresholds:
💰 Volume: $${this.config.getVolumeThreshold().toLocaleString()}
💧 Liquidity: $${this.config.getLiquidityThreshold().toLocaleString()}`;

      await this.sendMessage(testMessage);
      logger.info('✅ Test message sent successfully');
    } catch (error) {
      logger.warn('⚠️ Test message failed, but continuing:', error.message);
    }
  }

  /**
   * Send a token alert with the exact specified format
   */
  async sendTokenAlert(tokenData) {
    try {
      const { mint, volume, liquidity, riskFlags, name } = tokenData;
      
      // Get enhanced token information
      const enhancedInfo = await this.getEnhancedTokenInfo(mint);
      
      // Format the alert message using the exact template
      const message = await this.formatAlertMessage({
        mint,
        volume,
        liquidity,
        riskFlags: riskFlags || [],
        name: name || enhancedInfo.name || 'UNKNOWN',
        ...enhancedInfo
      });

      // Queue the message for sending
      await this.queueMessage(message);
      
      logger.info(`📨 Token alert queued for ${mint}`);
      
    } catch (error) {
      logger.error('❌ Failed to send token alert:', error);
      throw error;
    }
  }

  /**
   * Format the alert message using the exact template from requirements
   */
  async formatAlertMessage(tokenInfo) {
    const {
      mint,
      name,
      volume,
      liquidity,
      riskFlags,
      pumpfunUrl,
      gmgnUrl,
      quickNotes
    } = tokenInfo;

    // Format risk flags as specified
    const flagsText = this.formatRiskFlags(riskFlags);
    
    // Format volume and liquidity
    const volumeText = formatLargeNumber(volume);
    const liquidityText = formatLargeNumber(liquidity);
    
    // Generate quick notes based on why the alert was triggered
    const notes = this.generateQuickNotes(volume, liquidity, riskFlags);
    
    // Construct the exact message template
    const message = `🚨 NEW MEME TOKEN: ${name} (mint: ${this.truncateMint(mint)})
Flags: ${flagsText}
Volume: $${volumeText}
Liquidity: $${liquidityText}
Pump.fun page: ${pumpfunUrl || '(n/a)'}
GMGN: ${gmgnUrl || '(n/a)'}
Quick notes: ${notes}`;

    return message;
  }

  /**
   * Format risk flags for display
   */
  formatRiskFlags(riskFlags) {
    if (!riskFlags || riskFlags.length === 0) {
      return 'No risks detected ✅';
    }

    const flagMap = {
      'honeypot': 'honeypot ⚠️',
      'mintable': 'mintable ✅',
      'lp_not_burned': 'LP not burned ❌',
      'owner_not_renounced': 'owner not renounced ⚠️',
      'suspicious_transfer_hooks': 'transfer hooks ⚠️',
      'high_holder_concentration': 'whale dominance ⚠️',
      'lp_not_found': 'LP not found ❌',
      'assessment_failed': 'assessment failed ❓'
    };

    const formattedFlags = riskFlags.map(flag => flagMap[flag] || `${flag} ⚠️`);
    return formattedFlags.join(' | ');
  }

  /**
   * Generate quick notes explaining why the alert was triggered
   */
  generateQuickNotes(volume, liquidity, riskFlags) {
    const volumeThreshold = this.config.getVolumeThreshold();
    const liquidityThreshold = this.config.getLiquidityThreshold();
    
    const notes = [];
    
    // Volume triggered
    if (volume >= volumeThreshold) {
      notes.push(`Cumulative volume $${formatLargeNumber(volume)}`);
    }
    
    // Liquidity triggered
    if (liquidity >= liquidityThreshold) {
      notes.push(`Liquidity $${formatLargeNumber(liquidity)}`);
    }
    
    // Add context about threshold comparison
    if (volume >= volumeThreshold && liquidity < liquidityThreshold) {
      notes.push(`(liquidity below threshold)`);
    } else if (liquidity >= liquidityThreshold && volume < volumeThreshold) {
      notes.push(`(volume below threshold)`);
    }
    
    // Add risk context if significant
    const highRiskFlags = ['honeypot', 'suspicious_transfer_hooks'];
    const hasHighRisk = riskFlags.some(flag => highRiskFlags.includes(flag));
    
    if (hasHighRisk) {
      notes.push('⚠️ HIGH RISK FLAGS DETECTED');
    }
    
    return notes.join(' — ') || 'Alert threshold reached';
  }

  /**
   * Get enhanced token information from external APIs
   */
  async getEnhancedTokenInfo(mint) {
    const info = {
      name: null,
      pumpfunUrl: null,
      gmgnUrl: null
    };

    try {
      // Try to get Pump.fun information
      if (this.pumpfunConfig.API_KEY && this.pumpfunConfig.API_KEY !== 'optional_pump_portal_key') {
        const pumpInfo = await this.getPumpfunInfo(mint);
        if (pumpInfo) {
          info.name = pumpInfo.name;
          info.pumpfunUrl = `https://pump.fun/coin/${mint}`;
        }
      }

      // Try to get GMGN information
      if (this.gmgnConfig.API_KEY && this.gmgnConfig.API_KEY !== 'optional_gmgn_key') {
        const gmgnInfo = await this.getGMGNInfo(mint);
        if (gmgnInfo) {
          info.name = info.name || gmgnInfo.name;
          info.gmgnUrl = `https://gmgn.ai/sol/token/${mint}`;
        }
      }

      // Fallback URLs even without API keys
      if (!info.pumpfunUrl) {
        // Check if this might be a pump.fun token
        info.pumpfunUrl = `https://pump.fun/coin/${mint}`;
      }

      if (!info.gmgnUrl) {
        info.gmgnUrl = `https://gmgn.ai/sol/token/${mint}`;
      }

    } catch (error) {
      logger.debug(`Failed to get enhanced info for ${mint}:`, error.message);
    }

    return info;
  }

  /**
   * Get token information from Pump.fun API
   */
  async getPumpfunInfo(mint) {
    try {
      if (!this.pumpfunConfig.API_KEY || this.pumpfunConfig.API_KEY === 'optional_pump_portal_key') {
        return null;
      }

      // This is a placeholder - actual Pump.fun API integration would go here
      logger.debug(`Getting Pump.fun info for ${mint}`);
      
      // TODO: Implement actual Pump.fun API call
      return null;
    } catch (error) {
      logger.debug(`Pump.fun API error for ${mint}:`, error.message);
      return null;
    }
  }

  /**
   * Get token information from GMGN API
   */
  async getGMGNInfo(mint) {
    try {
      if (!this.gmgnConfig.API_KEY || this.gmgnConfig.API_KEY === 'optional_gmgn_key') {
        return null;
      }

      // This is a placeholder - actual GMGN API integration would go here
      logger.debug(`Getting GMGN info for ${mint}`);
      
      // TODO: Implement actual GMGN API call
      return null;
    } catch (error) {
      logger.debug(`GMGN API error for ${mint}:`, error.message);
      return null;
    }
  }

  /**
   * Truncate mint address for display
   */
  truncateMint(mint) {
    if (mint.length <= 12) return mint;
    return `${mint.substring(0, 6)}...${mint.substring(mint.length - 4)}`;
  }

  /**
   * Queue a message for sending with rate limiting
   */
  async queueMessage(message) {
    return new Promise((resolve, reject) => {
      this.messageQueue.push({
        message,
        resolve,
        reject,
        timestamp: Date.now()
      });

      if (!this.isProcessingQueue) {
        this.processMessageQueue();
      }
    });
  }

  /**
   * Process the message queue with rate limiting
   */
  async processMessageQueue() {
    if (this.isProcessingQueue) return;
    
    this.isProcessingQueue = true;
    
    while (this.messageQueue.length > 0) {
      const queueItem = this.messageQueue.shift();
      
      try {
        // Ensure minimum interval between messages
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        
        if (timeSinceLastMessage < this.minMessageInterval) {
          const delay = this.minMessageInterval - timeSinceLastMessage;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Send the message
        await this.sendMessage(queueItem.message);
        this.lastMessageTime = Date.now();
        
        queueItem.resolve();
        
      } catch (error) {
        logger.error('Failed to send queued message:', error);
        queueItem.reject(error);
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * Send a message to Telegram with retry logic
   */
  async sendMessage(text) {
    if (!this.isInitialized) {
      throw new Error('Telegram bot not initialized');
    }

    if (!this.telegramConfig.ENABLE_ALERTS) {
      logger.debug('Telegram alerts disabled, skipping message');
      return;
    }

    try {
      // Truncate message if too long
      const maxLength = this.telegramConfig.MAX_MESSAGE_LENGTH || 4096;
      const truncatedText = text.length > maxLength 
        ? text.substring(0, maxLength - 3) + '...' 
        : text;

      await retryAsync(
        () => this.bot.sendMessage(this.telegramConfig.CHAT_ID, truncatedText, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        this.telegramConfig.RETRY_ATTEMPTS || 3,
        this.telegramConfig.RETRY_DELAY_MS || 1000
      );

      logger.debug('✅ Message sent to Telegram');
      
    } catch (error) {
      logger.error('❌ Failed to send Telegram message:', error);
      throw error;
    }
  }

  /**
   * Start the message processor
   */
  startMessageProcessor() {
    // Process queue every second
    setInterval(() => {
      if (this.messageQueue.length > 0 && !this.isProcessingQueue) {
        this.processMessageQueue();
      }
    }, 1000);
  }

  /**
   * Send a status update message
   */
  async sendStatusUpdate(stats) {
    try {
      const message = `📊 Monitor Status Update

🎯 Tracked Tokens: ${stats.trackedTokens || 0}
📈 Total Trades: ${stats.totalTrades || 0}
🚨 Alerts Sent: ${stats.alertsSent || 0}
⏰ Uptime: ${stats.uptime || '0h 0m'}

Thresholds:
💰 Volume: $${this.config.getVolumeThreshold().toLocaleString()}
💧 Liquidity: $${this.config.getLiquidityThreshold().toLocaleString()}
🔄 Cooldown: ${this.config.getAlertCooldown()}s

Status: ✅ Online`;

      await this.sendMessage(message);
    } catch (error) {
      logger.error('Failed to send status update:', error);
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    return {
      queueLength: this.messageQueue.length,
      isProcessing: this.isProcessingQueue,
      lastMessageTime: this.lastMessageTime
    };
  }

  /**
   * Shutdown the bot
   */
  async shutdown() {
    try {
      logger.info('🛑 Shutting down Telegram bot...');
      
      // Process remaining messages
      if (this.messageQueue.length > 0) {
        logger.info(`Processing ${this.messageQueue.length} remaining messages...`);
        await this.processMessageQueue();
      }
      
      if (this.bot) {
        await this.bot.close();
      }
      
      this.isInitialized = false;
      logger.info('✅ Telegram bot shutdown complete');
      
    } catch (error) {
      logger.error('Error during Telegram bot shutdown:', error);
    }
  }
}

module.exports = TelegramAlertBot;
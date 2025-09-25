#!/usr/bin/env node

const { Connection, PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const { getConfig } = require('./utils/config');
const VolumeTracker = require('./volume-tracker');
const RiskAssessor = require('./risk-assessor');
const TelegramBot = require('./telegram-bot');
const logger = require('./utils/logger');
const { retryAsync } = require('./utils/helpers');
const RPCManager = require('./utils/rpc-manager');
const RequestQueue = require('./RequestQueue');
const BatchManager = require('./BatchManager');
const SelectiveFilter = require('./SelectiveFilter');
const CacheManager = require('./CacheManager');

class SolanaMemecoinMonitor {
  constructor() {
    this.config = getConfig();
    this.rpcManager = new RPCManager();
    this.connection = null;
    this.wsConnection = null;
    this.volumeTracker = null;
    this.riskAssessor = null;
    this.telegramBot = null;
    this.subscriptionIds = new Set();
    this.isRunning = false;
    this.reconnectAttempts = 0;
    
    // Token tracking
    this.trackedTokens = new Map();
    this.alertedTokens = new Map(); // Track cooldowns
    
    // Optimization components
    this.requestQueue = new RequestQueue();
    this.batchManager = new BatchManager();
    this.selectiveFilter = new SelectiveFilter({
      minLiquidityUSD: this.config.getLiquidityThreshold() * 0.5, // 50% of alert threshold
      minTradingVolume: this.config.getVolumeThreshold() * 0.1,   // 10% of alert threshold
      minHolders: 10,
      maxSupply: 10000000000, // 10B tokens max
      minTokenAge: 30000,     // 30 seconds minimum
      maxTokenAge: 7200000,   // 2 hours maximum for "new" tokens
      maxRiskScore: 8         // 0-10 scale, allow up to 8
    });
    this.cacheManager = new CacheManager({
      // Customize TTLs for memecoin monitoring
      priceDataTTL: 15000,        // 15 seconds for prices
      liquidityDataTTL: 30000,    // 30 seconds for liquidity
      volumeDataTTL: 60000,       // 1 minute for volume
      tokenMetadataTTL: 900000,   // 15 minutes for metadata
      riskAssessmentsTTL: 1800000 // 30 minutes for risk assessments
    });
    
    this.initialize();
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing Solana Memecoin Monitor...');
      
      // Initialize connections
      await this.setupConnections();
      
      // Initialize components
      this.volumeTracker = new VolumeTracker(this.connection);
      this.riskAssessor = new RiskAssessor(this.connection);
      
      if (!this.config.isDryRun()) {
        this.telegramBot = new TelegramBot();
        await this.telegramBot.initialize();
      }
      
      logger.info('✅ Monitor initialized successfully');
      
      // Start monitoring if not in mock mode
      if (!this.config.isMockMode()) {
        await this.startMonitoring();
      }
      
    } catch (error) {
      logger.error('❌ Failed to initialize monitor:', error);
      process.exit(1);
    }
  }

  async setupConnections() {
    const solanaConfig = this.config.getSolanaConfig();
    
    // Try RPC manager first, fallback to config if needed
    try {
      // Use RPC manager with fallback capability
      this.connection = await this.rpcManager.retryWithFallback(async () => {
        return await this.rpcManager.createConnection(solanaConfig.COMMITMENT);
      });
      
      // Test connection and get version
      const version = await this.connection.getVersion();
      logger.info(`📡 Connected to Solana RPC: ${version['solana-core']}`);
      
    } catch (error) {
      logger.warn('⚠️  RPC Manager failed, falling back to config endpoints...');
      
      // Fallback to original config-based connection
      this.connection = new Connection(
        solanaConfig.RPC_HTTP_ENDPOINT, 
        { commitment: solanaConfig.COMMITMENT }
      );
      
      const version = await this.connection.getVersion();
      logger.info(`📡 Connected to Solana RPC (fallback): ${version['solana-core']}`);
    }
    
    // WebSocket connection for real-time subscriptions
    await this.setupWebSocketConnection();
  }

  async setupWebSocketConnection() {
    const solanaConfig = this.config.getSolanaConfig();
    
    try {
      // Try RPC manager WebSocket first
      this.wsConnection = await this.rpcManager.retryWithFallback(async () => {
        return await this.rpcManager.createWebSocket();
      });
      
      // Set up event handlers
      this.wsConnection.on('message', (data) => {
        this.handleWebSocketMessage(JSON.parse(data));
      });
      
      this.wsConnection.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });
      
      this.wsConnection.on('close', () => {
        logger.warn('🔌 WebSocket disconnected');
        this.handleReconnect();
      });
      
      this.reconnectAttempts = 0;
      
    } catch (error) {
      logger.warn('⚠️  RPC Manager WebSocket failed, falling back to config endpoint...');
      
      // Fallback to original config-based WebSocket
      return new Promise((resolve, reject) => {
        this.wsConnection = new WebSocket(solanaConfig.RPC_WS_ENDPOINT);
        
        this.wsConnection.on('open', () => {
          logger.info('🔌 WebSocket connected to Solana (fallback)');
          this.reconnectAttempts = 0;
          resolve();
        });
        
        this.wsConnection.on('message', (data) => {
          this.handleWebSocketMessage(JSON.parse(data));
        });
        
        this.wsConnection.on('error', (error) => {
          logger.error('WebSocket error:', error);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
        
        this.wsConnection.on('close', () => {
          logger.warn('🔌 WebSocket disconnected');
          this.handleReconnect();
        });
      });
    }
  }

  async handleReconnect() {
    if (!this.isRunning) return;
    
    const solanaConfig = this.config.getSolanaConfig();
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > solanaConfig.MAX_RECONNECT_ATTEMPTS) {
      logger.error('❌ Max reconnection attempts reached. Exiting.');
      process.exit(1);
    }
    
    logger.info(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${solanaConfig.MAX_RECONNECT_ATTEMPTS})...`);
    
    setTimeout(async () => {
      try {
        await this.setupWebSocketConnection();
        await this.resubscribeAll();
      } catch (error) {
        logger.error('Reconnection failed:', error);
      }
    }, solanaConfig.RECONNECT_INTERVAL_MS);
  }

  async startMonitoring() {
    logger.info('🎯 Starting memecoin monitoring...');
    this.isRunning = true;
    
    // Subscribe to new token mints
    await this.subscribeToTokenMints();
    
    // Subscribe to token program logs for trades
    await this.subscribeToTokenTrades();
    
      // Start periodic price updates
      this.startPriceUpdateLoop();
      
      // Start RPC status monitoring
      this.startRPCStatusLoop();
      
      // Start optimization stats logging
      this.startOptimizationStatsLoop();
      
      logger.info('✅ Monitoring started successfully');
      logger.info(`📄 Volume threshold: $${this.config.getVolumeThreshold().toLocaleString()}`);
      logger.info(`💧 Liquidity threshold: $${this.config.getLiquidityThreshold().toLocaleString()}`);
      logger.info('🔧 Optimization systems: RequestQueue, BatchManager, SelectiveFilter, CacheManager');
    }

  async subscribeToTokenMints() {
    const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    
    const subscription = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [TOKEN_PROGRAM_ID]
        },
        {
          commitment: 'confirmed'
        }
      ]
    };
    
    this.wsConnection.send(JSON.stringify(subscription));
    logger.info('📝 Subscribed to token mint logs');
  }

  async subscribeToTokenTrades() {
    // Subscribe to Raydium and other DEX program logs
    const DEX_PROGRAMS = [
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
      'EhYXq3ANp5nAerUpbSgd7VK2RRcxK1zNuSQ755G5Mtc1',  // Raydium CPMM
      'CAMMCzo5YL8w4VFF8KVHrK22GGUQzaMob4na6NEn9a8',  // Raydium CLMM
    ];
    
    for (const programId of DEX_PROGRAMS) {
      const subscription = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'logsSubscribe',
        params: [
          {
            mentions: [programId]
          },
          {
            commitment: 'confirmed'
          }
        ]
      };
      
      this.wsConnection.send(JSON.stringify(subscription));
    }
    
    logger.info(`📈 Subscribed to ${DEX_PROGRAMS.length} DEX programs for trades`);
  }

  async handleWebSocketMessage(message) {
    try {
      if (message.method === 'logsNotification') {
        const { params } = message;
        const { result } = params;
        
        if (result && result.value) {
          await this.processLogMessage(result.value);
        }
      } else if (message.id && message.result) {
        // Subscription confirmation
        this.subscriptionIds.add(message.result);
        logger.debug(`✅ Subscription confirmed: ${message.result}`);
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
    }
  }

  async processLogMessage(logData) {
    const { signature, logs, err } = logData;
    
    if (err) return; // Skip failed transactions
    
    try {
      // Check for token mint events
      if (this.isTokenMintEvent(logs)) {
        await this.handleNewTokenMint(signature, logs);
      }
      
      // Check for trade events
      if (this.isTradeEvent(logs)) {
        await this.handleTokenTrade(signature, logs);
      }
    } catch (error) {
      logger.error(`Error processing log for ${signature}:`, error);
    }
  }

  isTokenMintEvent(logs) {
    return logs.some(log => 
      log.includes('InitializeMint') || 
      log.includes('MintTo') ||
      log.includes('CreateMint')
    );
  }

  isTradeEvent(logs) {
    return logs.some(log => 
      log.includes('Swap') || 
      log.includes('Trade') ||
      log.includes('swap') ||
      log.includes('SwapBaseIn') ||
      log.includes('SwapBaseOut')
    );
  }

  async handleNewTokenMint(signature, logs) {
    logger.info(`🪙 New token mint detected: ${signature}`);
    
    try {
      // Get transaction details
      const txDetails = await retryAsync(
        () => this.connection.getTransaction(signature, { commitment: 'confirmed' }),
        3,
        1000
      );
      
      if (!txDetails) {
        logger.warn(`Failed to fetch transaction details for ${signature}`);
        return;
      }
      
      // Extract token mint address
      const tokenMint = this.extractTokenMintFromTx(txDetails);
      if (!tokenMint) {
        logger.debug('Could not extract token mint address');
        return;
      }
      
      // Start tracking this token
      await this.startTrackingToken(tokenMint, signature);
      
    } catch (error) {
      logger.error(`Error handling mint ${signature}:`, error);
    }
  }

  async handleTokenTrade(signature, logs) {
    logger.debug(`📊 Trade detected: ${signature}`);
    
    try {
      // Use request queue for transaction fetching
      const txDetails = await this.requestQueue.enqueue(async () => {
        return await retryAsync(
          () => this.connection.getTransaction(signature, { commitment: 'confirmed' }),
          2, // Reduced retries to avoid rate limiting
          1000
        );
      });
      
      if (!txDetails) return;
      
      // Extract trade information
      const tradeInfo = await this.extractTradeInfo(txDetails);
      if (!tradeInfo) return;
      
      // Only process if we're already tracking this token or if it's promising
      if (!this.trackedTokens.has(tradeInfo.tokenMint)) {
        // Do a quick filter check before processing unknown tokens
        const basicData = {
          mint: tradeInfo.tokenMint,
          volume: tradeInfo.amountUSD,
          createdAt: new Date().toISOString()
        };
        
        const shouldMonitor = await this.selectiveFilter.shouldMonitor(basicData);
        if (!shouldMonitor) {
          logger.debug(`🚫 Trade on untracked token ${tradeInfo.tokenMint} - token filtered out`);
          return;
        }
      }
      
      // Update volume tracking
      await this.volumeTracker.recordTrade(
        tradeInfo.tokenMint,
        tradeInfo.amountUSD,
        signature
      );
      
      // Invalidate cache for this token's volume data
      this.cacheManager.delete('volumeData', tradeInfo.tokenMint);
      
      // Check if this triggers an alert
      await this.checkAlertConditions(tradeInfo.tokenMint);
      
    } catch (error) {
      logger.error(`Error handling trade ${signature}:`, error);
    }
  }

  extractTokenMintFromTx(txDetails) {
    // Extract token mint from transaction accounts and instructions
    // This is a simplified implementation - would need more robust parsing
    try {
      if (txDetails.meta && txDetails.meta.postTokenBalances) {
        const newTokens = txDetails.meta.postTokenBalances.filter(balance => 
          balance.uiTokenAmount.uiAmount > 0
        );
        
        if (newTokens.length > 0) {
          return newTokens[0].mint;
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting token mint:', error);
      return null;
    }
  }

  async extractTradeInfo(txDetails) {
    // Extract trade information from DEX transaction
    try {
      const tokenMint = this.extractTokenMintFromTx(txDetails);
      if (!tokenMint) return null;
      
      // Estimate trade amount
      const amountUSD = await this.estimateTradeAmount(txDetails, tokenMint);
      
      return {
        tokenMint,
        amountUSD,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Error extracting trade info:', error);
      return null;
    }
  }

  async estimateTradeAmount(txDetails, tokenMint) {
    // Estimate USD amount of trade
    try {
      const solAmount = this.extractSOLAmount(txDetails);
      if (solAmount) {
        const solPrice = await this.volumeTracker.getSOLPriceUSD();
        return solAmount * solPrice;
      }
      return 0;
    } catch (error) {
      logger.error('Error estimating trade amount:', error);
      return 0;
    }
  }

  extractSOLAmount(txDetails) {
    // Extract SOL amount from transaction
    try {
      if (txDetails.meta && txDetails.meta.preBalances && txDetails.meta.postBalances) {
        const preBalances = txDetails.meta.preBalances;
        const postBalances = txDetails.meta.postBalances;
        
        for (let i = 0; i < preBalances.length; i++) {
          const diff = Math.abs(postBalances[i] - preBalances[i]);
          if (diff > 0) {
            return diff / 1e9; // Convert lamports to SOL
          }
        }
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  async startTrackingToken(tokenMint, mintSignature) {
    if (this.trackedTokens.has(tokenMint)) {
      return; // Already tracking
    }
    
    logger.debug(`🔍 Evaluating new token: ${tokenMint}`);
    
    // First gather basic token data for filtering
    const tokenData = {
      mint: tokenMint,
      discoveredAt: Date.now(),
      mintSignature,
      volume: 0,
      liquidity: 0,
      lastUpdate: Date.now(),
      createdAt: new Date().toISOString()
    };
    
    try {
      // Get token metadata with caching
      const metadata = await this.cacheManager.getOrSet(
        'tokenMetadata',
        tokenMint,
        async () => {
          // Use request queue to manage RPC calls
          return await this.requestQueue.enqueue(async () => {
            // Get basic token info
            try {
              const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenMint));
              if (mintInfo && mintInfo.value && mintInfo.value.data && mintInfo.value.data.parsed) {
                const parsedData = mintInfo.value.data.parsed.info;
                return {
                  supply: parsedData.supply,
                  decimals: parsedData.decimals,
                  freezeAuthority: parsedData.freezeAuthority,
                  mintAuthority: parsedData.mintAuthority
                };
              }
              return null;
            } catch (error) {
              logger.debug(`Error fetching metadata for ${tokenMint}:`, error);
              return null;
            }
          });
        }
      );
      
      if (metadata) {
        tokenData.supply = metadata.supply;
        tokenData.decimals = metadata.decimals;
        tokenData.metadata = metadata;
      }
      
      // Get initial liquidity with caching
      const liquidity = await this.cacheManager.getOrSet(
        'liquidityData',
        tokenMint,
        async () => {
          return await this.requestQueue.enqueue(async () => {
            return await this.volumeTracker.getTokenLiquidity(tokenMint);
          });
        },
        60000 // 1 minute TTL for initial liquidity
      );
      
      tokenData.liquidity = liquidity;
      
      // Apply selective filtering
      const shouldMonitor = await this.selectiveFilter.shouldMonitor(tokenData);
      
      if (!shouldMonitor) {
        logger.debug(`🚫 Token ${tokenMint} filtered out - not worth monitoring`);
        return;
      }
      
      logger.info(`🎯 Starting to track promising token: ${tokenMint}`);
      this.trackedTokens.set(tokenMint, tokenData);
      
      // Perform initial risk assessment with caching
      const riskFlags = await this.cacheManager.getOrSet(
        'riskAssessments',
        tokenMint,
        async () => {
          return await this.requestQueue.enqueue(async () => {
            return await this.riskAssessor.assessToken(tokenMint);
          });
        }
      );
      
      tokenData.riskFlags = riskFlags;
      tokenData.riskScore = this.calculateRiskScore(riskFlags);
      
      logger.info(`📋 High-quality token ${tokenMint} added to tracking (liquidity: $${liquidity.toFixed(2)}, risk: ${tokenData.riskScore}/10)`);
      
    } catch (error) {
      logger.error(`Error evaluating token ${tokenMint}:`, error);
    }
  }
  
  calculateRiskScore(riskFlags) {
    // Calculate a numerical risk score from 0-10 based on risk flags
    let score = 0;
    if (!riskFlags || riskFlags.length === 0) return score;
    
    const riskWeights = {
      'low-liquidity': 2,
      'high-concentration': 3,
      'suspicious-metadata': 2,
      'new-token': 1,
      'unverified': 1,
      'rugpull-pattern': 5,
      'honeypot': 5
    };
    
    riskFlags.forEach(flag => {
      score += riskWeights[flag] || 1;
    });
    
    return Math.min(score, 10); // Cap at 10
  }

  async checkAlertConditions(tokenMint) {
    const tokenData = this.trackedTokens.get(tokenMint);
    if (!tokenData) return;
    
    // Check if already alerted recently
    const lastAlert = this.alertedTokens.get(tokenMint);
    const now = Date.now();
    const cooldownMs = this.config.getAlertCooldown() * 1000;
    
    if (lastAlert && (now - lastAlert) < cooldownMs) {
      return; // Still in cooldown
    }
    
    // Get current metrics with caching
    const volume = await this.cacheManager.getOrSet(
      'volumeData',
      tokenMint,
      async () => {
        return await this.requestQueue.enqueue(async () => {
          return await this.volumeTracker.getTokenVolume(tokenMint);
        });
      }
    );
    
    const liquidity = await this.cacheManager.getOrSet(
      'liquidityData',
      tokenMint,
      async () => {
        return await this.requestQueue.enqueue(async () => {
          return await this.volumeTracker.getTokenLiquidity(tokenMint);
        });
      }
    );
    
    // Apply filtering rules
    if (liquidity === 0) {
      logger.debug(`Token ${tokenMint} has zero liquidity, skipping alert`);
      return;
    }
    
    const volumeThreshold = this.config.getVolumeThreshold();
    const liquidityThreshold = this.config.getLiquidityThreshold();
    
    if (volume >= volumeThreshold || liquidity >= liquidityThreshold) {
      await this.sendAlert(tokenMint, volume, liquidity, tokenData.riskFlags);
      this.alertedTokens.set(tokenMint, now);
    }
  }

  async sendAlert(tokenMint, volume, liquidity, riskFlags) {
    if (this.config.isDryRun()) {
      logger.info(`🚨 [DRY RUN] Would send alert for ${tokenMint} (V:$${volume.toFixed(2)}, L:$${liquidity.toFixed(2)})`);
      return;
    }
    
    try {
      logger.info(`🚨 Sending alert for token: ${tokenMint}`);
      
      if (this.telegramBot) {
        await this.telegramBot.sendTokenAlert({
          mint: tokenMint,
          volume,
          liquidity,
          riskFlags: riskFlags || []
        });
      }
    } catch (error) {
      logger.error('Failed to send alert:', error);
    }
  }

  startPriceUpdateLoop() {
    const updateInterval = this.config.get('monitoring.PRICE_UPDATE_INTERVAL_MS');
    
    setInterval(async () => {
      try {
        // Use request queue for price updates
        await this.requestQueue.enqueue(async () => {
          await this.volumeTracker.updatePrices();
        });
      } catch (error) {
        logger.error('Error updating prices:', error);
      }
    }, updateInterval);
    
    logger.info(`🔄 Started price update loop (${updateInterval}ms interval)`);
  }

  startRPCStatusLoop() {
    // Log RPC status every 5 minutes
    setInterval(() => {
      try {
        this.rpcManager.logEndpointStats();
      } catch (error) {
        logger.debug('Error logging RPC stats:', error);
      }
    }, 300000); // 5 minutes
    
    logger.info('📈 Started RPC status monitoring (5min interval)');
  }
  
  startOptimizationStatsLoop() {
    // Log optimization stats every 10 minutes
    setInterval(() => {
      try {
        console.log('\n=== OPTIMIZATION PERFORMANCE STATS ===');
        this.requestQueue.logStats();
        this.batchManager.logStats();
        this.selectiveFilter.logStats();
        this.cacheManager.logStats();
        console.log('=====================================\n');
      } catch (error) {
        logger.debug('Error logging optimization stats:', error);
      }
    }, 600000); // 10 minutes
    
    logger.info('📊 Started optimization stats monitoring (10min interval)');
  }

  async resubscribeAll() {
    if (!this.isRunning) return;
    
    this.subscriptionIds.clear();
    await this.subscribeToTokenMints();
    await this.subscribeToTokenTrades();
    
    logger.info('✅ Re-subscribed to all WebSocket feeds');
  }

  async shutdown() {
    logger.info('🛑 Shutting down monitor...');
    this.isRunning = false;
    
    if (this.wsConnection) {
      this.wsConnection.close();
    }
    
    if (this.telegramBot) {
      await this.telegramBot.shutdown();
    }
    
    if (this.volumeTracker) {
      await this.volumeTracker.shutdown();
    }
    
    // Cleanup optimization components
    if (this.requestQueue) {
      this.requestQueue.destroy();
    }
    
    if (this.cacheManager) {
      this.cacheManager.destroy();
    }
    
    logger.info('✅ Monitor shutdown complete');
  }
}

// Main execution
async function main() {
  const monitor = new SolanaMemecoinMonitor();
  
  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await monitor.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await monitor.shutdown();
    process.exit(0);
  });
  
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = SolanaMemecoinMonitor;
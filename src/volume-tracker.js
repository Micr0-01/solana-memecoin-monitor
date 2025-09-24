const { PublicKey } = require('@solana/web3.js');
const Big = require('big.js');
const axios = require('axios');
const { getConfig } = require('./utils/config');
const logger = require('./utils/logger');
const { retryAsync, createRateLimiter } = require('./utils/helpers');

class VolumeTracker {
  constructor(connection) {
    this.connection = connection;
    this.config = getConfig();
    
    // Volume tracking by token mint
    this.tokenVolumes = new Map(); // tokenMint -> { cumulative: Big, trades: [] }
    this.tokenLiquidity = new Map(); // tokenMint -> { usdValue: Big, pools: [] }
    
    // Price caching
    this.priceCache = new Map(); // symbol -> { price: number, timestamp: number }
    this.priceCacheTTL = 30000; // 30 seconds
    
    // Rate limiters for price feeds
    this.coinGeckoLimiter = createRateLimiter(2); // 2 requests per second
    this.jupiterLimiter = createRateLimiter(10); // 10 requests per second
    
    // Well-known token addresses
    this.KNOWN_TOKENS = {
      SOL: 'So11111111111111111111111111111111111111112',
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      WSOL: 'So11111111111111111111111111111111111111112'
    };
  }

  /**
   * Record a trade for volume tracking
   */
  async recordTrade(tokenMint, amountUSD, signature) {
    try {
      if (!this.tokenVolumes.has(tokenMint)) {
        this.tokenVolumes.set(tokenMint, {
          cumulative: new Big(0),
          trades: []
        });
      }

      const tokenData = this.tokenVolumes.get(tokenMint);
      const tradeAmount = new Big(amountUSD);
      
      // Add to cumulative volume
      tokenData.cumulative = tokenData.cumulative.plus(tradeAmount);
      
      // Add trade record
      tokenData.trades.push({
        signature,
        amountUSD: tradeAmount.toNumber(),
        timestamp: Date.now()
      });

      // Cleanup old trades based on monitor mode
      this.cleanupOldTrades(tokenData);
      
      logger.debug(`Recorded trade for ${tokenMint}: $${amountUSD} (Total: $${tokenData.cumulative.toFixed(2)})`);
      
    } catch (error) {
      logger.error(`Error recording trade for ${tokenMint}:`, error);
    }
  }

  /**
   * Get cumulative volume for a token
   */
  async getTokenVolume(tokenMint) {
    try {
      const tokenData = this.tokenVolumes.get(tokenMint);
      if (!tokenData) {
        return 0;
      }

      // Recalculate based on monitor mode
      const monitorMode = this.config.get('monitoring.MONITOR_MODE');
      
      if (monitorMode === '24h') {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const recentTrades = tokenData.trades.filter(trade => trade.timestamp >= oneDayAgo);
        const volume24h = recentTrades.reduce((sum, trade) => sum + trade.amountUSD, 0);
        return volume24h;
      } else {
        // since_first_trade mode
        return tokenData.cumulative.toNumber();
      }
    } catch (error) {
      logger.error(`Error getting volume for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Get current liquidity for a token
   */
  async getTokenLiquidity(tokenMint) {
    try {
      // Check cache first
      const cached = this.tokenLiquidity.get(tokenMint);
      if (cached && (Date.now() - cached.timestamp) < this.priceCacheTTL) {
        return cached.usdValue.toNumber();
      }

      // Fetch current liquidity
      const liquidity = await this.fetchTokenLiquidity(tokenMint);
      
      // Cache the result
      this.tokenLiquidity.set(tokenMint, {
        usdValue: new Big(liquidity),
        pools: [], // TODO: Implement pool tracking
        timestamp: Date.now()
      });

      return liquidity;
    } catch (error) {
      logger.error(`Error getting liquidity for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Fetch token liquidity from various sources
   */
  async fetchTokenLiquidity(tokenMint) {
    try {
      // Try to find liquidity pools for this token
      const pools = await this.findLiquidityPools(tokenMint);
      
      if (pools.length === 0) {
        return 0; // No liquidity pools found
      }

      // Calculate total USD liquidity across all pools
      let totalLiquidity = 0;
      
      for (const pool of pools) {
        const poolLiquidity = await this.calculatePoolLiquidity(pool);
        totalLiquidity += poolLiquidity;
      }

      return totalLiquidity;
    } catch (error) {
      logger.error(`Error fetching liquidity for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Find liquidity pools for a token
   */
  async findLiquidityPools(tokenMint) {
    try {
      // This is a simplified implementation
      // In production, you'd query Raydium, Orca, and other DEX APIs
      
      // For now, we'll simulate finding pools
      const pools = [
        {
          id: `${tokenMint}_SOL_pool`,
          tokenA: tokenMint,
          tokenB: this.KNOWN_TOKENS.SOL,
          reserveA: 1000000, // Example reserves
          reserveB: 100, // 100 SOL
          dex: 'Raydium'
        }
      ];

      return pools;
    } catch (error) {
      logger.error(`Error finding pools for ${tokenMint}:`, error);
      return [];
    }
  }

  /**
   * Calculate USD liquidity for a pool
   */
  async calculatePoolLiquidity(pool) {
    try {
      const { tokenA, tokenB, reserveA, reserveB } = pool;
      
      // Get USD prices for both tokens
      const priceA = await this.getTokenPriceUSD(tokenA);
      const priceB = await this.getTokenPriceUSD(tokenB);
      
      // Calculate USD value of reserves
      const valueA = reserveA * priceA;
      const valueB = reserveB * priceB;
      
      // Total pool liquidity
      return valueA + valueB;
    } catch (error) {
      logger.error('Error calculating pool liquidity:', error);
      return 0;
    }
  }

  /**
   * Get USD price for a token
   */
  async getTokenPriceUSD(tokenMint) {
    try {
      // Check cache first
      const cached = this.priceCache.get(tokenMint);
      if (cached && (Date.now() - cached.timestamp) < this.priceCacheTTL) {
        return cached.price;
      }

      let price = 0;

      // Handle known stablecoins
      if (tokenMint === this.KNOWN_TOKENS.USDC || tokenMint === this.KNOWN_TOKENS.USDT) {
        price = 1.0;
      } else if (tokenMint === this.KNOWN_TOKENS.SOL || tokenMint === this.KNOWN_TOKENS.WSOL) {
        price = await this.getSOLPriceUSD();
      } else {
        // Try to get price from Jupiter first (faster)
        price = await this.getTokenPriceFromJupiter(tokenMint);
        
        if (price === 0) {
          // Fallback to calculating from SOL pairs
          price = await this.getTokenPriceFromSOLPair(tokenMint);
        }
      }

      // Cache the result
      this.priceCache.set(tokenMint, {
        price,
        timestamp: Date.now()
      });

      return price;
    } catch (error) {
      logger.error(`Error getting price for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Get SOL price in USD from CoinGecko
   */
  async getSOLPriceUSD() {
    try {
      // Check cache first
      const cached = this.priceCache.get('SOL_USD');
      if (cached && (Date.now() - cached.timestamp) < this.priceCacheTTL) {
        return cached.price;
      }

      const price = await this.coinGeckoLimiter(async () => {
        const response = await retryAsync(
          () => axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
            timeout: 10000
          }),
          3,
          1000
        );

        return response.data.solana.usd;
      });

      // Cache the result
      this.priceCache.set('SOL_USD', {
        price,
        timestamp: Date.now()
      });

      logger.debug(`SOL price: $${price}`);
      return price;
    } catch (error) {
      logger.error('Error fetching SOL price:', error);
      return 150; // Fallback price
    }
  }

  /**
   * Get token price from Jupiter aggregator
   */
  async getTokenPriceFromJupiter(tokenMint) {
    try {
      const price = await this.jupiterLimiter(async () => {
        const response = await retryAsync(
          () => axios.get(`https://price.jup.ag/v4/price?ids=${tokenMint}`, {
            timeout: 5000
          }),
          2,
          500
        );

        const data = response.data.data;
        if (data && data[tokenMint]) {
          return data[tokenMint].price;
        }
        return 0;
      });

      return price || 0;
    } catch (error) {
      logger.debug(`Jupiter price not found for ${tokenMint}:`, error.message);
      return 0;
    }
  }

  /**
   * Calculate token price from SOL pair
   */
  async getTokenPriceFromSOLPair(tokenMint) {
    try {
      // This would require finding the token's SOL pair and calculating price
      // For now, we'll return 0 as this needs proper DEX integration
      logger.debug(`Unable to calculate SOL pair price for ${tokenMint}`);
      return 0;
    } catch (error) {
      logger.error(`Error calculating SOL pair price for ${tokenMint}:`, error);
      return 0;
    }
  }

  /**
   * Update all cached prices
   */
  async updatePrices() {
    try {
      logger.debug('Updating cached prices...');
      
      // Update SOL price
      await this.getSOLPriceUSD();
      
      // Update prices for all tracked tokens
      const tokenMints = Array.from(this.tokenVolumes.keys()).concat(
        Array.from(this.tokenLiquidity.keys())
      );
      
      const uniqueTokens = [...new Set(tokenMints)];
      
      for (const tokenMint of uniqueTokens.slice(0, 10)) { // Limit to avoid rate limits
        try {
          await this.getTokenPriceUSD(tokenMint);
        } catch (error) {
          logger.debug(`Failed to update price for ${tokenMint}:`, error.message);
        }
      }
      
      logger.debug(`Updated prices for ${uniqueTokens.length} tokens`);
    } catch (error) {
      logger.error('Error updating prices:', error);
    }
  }

  /**
   * Clean up old trade records based on monitor mode
   */
  cleanupOldTrades(tokenData) {
    const monitorMode = this.config.get('monitoring.MONITOR_MODE');
    
    if (monitorMode === '24h') {
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      tokenData.trades = tokenData.trades.filter(trade => trade.timestamp >= oneDayAgo);
      
      // Recalculate cumulative volume for remaining trades
      tokenData.cumulative = tokenData.trades.reduce(
        (sum, trade) => sum.plus(new Big(trade.amountUSD)),
        new Big(0)
      );
    }
    
    // Keep only the most recent 1000 trades to prevent memory issues
    if (tokenData.trades.length > 1000) {
      tokenData.trades = tokenData.trades.slice(-1000);
    }
  }

  /**
   * Get tracking statistics
   */
  getStats() {
    return {
      trackedTokens: this.tokenVolumes.size,
      cachedPrices: this.priceCache.size,
      totalTrades: Array.from(this.tokenVolumes.values())
        .reduce((sum, data) => sum + data.trades.length, 0)
    };
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    logger.info('🛑 Volume tracker shutting down...');
    
    // Clear all caches
    this.tokenVolumes.clear();
    this.tokenLiquidity.clear();
    this.priceCache.clear();
    
    logger.info('✅ Volume tracker shutdown complete');
  }
}

module.exports = VolumeTracker;
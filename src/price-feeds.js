const axios = require('axios');
const { getConfig } = require('./utils/config');
const logger = require('./utils/logger');
const { retryAsync, createRateLimiter } = require('./utils/helpers');

class PriceFeeds {
  constructor() {
    this.config = getConfig();
    this.priceCache = new Map();
    this.cacheTTL = 30000; // 30 seconds
    
    // Rate limiters for different APIs
    this.coinGeckoLimiter = createRateLimiter(2);
    this.jupiterLimiter = createRateLimiter(10);
  }

  /**
   * Get token price from Jupiter aggregator
   */
  async getJupiterPrice(tokenMint) {
    try {
      const cacheKey = `jupiter_${tokenMint}`;
      const cached = this.priceCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.price;
      }

      const price = await this.jupiterLimiter(async () => {
        const response = await retryAsync(
          () => axios.get(`https://price.jup.ag/v4/price?ids=${tokenMint}`, {
            timeout: 5000
          }),
          2,
          500
        );

        if (response.data && response.data.data && response.data.data[tokenMint]) {
          return response.data.data[tokenMint].price;
        }
        return null;
      });

      if (price !== null) {
        this.priceCache.set(cacheKey, {
          price,
          timestamp: Date.now()
        });
      }

      return price;
    } catch (error) {
      logger.debug(`Jupiter price fetch failed for ${tokenMint}:`, error.message);
      return null;
    }
  }

  /**
   * Get SOL price from CoinGecko
   */
  async getSOLPrice() {
    try {
      const cacheKey = 'coingecko_solana';
      const cached = this.priceCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
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

      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now()
      });

      return price;
    } catch (error) {
      logger.error('Failed to fetch SOL price from CoinGecko:', error);
      return 150; // Fallback price
    }
  }

  /**
   * Clear price cache
   */
  clearCache() {
    this.priceCache.clear();
  }
}

module.exports = PriceFeeds;
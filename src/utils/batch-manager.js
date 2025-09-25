const logger = require('./logger');

class BatchManager {
  constructor() {
    this.batches = new Map(); // batchType -> { items: [], timeout: timer, resolver: fn }
    this.config = {
      // Batch configurations
      tokenLookup: { maxSize: 50, maxWait: 2000 },
      priceUpdate: { maxSize: 100, maxWait: 5000 },
      riskAssessment: { maxSize: 20, maxWait: 3000 },
      liquidityCheck: { maxSize: 30, maxWait: 2500 }
    };
  }

  /**
   * Add an item to a batch for processing
   */
  async addToBatch(batchType, item, processorFn) {
    const config = this.config[batchType];
    if (!config) {
      throw new Error(`Unknown batch type: ${batchType}`);
    }

    return new Promise((resolve, reject) => {
      let batch = this.batches.get(batchType);
      
      if (!batch) {
        batch = {
          items: [],
          promises: [],
          processor: processorFn,
          timeout: null
        };
        this.batches.set(batchType, batch);
      }

      // Add item and promise resolver to batch
      batch.items.push(item);
      batch.promises.push({ resolve, reject, item });

      // Set timeout for batch processing if not already set
      if (!batch.timeout) {
        batch.timeout = setTimeout(() => {
          this.processBatch(batchType);
        }, config.maxWait);
      }

      // Process immediately if batch is full
      if (batch.items.length >= config.maxSize) {
        clearTimeout(batch.timeout);
        this.processBatch(batchType);
      }
    });
  }

  /**
   * Process a batch of items
   */
  async processBatch(batchType) {
    const batch = this.batches.get(batchType);
    if (!batch || batch.items.length === 0) {
      return;
    }

    // Remove from pending batches
    this.batches.delete(batchType);
    
    // Clear timeout
    if (batch.timeout) {
      clearTimeout(batch.timeout);
    }

    logger.debug(`Processing batch ${batchType} with ${batch.items.length} items`);

    try {
      // Process the batch
      const results = await batch.processor(batch.items);
      
      // Resolve individual promises
      batch.promises.forEach((promise, index) => {
        const result = Array.isArray(results) ? results[index] : results[promise.item];
        promise.resolve(result);
      });

    } catch (error) {
      logger.error(`Batch processing failed for ${batchType}:`, error);
      
      // Reject all promises in the batch
      batch.promises.forEach(promise => {
        promise.reject(error);
      });
    }
  }

  /**
   * Create a batch processor for token metadata lookups
   */
  createTokenLookupProcessor(connection) {
    return async (tokenMints) => {
      logger.debug(`Batch processing ${tokenMints.length} token lookups`);
      
      try {
        // Use getMultipleAccountsInfo for batch token account fetching
        const publicKeys = tokenMints.map(mint => new (require('@solana/web3.js').PublicKey)(mint));
        const accounts = await connection.getMultipleAccountsInfo(publicKeys);
        
        const results = {};
        tokenMints.forEach((mint, index) => {
          results[mint] = accounts[index];
        });
        
        return results;
      } catch (error) {
        logger.error('Batch token lookup failed:', error);
        throw error;
      }
    };
  }

  /**
   * Create a batch processor for price updates
   */
  createPriceUpdateProcessor(priceApi) {
    return async (tokens) => {
      logger.debug(`Batch processing ${tokens.length} price updates`);
      
      try {
        // Group by price source for efficient API calls
        const solTokens = tokens.filter(t => t.pairedWith === 'SOL');
        const usdcTokens = tokens.filter(t => t.pairedWith === 'USDC');
        
        const results = {};
        
        // Batch fetch SOL prices
        if (solTokens.length > 0) {
          const solPrices = await this.batchFetchPrices(solTokens, 'SOL', priceApi);
          Object.assign(results, solPrices);
        }
        
        // Batch fetch USDC prices
        if (usdcTokens.length > 0) {
          const usdcPrices = await this.batchFetchPrices(usdcTokens, 'USDC', priceApi);
          Object.assign(results, usdcPrices);
        }
        
        return results;
      } catch (error) {
        logger.error('Batch price update failed:', error);
        throw error;
      }
    };
  }

  /**
   * Create a batch processor for risk assessments
   */
  createRiskAssessmentProcessor(riskAssessor) {
    return async (tokenMints) => {
      logger.debug(`Batch processing ${tokenMints.length} risk assessments`);
      
      try {
        // Process risk assessments with controlled concurrency
        const results = {};
        const chunks = this.chunkArray(tokenMints, 5); // Process 5 at a time
        
        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (mint) => {
            try {
              const assessment = await riskAssessor.assessToken(mint);
              return { mint, assessment };
            } catch (error) {
              logger.warn(`Risk assessment failed for ${mint}:`, error.message);
              return { mint, assessment: ['assessment_failed'] };
            }
          });
          
          const chunkResults = await Promise.allSettled(chunkPromises);
          chunkResults.forEach(result => {
            if (result.status === 'fulfilled') {
              results[result.value.mint] = result.value.assessment;
            }
          });
          
          // Small delay between chunks to avoid overwhelming the system
          await this.sleep(100);
        }
        
        return results;
      } catch (error) {
        logger.error('Batch risk assessment failed:', error);
        throw error;
      }
    };
  }

  /**
   * Create a batch processor for liquidity checks
   */
  createLiquidityCheckProcessor(volumeTracker) {
    return async (tokenMints) => {
      logger.debug(`Batch processing ${tokenMints.length} liquidity checks`);
      
      try {
        const results = {};
        
        // Process liquidity checks in smaller groups
        const chunks = this.chunkArray(tokenMints, 10);
        
        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (mint) => {
            try {
              const liquidity = await volumeTracker.getTokenLiquidity(mint);
              return { mint, liquidity };
            } catch (error) {
              logger.warn(`Liquidity check failed for ${mint}:`, error.message);
              return { mint, liquidity: 0 };
            }
          });
          
          const chunkResults = await Promise.allSettled(chunkPromises);
          chunkResults.forEach(result => {
            if (result.status === 'fulfilled') {
              results[result.value.mint] = result.value.liquidity;
            }
          });
          
          await this.sleep(50); // Small delay
        }
        
        return results;
      } catch (error) {
        logger.error('Batch liquidity check failed:', error);
        throw error;
      }
    };
  }

  /**
   * Batch fetch prices from external API
   */
  async batchFetchPrices(tokens, quoteCurrency, priceApi) {
    try {
      // Create batch request for price API
      const tokenIds = tokens.map(t => t.mint).join(',');
      const prices = await priceApi.getBatchPrices(tokenIds, quoteCurrency);
      
      const results = {};
      tokens.forEach(token => {
        results[token.mint] = prices[token.mint] || 0;
      });
      
      return results;
    } catch (error) {
      logger.error(`Batch price fetch failed for ${quoteCurrency}:`, error);
      
      // Fallback to individual requests with delay
      const results = {};
      for (const token of tokens) {
        try {
          results[token.mint] = await priceApi.getPrice(token.mint, quoteCurrency);
          await this.sleep(100); // Rate limit between individual calls
        } catch (err) {
          results[token.mint] = 0;
        }
      }
      
      return results;
    }
  }

  /**
   * Utility to chunk arrays
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get batch statistics
   */
  getStats() {
    const stats = {};
    
    for (const [batchType, batch] of this.batches.entries()) {
      stats[batchType] = {
        pendingItems: batch.items.length,
        waitingTime: batch.timeout ? 'Processing soon...' : 'Idle'
      };
    }
    
    return stats;
  }

  /**
   * Force process all pending batches
   */
  async flushAll() {
    const batchTypes = Array.from(this.batches.keys());
    const promises = batchTypes.map(batchType => this.processBatch(batchType));
    
    await Promise.allSettled(promises);
    logger.info(`🔄 Flushed ${batchTypes.length} pending batches`);
  }

  /**
   * Clear all batches (for shutdown)
   */
  clear() {
    for (const [batchType, batch] of this.batches.entries()) {
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }
      
      // Reject pending promises
      batch.promises.forEach(promise => {
        promise.reject(new Error('Batch manager cleared'));
      });
    }
    
    this.batches.clear();
    logger.info('🧹 Batch manager cleared');
  }
}

module.exports = BatchManager;
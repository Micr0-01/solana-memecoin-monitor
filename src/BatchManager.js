/**
 * BatchManager - Efficiently batches API calls to reduce overall request count
 * Groups similar operations and processes them together
 */

class BatchManager {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize || 10;
    this.maxWaitTime = options.maxWaitTime || 2000; // 2 seconds
    this.minBatchSize = options.minBatchSize || 2;
    
    // Active batches by type
    this.batches = new Map();
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      batchedRequests: 0,
      totalBatches: 0,
      averageBatchSize: 0,
      totalBatchSize: 0,
      timeouts: 0,
      errors: 0
    };
  }

  /**
   * Add item to batch and return promise for the result
   */
  async addToBatch(batchType, key, batchFunction, options = {}) {
    this.stats.totalRequests++;
    
    return new Promise((resolve, reject) => {
      // Get or create batch for this type
      if (!this.batches.has(batchType)) {
        this.batches.set(batchType, {
          items: new Map(),
          promises: new Map(),
          batchFunction: batchFunction,
          timeout: null,
          options: {
            maxSize: options.maxSize || this.maxBatchSize,
            maxWait: options.maxWait || this.maxWaitTime,
            minSize: options.minSize || this.minBatchSize
          }
        });
      }
      
      const batch = this.batches.get(batchType);
      
      // Add item to batch
      batch.items.set(key, {
        key: key,
        addedAt: Date.now()
      });
      
      batch.promises.set(key, { resolve, reject });
      
      // Set timeout if this is the first item
      if (batch.items.size === 1 && !batch.timeout) {
        batch.timeout = setTimeout(() => {
          this.processBatch(batchType, 'timeout');
        }, batch.options.maxWait);
      }
      
      // Process immediately if batch is full
      if (batch.items.size >= batch.options.maxSize) {
        this.processBatch(batchType, 'full');
      }
    });
  }

  /**
   * Process a batch
   */
  async processBatch(batchType, reason = 'manual') {
    const batch = this.batches.get(batchType);
    if (!batch || batch.items.size === 0) {
      return;
    }
    
    // Clear timeout
    if (batch.timeout) {
      clearTimeout(batch.timeout);
      batch.timeout = null;
    }
    
    // Don't process if batch is too small (unless timeout)
    if (batch.items.size < batch.options.minSize && reason !== 'timeout') {
      return;
    }
    
    // Extract batch data
    const items = Array.from(batch.items.keys());
    const promises = new Map(batch.promises);
    const batchFunction = batch.batchFunction;
    
    // Clear batch
    batch.items.clear();
    batch.promises.clear();
    
    // Update statistics
    this.stats.batchedRequests += items.length;
    this.stats.totalBatches++;
    this.stats.totalBatchSize += items.length;
    this.stats.averageBatchSize = this.stats.totalBatchSize / this.stats.totalBatches;
    
    if (reason === 'timeout') {
      this.stats.timeouts++;
    }
    
    console.log(`📦 Processing ${batchType} batch: ${items.length} items (${reason})`);
    
    try {
      // Execute batch function
      const startTime = Date.now();
      const results = await batchFunction(items);
      const endTime = Date.now();
      
      console.log(`✅ Batch completed in ${endTime - startTime}ms`);
      
      // Resolve individual promises
      for (const [key, promise] of promises) {
        const result = results[key];
        if (result !== undefined) {
          promise.resolve(result);
        } else {
          promise.reject(new Error(`No result for key: ${key}`));
        }
      }
      
    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Batch processing failed:`, error);
      
      // Reject all promises
      for (const [key, promise] of promises) {
        promise.reject(error);
      }
    }
  }

  /**
   * Process all pending batches
   */
  async processAllBatches() {
    const batchTypes = Array.from(this.batches.keys());
    
    for (const batchType of batchTypes) {
      await this.processBatch(batchType, 'manual');
    }
  }

  /**
   * Batch token metadata lookups
   */
  async batchTokenMetadata(tokenMints, metadataFunction) {
    if (!Array.isArray(tokenMints)) {
      tokenMints = [tokenMints];
    }
    
    const promises = tokenMints.map(mint => 
      this.addToBatch('metadata', mint, async (batchMints) => {
        const results = {};
        
        try {
          // Process in chunks to avoid overwhelming APIs
          const chunks = this.chunkArray(batchMints, 5);
          
          for (const chunk of chunks) {
            const chunkResults = await metadataFunction(chunk);
            Object.assign(results, chunkResults);
            
            // Small delay between chunks
            if (chunks.length > 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          
        } catch (error) {
          console.error('Error in metadata batch:', error);
          throw error;
        }
        
        return results;
      }, { maxSize: 8, maxWait: 1500 })
    );
    
    return Promise.all(promises);
  }

  /**
   * Batch price data lookups  
   */
  async batchPriceData(tokenMints, priceFunction) {
    if (!Array.isArray(tokenMints)) {
      tokenMints = [tokenMints];
    }
    
    const promises = tokenMints.map(mint => 
      this.addToBatch('prices', mint, async (batchMints) => {
        const results = {};
        
        try {
          // Group into smaller chunks for price APIs
          const chunks = this.chunkArray(batchMints, 10);
          
          for (const chunk of chunks) {
            const chunkResults = await priceFunction(chunk);
            Object.assign(results, chunkResults);
            
            // Small delay between chunks
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
        } catch (error) {
          console.error('Error in price batch:', error);
          throw error;
        }
        
        return results;
      }, { maxSize: 15, maxWait: 1000 })
    );
    
    return Promise.all(promises);
  }

  /**
   * Batch risk assessments
   */
  async batchRiskAssessments(tokenMints, riskFunction) {
    if (!Array.isArray(tokenMints)) {
      tokenMints = [tokenMints];
    }
    
    const promises = tokenMints.map(mint => 
      this.addToBatch('risk', mint, async (batchMints) => {
        const results = {};
        
        try {
          // Process risk assessments in smaller chunks
          const chunks = this.chunkArray(batchMints, 3);
          
          for (const chunk of chunks) {
            const chunkResults = await riskFunction(chunk);
            Object.assign(results, chunkResults);
            
            // Longer delay for risk assessment to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (error) {
          console.error('Error in risk assessment batch:', error);
          throw error;
        }
        
        return results;
      }, { maxSize: 6, maxWait: 3000 })
    );
    
    return Promise.all(promises);
  }

  /**
   * Batch liquidity checks
   */
  async batchLiquidityChecks(tokenMints, liquidityFunction) {
    if (!Array.isArray(tokenMints)) {
      tokenMints = [tokenMints];
    }
    
    const promises = tokenMints.map(mint => 
      this.addToBatch('liquidity', mint, async (batchMints) => {
        const results = {};
        
        try {
          // Process liquidity checks in chunks
          const chunks = this.chunkArray(batchMints, 5);
          
          for (const chunk of chunks) {
            const chunkResults = await liquidityFunction(chunk);
            Object.assign(results, chunkResults);
            
            // Delay to respect API limits
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
        } catch (error) {
          console.error('Error in liquidity batch:', error);
          throw error;
        }
        
        return results;
      }, { maxSize: 8, maxWait: 2000 })
    );
    
    return Promise.all(promises);
  }

  /**
   * Utility function to chunk arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Get batch status for a specific type
   */
  getBatchStatus(batchType) {
    const batch = this.batches.get(batchType);
    if (!batch) {
      return null;
    }
    
    return {
      type: batchType,
      itemCount: batch.items.size,
      maxSize: batch.options.maxSize,
      hasTimeout: batch.timeout !== null,
      oldestItem: batch.items.size > 0 
        ? Math.min(...Array.from(batch.items.values()).map(item => item.addedAt))
        : null
    };
  }

  /**
   * Get all batch statuses
   */
  getAllBatchStatuses() {
    const statuses = {};
    
    for (const batchType of this.batches.keys()) {
      statuses[batchType] = this.getBatchStatus(batchType);
    }
    
    return statuses;
  }

  /**
   * Get statistics
   */
  getStats() {
    const batchEfficiency = this.stats.totalRequests > 0 
      ? (this.stats.batchedRequests / this.stats.totalRequests * 100).toFixed(2)
      : 0;
      
    return {
      ...this.stats,
      batchEfficiency: `${batchEfficiency}%`,
      activeBatches: this.batches.size,
      pendingItems: Array.from(this.batches.values())
        .reduce((total, batch) => total + batch.items.size, 0)
    };
  }

  /**
   * Log current statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log('\n=== Batch Manager Stats ===');
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`Batched Requests: ${stats.batchedRequests}`);
    console.log(`Batch Efficiency: ${stats.batchEfficiency}`);
    console.log(`Total Batches: ${stats.totalBatches}`);
    console.log(`Average Batch Size: ${stats.averageBatchSize.toFixed(2)}`);
    console.log(`Timeouts: ${stats.timeouts}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Active Batches: ${stats.activeBatches}`);
    console.log(`Pending Items: ${stats.pendingItems}`);
    console.log('===========================\n');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      batchedRequests: 0,
      totalBatches: 0,
      averageBatchSize: 0,
      totalBatchSize: 0,
      timeouts: 0,
      errors: 0
    };
  }

  /**
   * Clear all batches
   */
  clearAllBatches() {
    for (const [batchType, batch] of this.batches) {
      // Clear timeout
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }
      
      // Reject all pending promises
      for (const [key, promise] of batch.promises) {
        promise.reject(new Error('Batch cleared'));
      }
      
      batch.items.clear();
      batch.promises.clear();
    }
    
    this.batches.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this, newConfig);
    console.log('BatchManager configuration updated:', newConfig);
  }

  /**
   * Destroy the batch manager
   */
  destroy() {
    this.clearAllBatches();
  }
}

module.exports = BatchManager;
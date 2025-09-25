/**
 * CacheManager - Intelligent caching system to reduce redundant API calls
 * Supports multiple TTL strategies and cache levels
 */

class CacheManager {
  constructor(options = {}) {
    // Cache storage
    this.caches = {
      tokenMetadata: new Map(),
      priceData: new Map(),
      riskAssessments: new Map(),
      liquidityData: new Map(),
      holderData: new Map(),
      volumeData: new Map()
    };
    
    // TTL configurations (in milliseconds)
    this.ttls = {
      tokenMetadata: options.tokenMetadataTTL || 1800000,    // 30 minutes
      priceData: options.priceDataTTL || 30000,              // 30 seconds
      riskAssessments: options.riskAssessmentsTTL || 600000,  // 10 minutes
      liquidityData: options.liquidityDataTTL || 60000,       // 1 minute
      holderData: options.holderDataTTL || 300000,           // 5 minutes
      volumeData: options.volumeDataTTL || 120000            // 2 minutes
    };
    
    // Cache limits to prevent memory bloat
    this.limits = {
      tokenMetadata: options.tokenMetadataLimit || 5000,
      priceData: options.priceDataLimit || 2000,
      riskAssessments: options.riskAssessmentsLimit || 3000,
      liquidityData: options.liquidityDataLimit || 2000,
      holderData: options.holderDataLimit || 2000,
      volumeData: options.volumeDataLimit || 2000
    };
    
    // Statistics
    this.stats = {
      hits: {},
      misses: {},
      sets: {},
      evictions: {}
    };
    
    // Initialize stats for each cache type
    Object.keys(this.caches).forEach(cacheType => {
      this.stats.hits[cacheType] = 0;
      this.stats.misses[cacheType] = 0;
      this.stats.sets[cacheType] = 0;
      this.stats.evictions[cacheType] = 0;
    });
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  /**
   * Get cached data
   */
  get(cacheType, key) {
    if (!this.caches[cacheType]) {
      throw new Error(`Invalid cache type: ${cacheType}`);
    }
    
    const cache = this.caches[cacheType];
    const entry = cache.get(key);
    
    if (!entry) {
      this.stats.misses[cacheType]++;
      return null;
    }
    
    // Check if entry is expired
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      this.stats.misses[cacheType]++;
      return null;
    }
    
    // Update access time for LRU
    entry.lastAccessed = Date.now();
    this.stats.hits[cacheType]++;
    
    return entry.data;
  }

  /**
   * Set cached data
   */
  set(cacheType, key, data, customTTL = null) {
    if (!this.caches[cacheType]) {
      throw new Error(`Invalid cache type: ${cacheType}`);
    }
    
    const cache = this.caches[cacheType];
    const ttl = customTTL || this.ttls[cacheType];
    const now = Date.now();
    
    // Check cache size limit and evict if necessary
    if (cache.size >= this.limits[cacheType]) {
      this.evictOldest(cacheType);
    }
    
    const entry = {
      data: data,
      createdAt: now,
      expiresAt: now + ttl,
      lastAccessed: now
    };
    
    cache.set(key, entry);
    this.stats.sets[cacheType]++;
    
    return true;
  }

  /**
   * Check if key exists and is not expired
   */
  has(cacheType, key) {
    return this.get(cacheType, key) !== null;
  }

  /**
   * Delete specific key
   */
  delete(cacheType, key) {
    if (!this.caches[cacheType]) {
      return false;
    }
    
    return this.caches[cacheType].delete(key);
  }

  /**
   * Clear entire cache type
   */
  clear(cacheType) {
    if (!this.caches[cacheType]) {
      return false;
    }
    
    this.caches[cacheType].clear();
    return true;
  }

  /**
   * Clear all caches
   */
  clearAll() {
    Object.keys(this.caches).forEach(cacheType => {
      this.caches[cacheType].clear();
    });
  }

  /**
   * Evict oldest entry from cache (LRU)
   */
  evictOldest(cacheType) {
    const cache = this.caches[cacheType];
    if (cache.size === 0) return;
    
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      cache.delete(oldestKey);
      this.stats.evictions[cacheType]++;
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let totalEvicted = 0;
    
    Object.keys(this.caches).forEach(cacheType => {
      const cache = this.caches[cacheType];
      const keysToDelete = [];
      
      for (const [key, entry] of cache.entries()) {
        if (now > entry.expiresAt) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => {
        cache.delete(key);
        this.stats.evictions[cacheType]++;
        totalEvicted++;
      });
    });
    
    if (totalEvicted > 0) {
      console.log(`Cache cleanup: evicted ${totalEvicted} expired entries`);
    }
  }

  /**
   * Get multiple values at once
   */
  getMany(cacheType, keys) {
    const results = {};
    
    keys.forEach(key => {
      const value = this.get(cacheType, key);
      if (value !== null) {
        results[key] = value;
      }
    });
    
    return results;
  }

  /**
   * Set multiple values at once
   */
  setMany(cacheType, entries, customTTL = null) {
    const results = {};
    
    Object.entries(entries).forEach(([key, data]) => {
      results[key] = this.set(cacheType, key, data, customTTL);
    });
    
    return results;
  }

  /**
   * Get or set pattern (cache-aside pattern)
   */
  async getOrSet(cacheType, key, fetchFunction, customTTL = null) {
    // Try to get from cache first
    let data = this.get(cacheType, key);
    
    if (data !== null) {
      return data;
    }
    
    // Not in cache, fetch the data
    try {
      data = await fetchFunction();
      
      // Store in cache
      if (data !== null && data !== undefined) {
        this.set(cacheType, key, data, customTTL);
      }
      
      return data;
    } catch (error) {
      console.error(`Error in getOrSet for ${cacheType}:${key}:`, error);
      throw error;
    }
  }

  /**
   * Batch get-or-set for multiple keys
   */
  async batchGetOrSet(cacheType, keys, batchFetchFunction, customTTL = null) {
    const results = {};
    const missingKeys = [];
    
    // Check cache for each key
    keys.forEach(key => {
      const cached = this.get(cacheType, key);
      if (cached !== null) {
        results[key] = cached;
      } else {
        missingKeys.push(key);
      }
    });
    
    // Fetch missing data in batch
    if (missingKeys.length > 0) {
      try {
        const fetchedData = await batchFetchFunction(missingKeys);
        
        // Store fetched data in cache
        Object.entries(fetchedData).forEach(([key, data]) => {
          if (data !== null && data !== undefined) {
            this.set(cacheType, key, data, customTTL);
            results[key] = data;
          }
        });
        
      } catch (error) {
        console.error(`Error in batchGetOrSet for ${cacheType}:`, error);
        throw error;
      }
    }
    
    return results;
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidatePattern(cacheType, pattern) {
    if (!this.caches[cacheType]) {
      return 0;
    }
    
    const cache = this.caches[cacheType];
    const keysToDelete = [];
    
    for (const key of cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => cache.delete(key));
    
    return keysToDelete.length;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalHits = Object.values(this.stats.hits).reduce((a, b) => a + b, 0);
    const totalMisses = Object.values(this.stats.misses).reduce((a, b) => a + b, 0);
    const totalRequests = totalHits + totalMisses;
    
    const hitRate = totalRequests > 0 
      ? (totalHits / totalRequests * 100).toFixed(2)
      : 0;
    
    const cacheInfo = {};
    Object.keys(this.caches).forEach(cacheType => {
      const cache = this.caches[cacheType];
      const hits = this.stats.hits[cacheType];
      const misses = this.stats.misses[cacheType];
      const requests = hits + misses;
      const typeHitRate = requests > 0 ? (hits / requests * 100).toFixed(2) : 0;
      
      cacheInfo[cacheType] = {
        size: cache.size,
        limit: this.limits[cacheType],
        hitRate: `${typeHitRate}%`,
        hits: hits,
        misses: misses,
        sets: this.stats.sets[cacheType],
        evictions: this.stats.evictions[cacheType]
      };
    });
    
    return {
      totalHitRate: `${hitRate}%`,
      totalHits: totalHits,
      totalMisses: totalMisses,
      totalRequests: totalRequests,
      caches: cacheInfo
    };
  }

  /**
   * Log cache statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log('\n=== Cache Manager Stats ===');
    console.log(`Overall Hit Rate: ${stats.totalHitRate}`);
    console.log(`Total Requests: ${stats.totalRequests} (${stats.totalHits} hits, ${stats.totalMisses} misses)`);
    console.log('\nPer-Cache Stats:');
    
    Object.entries(stats.caches).forEach(([cacheType, info]) => {
      console.log(`  ${cacheType}: ${info.size}/${info.limit} entries, ${info.hitRate} hit rate`);
      console.log(`    Hits: ${info.hits}, Misses: ${info.misses}, Sets: ${info.sets}, Evictions: ${info.evictions}`);
    });
    console.log('==========================\n');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    Object.keys(this.caches).forEach(cacheType => {
      this.stats.hits[cacheType] = 0;
      this.stats.misses[cacheType] = 0;
      this.stats.sets[cacheType] = 0;
      this.stats.evictions[cacheType] = 0;
    });
  }

  /**
   * Update cache configuration
   */
  updateConfig(newConfig) {
    if (newConfig.ttls) {
      Object.assign(this.ttls, newConfig.ttls);
    }
    
    if (newConfig.limits) {
      Object.assign(this.limits, newConfig.limits);
    }
    
    console.log('CacheManager configuration updated:', newConfig);
  }

  /**
   * Get memory usage estimate (rough)
   */
  getMemoryUsage() {
    let totalEntries = 0;
    let totalSize = 0;
    
    Object.entries(this.caches).forEach(([cacheType, cache]) => {
      const entries = cache.size;
      totalEntries += entries;
      
      // Rough estimate: each entry ~1KB average
      totalSize += entries * 1024;
    });
    
    return {
      totalEntries: totalEntries,
      estimatedSizeBytes: totalSize,
      estimatedSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * Destroy cache manager (cleanup)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.clearAll();
  }
}

module.exports = CacheManager;
/**
 * SelectiveFilter - Filters tokens to focus on high-value/promising memecoins only
 * Reduces monitoring load by skipping obvious scams and low-value tokens
 */

class SelectiveFilter {
  constructor(options = {}) {
    // Minimum thresholds for token consideration
    this.minLiquidityUSD = options.minLiquidityUSD || 5000;
    this.minTradingVolume = options.minTradingVolume || 1000;
    this.minHolders = options.minHolders || 20;
    this.maxSupply = options.maxSupply || 1000000000; // 1B tokens max
    
    // Time-based filtering
    this.minTokenAge = options.minTokenAge || 60000; // 1 minute old minimum
    this.maxTokenAge = options.maxTokenAge || 3600000; // 1 hour maximum for "new" tokens
    
    // Risk filtering
    this.maxRiskScore = options.maxRiskScore || 7; // 0-10 scale
    this.requireVerifiedCreator = options.requireVerifiedCreator || false;
    
    // Performance tracking
    this.stats = {
      totalProcessed: 0,
      passed: 0,
      filtered: 0,
      reasons: {}
    };
    
    // Recently processed tokens cache (to avoid reprocessing)
    this.processedTokens = new Map();
    this.processedTokensExpiry = 300000; // 5 minutes
  }

  /**
   * Main filtering function - returns true if token should be monitored
   */
  async shouldMonitor(tokenData) {
    this.stats.totalProcessed++;
    
    try {
      // Skip if recently processed
      if (this.wasRecentlyProcessed(tokenData.mint)) {
        this.incrementFilterReason('recently_processed');
        return false;
      }
      
      // Basic data validation
      if (!this.hasBasicData(tokenData)) {
        this.incrementFilterReason('missing_basic_data');
        return false;
      }
      
      // Age filtering
      if (!this.passesAgeFilter(tokenData)) {
        this.incrementFilterReason('age_filter');
        return false;
      }
      
      // Supply filtering
      if (!this.passesSupplyFilter(tokenData)) {
        this.incrementFilterReason('supply_filter');
        return false;
      }
      
      // Liquidity filtering (if available)
      if (tokenData.liquidity !== undefined && !this.passesLiquidityFilter(tokenData)) {
        this.incrementFilterReason('liquidity_filter');
        return false;
      }
      
      // Volume filtering (if available)
      if (tokenData.volume !== undefined && !this.passesVolumeFilter(tokenData)) {
        this.incrementFilterReason('volume_filter');
        return false;
      }
      
      // Holder count filtering (if available)
      if (tokenData.holders !== undefined && !this.passesHolderFilter(tokenData)) {
        this.incrementFilterReason('holder_filter');
        return false;
      }
      
      // Risk score filtering (if available)
      if (tokenData.riskScore !== undefined && !this.passesRiskFilter(tokenData)) {
        this.incrementFilterReason('risk_filter');
        return false;
      }
      
      // Scam detection patterns
      if (!this.passesScamDetection(tokenData)) {
        this.incrementFilterReason('scam_detection');
        return false;
      }
      
      // If we get here, token passed all filters
      this.stats.passed++;
      this.markAsProcessed(tokenData.mint);
      
      return true;
      
    } catch (error) {
      console.error(`Error filtering token ${tokenData.mint}:`, error);
      this.incrementFilterReason('error');
      return false;
    }
  }

  /**
   * Check if token was recently processed to avoid duplicates
   */
  wasRecentlyProcessed(mint) {
    const entry = this.processedTokens.get(mint);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > this.processedTokensExpiry) {
      this.processedTokens.delete(mint);
      return false;
    }
    
    return true;
  }

  /**
   * Mark token as processed
   */
  markAsProcessed(mint) {
    this.processedTokens.set(mint, {
      timestamp: Date.now()
    });
    
    // Clean old entries periodically
    if (this.processedTokens.size > 1000) {
      this.cleanOldEntries();
    }
  }

  /**
   * Clean expired entries from processed tokens cache
   */
  cleanOldEntries() {
    const now = Date.now();
    for (const [mint, entry] of this.processedTokens.entries()) {
      if (now - entry.timestamp > this.processedTokensExpiry) {
        this.processedTokens.delete(mint);
      }
    }
  }

  /**
   * Basic data validation
   */
  hasBasicData(tokenData) {
    return tokenData && 
           tokenData.mint && 
           tokenData.name && 
           tokenData.symbol &&
           tokenData.mint.length === 44; // Valid Solana address length
  }

  /**
   * Age-based filtering
   */
  passesAgeFilter(tokenData) {
    if (!tokenData.createdAt) return true; // Skip if no timestamp
    
    const age = Date.now() - new Date(tokenData.createdAt).getTime();
    return age >= this.minTokenAge && age <= this.maxTokenAge;
  }

  /**
   * Supply-based filtering
   */
  passesSupplyFilter(tokenData) {
    if (!tokenData.supply) return true; // Skip if no supply data
    
    const supply = parseFloat(tokenData.supply);
    return supply > 0 && supply <= this.maxSupply;
  }

  /**
   * Liquidity-based filtering
   */
  passesLiquidityFilter(tokenData) {
    const liquidity = parseFloat(tokenData.liquidity);
    return liquidity >= this.minLiquidityUSD;
  }

  /**
   * Volume-based filtering
   */
  passesVolumeFilter(tokenData) {
    const volume = parseFloat(tokenData.volume);
    return volume >= this.minTradingVolume;
  }

  /**
   * Holder count filtering
   */
  passesHolderFilter(tokenData) {
    const holders = parseInt(tokenData.holders);
    return holders >= this.minHolders;
  }

  /**
   * Risk score filtering
   */
  passesRiskFilter(tokenData) {
    const riskScore = parseFloat(tokenData.riskScore);
    return riskScore <= this.maxRiskScore;
  }

  /**
   * Scam detection based on common patterns
   */
  passesScamDetection(tokenData) {
    const name = tokenData.name?.toLowerCase() || '';
    const symbol = tokenData.symbol?.toLowerCase() || '';
    
    // Common scam patterns
    const scamPatterns = [
      /test/i,
      /fake/i,
      /scam/i,
      /rug/i,
      /honeypot/i,
      /^[a-z]{1,2}$/,  // Very short symbols
      /^\d+$/,         // Only numbers
      /^[^a-zA-Z]*$/   // No letters at all
    ];
    
    // Check for suspicious patterns
    for (const pattern of scamPatterns) {
      if (pattern.test(name) || pattern.test(symbol)) {
        return false;
      }
    }
    
    // Check for excessive emoji or special characters
    const specialCharCount = (name.match(/[^\w\s]/g) || []).length;
    if (specialCharCount > name.length * 0.3) { // More than 30% special chars
      return false;
    }
    
    return true;
  }

  /**
   * Track filtering reasons
   */
  incrementFilterReason(reason) {
    this.stats.filtered++;
    this.stats.reasons[reason] = (this.stats.reasons[reason] || 0) + 1;
  }

  /**
   * Get filtering statistics
   */
  getStats() {
    const passRate = this.stats.totalProcessed > 0 
      ? (this.stats.passed / this.stats.totalProcessed * 100).toFixed(2)
      : 0;
      
    return {
      ...this.stats,
      passRate: `${passRate}%`,
      processedTokensCacheSize: this.processedTokens.size
    };
  }

  /**
   * Log current statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log('\n=== Selective Filter Stats ===');
    console.log(`Total Processed: ${stats.totalProcessed}`);
    console.log(`Passed: ${stats.passed} (${stats.passRate})`);
    console.log(`Filtered: ${stats.filtered}`);
    console.log('Filter Reasons:', stats.reasons);
    console.log(`Cache Size: ${stats.processedTokensCacheSize}`);
    console.log('==============================\n');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      passed: 0,
      filtered: 0,
      reasons: {}
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this, newConfig);
    console.log('SelectiveFilter configuration updated:', newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      minLiquidityUSD: this.minLiquidityUSD,
      minTradingVolume: this.minTradingVolume,
      minHolders: this.minHolders,
      maxSupply: this.maxSupply,
      minTokenAge: this.minTokenAge,
      maxTokenAge: this.maxTokenAge,
      maxRiskScore: this.maxRiskScore,
      requireVerifiedCreator: this.requireVerifiedCreator
    };
  }
}

module.exports = SelectiveFilter;
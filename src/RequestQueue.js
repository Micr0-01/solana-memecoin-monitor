/**
 * RequestQueue - Manages API request rate limiting and queuing
 * Prevents rate limit errors by controlling request frequency
 */

class RequestQueue {
  constructor(options = {}) {
    this.maxRequestsPerSecond = options.maxRequestsPerSecond || 10;
    this.maxConcurrent = options.maxConcurrent || 5;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    
    // Queue state
    this.queue = [];
    this.processing = false;
    this.activeRequests = 0;
    this.requestTimes = [];
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0,
      totalResponseTime: 0
    };
    
    // Auto-cleanup old request times
    setInterval(() => this.cleanupOldTimes(), 1000);
  }

  /**
   * Add request to queue
   */
  async enqueue(requestFunction, priority = 0) {
    return new Promise((resolve, reject) => {
      const request = {
        fn: requestFunction,
        priority: priority,
        resolve: resolve,
        reject: reject,
        attempts: 0,
        startTime: Date.now()
      };
      
      // Insert based on priority (higher numbers first)
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].priority < priority) {
          this.queue.splice(i, 0, request);
          inserted = true;
          break;
        }
      }
      
      if (!inserted) {
        this.queue.push(request);
      }
      
      this.stats.totalRequests++;
      
      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the request queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      if (!this.canMakeRequest()) {
        await this.waitForRateLimit();
        continue;
      }
      
      const request = this.queue.shift();
      this.executeRequest(request);
    }
    
    this.processing = false;
    
    // Continue processing if there are more requests
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  /**
   * Execute individual request
   */
  async executeRequest(request) {
    this.activeRequests++;
    this.recordRequestTime();
    
    try {
      const startTime = Date.now();
      const result = await request.fn();
      const endTime = Date.now();
      
      // Update statistics
      const responseTime = endTime - startTime;
      this.stats.successfulRequests++;
      this.stats.totalResponseTime += responseTime;
      this.stats.averageResponseTime = this.stats.totalResponseTime / this.stats.successfulRequests;
      
      request.resolve(result);
      
    } catch (error) {
      await this.handleRequestError(request, error);
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Handle request errors with retry logic
   */
  async handleRequestError(request, error) {
    request.attempts++;
    
    // Check if it's a rate limit error
    const isRateLimit = this.isRateLimitError(error);
    if (isRateLimit) {
      this.stats.rateLimitErrors++;
    }
    
    // Retry logic
    const shouldRetry = request.attempts < this.retryAttempts && 
                       (isRateLimit || this.isRetriableError(error));
    
    if (shouldRetry) {
      const delay = this.calculateRetryDelay(request.attempts, isRateLimit);
      
      setTimeout(() => {
        // Re-add to front of queue for faster retry
        this.queue.unshift(request);
        if (!this.processing) {
          this.processQueue();
        }
      }, delay);
      
    } else {
      this.stats.failedRequests++;
      request.reject(error);
    }
  }

  /**
   * Check if error is due to rate limiting
   */
  isRateLimitError(error) {
    if (!error) return false;
    
    const message = error.message || error.toString();
    return message.includes('429') || 
           message.includes('Too Many Requests') ||
           message.includes('rate limit') ||
           message.includes('Rate limit');
  }

  /**
   * Check if error should be retried
   */
  isRetriableError(error) {
    if (!error) return false;
    
    const message = error.message || error.toString();
    return message.includes('timeout') ||
           message.includes('ECONNRESET') ||
           message.includes('ETIMEDOUT') ||
           message.includes('503') ||
           message.includes('502') ||
           message.includes('network');
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(attempts, isRateLimit) {
    const baseDelay = this.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempts - 1);
    
    // Longer delays for rate limit errors
    const rateLimitMultiplier = isRateLimit ? 3 : 1;
    
    return Math.min(exponentialDelay * rateLimitMultiplier, 30000); // Max 30 seconds
  }

  /**
   * Check if we can make a request based on rate limits
   */
  canMakeRequest() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Count requests in the last second
    const recentRequests = this.requestTimes.filter(time => time > oneSecondAgo).length;
    
    return recentRequests < this.maxRequestsPerSecond;
  }

  /**
   * Wait until we can make another request
   */
  async waitForRateLimit() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    const oldestRecentRequest = this.requestTimes.find(time => time > oneSecondAgo);
    
    if (oldestRecentRequest) {
      const waitTime = oldestRecentRequest + 1000 - now + 50; // Add 50ms buffer
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Record the time of a request
   */
  recordRequestTime() {
    this.requestTimes.push(Date.now());
  }

  /**
   * Clean up old request times to prevent memory leaks
   */
  cleanupOldTimes() {
    const fiveSecondsAgo = Date.now() - 5000;
    this.requestTimes = this.requestTimes.filter(time => time > fiveSecondsAgo);
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      processing: this.processing,
      recentRequests: this.requestTimes.filter(time => time > Date.now() - 1000).length,
      ...this.stats
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      successRate: this.stats.totalRequests > 0 
        ? (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * Log current statistics
   */
  logStats() {
    const stats = this.getStats();
    console.log('\n=== Request Queue Stats ===');
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`Successful: ${stats.successfulRequests}`);
    console.log(`Failed: ${stats.failedRequests}`);
    console.log(`Rate Limit Errors: ${stats.rateLimitErrors}`);
    console.log(`Success Rate: ${stats.successRate}`);
    console.log(`Average Response Time: ${stats.averageResponseTime.toFixed(2)}ms`);
    console.log(`Queue Length: ${stats.queueLength}`);
    console.log(`Active Requests: ${stats.activeRequests}`);
    console.log('===========================\n');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitErrors: 0,
      averageResponseTime: 0,
      totalResponseTime: 0
    };
  }

  /**
   * Clear the queue
   */
  clearQueue() {
    // Reject all pending requests
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    
    this.queue = [];
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    Object.assign(this, newConfig);
    console.log('RequestQueue configuration updated:', newConfig);
  }

  /**
   * Destroy the queue and cleanup
   */
  destroy() {
    this.clearQueue();
    this.processing = false;
    this.requestTimes = [];
  }
}

module.exports = RequestQueue;
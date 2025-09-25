const logger = require('./logger');

class RequestQueue {
  constructor() {
    this.queues = new Map(); // endpoint -> queue
    this.processing = new Map(); // endpoint -> boolean
    this.rateLimits = new Map(); // endpoint -> { maxRPS, currentCount, resetTime }
    this.stats = new Map(); // endpoint -> { requests, errors, avgResponseTime }
  }

  /**
   * Configure rate limits for an endpoint
   */
  configureEndpoint(endpoint, maxRPS = 10, burstLimit = 20) {
    this.rateLimits.set(endpoint, {
      maxRPS,
      burstLimit,
      currentCount: 0,
      resetTime: Date.now() + 1000,
      lastRequest: 0
    });
    
    this.queues.set(endpoint, []);
    this.processing.set(endpoint, false);
    this.stats.set(endpoint, {
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      avgResponseTime: 0
    });
    
    logger.debug(`Configured rate limit for ${endpoint}: ${maxRPS} RPS, ${burstLimit} burst`);
  }

  /**
   * Add a request to the queue
   */
  async enqueue(endpoint, requestFn, priority = 0, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const request = {
        fn: requestFn,
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
        timeout: setTimeout(() => {
          reject(new Error(`Request timeout after ${timeout}ms`));
        }, timeout)
      };

      const queue = this.queues.get(endpoint);
      if (!queue) {
        reject(new Error(`Endpoint ${endpoint} not configured`));
        return;
      }

      // Insert based on priority (higher priority first)
      const insertIndex = queue.findIndex(r => r.priority < priority);
      if (insertIndex === -1) {
        queue.push(request);
      } else {
        queue.splice(insertIndex, 0, request);
      }

      this.processQueue(endpoint);
    });
  }

  /**
   * Process the queue for an endpoint
   */
  async processQueue(endpoint) {
    if (this.processing.get(endpoint)) {
      return; // Already processing
    }

    const queue = this.queues.get(endpoint);
    const rateLimit = this.rateLimits.get(endpoint);
    
    if (!queue || !rateLimit || queue.length === 0) {
      return;
    }

    this.processing.set(endpoint, true);

    while (queue.length > 0) {
      // Check rate limits
      const now = Date.now();
      
      // Reset counter if time window has passed
      if (now >= rateLimit.resetTime) {
        rateLimit.currentCount = 0;
        rateLimit.resetTime = now + 1000;
      }

      // Check if we can make a request
      if (rateLimit.currentCount >= rateLimit.maxRPS) {
        const waitTime = rateLimit.resetTime - now;
        logger.debug(`Rate limit reached for ${endpoint}, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
        continue;
      }

      // Add minimum delay between requests
      const timeSinceLastRequest = now - rateLimit.lastRequest;
      const minDelay = Math.floor(1000 / rateLimit.maxRPS);
      
      if (timeSinceLastRequest < minDelay) {
        await this.sleep(minDelay - timeSinceLastRequest);
      }

      const request = queue.shift();
      if (!request) continue;

      try {
        // Clear timeout
        clearTimeout(request.timeout);
        
        // Execute request
        const startTime = Date.now();
        rateLimit.currentCount++;
        rateLimit.lastRequest = Date.now();
        
        const result = await request.fn();
        const responseTime = Date.now() - startTime;
        
        // Update stats
        this.updateStats(endpoint, responseTime, false);
        
        request.resolve(result);
      } catch (error) {
        this.updateStats(endpoint, 0, true);
        request.reject(error);
        
        // Add exponential backoff on errors
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          const backoffTime = Math.min(5000, 500 * Math.pow(2, this.getErrorCount(endpoint) % 5));
          logger.warn(`Rate limited on ${endpoint}, backing off for ${backoffTime}ms`);
          await this.sleep(backoffTime);
        }
      }
    }

    this.processing.set(endpoint, false);
  }

  /**
   * Update statistics for an endpoint
   */
  updateStats(endpoint, responseTime, isError) {
    const stats = this.stats.get(endpoint);
    if (!stats) return;

    stats.requests++;
    if (isError) {
      stats.errors++;
    } else {
      stats.totalResponseTime += responseTime;
      stats.avgResponseTime = stats.totalResponseTime / (stats.requests - stats.errors);
    }
  }

  /**
   * Get error count for backoff calculation
   */
  getErrorCount(endpoint) {
    const stats = this.stats.get(endpoint);
    return stats ? stats.errors : 0;
  }

  /**
   * Get queue status
   */
  getStatus() {
    const status = {};
    
    for (const [endpoint, queue] of this.queues.entries()) {
      const stats = this.stats.get(endpoint);
      const rateLimit = this.rateLimits.get(endpoint);
      
      status[endpoint] = {
        queueLength: queue.length,
        processing: this.processing.get(endpoint),
        requests: stats.requests,
        errors: stats.errors,
        errorRate: stats.requests > 0 ? (stats.errors / stats.requests * 100).toFixed(1) + '%' : '0%',
        avgResponseTime: Math.round(stats.avgResponseTime) + 'ms',
        currentRPS: rateLimit.currentCount,
        maxRPS: rateLimit.maxRPS,
        resetIn: Math.max(0, rateLimit.resetTime - Date.now()) + 'ms'
      };
    }
    
    return status;
  }

  /**
   * Log queue status
   */
  logStatus() {
    const status = this.getStatus();
    logger.info('📊 Request Queue Status:');
    
    for (const [endpoint, stats] of Object.entries(status)) {
      logger.info(`  ${endpoint}: Queue(${stats.queueLength}) RPS(${stats.currentRPS}/${stats.maxRPS}) Errors(${stats.errorRate}) Avg(${stats.avgResponseTime})`);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all queues (for shutdown)
   */
  clear() {
    for (const [endpoint, queue] of this.queues.entries()) {
      queue.forEach(request => {
        clearTimeout(request.timeout);
        request.reject(new Error('Queue cleared'));
      });
      queue.length = 0;
    }
    
    logger.info('🧹 Request queues cleared');
  }
}

module.exports = RequestQueue;
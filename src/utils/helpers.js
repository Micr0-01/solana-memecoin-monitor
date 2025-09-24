const retry = require('retry');

/**
 * Retry an async operation with exponential backoff
 */
async function retryAsync(fn, maxAttempts = 3, delayMs = 1000) {
  const operation = retry.operation({
    retries: maxAttempts - 1,
    factor: 2,
    minTimeout: delayMs,
    maxTimeout: delayMs * 8,
    randomize: true,
  });

  return new Promise((resolve, reject) => {
    operation.attempt(async (currentAttempt) => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        if (operation.retry(error)) {
          return;
        }
        reject(operation.mainError());
      }
    });
  });
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format a number as currency
 */
function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a large number with K/M/B suffixes
 */
function formatLargeNumber(num) {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(1) + 'B';
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1) + 'M';
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Truncate a string to a given length
 */
function truncateString(str, maxLength) {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Validate if a string is a valid Solana public key
 */
function isValidPublicKey(str) {
  try {
    const { PublicKey } = require('@solana/web3.js');
    new PublicKey(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a rate limiter function
 */
function createRateLimiter(requestsPerSecond) {
  const pLimit = require('p-limit');
  const limit = pLimit(requestsPerSecond);
  
  return function(fn) {
    return limit(fn);
  };
}

/**
 * Parse duration string (e.g., "30s", "5m", "2h") to milliseconds
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smh])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

/**
 * Create a debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a throttled function
 */
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Escape characters for Telegram markdown
 */
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
}

/**
 * Generate a short hash from a string
 */
function shortHash(str, length = 8) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, length);
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if an object is empty
 */
function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}

/**
 * Get a nested property safely
 */
function safeGet(obj, path, defaultValue = null) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : defaultValue;
  }, obj);
}

/**
 * Convert lamports to SOL
 */
function lamportsToSol(lamports) {
  return lamports / 1e9;
}

/**
 * Convert SOL to lamports
 */
function solToLamports(sol) {
  return Math.floor(sol * 1e9);
}

module.exports = {
  retryAsync,
  sleep,
  formatCurrency,
  formatLargeNumber,
  truncateString,
  isValidPublicKey,
  createRateLimiter,
  parseDuration,
  debounce,
  throttle,
  escapeMarkdown,
  shortHash,
  deepClone,
  isEmpty,
  safeGet,
  lamportsToSol,
  solToLamports,
};
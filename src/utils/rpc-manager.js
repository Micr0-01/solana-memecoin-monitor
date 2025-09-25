const { Connection } = require('@solana/web3.js');
const WebSocket = require('ws');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class RPCManager {
  constructor() {
    this.currentEndpointIndex = 0;
    this.endpoints = this.loadEndpoints();
    this.failureCounts = new Map();
    this.lastFailureTime = new Map();
    this.maxFailures = 5;
    this.cooldownPeriod = 60000; // 1 minute
  }

  loadEndpoints() {
    const endpoints = [];
    
    // Try to load API keys from ap.txt file
    const apiKeys = this.loadApiKeys();
    
    // Priority order with your API keys (only working endpoints)
    if (apiKeys.helius) {
      endpoints.push({
        name: 'Helius (Primary)',
        http: `https://rpc.helius.xyz/?api-key=${apiKeys.helius}`,
        ws: `wss://rpc.helius.xyz/?api-key=${apiKeys.helius}`,
        priority: 1,
        maxRPS: 100
      });
    }
    
    // Free endpoints as fallbacks (only working ones)
    endpoints.push({
      name: 'dRPC (Free)',
      http: 'https://solana.drpc.org',
      ws: 'wss://solana.drpc.org',
      priority: 2,
      maxRPS: 10
    });
    
    endpoints.push({
      name: 'Solana Foundation (Backup)',
      http: 'https://api.mainnet-beta.solana.com',
      ws: 'wss://api.mainnet-beta.solana.com',
      priority: 3,
      maxRPS: 2
    });
    
    logger.info(`🔗 Loaded ${endpoints.length} RPC endpoints`);
    endpoints.forEach((endpoint, index) => {
      logger.info(`  ${index + 1}. ${endpoint.name} (Priority: ${endpoint.priority})`);
    });
    
    return endpoints;
  }

  loadApiKeys() {
    const apiKeys = {};
    
    try {
      const apFilePath = path.join(process.cwd(), 'ap.txt');
      if (fs.existsSync(apFilePath)) {
        const content = fs.readFileSync(apFilePath, 'utf8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.includes('=')) {
            const [key, value] = trimmed.split('=');
            if (key && value) {
              apiKeys[key.toLowerCase().trim()] = value.trim();
            }
          }
        }
        
        logger.info(`📋 Loaded API keys: ${Object.keys(apiKeys).join(', ')}`);
      }
    } catch (error) {
      logger.warn('⚠️  Could not load API keys from ap.txt:', error.message);
    }
    
    return apiKeys;
  }

  getCurrentEndpoint() {
    return this.endpoints[this.currentEndpointIndex];
  }

  async createConnection(commitment = 'confirmed') {
    const endpoint = this.getCurrentEndpoint();
    
    try {
      const connection = new Connection(endpoint.http, { commitment });
      
      // Test the connection
      await connection.getVersion();
      
      logger.info(`✅ Connected to ${endpoint.name}`);
      this.resetFailureCount(endpoint.name);
      
      return connection;
    } catch (error) {
      logger.error(`❌ Failed to connect to ${endpoint.name}:`, error.message);
      await this.handleEndpointFailure(endpoint.name);
      throw error;
    }
  }

  async createWebSocket() {
    const endpoint = this.getCurrentEndpoint();
    
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(endpoint.ws);
        
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error(`WebSocket connection timeout to ${endpoint.name}`));
        }, 10000);
        
        ws.on('open', () => {
          clearTimeout(timeout);
          logger.info(`🔌 WebSocket connected to ${endpoint.name}`);
          this.resetFailureCount(endpoint.name);
          resolve(ws);
        });
        
        ws.on('error', async (error) => {
          clearTimeout(timeout);
          logger.error(`🔌 WebSocket error with ${endpoint.name}:`, error.message);
          await this.handleEndpointFailure(endpoint.name);
          reject(error);
        });
        
      } catch (error) {
        logger.error(`🔌 Failed to create WebSocket to ${endpoint.name}:`, error.message);
        this.handleEndpointFailure(endpoint.name);
        reject(error);
      }
    });
  }

  async handleEndpointFailure(endpointName) {
    const currentCount = this.failureCounts.get(endpointName) || 0;
    this.failureCounts.set(endpointName, currentCount + 1);
    this.lastFailureTime.set(endpointName, Date.now());
    
    const endpoint = this.endpoints[this.currentEndpointIndex];
    
    if (currentCount + 1 >= this.maxFailures) {
      logger.warn(`⚠️  ${endpointName} exceeded max failures (${this.maxFailures}), switching to next endpoint`);
      await this.switchToNextEndpoint();
    }
  }

  async switchToNextEndpoint() {
    const totalEndpoints = this.endpoints.length;
    let attempts = 0;
    
    while (attempts < totalEndpoints) {
      this.currentEndpointIndex = (this.currentEndpointIndex + 1) % totalEndpoints;
      const nextEndpoint = this.getCurrentEndpoint();
      
      // Check if this endpoint is in cooldown
      if (this.isEndpointInCooldown(nextEndpoint.name)) {
        attempts++;
        continue;
      }
      
      logger.info(`🔄 Switching to ${nextEndpoint.name}...`);
      return true;
    }
    
    logger.error('❌ All RPC endpoints are failing or in cooldown!');
    return false;
  }

  isEndpointInCooldown(endpointName) {
    const failureCount = this.failureCounts.get(endpointName) || 0;
    const lastFailure = this.lastFailureTime.get(endpointName) || 0;
    
    if (failureCount >= this.maxFailures) {
      const timeSinceFailure = Date.now() - lastFailure;
      return timeSinceFailure < this.cooldownPeriod;
    }
    
    return false;
  }

  resetFailureCount(endpointName) {
    this.failureCounts.set(endpointName, 0);
    this.lastFailureTime.delete(endpointName);
  }

  async retryWithFallback(operation, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error;
        logger.debug(`Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries - 1) {
          // Try next endpoint
          const switched = await this.switchToNextEndpoint();
          if (!switched) {
            break; // All endpoints failed
          }
          
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    throw lastError;
  }

  getEndpointStats() {
    return this.endpoints.map((endpoint, index) => ({
      index,
      name: endpoint.name,
      isActive: index === this.currentEndpointIndex,
      failures: this.failureCounts.get(endpoint.name) || 0,
      inCooldown: this.isEndpointInCooldown(endpoint.name),
      maxRPS: endpoint.maxRPS
    }));
  }

  logEndpointStats() {
    const stats = this.getEndpointStats();
    logger.info('📊 RPC Endpoint Status:');
    
    stats.forEach(stat => {
      const status = stat.isActive ? '🟢 ACTIVE' : 
                    stat.inCooldown ? '🔴 COOLDOWN' : 
                    stat.failures > 0 ? '🟡 DEGRADED' : '⚪ READY';
      
      logger.info(`  ${stat.name}: ${status} (Failures: ${stat.failures}, Max RPS: ${stat.maxRPS})`);
    });
  }
}

module.exports = RPCManager;
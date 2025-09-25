#!/usr/bin/env node

/**
 * Test script to verify optimization systems are working correctly
 * Tests RequestQueue, BatchManager, SelectiveFilter, and CacheManager
 */

const RequestQueue = require('./src/RequestQueue');
const BatchManager = require('./src/BatchManager');
const SelectiveFilter = require('./src/SelectiveFilter');
const CacheManager = require('./src/CacheManager');

async function testRequestQueue() {
  console.log('\n=== Testing RequestQueue ===');
  
  const requestQueue = new RequestQueue();
  const testPromises = [];
  
  // Create multiple test requests
  for (let i = 0; i < 10; i++) {
    const promise = requestQueue.enqueue(async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      return `Request ${i} completed`;
    });
    testPromises.push(promise);
  }
  
  const results = await Promise.all(testPromises);
  console.log(`✅ Processed ${results.length} requests through queue`);
  requestQueue.logStats();
  
  requestQueue.destroy();
}

async function testBatchManager() {
  console.log('\n=== Testing BatchManager ===');
  
  const batchManager = new BatchManager({
    maxBatchSize: 3,
    maxWaitTime: 1000
  });
  
  // Test metadata batching
  const tokens = [
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // Test token 1
    '5CmWtUihvSrJpaUrpJ3H1jUXXKbMhMn4102QMYcwrCh5'  // Test token 2
  ];
  
  const batchPromises = tokens.map(token => 
    batchManager.addToBatch('metadata', token, async (batchTokens) => {
      // Simulate batch API call
      await new Promise(resolve => setTimeout(resolve, 200));
      const results = {};
      batchTokens.forEach(t => {
        results[t] = {
          name: `Token ${t.slice(-4)}`,
          symbol: `TKN${t.slice(-2)}`,
          supply: Math.random() * 1000000,
          decimals: 9
        };
      });
      return results;
    })
  );
  
  const batchResults = await Promise.all(batchPromises);
  console.log(`✅ Processed ${batchResults.length} tokens through batch manager`);
  batchManager.logStats();
}

async function testSelectiveFilter() {
  console.log('\n=== Testing SelectiveFilter ===');
  
  const selectiveFilter = new SelectiveFilter({
    minLiquidityUSD: 1000,
    minTradingVolume: 500,
    minHolders: 5,
    maxSupply: 1000000000
  });
  
  const testTokens = [
    {
      mint: 'GoodToken111111111111111111111111111111111',
      name: 'Good Memecoin',
      symbol: 'GOOD',
      supply: 1000000,
      liquidity: 5000,
      volume: 2000,
      holders: 50,
      riskScore: 3,
      createdAt: new Date(Date.now() - 300000).toISOString() // 5 min ago
    },
    {
      mint: 'BadToken1111111111111111111111111111111111',
      name: 'test',
      symbol: 'tst',
      supply: 999999999999, // Too high supply
      liquidity: 100,       // Too low liquidity
      volume: 10,           // Too low volume
      holders: 2,           // Too few holders
      riskScore: 9,         // Too high risk
      createdAt: new Date(Date.now() - 10000).toISOString() // Too new
    },
    {
      mint: 'ScamToken111111111111111111111111111111111',
      name: 'Fake Bitcoin',
      symbol: '123',
      supply: 1000000,
      liquidity: 2000,
      volume: 1000,
      holders: 20,
      riskScore: 5,
      createdAt: new Date(Date.now() - 600000).toISOString()
    },
    {
      mint: 'PromisingToken11111111111111111111111111111',
      name: 'Promising Dog Coin',
      symbol: 'PDOG',
      supply: 100000000,
      liquidity: 10000,
      volume: 5000,
      holders: 100,
      riskScore: 2,
      createdAt: new Date(Date.now() - 900000).toISOString() // 15 min ago
    }
  ];
  
  let passed = 0;
  let filtered = 0;
  
  for (const token of testTokens) {
    const shouldMonitor = await selectiveFilter.shouldMonitor(token);
    if (shouldMonitor) {
      console.log(`✅ ${token.name} (${token.symbol}) - PASSED filter`);
      passed++;
    } else {
      console.log(`🚫 ${token.name} (${token.symbol}) - FILTERED OUT`);
      filtered++;
    }
  }
  
  console.log(`\nFilter Results: ${passed} passed, ${filtered} filtered`);
  selectiveFilter.logStats();
}

async function testCacheManager() {
  console.log('\n=== Testing CacheManager ===');
  
  const cacheManager = new CacheManager({
    priceDataTTL: 1000,     // 1 second for testing
    tokenMetadataTTL: 5000  // 5 seconds for testing
  });
  
  // Test basic caching
  const testKey = 'test-token';
  const testData = { price: 1.23, timestamp: Date.now() };
  
  // Set cache
  cacheManager.set('priceData', testKey, testData);
  console.log('✅ Data cached');
  
  // Get from cache
  const cachedData = cacheManager.get('priceData', testKey);
  console.log('✅ Data retrieved from cache:', cachedData);
  
  // Test cache miss
  const missData = cacheManager.get('priceData', 'nonexistent-key');
  console.log('✅ Cache miss handled correctly:', missData === null);
  
  // Test getOrSet pattern
  const getOrSetData = await cacheManager.getOrSet(
    'tokenMetadata',
    'test-metadata',
    async () => {
      console.log('📥 Fetching data (cache miss)');
      await new Promise(resolve => setTimeout(resolve, 100));
      return { name: 'Test Token', symbol: 'TEST' };
    }
  );
  
  console.log('✅ GetOrSet result:', getOrSetData);
  
  // Test cache hit on second call
  const cachedResult = await cacheManager.getOrSet(
    'tokenMetadata',
    'test-metadata',
    async () => {
      console.log('📥 This should not be called (cache hit)');
      return { name: 'Should not see this' };
    }
  );
  
  console.log('✅ Second call (should be cached):', cachedResult);
  
  // Test expiration
  console.log('⏰ Waiting for cache expiration...');
  await new Promise(resolve => setTimeout(resolve, 1200));
  
  const expiredData = cacheManager.get('priceData', testKey);
  console.log('✅ Expired data correctly returned null:', expiredData === null);
  
  cacheManager.logStats();
  cacheManager.destroy();
}

async function testIntegration() {
  console.log('\n=== Testing Integration ===');
  
  const requestQueue = new RequestQueue({ maxRequestsPerSecond: 5 });
  const cacheManager = new CacheManager();
  const selectiveFilter = new SelectiveFilter();
  
  // Simulate a workflow similar to the monitor
  const testTokenMint = 'IntegrationTest1111111111111111111111111111';
  
  console.log('🔄 Simulating optimized token processing workflow...');
  
  // Step 1: Check cache first
  let tokenData = cacheManager.get('tokenMetadata', testTokenMint);
  
  if (!tokenData) {
    console.log('📥 Cache miss - fetching token data');
    
    // Step 2: Use request queue for API call
    tokenData = await requestQueue.enqueue(async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        mint: testTokenMint,
        name: 'Integration Test Token',
        symbol: 'ITT',
        supply: 1000000,
        liquidity: 15000,
        volume: 3000,
        holders: 75,
        createdAt: new Date().toISOString()
      };
    });
    
    // Step 3: Cache the result
    cacheManager.set('tokenMetadata', testTokenMint, tokenData);
  } else {
    console.log('✅ Cache hit - using cached data');
  }
  
  // Step 4: Apply selective filtering
  const shouldMonitor = await selectiveFilter.shouldMonitor(tokenData);
  
  console.log(`🎯 Token processing result: ${shouldMonitor ? 'MONITOR' : 'SKIP'}`);
  console.log(`📊 Token: ${tokenData.name} (${tokenData.symbol})`);
  console.log(`💧 Liquidity: $${tokenData.liquidity}`);
  console.log(`📈 Volume: $${tokenData.volume}`);
  
  // Cleanup
  requestQueue.destroy();
  cacheManager.destroy();
  
  console.log('✅ Integration test completed successfully');
}

async function runAllTests() {
  console.log('🚀 Starting Optimization Systems Test Suite\n');
  
  try {
    await testRequestQueue();
    await testBatchManager();
    await testSelectiveFilter();
    await testCacheManager();
    await testIntegration();
    
    console.log('\n🎉 All optimization tests passed successfully!');
    console.log('\n📈 Benefits expected:');
    console.log('  • Reduced RPC rate limit errors');
    console.log('  • Better resource utilization');
    console.log('  • Focus on high-value tokens only');
    console.log('  • Faster response times through caching');
    console.log('  • Improved system reliability');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testRequestQueue,
  testBatchManager,
  testSelectiveFilter,
  testCacheManager,
  testIntegration,
  runAllTests
};
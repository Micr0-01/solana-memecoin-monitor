const { Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

async function testRPC() {
  // Load API keys
  const apiKeys = {};
  try {
    const apFilePath = path.join(__dirname, 'ap.txt');
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
    }
  } catch (error) {
    console.log('Could not load API keys:', error.message);
  }

  const endpoints = [];
  
  // Add your premium endpoints
  if (apiKeys.helius) {
    endpoints.push({
      name: 'Helius',
      http: `https://rpc.helius.xyz/?api-key=${apiKeys.helius}`,
      ws: `wss://rpc.helius.xyz/?api-key=${apiKeys.helius}`
    });
  }

  // Try different Chainstack formats
  if (apiKeys.chainstack) {
    endpoints.push({
      name: 'Chainstack (Format 1)',
      http: `https://solana-mainnet.core.chainstack.com/rpc/${apiKeys.chainstack}`,
      ws: `wss://solana-mainnet.core.chainstack.com/ws/${apiKeys.chainstack}`
    });
  }

  // Free endpoints
  endpoints.push(
    {
      name: 'dRPC Free',
      http: 'https://solana.drpc.org',
      ws: 'wss://solana.drpc.org'
    },
    {
      name: 'LeoRPC',
      http: 'https://rpc.leo.solana.com',
      ws: 'wss://rpc.leo.solana.com'
    },
    {
      name: 'Solana Foundation',
      http: 'https://api.mainnet-beta.solana.com',
      ws: 'wss://api.mainnet-beta.solana.com'
    }
  );

  console.log('🧪 Testing RPC endpoints...\n');

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.name}...`);
      
      const connection = new Connection(endpoint.http, { commitment: 'confirmed' });
      
      const startTime = Date.now();
      const version = await connection.getVersion();
      const endTime = Date.now();
      
      console.log(`✅ ${endpoint.name}: Connected! (${endTime - startTime}ms)`);
      console.log(`   Solana version: ${version['solana-core']}`);
      console.log(`   HTTP: ${endpoint.http.substring(0, 80)}...`);
      console.log();
      
    } catch (error) {
      console.log(`❌ ${endpoint.name}: Failed`);
      console.log(`   Error: ${error.message}`);
      console.log(`   HTTP: ${endpoint.http.substring(0, 80)}...`);
      console.log();
    }
  }
}

testRPC().catch(console.error);
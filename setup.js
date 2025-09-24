#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('🚀 Solana Memecoin Monitor Setup');
console.log('===============================\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function setup() {
  try {
    console.log('⚠️  IMPORTANT: This tool monitors memecoins which are extremely high risk!');
    console.log('   Only use this for educational/research purposes.\n');
    
    const proceed = await askQuestion('Do you want to continue? (y/n): ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    
    console.log('\n📋 Please provide the following required information:\n');
    
    // Get required information
    const botToken = await askQuestion('Telegram Bot Token: ');
    const chatId = await askQuestion('Telegram Chat ID: ');
    const rpcHttp = await askQuestion('Solana RPC HTTP (press enter for default): ') || 'https://api.mainnet-beta.solana.com';
    const rpcWs = await askQuestion('Solana RPC WebSocket (press enter for default): ') || 'wss://api.mainnet-beta.solana.com';
    
    console.log('\n⚙️  Optional settings (press enter to skip):');
    const volumeThreshold = await askQuestion('Volume threshold USD (default 50000): ') || '50000';
    const liquidityThreshold = await askQuestion('Liquidity threshold USD (default 2000): ') || '2000';
    const cooldown = await askQuestion('Alert cooldown seconds (default 3600): ') || '3600';
    
    // Create .env file
    const envContent = `# Solana Memecoin Monitor Configuration

# REQUIRED
TELEGRAM_BOT_TOKEN=${botToken}
TELEGRAM_CHAT_ID=${chatId}
SOLANA_RPC_HTTP=${rpcHttp}
SOLANA_RPC_WS=${rpcWs}

# THRESHOLDS
VOLUME_THRESHOLD_USD=${volumeThreshold}
LIQUIDITY_THRESHOLD_USD=${liquidityThreshold}
ALERT_COOLDOWN_SECONDS=${cooldown}

# OPTIONAL (uncomment to use)
# PUMPPORTAL_KEY=your_pump_portal_key
# GMGN_KEY=your_gmgn_key
# REDIS_URL=redis://localhost:6379

# DEVELOPMENT
MOCK_MODE=false
DRY_RUN=false
LOG_LEVEL=info
`;

    fs.writeFileSync('.env', envContent);
    console.log('\n✅ Created .env file with your configuration');
    
    // Copy example config
    if (!fs.existsSync('config/config.json')) {
      const exampleConfig = fs.readFileSync('config/config.example.json', 'utf8');
      fs.writeFileSync('config/config.json', exampleConfig);
      console.log('✅ Created config/config.json from template');
    }
    
    console.log('\n🎉 Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Test configuration: npm run test-mock');
    console.log('3. Start monitoring: npm start');
    console.log('\n⚠️  Remember: This is for educational purposes only!');
    
  } catch (error) {
    console.error('Setup failed:', error);
  } finally {
    rl.close();
  }
}

setup();
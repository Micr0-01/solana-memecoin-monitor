#!/bin/bash

# Solana Memecoin Monitor - Application Setup Script
# This script sets up the Node.js application and dependencies

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Log function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

echo "🚀 Setting up Solana Memecoin Monitor Application..."

# Get current user and check if it's the app user
CURRENT_USER=$(whoami)
APP_USER="solana-monitor"
APP_DIR="/home/$APP_USER/solana-memecoin-monitor"

log "👤 Current user: $CURRENT_USER"

# Switch to application user if needed
if [[ "$CURRENT_USER" != "$APP_USER" ]]; then
    log "🔄 Switching to application user..."
    if id "$APP_USER" &>/dev/null; then
        exec sudo -u "$APP_USER" bash "$0" "$@"
    else
        error "Application user '$APP_USER' does not exist. Please run install-ubuntu.sh first."
    fi
fi

log "📁 Working in directory: $APP_DIR"
cd "$APP_DIR"

# Check if package.json exists
if [[ ! -f "package.json" ]]; then
    error "package.json not found. Please ensure the application files are uploaded to $APP_DIR"
fi

log "📦 Installing Node.js dependencies..."
npm install --production

log "🔧 Installing additional production dependencies..."
# Install PM2 if not already installed
if ! command -v pm2 &> /dev/null; then
    log "Installing PM2..."
    sudo npm install -g pm2
fi

# Install additional dependencies for production
npm install --save \
    dotenv \
    winston \
    winston-daily-rotate-file

log "📝 Setting up environment configuration..."
# Create .env file if it doesn't exist
if [[ ! -f ".env" ]]; then
    if [[ -f ".env.example" ]]; then
        cp .env.example .env
        log "✅ Created .env from .env.example"
    else
        # Create basic .env template
        cat > .env <<EOF
# Solana Configuration
SOLANA_RPC_HTTP_ENDPOINT=https://api.mainnet-beta.solana.com
SOLANA_RPC_WS_ENDPOINT=wss://api.mainnet-beta.solana.com
SOLANA_COMMITMENT=confirmed

# Your RPC API Keys (add your premium endpoints)
HELIUS_API_KEY=your_helius_api_key
CHAINSTACK_API_KEY=your_chainstack_api_key

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Monitoring Configuration
VOLUME_THRESHOLD_USD=10000
LIQUIDITY_THRESHOLD_USD=5000
ALERT_COOLDOWN_SECONDS=3600

# Performance Configuration
MAX_REQUESTS_PER_SECOND=8
MAX_CONCURRENT_REQUESTS=4
ENABLE_OPTIMIZATIONS=true

# Logging Configuration
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/solana-monitor/monitor.log
LOG_MAX_FILES=30

# Environment
NODE_ENV=production
EOF
        log "✅ Created basic .env template"
    fi
    
    warn "Please edit .env file with your actual configuration:"
    echo "  nano .env"
else
    log "ℹ️ .env file already exists"
fi

log "⚙️ Creating PM2 ecosystem configuration..."
# Create PM2 ecosystem file
cat > ecosystem.config.js <<EOF
module.exports = {
  apps: [{
    name: 'solana-memecoin-monitor',
    script: 'src/monitor.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/solana-monitor/combined.log',
    out_file: '/var/log/solana-monitor/out.log',
    error_file: '/var/log/solana-monitor/error.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Restart configuration
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Performance monitoring
    monitoring: false,
    
    // Auto restart on crash
    autorestart: true,
    
    // Kill timeout
    kill_timeout: 5000,
    
    // Additional environment variables
    env_production: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    }
  }]
};
EOF

log "🔧 Setting up production logging..."
# Create logs directory if it doesn't exist
sudo mkdir -p /var/log/solana-monitor
sudo chown -R "$APP_USER:$APP_USER" /var/log/solana-monitor
sudo chmod 755 /var/log/solana-monitor

log "🚀 Creating start/stop scripts..."
# Create start script
cat > start.sh <<EOF
#!/bin/bash
echo "🚀 Starting Solana Memecoin Monitor..."

# Load environment variables
if [[ -f ".env" ]]; then
    export \$(cat .env | grep -v '^#' | xargs)
fi

# Start with PM2
pm2 start ecosystem.config.js --env production

echo "✅ Monitor started successfully!"
echo "📊 Check status: pm2 status"
echo "📝 Check logs: pm2 logs solana-memecoin-monitor"
EOF

chmod +x start.sh

# Create stop script
cat > stop.sh <<EOF
#!/bin/bash
echo "🛑 Stopping Solana Memecoin Monitor..."

pm2 stop solana-memecoin-monitor
pm2 delete solana-memecoin-monitor

echo "✅ Monitor stopped successfully!"
EOF

chmod +x stop.sh

# Create restart script
cat > restart.sh <<EOF
#!/bin/bash
echo "🔄 Restarting Solana Memecoin Monitor..."

pm2 restart solana-memecoin-monitor

echo "✅ Monitor restarted successfully!"
echo "📊 Check status: pm2 status"
echo "📝 Check logs: pm2 logs solana-memecoin-monitor"
EOF

chmod +x restart.sh

# Create status script
cat > status.sh <<EOF
#!/bin/bash
echo "📊 Solana Memecoin Monitor Status:"
echo ""

pm2 status solana-memecoin-monitor

echo ""
echo "📝 Recent logs:"
pm2 logs solana-memecoin-monitor --lines 20
EOF

chmod +x status.sh

log "🧪 Running validation tests..."
# Run optimization validation
if [[ -f "validate-optimizations.js" ]]; then
    node validate-optimizations.js
    log "✅ Optimization validation completed"
else
    warn "validate-optimizations.js not found, skipping validation"
fi

log "🔐 Setting proper file permissions..."
# Set proper permissions
chmod 600 .env
chmod +x *.sh
find . -name "*.js" -exec chmod 644 {} \;

log "📋 Setting up PM2 startup script..."
# Configure PM2 to start on system boot
pm2 startup ubuntu -u "$APP_USER" --hp "/home/$APP_USER"

log "✅ Application setup completed!"
echo ""
echo -e "${BLUE}===========================================${NC}"
echo -e "${GREEN}🎉 Application Setup Complete!${NC}"
echo -e "${BLUE}===========================================${NC}"
echo ""
echo -e "${YELLOW}Available Commands:${NC}"
echo "  ./start.sh        - Start the monitor"
echo "  ./stop.sh         - Stop the monitor"
echo "  ./restart.sh      - Restart the monitor"
echo "  ./status.sh       - Check monitor status"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  nano .env         - Edit environment variables"
echo "  nano ecosystem.config.js - Edit PM2 configuration"
echo ""
echo -e "${YELLOW}Monitoring:${NC}"
echo "  pm2 status        - PM2 status"
echo "  pm2 logs          - View logs"
echo "  pm2 monit         - PM2 monitoring"
echo "  tail -f /var/log/solana-monitor/monitor.log - Application logs"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Edit .env file with your API keys and configuration"
echo "2. Run: ./start.sh"
echo "3. Monitor: ./status.sh"
echo ""
echo -e "${GREEN}Ready to launch! 🚀${NC}"
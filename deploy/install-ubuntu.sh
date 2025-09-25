#!/bin/bash

# Solana Memecoin Monitor - Ubuntu Server Installation Script
# This script sets up the complete environment on Ubuntu VPS

set -e  # Exit on any error

echo "🚀 Starting Solana Memecoin Monitor Ubuntu Installation..."

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

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root. Please run as a regular user with sudo privileges."
fi

# Check if sudo is available
if ! command -v sudo &> /dev/null; then
    error "sudo is required but not installed. Please install sudo first."
fi

log "📋 Updating system packages..."
sudo apt update && sudo apt upgrade -y

log "🔧 Installing essential packages..."
sudo apt install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    htop \
    nano \
    unzip \
    fail2ban \
    ufw \
    logrotate

log "🟢 Installing Node.js LTS..."
# Install Node.js using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
log "✅ Node.js installed: $NODE_VERSION"
log "✅ npm installed: $NPM_VERSION"

log "📦 Installing PM2 globally..."
sudo npm install -g pm2

log "🔒 Configuring firewall..."
# Configure UFW firewall
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 22/tcp
sudo ufw --force enable

log "🛡️ Configuring fail2ban..."
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

log "👤 Creating application user..."
# Create a dedicated user for the application
APP_USER="solana-monitor"
if ! id "$APP_USER" &>/dev/null; then
    sudo useradd -m -s /bin/bash "$APP_USER"
    sudo usermod -aG sudo "$APP_USER"
    log "✅ Created user: $APP_USER"
else
    log "ℹ️ User $APP_USER already exists"
fi

log "📁 Setting up application directory..."
APP_DIR="/home/$APP_USER/solana-memecoin-monitor"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" "/home/$APP_USER"

log "📝 Creating log directory..."
sudo mkdir -p /var/log/solana-monitor
sudo chown -R "$APP_USER:$APP_USER" /var/log/solana-monitor
sudo chmod 755 /var/log/solana-monitor

log "⚙️ Setting up logrotate..."
sudo tee /etc/logrotate.d/solana-monitor > /dev/null <<EOF
/var/log/solana-monitor/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su $APP_USER $APP_USER
}
EOF

log "🔑 Setting up SSH security..."
# Backup original sshd_config
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Improve SSH security
sudo tee -a /etc/ssh/sshd_config.d/security.conf > /dev/null <<EOF
# Enhanced SSH Security
Protocol 2
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitEmptyPasswords no
ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 3
MaxSessions 2
EOF

log "🔄 Restarting SSH service..."
sudo systemctl restart sshd

log "⚡ Optimizing system performance..."
# Add performance optimizations
sudo tee -a /etc/security/limits.conf > /dev/null <<EOF
# Solana Monitor optimizations
$APP_USER soft nofile 65536
$APP_USER hard nofile 65536
$APP_USER soft nproc 4096
$APP_USER hard nproc 4096
EOF

# Optimize network settings
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF
# Solana Monitor network optimizations
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.netdev_max_backlog = 5000
EOF

sudo sysctl -p

log "🎯 Setting up swap (if not exists)..."
if ! swapon --show | grep -q swap; then
    # Create 2GB swap file
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    log "✅ Created 2GB swap file"
else
    log "ℹ️ Swap already configured"
fi

log "📊 Installing monitoring tools..."
# Install htop, iotop, and other monitoring tools
sudo apt install -y htop iotop nethogs iftop

log "🧹 Cleaning up..."
sudo apt autoremove -y
sudo apt autoclean

log "✅ Ubuntu server setup completed!"
echo ""
echo -e "${BLUE}===========================================${NC}"
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo -e "${BLUE}===========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Upload your project files to: $APP_DIR"
echo "2. Run the application setup script: ./deploy/setup-app.sh"
echo "3. Configure your environment variables"
echo "4. Start the monitoring service"
echo ""
echo -e "${YELLOW}Important Notes:${NC}"
echo "- Application user created: $APP_USER"
echo "- Application directory: $APP_DIR"
echo "- Logs directory: /var/log/solana-monitor"
echo "- SSH security has been enhanced"
echo "- Firewall (UFW) is enabled"
echo "- fail2ban is configured"
echo ""
echo -e "${GREEN}Server is ready for Solana Memecoin Monitor deployment!${NC}"
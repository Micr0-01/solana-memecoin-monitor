#!/bin/bash

# Solana Memecoin Monitor - Quick Deployment Script
# This is the main deployment orchestrator for Ubuntu VPS

set -e  # Exit on any error

echo "🚀 Solana Memecoin Monitor - Quick Deployment"
echo "============================================="
echo ""

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

# Check if we're on Ubuntu
if ! grep -q "Ubuntu" /etc/os-release; then
    error "This script is designed for Ubuntu. Please use Ubuntu 22.04 LTS or later."
fi

# Get current user
CURRENT_USER=$(whoami)
log "Current user: $CURRENT_USER"

echo -e "${BLUE}What would you like to do?${NC}"
echo "1. Complete server setup (run as regular user with sudo)"
echo "2. Application setup only (run as solana-monitor user)"
echo "3. Install system dependencies only"
echo "4. Configure and start monitor"
echo "5. Show deployment status"
echo ""
read -p "Enter your choice (1-5): " CHOICE

case $CHOICE in
    1)
        echo -e "${YELLOW}=== COMPLETE SERVER SETUP ===${NC}"
        echo "This will:"
        echo "- Install Node.js, PM2, and system packages"
        echo "- Configure security (firewall, fail2ban)"
        echo "- Create application user"
        echo "- Set up logging and directories"
        echo ""
        read -p "Continue? (y/N): " CONFIRM
        
        if [[ $CONFIRM == [yY] ]]; then
            log "Starting complete server setup..."
            
            # Check if install script exists
            if [[ -f "deploy/install-ubuntu.sh" ]]; then
                chmod +x deploy/install-ubuntu.sh
                ./deploy/install-ubuntu.sh
                log "✅ Server setup completed!"
            else
                error "install-ubuntu.sh not found. Please ensure you have the complete project files."
            fi
            
            echo ""
            echo -e "${GREEN}🎉 Server setup complete!${NC}"
            echo -e "${YELLOW}Next steps:${NC}"
            echo "1. Switch to application user: sudo su - solana-monitor"
            echo "2. Upload your project files to: /home/solana-monitor/solana-memecoin-monitor/"
            echo "3. Run: ./deploy/quick-deploy.sh (choose option 2)"
        fi
        ;;
        
    2)
        echo -e "${YELLOW}=== APPLICATION SETUP ===${NC}"
        
        # Check if we're the right user
        if [[ "$CURRENT_USER" != "solana-monitor" ]]; then
            warn "You should run this as the solana-monitor user"
            echo "Switch user with: sudo su - solana-monitor"
            read -p "Continue anyway? (y/N): " CONFIRM
            if [[ $CONFIRM != [yY] ]]; then
                exit 0
            fi
        fi
        
        # Check if we're in the right directory
        if [[ ! -f "package.json" ]]; then
            error "package.json not found. Please cd to your project directory first."
        fi
        
        log "Starting application setup..."
        
        # Run setup script
        if [[ -f "deploy/setup-app.sh" ]]; then
            chmod +x deploy/setup-app.sh
            ./deploy/setup-app.sh
            
            echo ""
            echo -e "${GREEN}🎉 Application setup complete!${NC}"
            echo -e "${YELLOW}Next steps:${NC}"
            echo "1. Edit your configuration: nano .env"
            echo "2. Start the monitor: ./start.sh"
            echo "3. Check status: ./status.sh"
        else
            error "setup-app.sh not found"
        fi
        ;;
        
    3)
        echo -e "${YELLOW}=== SYSTEM DEPENDENCIES ONLY ===${NC}"
        
        if [[ -f "deploy/install-ubuntu.sh" ]]; then
            log "Installing system dependencies..."
            chmod +x deploy/install-ubuntu.sh
            
            # Extract just the package installation parts
            sudo apt update
            sudo apt install -y curl wget git build-essential software-properties-common
            
            # Install Node.js
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt install -y nodejs
            
            # Install PM2
            sudo npm install -g pm2
            
            log "✅ System dependencies installed!"
        else
            error "install-ubuntu.sh not found"
        fi
        ;;
        
    4)
        echo -e "${YELLOW}=== CONFIGURE AND START MONITOR ===${NC}"
        
        # Check if we're in the right place
        if [[ ! -f ".env" ]]; then
            warn ".env file not found. Creating from template..."
            if [[ -f ".env.production" ]]; then
                cp .env.production .env
                log "Created .env from .env.production template"
            else
                error ".env.production template not found"
            fi
        fi
        
        echo "Current configuration status:"
        echo ""
        
        # Check configuration
        if grep -q "your_.*_here" .env; then
            error "❌ Configuration incomplete! Please edit .env file with your actual values."
        else
            log "✅ Configuration looks complete"
        fi
        
        # Validate setup
        if [[ -f "validate-optimizations.js" ]]; then
            log "Running validation..."
            if node validate-optimizations.js; then
                log "✅ Validation passed!"
            else
                error "❌ Validation failed. Please check your setup."
            fi
        fi
        
        # Start monitor
        log "Starting monitor..."
        if [[ -f "start.sh" ]]; then
            ./start.sh
            
            # Check if it started
            sleep 3
            if pm2 list | grep -q "solana-memecoin-monitor"; then
                log "✅ Monitor started successfully!"
                echo ""
                echo -e "${GREEN}🎉 Deployment complete!${NC}"
                echo ""
                echo "Monitor status:"
                pm2 status solana-memecoin-monitor
                
                echo ""
                echo -e "${YELLOW}Useful commands:${NC}"
                echo "  ./status.sh       - Check status"
                echo "  ./restart.sh      - Restart monitor"
                echo "  ./stop.sh         - Stop monitor"
                echo "  pm2 logs solana-memecoin-monitor - View logs"
                echo "  tail -f /var/log/solana-monitor/monitor.log - Application logs"
                
            else
                error "❌ Failed to start monitor. Check logs: pm2 logs"
            fi
        else
            error "start.sh not found. Please run application setup first."
        fi
        ;;
        
    5)
        echo -e "${YELLOW}=== DEPLOYMENT STATUS ===${NC}"
        echo ""
        
        # Check system components
        echo "System Components:"
        
        # Node.js
        if command -v node &> /dev/null; then
            NODE_VERSION=$(node --version)
            echo "  ✅ Node.js: $NODE_VERSION"
        else
            echo "  ❌ Node.js: Not installed"
        fi
        
        # PM2
        if command -v pm2 &> /dev/null; then
            PM2_VERSION=$(pm2 --version)
            echo "  ✅ PM2: v$PM2_VERSION"
        else
            echo "  ❌ PM2: Not installed"
        fi
        
        # Application user
        if id "solana-monitor" &>/dev/null; then
            echo "  ✅ Application user: solana-monitor exists"
        else
            echo "  ❌ Application user: solana-monitor not found"
        fi
        
        # Application files
        echo ""
        echo "Application Status:"
        
        if [[ -f "package.json" ]]; then
            echo "  ✅ Project files: Present"
        else
            echo "  ❌ Project files: Not found in current directory"
        fi
        
        if [[ -f ".env" ]]; then
            if grep -q "your_.*_here" .env; then
                echo "  ⚠️  Configuration: Incomplete (contains template values)"
            else
                echo "  ✅ Configuration: Complete"
            fi
        else
            echo "  ❌ Configuration: .env file not found"
        fi
        
        # PM2 process status
        echo ""
        echo "Process Status:"
        if command -v pm2 &> /dev/null; then
            if pm2 list | grep -q "solana-memecoin-monitor"; then
                echo "  ✅ Monitor process: Running"
                pm2 status solana-memecoin-monitor
            else
                echo "  ❌ Monitor process: Not running"
            fi
        fi
        
        # Log files
        echo ""
        echo "Log Files:"
        if [[ -d "/var/log/solana-monitor" ]]; then
            echo "  ✅ Log directory: /var/log/solana-monitor"
            ls -la /var/log/solana-monitor/ | head -10
        else
            echo "  ❌ Log directory: Not found"
        fi
        
        echo ""
        echo -e "${BLUE}Current directory:${NC} $(pwd)"
        echo -e "${BLUE}Current user:${NC} $(whoami)"
        ;;
        
    *)
        error "Invalid choice. Please select 1-5."
        ;;
esac

echo ""
echo -e "${BLUE}For more detailed instructions, see: DEPLOYMENT_GUIDE.md${NC}"
echo -e "${BLUE}For troubleshooting, check logs: pm2 logs solana-memecoin-monitor${NC}"
echo ""
# Solana Memecoin Monitor - Ubuntu VPS Deployment Guide

Complete guide for deploying the Solana Memecoin Monitor on Digital Ocean Ubuntu VPS or any Ubuntu server.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [File Upload](#file-upload)
4. [Application Installation](#application-installation)
5. [Configuration](#configuration)
6. [Starting the Monitor](#starting-the-monitor)
7. [Monitoring & Management](#monitoring--management)
8. [Troubleshooting](#troubleshooting)
9. [Maintenance](#maintenance)
10. [Security](#security)

## 🛠️ Prerequisites

### Digital Ocean Requirements
- **Droplet Size**: Minimum 2GB RAM, 2 vCPUs (Basic $18/month plan recommended)
- **OS**: Ubuntu 22.04 LTS (latest stable)
- **Storage**: At least 25GB SSD
- **Network**: Public IPv4 address

### Local Requirements
- SSH client (PuTTY on Windows, Terminal on Mac/Linux)
- SCP/SFTP client (WinSCP, FileZilla, or command line)
- Your API keys and tokens ready

## 🖥️ Server Setup

### Step 1: Create Ubuntu VPS

1. **Digital Ocean Setup:**
   ```bash
   # Create a new Droplet
   - Choose Ubuntu 22.04 LTS
   - Select Basic plan (2GB RAM minimum)
   - Choose datacenter region closest to you
   - Add SSH key (recommended) or use password
   ```

2. **Initial Connection:**
   ```bash
   ssh root@YOUR_SERVER_IP
   # or if using SSH key:
   ssh -i ~/.ssh/your_key root@YOUR_SERVER_IP
   ```

### Step 2: Run Server Installation Script

1. **Create non-root user (if connecting as root):**
   ```bash
   # Create user
   adduser ubuntu
   usermod -aG sudo ubuntu
   
   # Switch to new user
   su - ubuntu
   ```

2. **Upload installation script:**
   ```bash
   # Create directory for scripts
   mkdir -p ~/deployment-scripts
   cd ~/deployment-scripts
   ```

3. **Upload the install script** (use SCP or copy-paste):
   ```bash
   # If uploading from local machine:
   scp deploy/install-ubuntu.sh ubuntu@YOUR_SERVER_IP:~/deployment-scripts/
   ```

4. **Run installation:**
   ```bash
   chmod +x install-ubuntu.sh
   ./install-ubuntu.sh
   ```

   This will install:
   - Node.js LTS and npm
   - PM2 process manager
   - Essential system packages
   - Security configurations (firewall, fail2ban)
   - System optimizations
   - Application user and directories

## 📁 File Upload

### Method 1: Direct Upload (Recommended)

1. **Compress your project locally:**
   ```bash
   # On your Windows machine, create a zip file excluding:
   # - node_modules/
   # - .git/
   # - *.log files
   # - .env files
   ```

2. **Upload to server:**
   ```bash
   # Using SCP (replace with your actual IP):
   scp solana-memecoin-monitor.zip ubuntu@YOUR_SERVER_IP:~/
   
   # Or use FileZilla, WinSCP, etc.
   ```

3. **Extract on server:**
   ```bash
   ssh ubuntu@YOUR_SERVER_IP
   
   # Switch to application user
   sudo su - solana-monitor
   
   # Extract files
   cd ~/
   unzip ~/solana-memecoin-monitor.zip
   
   # Ensure correct permissions
   chmod -R 755 solana-memecoin-monitor/
   cd solana-memecoin-monitor/
   ```

### Method 2: Git Clone

```bash
# Switch to application user
sudo su - solana-monitor

# Clone repository (if you have it on GitHub)
cd ~/
git clone https://github.com/your-username/solana-memecoin-monitor.git
cd solana-memecoin-monitor/

# Or clone private repo with token
git clone https://YOUR_TOKEN@github.com/your-username/solana-memecoin-monitor.git
```

## ⚙️ Application Installation

### Step 1: Run Application Setup

```bash
# Switch to application user
sudo su - solana-monitor
cd ~/solana-memecoin-monitor

# Upload and run setup script
chmod +x deploy/setup-app.sh
./deploy/setup-app.sh
```

This will:
- Install Node.js dependencies
- Create PM2 configuration
- Set up logging
- Create management scripts
- Generate environment template

### Step 2: Verify Installation

```bash
# Check if all files are present
ls -la

# Verify Node modules
ls -la node_modules/

# Check PM2 is available
pm2 --version

# Validate optimization systems
node validate-optimizations.js
```

## 🔧 Configuration

### Step 1: Configure Environment Variables

```bash
# Edit environment file
nano .env

# Required configuration:
```

**Essential Settings to Update:**

```bash
# ===============================================
# REQUIRED: Update these with your actual values
# ===============================================

# Your RPC endpoints (add at least one premium endpoint)
HELIUS_API_KEY=your_actual_helius_key_here
CHAINSTACK_API_KEY=your_actual_chainstack_key_here

# Your Telegram configuration
TELEGRAM_BOT_TOKEN=your_actual_bot_token_here
TELEGRAM_CHAT_ID=your_actual_chat_id_here

# Monitoring thresholds (adjust as needed)
VOLUME_THRESHOLD_USD=10000
LIQUIDITY_THRESHOLD_USD=5000

# Performance settings (start conservative)
MAX_REQUESTS_PER_SECOND=6
MAX_CONCURRENT_REQUESTS=3
```

### Step 2: Secure Configuration

```bash
# Set secure permissions
chmod 600 .env

# Verify configuration
grep -v "^#" .env | grep -v "^$"
```

### Step 3: Test Configuration

```bash
# Run validation
node validate-optimizations.js

# Test Telegram connection (if implemented)
# node test/test-telegram.js
```

## 🚀 Starting the Monitor

### Method 1: Using PM2 (Recommended)

```bash
# Start the monitor
./start.sh

# Check status
./status.sh

# View logs
pm2 logs solana-memecoin-monitor
```

### Method 2: Direct Node.js (for testing)

```bash
# For testing only
node src/monitor.js

# Press Ctrl+C to stop
```

### Startup Commands Reference

```bash
# Start
./start.sh
pm2 start ecosystem.config.js --env production

# Stop
./stop.sh
pm2 stop solana-memecoin-monitor

# Restart
./restart.sh
pm2 restart solana-memecoin-monitor

# Status
./status.sh
pm2 status
pm2 monit

# Logs
pm2 logs solana-memecoin-monitor --lines 100
tail -f /var/log/solana-monitor/monitor.log
```

## 📊 Monitoring & Management

### PM2 Commands

```bash
# Real-time monitoring
pm2 monit

# Process status
pm2 status

# Detailed info
pm2 show solana-memecoin-monitor

# Memory usage
pm2 list --sort memory

# Restart with 0 downtime
pm2 reload solana-memecoin-monitor
```

### Log Management

```bash
# Application logs
tail -f /var/log/solana-monitor/monitor.log
tail -f /var/log/solana-monitor/error.log

# PM2 logs
pm2 logs solana-memecoin-monitor
pm2 logs solana-memecoin-monitor --err
pm2 logs solana-memecoin-monitor --lines 100

# System logs
sudo journalctl -u solana-monitor -f

# Log rotation status
sudo logrotate -d /etc/logrotate.d/solana-monitor
```

### Performance Monitoring

```bash
# System resources
htop
iotop
nethogs

# Disk usage
df -h
du -sh /var/log/solana-monitor/

# Network connections
netstat -tulpn | grep node
ss -tulpn | grep node
```

### Health Monitoring (Optional)

```bash
# Enable health monitor
pm2 start deploy/health-monitor.js --name health-monitor

# View health status
cat /var/log/solana-monitor/health-status.json

# Health alerts
tail -f /var/log/solana-monitor/health-alerts.log
```

## 🔧 Troubleshooting

### Common Issues

#### 1. **Monitor Won't Start**

```bash
# Check for errors
pm2 logs solana-memecoin-monitor --err

# Check environment
node -e "console.log(process.env.NODE_ENV)"

# Validate config
node validate-optimizations.js

# Check dependencies
npm list --depth=0
```

#### 2. **High Rate Limit Errors**

```bash
# Check optimization stats in logs
grep "Request Queue Stats" /var/log/solana-monitor/monitor.log

# Reduce request rates
nano .env
# Set: MAX_REQUESTS_PER_SECOND=4
# Set: MAX_CONCURRENT_REQUESTS=2

# Restart
pm2 restart solana-memecoin-monitor
```

#### 3. **Memory Issues**

```bash
# Check memory usage
pm2 monit

# Restart if memory is high
pm2 restart solana-memecoin-monitor

# Check for memory leaks
pm2 logs solana-memecoin-monitor | grep memory

# Adjust memory limit in ecosystem.config.js
nano ecosystem.config.js
# Change: max_memory_restart: '512M'
```

#### 4. **Network/Connection Issues**

```bash
# Test internet connectivity
ping google.com
curl -I https://api.mainnet-beta.solana.com

# Check DNS
nslookup api.mainnet-beta.solana.com

# Test RPC endpoints
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  https://api.mainnet-beta.solana.com
```

#### 5. **Permission Issues**

```bash
# Fix ownership
sudo chown -R solana-monitor:solana-monitor /home/solana-monitor/
sudo chown -R solana-monitor:solana-monitor /var/log/solana-monitor/

# Fix permissions
chmod 755 /home/solana-monitor/solana-memecoin-monitor/
chmod 600 .env
chmod +x *.sh
```

### Debug Mode

```bash
# Enable debug logging
nano .env
# Set: LOG_LEVEL=debug
# Set: DEBUG_MODE=true

# Restart and monitor
pm2 restart solana-memecoin-monitor
pm2 logs solana-memecoin-monitor --lines 50
```

## 🔄 Maintenance

### Regular Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Node.js dependencies
npm update

# Update PM2
sudo npm update -g pm2

# Backup configuration before updates
cp .env .env.backup.$(date +%Y%m%d)
```

### Log Rotation

```bash
# Manual log rotation
sudo logrotate -f /etc/logrotate.d/solana-monitor

# Check logrotate status
sudo cat /var/lib/logrotate/status

# Clean old PM2 logs
pm2 flush
```

### Database Cleanup (if applicable)

```bash
# Clean old cached data (if you add persistence)
# This depends on your caching implementation
```

### Backup & Recovery

```bash
# Backup configuration
tar -czf ~/solana-monitor-backup-$(date +%Y%m%d).tar.gz \
  ~/.env \
  ~/ecosystem.config.js \
  ~/solana-memecoin-monitor/

# Recovery
# 1. Extract backup
# 2. Run setup-app.sh
# 3. Start monitor
```

## 🔐 Security

### Firewall Management

```bash
# Check UFW status
sudo ufw status

# Allow specific ports if needed
sudo ufw allow 3000  # If using health check endpoint

# Block/unblock IPs
sudo ufw deny from SUSPICIOUS_IP
```

### SSL/TLS (if exposing HTTP endpoint)

```bash
# Install certbot for Let's Encrypt
sudo apt install certbot

# Get certificate (if using domain)
sudo certbot certonly --standalone -d your-domain.com
```

### Security Monitoring

```bash
# Check fail2ban status
sudo fail2ban-client status

# Check SSH attempts
sudo cat /var/log/auth.log | grep "Failed password"

# Monitor resource usage
htop
```

## 📈 Performance Tuning

### For High-Volume Trading

```bash
# Increase file limits
# Add to /etc/security/limits.conf:
solana-monitor soft nofile 65536
solana-monitor hard nofile 65536

# Optimize network settings
# Add to /etc/sysctl.conf:
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216

# Apply settings
sudo sysctl -p
```

### Environment Optimization

```bash
# For high-traffic periods
nano .env

# Adjust these settings:
MAX_REQUESTS_PER_SECOND=12
MAX_CONCURRENT_REQUESTS=6
PRICE_DATA_TTL=10000
LIQUIDITY_DATA_TTL=20000

# For low-resource servers
MAX_REQUESTS_PER_SECOND=4
MAX_CONCURRENT_REQUESTS=2
```

## 🆘 Emergency Procedures

### Complete Restart

```bash
# Stop everything
pm2 kill

# Start fresh
cd ~/solana-memecoin-monitor
./start.sh
```

### Factory Reset

```bash
# Stop monitor
pm2 kill

# Backup current config
cp .env .env.emergency.backup

# Reset to defaults
cp .env.production .env

# Reconfigure and restart
nano .env
./start.sh
```

## 📞 Support

### Getting Help

1. **Check logs first:**
   ```bash
   pm2 logs solana-memecoin-monitor --lines 100
   tail -f /var/log/solana-monitor/error.log
   ```

2. **Run diagnostics:**
   ```bash
   node validate-optimizations.js
   ./status.sh
   ```

3. **System information:**
   ```bash
   # Gather system info for support
   echo "=== System Info ===" > ~/debug-info.txt
   uname -a >> ~/debug-info.txt
   node --version >> ~/debug-info.txt
   npm --version >> ~/debug-info.txt
   pm2 --version >> ~/debug-info.txt
   echo "=== Process Status ===" >> ~/debug-info.txt
   pm2 status >> ~/debug-info.txt
   echo "=== Recent Logs ===" >> ~/debug-info.txt
   pm2 logs solana-memecoin-monitor --lines 50 >> ~/debug-info.txt
   ```

---

## 🎉 Deployment Complete!

Your Solana Memecoin Monitor is now running on Ubuntu VPS with:

- ✅ **Optimized performance** with rate limiting and caching
- ✅ **Automatic restarts** via PM2
- ✅ **Comprehensive logging** and monitoring
- ✅ **Security hardening** with firewall and fail2ban
- ✅ **Health monitoring** and recovery
- ✅ **Production-ready configuration**

**Next Steps:**
1. Monitor the logs for the first few hours
2. Adjust thresholds based on your needs
3. Set up additional alerts if needed
4. Consider enabling the health monitor service

**Happy monitoring! 🚀**
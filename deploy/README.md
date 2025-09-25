# Ubuntu VPS Deployment Files

This directory contains all the files needed to deploy your Solana Memecoin Monitor on an Ubuntu VPS (Digital Ocean, AWS, etc.).

## 📁 Files Overview

### Core Deployment Scripts
- **`install-ubuntu.sh`** - Complete Ubuntu server setup (run first)
- **`setup-app.sh`** - Application installation and configuration
- **`quick-deploy.sh`** - Interactive deployment helper (recommended)

### Configuration Files
- **`solana-monitor.service`** - Systemd service configuration
- **`ecosystem.production.config.js`** - Advanced PM2 configuration

### Monitoring & Health
- **`health-monitor.js`** - Optional health monitoring service

### Documentation
- **`../DEPLOYMENT_GUIDE.md`** - Complete deployment documentation
- **`../OPTIMIZATION_SUMMARY.md`** - Performance optimization details

## 🚀 Quick Start

### 1. Create Ubuntu VPS
- Digital Ocean: Ubuntu 22.04 LTS, 2GB RAM minimum
- AWS: t3.small or larger with Ubuntu 22.04

### 2. Upload Files
```bash
# Compress your project (exclude node_modules, .git, logs)
# Upload to your VPS using SCP, FileZilla, or Git

# Example with SCP:
scp -r solana-memecoin-monitor ubuntu@YOUR_SERVER_IP:~/
```

### 3. Run Quick Deploy
```bash
ssh ubuntu@YOUR_SERVER_IP
cd solana-memecoin-monitor
chmod +x deploy/quick-deploy.sh
./deploy/quick-deploy.sh

# Choose option 1 for complete setup
# Then switch to solana-monitor user for app setup
```

## 🛠️ Manual Step-by-Step

If you prefer manual deployment:

### Step 1: Server Setup
```bash
chmod +x deploy/install-ubuntu.sh
./deploy/install-ubuntu.sh
```

### Step 2: Application Setup
```bash
sudo su - solana-monitor
cd ~/solana-memecoin-monitor
chmod +x deploy/setup-app.sh
./deploy/setup-app.sh
```

### Step 3: Configure Environment
```bash
nano .env
# Update with your API keys and settings
```

### Step 4: Start Monitor
```bash
./start.sh
```

## ⚙️ What Gets Installed

### System Components
- **Node.js LTS** - Runtime environment
- **PM2** - Process manager for production
- **Security** - UFW firewall, fail2ban, SSH hardening
- **Monitoring** - htop, iotop, system tools
- **Logging** - Log rotation, centralized logging

### Application Structure
```
/home/solana-monitor/solana-memecoin-monitor/
├── src/                    # Application code
├── deploy/                 # Deployment scripts
├── .env                    # Environment configuration
├── ecosystem.config.js     # PM2 configuration
├── start.sh               # Start script
├── stop.sh                # Stop script
├── restart.sh             # Restart script
└── status.sh              # Status check script

/var/log/solana-monitor/    # Log files
├── monitor.log            # Application logs
├── error.log              # Error logs
├── combined.log           # PM2 combined logs
└── health-alerts.log      # Health monitoring alerts
```

## 🔧 Management Commands

### Process Management
```bash
./start.sh                 # Start monitor
./stop.sh                  # Stop monitor  
./restart.sh               # Restart monitor
./status.sh                # Check status

pm2 status                 # PM2 status
pm2 logs solana-memecoin-monitor # View logs
pm2 monit                  # Real-time monitoring
```

### Log Management
```bash
# Application logs
tail -f /var/log/solana-monitor/monitor.log
tail -f /var/log/solana-monitor/error.log

# PM2 logs
pm2 logs solana-memecoin-monitor
pm2 logs solana-memecoin-monitor --lines 100

# Flush old logs
pm2 flush
```

### System Monitoring
```bash
htop                       # System resources
pm2 monit                  # Process monitoring
df -h                      # Disk usage
free -m                    # Memory usage
```

## 🔍 Troubleshooting

### Common Issues

**Monitor won't start:**
```bash
pm2 logs solana-memecoin-monitor --err
node validate-optimizations.js
```

**High rate limit errors:**
```bash
# Edit .env to reduce request rates
nano .env
# Set: MAX_REQUESTS_PER_SECOND=4
# Set: MAX_CONCURRENT_REQUESTS=2
pm2 restart solana-memecoin-monitor
```

**Memory issues:**
```bash
pm2 monit
pm2 restart solana-memecoin-monitor
```

**Check deployment status:**
```bash
./deploy/quick-deploy.sh
# Choose option 5 for status check
```

## 📈 Performance Optimization

Your monitor includes advanced optimizations:

- **RequestQueue** - Rate limiting (reduces 429 errors by 70-90%)
- **BatchManager** - API call batching (reduces calls by 50-80%) 
- **SelectiveFilter** - Smart token filtering (focuses on quality tokens)
- **CacheManager** - Intelligent caching (faster response times)

Performance stats are logged every 10 minutes automatically.

## 🔐 Security Features

- **Firewall** - UFW configured with essential ports only
- **fail2ban** - Protection against brute force attacks
- **SSH hardening** - Enhanced SSH security settings
- **User isolation** - Dedicated application user
- **Process limits** - Resource constraints for stability

## 📞 Support

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

3. **Get system info:**
   ```bash
   ./deploy/quick-deploy.sh  # Choose option 5
   ```

## 📚 Additional Resources

- **`DEPLOYMENT_GUIDE.md`** - Complete deployment walkthrough
- **`OPTIMIZATION_SUMMARY.md`** - Performance optimization details
- **Digital Ocean Docs** - VPS management guides
- **PM2 Documentation** - Process management help

---

## 🎉 Ready to Deploy!

Your Solana Memecoin Monitor is now production-ready with:

✅ **Optimized Performance** - Advanced rate limiting and caching  
✅ **Production Reliability** - PM2 process management  
✅ **Security Hardening** - Firewall and security configurations  
✅ **Comprehensive Monitoring** - Health checks and alerting  
✅ **Easy Management** - Simple start/stop/status scripts  

**Start with:** `./deploy/quick-deploy.sh` and choose option 1 for complete setup!
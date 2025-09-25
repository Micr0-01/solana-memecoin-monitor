#!/usr/bin/env node

/**
 * Health Monitor - Monitors the Solana Memecoin Monitor application health
 * Provides alerts and automatic recovery for production deployments
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class HealthMonitor {
  constructor() {
    this.appName = 'solana-memecoin-monitor';
    this.logPath = '/var/log/solana-monitor';
    this.alertThresholds = {
      memoryUsage: 90,        // Percentage
      cpuUsage: 80,           // Percentage
      diskUsage: 85,          // Percentage
      errorRate: 10,          // Errors per minute
      restartCount: 5,        // Max restarts per hour
      responseTime: 30000     // Max response time in ms
    };
    
    this.checkInterval = 60000; // Check every minute
    this.isRunning = false;
    this.stats = {
      lastCheck: null,
      checks: 0,
      alerts: 0,
      recoveries: 0
    };
  }

  async start() {
    console.log('🏥 Starting Health Monitor for Solana Memecoin Monitor...');
    this.isRunning = true;
    
    // Initial health check
    await this.performHealthCheck();
    
    // Set up periodic checks
    this.intervalId = setInterval(async () => {
      await this.performHealthCheck();
    }, this.checkInterval);
    
    console.log(`✅ Health Monitor started (checking every ${this.checkInterval/1000}s)`);
  }

  async stop() {
    console.log('🛑 Stopping Health Monitor...');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    console.log('✅ Health Monitor stopped');
  }

  async performHealthCheck() {
    this.stats.lastCheck = new Date();
    this.stats.checks++;
    
    try {
      const health = {
        timestamp: new Date(),
        status: 'healthy',
        issues: [],
        metrics: {}
      };
      
      // Check if PM2 process is running
      const processHealth = await this.checkProcessHealth();
      health.metrics.process = processHealth;
      
      if (!processHealth.isRunning) {
        health.status = 'critical';
        health.issues.push('Main process is not running');
        await this.handleCriticalIssue('process_down', 'Main process is down');
      }
      
      // Check system resources
      const systemHealth = await this.checkSystemHealth();
      health.metrics.system = systemHealth;
      
      if (systemHealth.memoryUsage > this.alertThresholds.memoryUsage) {
        health.status = 'warning';
        health.issues.push(`High memory usage: ${systemHealth.memoryUsage}%`);
        await this.handleWarning('high_memory', `Memory usage: ${systemHealth.memoryUsage}%`);
      }
      
      if (systemHealth.diskUsage > this.alertThresholds.diskUsage) {
        health.status = 'warning';
        health.issues.push(`High disk usage: ${systemHealth.diskUsage}%`);
        await this.handleWarning('high_disk', `Disk usage: ${systemHealth.diskUsage}%`);
      }
      
      // Check application logs for errors
      const errorCount = await this.checkErrorLogs();
      health.metrics.errorCount = errorCount;
      
      if (errorCount > this.alertThresholds.errorRate) {
        health.status = 'warning';
        health.issues.push(`High error rate: ${errorCount} errors/min`);
        await this.handleWarning('high_errors', `Error rate: ${errorCount}/min`);
      }
      
      // Check restart frequency
      const restartCount = await this.checkRestartFrequency();
      health.metrics.restartCount = restartCount;
      
      if (restartCount > this.alertThresholds.restartCount) {
        health.status = 'critical';
        health.issues.push(`Too many restarts: ${restartCount}/hour`);
        await this.handleCriticalIssue('frequent_restarts', `${restartCount} restarts in last hour`);
      }
      
      // Log health status
      this.logHealthStatus(health);
      
      // Save health report
      await this.saveHealthReport(health);
      
    } catch (error) {
      console.error('❌ Health check failed:', error);
      await this.handleCriticalIssue('health_check_failed', error.message);
    }
  }

  async checkProcessHealth() {
    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      
      const targetProcess = processes.find(p => p.name === this.appName);
      
      if (!targetProcess) {
        return {
          isRunning: false,
          status: 'not_found',
          pid: null,
          memory: 0,
          cpu: 0,
          restarts: 0
        };
      }
      
      return {
        isRunning: targetProcess.pm2_env.status === 'online',
        status: targetProcess.pm2_env.status,
        pid: targetProcess.pid,
        memory: Math.round(targetProcess.memory / 1024 / 1024), // MB
        cpu: targetProcess.cpu || 0,
        restarts: targetProcess.pm2_env.restart_time || 0,
        uptime: targetProcess.pm2_env.pm_uptime || 0
      };
      
    } catch (error) {
      console.error('Error checking process health:', error);
      return {
        isRunning: false,
        status: 'error',
        error: error.message
      };
    }
  }

  async checkSystemHealth() {
    try {
      // Memory usage
      const { stdout: memInfo } = await execAsync('free -m');
      const memLines = memInfo.split('\n')[1].split(/\s+/);
      const totalMem = parseInt(memLines[1]);
      const usedMem = parseInt(memLines[2]);
      const memoryUsage = Math.round((usedMem / totalMem) * 100);
      
      // Disk usage
      const { stdout: diskInfo } = await execAsync('df -h /');
      const diskLines = diskInfo.split('\n')[1].split(/\s+/);
      const diskUsage = parseInt(diskLines[4].replace('%', ''));
      
      // Load average
      const { stdout: loadInfo } = await execAsync('uptime');
      const loadMatch = loadInfo.match(/load average: ([\d.]+)/);
      const loadAverage = loadMatch ? parseFloat(loadMatch[1]) : 0;
      
      return {
        memoryUsage,
        diskUsage,
        loadAverage,
        totalMemoryMB: totalMem,
        usedMemoryMB: usedMem
      };
      
    } catch (error) {
      console.error('Error checking system health:', error);
      return {
        memoryUsage: 0,
        diskUsage: 0,
        loadAverage: 0,
        error: error.message
      };
    }
  }

  async checkErrorLogs() {
    try {
      const errorLogPath = path.join(this.logPath, 'error.log');
      
      if (!fs.existsSync(errorLogPath)) {
        return 0;
      }
      
      // Count errors in the last minute
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const { stdout } = await execAsync(`grep "$(date -d '1 minute ago' '+%Y-%m-%d %H:%M')" "${errorLogPath}" | wc -l`);
      
      return parseInt(stdout.trim()) || 0;
      
    } catch (error) {
      console.error('Error checking error logs:', error);
      return 0;
    }
  }

  async checkRestartFrequency() {
    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      
      const targetProcess = processes.find(p => p.name === this.appName);
      
      if (!targetProcess) {
        return 0;
      }
      
      // This is a simplified check - in reality you'd want to track restart times
      const restartCount = targetProcess.pm2_env.restart_time || 0;
      
      // Return recent restart count (simplified)
      return Math.min(restartCount, 10);
      
    } catch (error) {
      console.error('Error checking restart frequency:', error);
      return 0;
    }
  }

  async handleCriticalIssue(type, message) {
    console.error(`🚨 CRITICAL ISSUE [${type}]: ${message}`);
    this.stats.alerts++;
    
    // Log to file
    this.logAlert('CRITICAL', type, message);
    
    // Attempt automatic recovery
    try {
      switch (type) {
        case 'process_down':
          await this.recoverProcessDown();
          break;
        case 'frequent_restarts':
          await this.recoverFrequentRestarts();
          break;
        default:
          console.log('⚠️  No automatic recovery available for:', type);
      }
    } catch (error) {
      console.error('❌ Recovery failed:', error);
    }
  }

  async handleWarning(type, message) {
    console.warn(`⚠️  WARNING [${type}]: ${message}`);
    
    // Log to file
    this.logAlert('WARNING', type, message);
    
    // Could implement warning-specific actions here
  }

  async recoverProcessDown() {
    console.log('🔧 Attempting to recover downed process...');
    
    try {
      // Try to start the process
      await execAsync(`pm2 start ${this.appName}`);
      
      // Wait a bit and check if it's running
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const health = await this.checkProcessHealth();
      
      if (health.isRunning) {
        console.log('✅ Process recovery successful');
        this.stats.recoveries++;
        this.logAlert('INFO', 'recovery_success', 'Process successfully restarted');
      } else {
        console.log('❌ Process recovery failed - still not running');
        this.logAlert('ERROR', 'recovery_failed', 'Process restart failed');
      }
      
    } catch (error) {
      console.error('❌ Process recovery error:', error);
      this.logAlert('ERROR', 'recovery_error', error.message);
    }
  }

  async recoverFrequentRestarts() {
    console.log('🔧 Attempting to address frequent restarts...');
    
    try {
      // Stop the process temporarily
      await execAsync(`pm2 stop ${this.appName}`);
      
      // Wait 30 seconds
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Restart with fresh state
      await execAsync(`pm2 restart ${this.appName}`);
      
      console.log('✅ Process restarted with cooldown period');
      this.stats.recoveries++;
      this.logAlert('INFO', 'restart_recovery', 'Applied cooldown and restart');
      
    } catch (error) {
      console.error('❌ Restart recovery error:', error);
      this.logAlert('ERROR', 'restart_recovery_error', error.message);
    }
  }

  logHealthStatus(health) {
    const statusSymbol = {
      'healthy': '✅',
      'warning': '⚠️',
      'critical': '🚨'
    };
    
    console.log(`${statusSymbol[health.status]} Health Check [${health.status.toUpperCase()}] - ${health.timestamp.toISOString()}`);
    
    if (health.issues.length > 0) {
      health.issues.forEach(issue => {
        console.log(`  📋 ${issue}`);
      });
    }
    
    if (health.metrics.process) {
      const p = health.metrics.process;
      console.log(`  🔄 Process: ${p.status} | PID: ${p.pid} | Memory: ${p.memory}MB | CPU: ${p.cpu}%`);
    }
    
    if (health.metrics.system) {
      const s = health.metrics.system;
      console.log(`  💻 System: Memory ${s.memoryUsage}% | Disk ${s.diskUsage}% | Load ${s.loadAverage}`);
    }
  }

  logAlert(level, type, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level} [${type}] ${message}\n`;
    
    const alertLogPath = path.join(this.logPath, 'health-alerts.log');
    
    try {
      fs.appendFileSync(alertLogPath, logEntry);
    } catch (error) {
      console.error('Failed to write alert log:', error);
    }
  }

  async saveHealthReport(health) {
    try {
      const reportPath = path.join(this.logPath, 'health-status.json');
      
      const report = {
        ...health,
        monitorStats: this.stats
      };
      
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      
    } catch (error) {
      console.error('Failed to save health report:', error);
    }
  }
}

// Main execution
if (require.main === module) {
  const monitor = new HealthMonitor();
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down health monitor...');
    await monitor.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down health monitor...');
    await monitor.stop();
    process.exit(0);
  });
  
  // Start monitoring
  monitor.start().catch(error => {
    console.error('❌ Health monitor failed to start:', error);
    process.exit(1);
  });
}

module.exports = HealthMonitor;
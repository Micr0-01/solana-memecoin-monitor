module.exports = {
  apps: [
    {
      // ===============================================
      // MAIN APPLICATION CONFIGURATION
      // ===============================================
      name: 'solana-memecoin-monitor',
      script: 'src/monitor.js',
      
      // Process configuration
      instances: 1,
      exec_mode: 'fork',
      
      // Environment
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      
      // ===============================================
      // RESOURCE MANAGEMENT
      // ===============================================
      max_memory_restart: '1G',
      instance_var: 'INSTANCE_ID',
      
      // CPU and memory monitoring
      max_restarts: 10,
      min_uptime: '10s',
      
      // ===============================================
      // LOGGING CONFIGURATION
      // ===============================================
      log_file: '/var/log/solana-monitor/combined.log',
      out_file: '/var/log/solana-monitor/out.log',
      error_file: '/var/log/solana-monitor/error.log',
      
      // Log formatting
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // ===============================================
      // RESTART POLICY
      // ===============================================
      autorestart: true,
      restart_delay: 4000,
      
      // Restart conditions
      watch: false,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        '.env'
      ],
      
      // ===============================================
      // ADVANCED CONFIGURATION
      // ===============================================
      
      // Process management
      kill_timeout: 5000,
      listen_timeout: 8000,
      
      // Source map support
      source_map_support: true,
      
      // Interpreter options
      node_args: [
        '--max-old-space-size=1024',
        '--optimize-for-size'
      ],
      
      // ===============================================
      // HEALTH MONITORING
      // ===============================================
      
      // Health check (if you implement HTTP endpoint)
      // health_check_url: 'http://localhost:3000/health',
      // health_check_grace_period: 3000,
      
      // Monitoring
      monitoring: false, // Set to true if you want PM2 Plus monitoring
      
      // ===============================================
      // CLUSTERING (for future scaling)
      // ===============================================
      // Uncomment below for cluster mode (requires app modifications)
      // instances: 'max',
      // exec_mode: 'cluster',
      
      // ===============================================
      // CUSTOM HOOKS
      // ===============================================
      
      // Pre-start script
      // pre_start: 'echo "Starting Solana Monitor..."',
      
      // Post-start script  
      // post_start: 'echo "Solana Monitor started successfully"',
      
      // Pre-stop script
      // pre_stop: 'echo "Stopping Solana Monitor..."'
    },
    
    // ===============================================
    // OPTIONAL: LOG PROCESSOR SERVICE
    // ===============================================
    {
      name: 'log-processor',
      script: 'deploy/log-processor.js',
      instances: 1,
      exec_mode: 'fork',
      
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      
      // Resource limits for log processor
      max_memory_restart: '256M',
      
      // Logging
      log_file: '/var/log/solana-monitor/log-processor.log',
      out_file: '/var/log/solana-monitor/log-processor-out.log',
      error_file: '/var/log/solana-monitor/log-processor-error.log',
      
      // Restart configuration
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 5,
      min_uptime: '5s',
      
      // Disable by default (enable if needed)
      disabled: true
    },
    
    // ===============================================
    // OPTIONAL: HEALTH MONITOR SERVICE
    // ===============================================
    {
      name: 'health-monitor',
      script: 'deploy/health-monitor.js',
      instances: 1,
      exec_mode: 'fork',
      
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn'
      },
      
      // Resource limits
      max_memory_restart: '128M',
      
      // Logging
      log_file: '/var/log/solana-monitor/health-monitor.log',
      
      // Restart configuration
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 3,
      min_uptime: '30s',
      
      // Disable by default (enable if needed)
      disabled: true
    }
  ],
  
  // ===============================================
  // DEPLOYMENT CONFIGURATION
  // ===============================================
  deploy: {
    production: {
      user: 'solana-monitor',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'https://github.com/your-username/solana-memecoin-monitor.git',
      path: '/home/solana-monitor/solana-memecoin-monitor',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.production.config.js --env production'
    }
  }
};
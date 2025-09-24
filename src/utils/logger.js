const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let logger;

function createLogger() {
  try {
    const config = getConfig();
    const logConfig = config.get('logging');

    const formats = [
      winston.format.timestamp({ format: logConfig.TIMESTAMP_FORMAT }),
      winston.format.errors({ stack: true })
    ];

    if (logConfig.CONSOLE_OUTPUT) {
      formats.push(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          return `${timestamp} [${level}]: ${stack || message}`;
        })
      );
    }

    const transports = [];

    // Console transport
    if (logConfig.CONSOLE_OUTPUT) {
      transports.push(new winston.transports.Console());
    }

    // File transport
    if (logConfig.FILE_PATH) {
      transports.push(
        new winston.transports.File({
          filename: path.join(__dirname, '../../', logConfig.FILE_PATH),
          maxsize: logConfig.MAX_FILE_SIZE,
          maxFiles: logConfig.MAX_FILES,
          format: winston.format.combine(
            winston.format.uncolorize(),
            winston.format.json()
          )
        })
      );
    }

    logger = winston.createLogger({
      level: logConfig.LEVEL,
      format: winston.format.combine(...formats),
      transports,
      exitOnError: false
    });

    return logger;
  } catch (error) {
    // Fallback to console logging if config fails
    console.warn('Failed to load logging config, using fallback:', error.message);
    
    logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()],
      exitOnError: false
    });

    return logger;
  }
}

// Initialize logger
if (!logger) {
  logger = createLogger();
}

module.exports = logger;
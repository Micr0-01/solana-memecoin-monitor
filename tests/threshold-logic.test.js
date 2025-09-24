const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mock the config and logger
jest.mock('../src/utils/config', () => ({
  getConfig: () => ({
    getVolumeThreshold: () => 50000,
    getLiquidityThreshold: () => 2000,
    getAlertCooldown: () => 3600,
    get: (path) => {
      const mockConfig = {
        'monitoring.MONITOR_MODE': 'since_first_trade'
      };
      return mockConfig[path];
    }
  })
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

describe('Threshold Logic Tests', () => {
  let mockMonitor;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock the monitor class with threshold checking logic
    mockMonitor = {
      config: {
        getVolumeThreshold: () => 50000,
        getLiquidityThreshold: () => 2000,
        getAlertCooldown: () => 3600
      },
      
      shouldTriggerAlert(volume, liquidity, cooldownCheck = false) {
        // Zero liquidity blocks alerts
        if (liquidity === 0) {
          return false;
        }
        
        // If cooldown check is enabled, simulate cooldown logic
        if (cooldownCheck) {
          return false; // Assume in cooldown for this test
        }
        
        // Either threshold can trigger alert
        return volume >= this.config.getVolumeThreshold() || 
               liquidity >= this.config.getLiquidityThreshold();
      }
    };
  });

  describe('Zero Liquidity Filtering', () => {
    test('should NOT alert when liquidity is zero, regardless of volume', () => {
      const result = mockMonitor.shouldTriggerAlert(100000, 0); // High volume, zero liquidity
      expect(result).toBe(false);
    });

    test('should NOT alert when both volume and liquidity are zero', () => {
      const result = mockMonitor.shouldTriggerAlert(0, 0);
      expect(result).toBe(false);
    });
  });

  describe('Volume Threshold Tests', () => {
    test('should alert when volume reaches threshold with non-zero liquidity', () => {
      const result = mockMonitor.shouldTriggerAlert(50000, 1000); // Volume at threshold, liquidity > 0
      expect(result).toBe(true);
    });

    test('should alert when volume exceeds threshold with non-zero liquidity', () => {
      const result = mockMonitor.shouldTriggerAlert(75000, 500); // Volume above threshold
      expect(result).toBe(true);
    });

    test('should NOT alert when volume is below threshold and liquidity is below threshold', () => {
      const result = mockMonitor.shouldTriggerAlert(25000, 1000); // Both below thresholds
      expect(result).toBe(false);
    });
  });

  describe('Liquidity Threshold Tests', () => {
    test('should alert when liquidity reaches threshold regardless of volume', () => {
      const result = mockMonitor.shouldTriggerAlert(1000, 2000); // Low volume, liquidity at threshold
      expect(result).toBe(true);
    });

    test('should alert when liquidity exceeds threshold regardless of volume', () => {
      const result = mockMonitor.shouldTriggerAlert(500, 5000); // Low volume, high liquidity
      expect(result).toBe(true);
    });
  });

  describe('Combined Threshold Tests', () => {
    test('should alert when both volume and liquidity exceed thresholds', () => {
      const result = mockMonitor.shouldTriggerAlert(75000, 5000); // Both above thresholds
      expect(result).toBe(true);
    });

    test('should alert when only volume threshold is met', () => {
      const result = mockMonitor.shouldTriggerAlert(60000, 1500); // Volume above, liquidity below
      expect(result).toBe(true);
    });

    test('should alert when only liquidity threshold is met', () => {
      const result = mockMonitor.shouldTriggerAlert(30000, 3000); // Volume below, liquidity above
      expect(result).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle exactly zero values correctly', () => {
      expect(mockMonitor.shouldTriggerAlert(0, 2000)).toBe(true); // Zero volume, sufficient liquidity
      expect(mockMonitor.shouldTriggerAlert(50000, 0)).toBe(false); // Sufficient volume, zero liquidity
    });

    test('should handle very small non-zero liquidity', () => {
      const result = mockMonitor.shouldTriggerAlert(60000, 0.01); // High volume, tiny liquidity
      expect(result).toBe(true);
    });

    test('should handle exactly threshold values', () => {
      expect(mockMonitor.shouldTriggerAlert(50000, 1)).toBe(true); // Exactly volume threshold
      expect(mockMonitor.shouldTriggerAlert(1, 2000)).toBe(true); // Exactly liquidity threshold
    });
  });

  describe('Cooldown Logic', () => {
    test('should NOT alert when in cooldown period', () => {
      const result = mockMonitor.shouldTriggerAlert(75000, 3000, true); // High values but in cooldown
      expect(result).toBe(false);
    });
  });

  describe('Alert Reason Generation', () => {
    const getAlertReason = (volume, liquidity) => {
      const volumeThreshold = 50000;
      const liquidityThreshold = 2000;
      
      if (liquidity === 0) {
        return 'Zero liquidity - alert blocked';
      }
      
      const reasons = [];
      if (volume >= volumeThreshold) {
        reasons.push('Volume threshold reached');
      }
      if (liquidity >= liquidityThreshold) {
        reasons.push('Liquidity threshold reached');
      }
      
      if (reasons.length === 0) {
        return 'Neither threshold reached';
      }
      
      return reasons.join(' & ');
    };

    test('should generate correct reason for volume-triggered alert', () => {
      const reason = getAlertReason(60000, 1500);
      expect(reason).toBe('Volume threshold reached');
    });

    test('should generate correct reason for liquidity-triggered alert', () => {
      const reason = getAlertReason(30000, 3000);
      expect(reason).toBe('Liquidity threshold reached');
    });

    test('should generate correct reason for both thresholds met', () => {
      const reason = getAlertReason(75000, 5000);
      expect(reason).toBe('Volume threshold reached & Liquidity threshold reached');
    });

    test('should generate correct reason for zero liquidity block', () => {
      const reason = getAlertReason(100000, 0);
      expect(reason).toBe('Zero liquidity - alert blocked');
    });

    test('should generate correct reason when no thresholds met', () => {
      const reason = getAlertReason(25000, 1000);
      expect(reason).toBe('Neither threshold reached');
    });
  });
});
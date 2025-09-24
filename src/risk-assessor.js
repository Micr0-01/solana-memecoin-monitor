const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAccount, getMint } = require('@solana/spl-token');
const { getConfig } = require('./utils/config');
const logger = require('./utils/logger');
const { retryAsync, isValidPublicKey } = require('./utils/helpers');

class RiskAssessor {
  constructor(connection) {
    this.connection = connection;
    this.config = getConfig();
    this.riskConfig = this.config.get('risk_assessment');
    
    // Cache for assessments to avoid repeated checks
    this.assessmentCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Perform comprehensive risk assessment on a token
   */
  async assessToken(tokenMint) {
    try {
      // Check cache first
      const cached = this.assessmentCache.get(tokenMint);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.flags;
      }

      logger.debug(`Assessing risks for token: ${tokenMint}`);
      
      const flags = [];
      
      // Run all risk checks
      const checks = [
        this.checkMintable(tokenMint),
        this.checkHoneypot(tokenMint),
        this.checkLPBurned(tokenMint),
        this.checkOwnerRenounced(tokenMint),
        this.checkTransferHooks(tokenMint),
        this.checkHolderConcentration(tokenMint),
        this.checkLiquidityProvision(tokenMint)
      ];

      const results = await Promise.allSettled(checks);
      
      // Process check results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const checkNames = [
            'mintable',
            'honeypot', 
            'lp_not_burned',
            'owner_not_renounced',
            'suspicious_transfer_hooks',
            'high_holder_concentration',
            'lp_not_found'
          ];
          flags.push(checkNames[index]);
        }
      });

      // Cache the result
      this.assessmentCache.set(tokenMint, {
        flags,
        timestamp: Date.now()
      });

      logger.debug(`Risk assessment for ${tokenMint}: ${flags.join(', ') || 'No risks detected'}`);
      
      return flags;
    } catch (error) {
      logger.error(`Error assessing token ${tokenMint}:`, error);
      return ['assessment_failed'];
    }
  }

  /**
   * Check if token is still mintable
   */
  async checkMintable(tokenMint) {
    if (!this.riskConfig.MINTABLE_CHECKS) return false;
    
    try {
      const mintInfo = await retryAsync(
        () => getMint(this.connection, new PublicKey(tokenMint)),
        3,
        1000
      );

      // Token is mintable if mint authority exists
      const isMintable = mintInfo.mintAuthority !== null;
      
      logger.debug(`Token ${tokenMint} mintable: ${isMintable}`);
      return isMintable;
    } catch (error) {
      logger.debug(`Error checking mintable for ${tokenMint}:`, error.message);
      return false; // Assume not mintable if check fails
    }
  }

  /**
   * Check for honeypot characteristics
   */
  async checkHoneypot(tokenMint) {
    if (!this.riskConfig.HONEYPOT_CHECKS) return false;
    
    try {
      // This is a simplified honeypot check
      // In production, you'd analyze trading patterns, failed transactions, etc.
      
      const mintInfo = await retryAsync(
        () => getMint(this.connection, new PublicKey(tokenMint)),
        3,
        1000
      );

      // Check for suspicious characteristics
      const suspiciousFlags = [];

      // Very high supply might indicate a honeypot
      if (mintInfo.supply > BigInt(1000000000000)) {
        suspiciousFlags.push('high_supply');
      }

      // Unusual decimal places
      if (mintInfo.decimals > 9) {
        suspiciousFlags.push('unusual_decimals');
      }

      // Check if freeze authority still exists (red flag)
      if (mintInfo.freezeAuthority !== null) {
        suspiciousFlags.push('freeze_authority');
      }

      const isHoneypot = suspiciousFlags.length >= 2;
      
      if (isHoneypot) {
        logger.debug(`Token ${tokenMint} honeypot indicators: ${suspiciousFlags.join(', ')}`);
      }
      
      return isHoneypot;
    } catch (error) {
      logger.debug(`Error checking honeypot for ${tokenMint}:`, error.message);
      return false;
    }
  }

  /**
   * Check if LP tokens are burned
   */
  async checkLPBurned(tokenMint) {
    if (!this.riskConfig.LP_BURN_CHECKS) return false;
    
    try {
      // This is a simplified check - would need to find actual LP token addresses
      // For now, we'll return false (LP not burned) as a conservative assumption
      
      // TODO: Implement proper LP token detection and burn verification
      // This would require:
      // 1. Finding LP pools for this token
      // 2. Checking if LP tokens were sent to burn address
      // 3. Verifying the burn transaction
      
      logger.debug(`LP burn check for ${tokenMint}: not implemented (assuming not burned)`);
      return true; // Assume LP not burned as conservative default
    } catch (error) {
      logger.debug(`Error checking LP burned for ${tokenMint}:`, error.message);
      return false;
    }
  }

  /**
   * Check if owner/authority has been renounced
   */
  async checkOwnerRenounced(tokenMint) {
    if (!this.riskConfig.OWNER_RENOUNCE_CHECKS) return false;
    
    try {
      const mintInfo = await retryAsync(
        () => getMint(this.connection, new PublicKey(tokenMint)),
        3,
        1000
      );

      // Owner is considered renounced if both authorities are null
      const ownerRenounced = mintInfo.mintAuthority === null && mintInfo.freezeAuthority === null;
      
      logger.debug(`Token ${tokenMint} owner renounced: ${ownerRenounced}`);
      return !ownerRenounced; // Return true if owner NOT renounced (risk)
    } catch (error) {
      logger.debug(`Error checking owner renounced for ${tokenMint}:`, error.message);
      return true; // Assume owner not renounced as conservative default
    }
  }

  /**
   * Check for suspicious transfer hooks
   */
  async checkTransferHooks(tokenMint) {
    if (!this.riskConfig.TRANSFER_HOOK_CHECKS) return false;
    
    try {
      const mintInfo = await retryAsync(
        () => getMint(this.connection, new PublicKey(tokenMint)),
        3,
        1000
      );

      // Check for Token-2022 extensions that might include transfer hooks
      // This is a simplified check - Token-2022 has more complex extension handling
      
      const hasExtensions = mintInfo.tlvData && mintInfo.tlvData.length > 0;
      
      if (hasExtensions) {
        logger.debug(`Token ${tokenMint} has extensions - potential transfer hooks`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.debug(`Error checking transfer hooks for ${tokenMint}:`, error.message);
      return false;
    }
  }

  /**
   * Check holder concentration (whale dominance)
   */
  async checkHolderConcentration(tokenMint) {
    try {
      // Get largest token accounts for this mint
      const largestAccounts = await retryAsync(
        () => this.connection.getTokenLargestAccounts(new PublicKey(tokenMint)),
        3,
        1000
      );

      if (!largestAccounts.value || largestAccounts.value.length === 0) {
        return true; // No holders found - suspicious
      }

      const accounts = largestAccounts.value;
      const totalSupply = accounts.reduce((sum, acc) => sum + Number(acc.amount), 0);
      
      if (totalSupply === 0) {
        return true; // No supply - suspicious
      }

      // Check if top holder has too much concentration
      const topHolderPercentage = Number(accounts[0].amount) / totalSupply;
      const isHighConcentration = topHolderPercentage > this.riskConfig.MAX_HOLDER_CONCENTRATION;

      // Check minimum holder count
      const holderCount = accounts.filter(acc => Number(acc.amount) > 0).length;
      const tooFewHolders = holderCount < this.riskConfig.MIN_HOLDER_COUNT;

      const hasConcentrationRisk = isHighConcentration || tooFewHolders;
      
      if (hasConcentrationRisk) {
        logger.debug(`Token ${tokenMint} concentration risk - top holder: ${(topHolderPercentage * 100).toFixed(1)}%, holders: ${holderCount}`);
      }
      
      return hasConcentrationRisk;
    } catch (error) {
      logger.debug(`Error checking holder concentration for ${tokenMint}:`, error.message);
      return false;
    }
  }

  /**
   * Check if liquidity is properly provided
   */
  async checkLiquidityProvision(tokenMint) {
    try {
      // This is a simplified check
      // In production, you'd check specific DEX pools
      
      // For now, assume liquidity exists if we can find any token accounts
      const largestAccounts = await retryAsync(
        () => this.connection.getTokenLargestAccounts(new PublicKey(tokenMint)),
        2,
        500
      );

      const hasLiquidity = largestAccounts.value && largestAccounts.value.length > 0;
      
      if (!hasLiquidity) {
        logger.debug(`Token ${tokenMint} - no liquidity found`);
      }
      
      return !hasLiquidity; // Return true if NO liquidity (risk)
    } catch (error) {
      logger.debug(`Error checking liquidity for ${tokenMint}:`, error.message);
      return true; // Assume no liquidity if check fails
    }
  }

  /**
   * Get risk flag descriptions
   */
  getRiskFlagDescriptions() {
    return {
      'mintable': 'Token supply can still be increased',
      'honeypot': 'Potential honeypot characteristics detected',
      'lp_not_burned': 'Liquidity provider tokens not burned',
      'owner_not_renounced': 'Token owner/authority not renounced',
      'suspicious_transfer_hooks': 'Suspicious transfer restrictions detected',
      'high_holder_concentration': 'High concentration of tokens in few wallets',
      'lp_not_found': 'No liquidity pools found',
      'assessment_failed': 'Risk assessment could not be completed'
    };
  }

  /**
   * Format risk flags for display
   */
  formatRiskFlags(flags) {
    if (!flags || flags.length === 0) {
      return 'No risks detected ✅';
    }

    const descriptions = this.getRiskFlagDescriptions();
    const symbols = {
      'mintable': '✅',
      'honeypot': '⚠️',
      'lp_not_burned': '❌',
      'owner_not_renounced': '⚠️',
      'suspicious_transfer_hooks': '⚠️',
      'high_holder_concentration': '⚠️',
      'lp_not_found': '❌',
      'assessment_failed': '❓'
    };

    return flags.map(flag => {
      const symbol = symbols[flag] || '⚠️';
      const description = flag.replace(/_/g, ' ');
      return `${description} ${symbol}`;
    }).join(' | ');
  }

  /**
   * Get risk score (0-100, higher is more risky)
   */
  calculateRiskScore(flags) {
    if (!flags || flags.length === 0) {
      return 0;
    }

    const riskWeights = {
      'honeypot': 40,
      'suspicious_transfer_hooks': 30,
      'high_holder_concentration': 20,
      'owner_not_renounced': 15,
      'mintable': 10,
      'lp_not_burned': 10,
      'lp_not_found': 25,
      'assessment_failed': 5
    };

    const score = flags.reduce((total, flag) => {
      return total + (riskWeights[flag] || 5);
    }, 0);

    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Clear assessment cache
   */
  clearCache() {
    this.assessmentCache.clear();
    logger.debug('Risk assessment cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cachedAssessments: this.assessmentCache.size,
      cacheHitRate: this.cacheHits / Math.max(this.cacheRequests, 1)
    };
  }
}

module.exports = RiskAssessor;
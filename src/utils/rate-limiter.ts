/**
 * Rate limiter utility for Shopify API calls
 *
 * Shopify uses a leaky bucket algorithm with:
 * - Maximum bucket size: 2000 points
 * - Restore rate: 100 points per second
 * - Each mutation typically costs 10-20 points
 */

export class RateLimiter {
  private lastRequestTime: number = 0;
  private minDelayMs: number;

  constructor(minDelayMs: number = 300) {
    this.minDelayMs = minDelayMs;
  }

  /**
   * Wait if necessary to respect rate limits
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minDelayMs) {
      const waitTime = this.minDelayMs - timeSinceLastRequest;
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next request`);
      await this.delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Calculate wait time based on Shopify's throttle status
   */
  calculateBackoffTime(currentlyAvailable: number, requestCost: number, restoreRate: number): number {
    // If we have enough points, use minimum delay
    if (currentlyAvailable >= requestCost) {
      return this.minDelayMs;
    }

    // Calculate how long to wait for enough points to restore
    const pointsNeeded = requestCost - currentlyAvailable;
    const waitTime = Math.ceil((pointsNeeded / restoreRate) * 1000) + 500; // Add 500ms buffer

    return Math.max(waitTime, this.minDelayMs);
  }

  /**
   * Calculate exponential backoff for retries
   */
  calculateExponentialBackoff(retryCount: number, baseDelay: number = 1000): number {
    const backoff = baseDelay * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000; // Add jitter to avoid thundering herd
    return Math.min(backoff + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Delay for a specified number of milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Extract throttle status from Shopify GraphQL error
   */
  extractThrottleStatus(error: any): { currentlyAvailable: number; restoreRate: number; requestCost: number } | null {
    try {
      const extensions = error?.response?.extensions;
      if (extensions?.cost?.throttleStatus) {
        return {
          currentlyAvailable: extensions.cost.throttleStatus.currentlyAvailable || 0,
          restoreRate: extensions.cost.throttleStatus.restoreRate || 100,
          requestCost: extensions.cost.requestedQueryCost || 20
        };
      }
    } catch (e) {
      // Ignore parsing errors
    }
    return null;
  }

  /**
   * Check if error is a throttle error
   */
  isThrottleError(error: any): boolean {
    const errorMessage = error?.response?.errors?.[0]?.message;
    const errorCode = error?.response?.errors?.[0]?.extensions?.code;
    return errorMessage === 'Throttled' || errorCode === 'THROTTLED';
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter(
  parseInt(process.env.SHOPIFY_RATE_LIMIT_DELAY || '300', 10)
);

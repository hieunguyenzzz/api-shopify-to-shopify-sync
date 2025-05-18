import { Redis } from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class RedisService {
  private client: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL is required in environment variables');
    }

    this.client = new Redis(redisUrl);
    
    this.client.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
    
    this.client.on('connect', () => {
      console.log('Connected to Redis');
    });
  }

  /**
   * Get a value from cache
   * @param key The cache key
   * @returns The cached value or null if not found
   */
  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    
    try {
      return JSON.parse(data) as T;
    } catch (error) {
      return data as unknown as T;
    }
  }

  /**
   * Set a value in cache
   * @param key The cache key
   * @param value The value to cache
   * @param expireInSeconds TTL in seconds (optional, if not provided cache will never expire)
   */
  async set(key: string, value: any, expireInSeconds?: number): Promise<void> {
    const valueToStore = typeof value === 'string' ? value : JSON.stringify(value);
    
    if (expireInSeconds) {
      await this.client.set(key, valueToStore, 'EX', expireInSeconds);
    } else {
      // Set without expiration
      await this.client.set(key, valueToStore);
    }
  }

  /**
   * Delete a key from cache
   * @param key The cache key to delete
   */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Create a hash of parameters to use as a cache key
   * @param params Object containing parameters
   * @returns A string hash to use as cache key
   */
  createCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.entries(params)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
      .join('|');
      
    return `${prefix}:${sortedParams}`;
  }
}

// Export singleton instance
export const redisService = new RedisService(); 
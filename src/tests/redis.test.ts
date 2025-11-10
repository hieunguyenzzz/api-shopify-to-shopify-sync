import { redisService } from '../services/redis.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export async function testRedis() {
  try {
    console.log('Testing Redis connection...');

    // Test basic set/get
    const testKey = 'test:connection';
    const testValue = `test-${Date.now()}`;

    console.log(`Setting test key: ${testKey}`);
    await redisService.set(testKey, testValue);
    console.log('✅ Successfully set value in Redis');

    console.log(`Getting test key: ${testKey}`);
    const retrievedValue = await redisService.get<string>(testKey);
    console.log(`✅ Retrieved value: ${retrievedValue}`);

    // Verify the value matches
    if (retrievedValue === testValue) {
      console.log('✅ Values match! Redis is working correctly');
    } else {
      throw new Error(`Value mismatch: expected ${testValue}, got ${retrievedValue}`);
    }

    // Test cache key creation
    const cacheKey = redisService.createCacheKey('test:prefix:', { foo: 'bar', baz: 123 });
    console.log(`✅ Created cache key: ${cacheKey}`);

    // Clean up test key
    await redisService.delete(testKey);
    console.log('✅ Cleaned up test key');

    // Test that key was deleted
    const deletedValue = await redisService.get<string>(testKey);
    if (deletedValue === null) {
      console.log('✅ Key successfully deleted');
    }

    console.log('✅ Redis tests passed!');
  } catch (error) {
    console.error('❌ Redis test failed:', error);
    throw error;
  }
}

// If run directly, execute the test
if (require.main === module) {
  testRedis().catch(() => process.exit(1));
}

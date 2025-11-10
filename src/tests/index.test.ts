import dotenv from 'dotenv';
import { Command } from 'commander';

// Load environment variables
dotenv.config();

// Import test modules
import { testOpenAI } from './openai.service.test';
import { testMongoDB } from './mongodb.test';
import { testRedis } from './redis.test';
import { testShopify } from './shopify.test';

const program = new Command();

program
  .name('test')
  .description('Run tests for the Shopify sync application')
  .option('-a, --all', 'Run all tests')
  .option('-o, --openai', 'Test OpenAI/OpenRouter service')
  .option('-m, --mongodb', 'Test MongoDB connection')
  .option('-r, --redis', 'Test Redis connection')
  .option('-s, --shopify', 'Test Shopify API connection')
  .parse(process.argv);

const options = program.opts();

async function runAllTests() {
  console.log('🧪 Running All Tests\n');
  console.log('='.repeat(50));

  let failedTests: string[] = [];

  // Test 1: MongoDB
  try {
    console.log('\n📦 MongoDB Connection Test');
    console.log('-'.repeat(50));
    await testMongoDB();
  } catch (error) {
    failedTests.push('MongoDB');
    console.error('❌ MongoDB test failed:', error instanceof Error ? error.message : String(error));
  }

  // Test 2: Redis
  try {
    console.log('\n🔴 Redis Connection Test');
    console.log('-'.repeat(50));
    await testRedis();
  } catch (error) {
    failedTests.push('Redis');
    console.error('❌ Redis test failed:', error instanceof Error ? error.message : String(error));
  }

  // Test 3: Shopify
  try {
    console.log('\n🛍️  Shopify API Test');
    console.log('-'.repeat(50));
    await testShopify();
  } catch (error) {
    failedTests.push('Shopify');
    console.error('❌ Shopify test failed:', error instanceof Error ? error.message : String(error));
  }

  // Test 4: OpenAI/OpenRouter
  try {
    console.log('\n🤖 OpenAI/OpenRouter Service Test');
    console.log('-'.repeat(50));
    await testOpenAI();
  } catch (error) {
    failedTests.push('OpenAI');
    console.error('❌ OpenAI test failed:', error instanceof Error ? error.message : String(error));
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));

  if (failedTests.length === 0) {
    console.log('✅ All tests passed successfully!');
  } else {
    console.log(`❌ ${failedTests.length} test(s) failed:`);
    failedTests.forEach(test => console.log(`   - ${test}`));
    process.exit(1);
  }
}

async function main() {
  try {
    // If no options specified, run all tests
    if (!options.all && !options.openai && !options.mongodb && !options.redis && !options.shopify) {
      options.all = true;
    }

    if (options.all) {
      await runAllTests();
    } else {
      // Run individual tests
      if (options.mongodb) {
        console.log('📦 Testing MongoDB Connection\n');
        await testMongoDB();
      }

      if (options.redis) {
        console.log('🔴 Testing Redis Connection\n');
        await testRedis();
      }

      if (options.shopify) {
        console.log('🛍️  Testing Shopify API\n');
        await testShopify();
      }

      if (options.openai) {
        console.log('🤖 Testing OpenAI/OpenRouter Service\n');
        await testOpenAI();
      }

      console.log('\n✅ Selected tests completed successfully!');
    }
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run tests
main();

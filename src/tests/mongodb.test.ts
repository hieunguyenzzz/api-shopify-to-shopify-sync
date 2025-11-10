import mongoDBService from '../services/mongodb.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export async function testMongoDB() {
  try {
    console.log('Testing MongoDB connection...');

    // Test connection by initializing
    await mongoDBService.initialize();
    console.log('✅ Successfully connected to MongoDB');

    // Test a simple operation - get all mappings
    const mappings = await mongoDBService.getAllFileMappings();
    console.log(`✅ Found ${mappings.size} file mapping(s) in database`);

    // Test finding a mapping (even if it doesn't exist, it tests the query)
    const testHash = 'test-hash-123';
    const result = await mongoDBService.findFileByHash(testHash);
    if (result === null) {
      console.log(`✅ Successfully queried for non-existent hash (returned null as expected)`);
    } else {
      console.log(`✅ Found existing mapping with hash: ${testHash}`);
    }

    console.log('✅ MongoDB tests passed!');
  } catch (error) {
    console.error('❌ MongoDB test failed:', error);
    throw error;
  } finally {
    // Close connection
    try {
      await mongoDBService.close();
      console.log('✅ MongoDB connection closed');
    } catch (error) {
      console.warn('⚠️  Warning: Could not close MongoDB connection:', error);
    }
  }
}

// If run directly, execute the test
if (require.main === module) {
  testMongoDB().catch(() => process.exit(1));
}

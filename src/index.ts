import express from 'express';
import syncProducts from './api/sync-products';
import syncPages from './api/sync-pages';
import syncMetaobjects from './api/sync-metaobjects';
import syncFiles from './api/sync-files';
import syncCollections from './api/sync-collections';
import mongoDBService from './services/mongodb.service';
import { variantIdMappingService } from './services/variant-id-mapping.service';
import { pageMappingService } from './services/page-mapping.service';
import { metaobjectMappingService } from './services/metaobject-mapping.service';
import mongoDBCollectionService from './services/mongodb-collection.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize MongoDB connections
(async () => {
  try {
    // Initialize file caching service
    await mongoDBService.initialize();
    console.log('File caching MongoDB connection initialized successfully');
    
    // Initialize variant mapping service
    await variantIdMappingService.initialize();
    console.log('Variant mapping MongoDB connection initialized successfully');
    
    // Initialize page mapping service
    await pageMappingService.initialize();
    console.log('Page mapping MongoDB connection initialized successfully');

    // Initialize metaobject mapping service
    await metaobjectMappingService.initialize();
    console.log('Metaobject mapping MongoDB connection initialized successfully');

    // Initialize collection mapping service
    await mongoDBCollectionService.initialize();
    console.log('Collection mapping MongoDB connection initialized successfully');
  } catch (error) {
    console.error('Failed to initialize MongoDB connections:', error);
    // Continue application startup even if MongoDB fails
    // This allows the app to function without caching
  }
})();

// Middleware
app.use(express.json());

// Routes
app.get('/api/sync-products', syncProducts);
app.get('/api/sync-pages', syncPages);
app.get('/api/sync-metaobjects', syncMetaobjects);
app.get('/api/sync-files', syncFiles);
app.get('/api/sync-collections', syncCollections);

// Backward compatibility route
app.get('/api/sync-metaobject-faq', (req, res) => {
  req.query.type = 'FAQs';
  syncMetaobjects(req, res);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle application shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  try {
    await mongoDBService.close();
    console.log('File caching MongoDB connection closed');
    
    await variantIdMappingService.close();
    console.log('Variant mapping MongoDB connection closed');
    
    await pageMappingService.close();
    console.log('Page mapping MongoDB connection closed');

    await metaobjectMappingService.close();
    console.log('Metaobject mapping MongoDB connection closed');
    
    await mongoDBCollectionService.close();
    console.log('Collection mapping MongoDB connection closed');
  } catch (error) {
    console.error('Error closing MongoDB connections:', error);
  }
  process.exit(0);
});

export default app; 
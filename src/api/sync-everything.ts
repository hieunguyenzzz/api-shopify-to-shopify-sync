import { Request, Response } from 'express';
import { shopifyFileSyncService } from '../services/shopify-file-sync.service';
import { shopifyRedirectSyncService } from '../services/shopify-redirect-sync.service';
import { shopifyMetaobjectSyncService } from '../services/shopify-metaobject-sync.service';
import { shopifyPageSyncService } from '../services/shopify-page-sync.service';
import { shopifyCollectionSyncService } from '../services/shopify-collection-sync.service';
import { shopifyProductSyncService } from '../services/shopify-product-sync.service';
import { shopifyPriceListSyncService } from '../services/shopify-pricelist-sync.service';
import { AxiosError } from 'axios';

// Define valid metaobject types
const validMetaobjectTypes = ['FAQs', 'room_features', 'company_logo', 'product_feature', 'meeting_rooms_features'];

// Define interface for sync results
interface SyncResults {
  files: any[];
  redirects: any[];
  metaobjects: Record<string, any>;
  pages: any[];
  collections: any[];
  products: any[];
  priceLists: any[];
}

/**
 * Syncs all types of metaobjects sequentially
 */
async function syncAllMetaobjectTypes(limit?: number): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  for (const type of validMetaobjectTypes) {
    results[type] = await shopifyMetaobjectSyncService.syncMetaobjects(type, limit);
  }
  
  return results;
}

/**
 * Syncs everything in the specified sequence
 */
export const syncEverything = async (req: Request, res: Response) => {
  try {
    // Get limit parameter if provided
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    const results: SyncResults = {
      files: [],
      redirects: [],
      metaobjects: {},
      pages: [],
      collections: [],
      products: [],
      priceLists: []
    };
    
    // Step 1: Sync files
    console.log('🔄 Starting sync-everything process: Step 1 - Files');
    results.files = await shopifyFileSyncService.syncFiles(limit);
    
    // Step 2: Sync redirects
    console.log('🔄 Starting sync-everything process: Step 2 - Redirects');
    results.redirects = await shopifyRedirectSyncService.syncRedirects(limit);
    
    // Step 3: Sync metaobjects
    console.log('🔄 Starting sync-everything process: Step 3 - Metaobjects');
    results.metaobjects = await syncAllMetaobjectTypes(limit);
    
    // Step 4: Sync pages
    // console.log('🔄 Starting sync-everything process: Step 4 - Pages');
    // results.pages = await shopifyPageSyncService.syncPages(limit);
    
    // Step 5: Sync collections
    // console.log('🔄 Starting sync-everything process: Step 5 - Collections');
    // results.collections = await shopifyCollectionSyncService.syncCollections(limit);
    
    // Step 6: Sync products
    console.log('🔄 Starting sync-everything process: Step 6 - Products');
    results.products = await shopifyProductSyncService.syncProducts(limit);
    
    // Step 7: Sync price lists
    // console.log('🔄 Starting sync-everything process: Step 7 - Price Lists');
    // results.priceLists = await shopifyPriceListSyncService.syncPriceLists();
    
    // Return success response with all results
    res.status(200).json({
      message: 'All sync processes completed successfully',
      syncResults: results
    });
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      // Handle Axios errors specifically
      console.error(`❌ Error during external API call to ${error.config?.url}: Status ${error.response.status}`, error.message);
      res.status(error.response.status).json({
        message: `Failed during sync process due to external API error: ${error.message}`,
        details: `External API returned status ${error.response.status} for URL ${error.config?.url}`,
        error: error.message
      });
    } else {
      // Handle other errors
      console.error('Sync everything error:', error);
      res.status(500).json({
        message: 'Error during sync-everything process',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};

export default syncEverything; 
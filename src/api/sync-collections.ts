import { Request, Response } from 'express';
import { shopifyCollectionSyncService } from '../services/shopify-collection-sync.service';

export const syncCollections = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    // Check for the 'delete' query parameter
    // Treat its presence as true, unless explicitly set to 'false' or '0'
    const deleteQueryParam = req.query.delete as string | undefined;
    const deleteMode = deleteQueryParam !== undefined && deleteQueryParam !== 'false' && deleteQueryParam !== '0';

    if (deleteMode) {
        console.log('API: Received request with delete mode enabled.');
    }
    
    // Pass the deleteMode flag to the service
    const syncResults = await shopifyCollectionSyncService.syncCollections(limit, deleteMode);
    
    // Adjust response message based on mode
    const message = deleteMode 
        ? 'Collection deletion process completed'
        : 'Collection sync completed successfully';
    const detailsKey = deleteMode ? 'deletedCollectionsInfo' : 'syncedCollectionsInfo';
    const detailsValue = deleteMode 
        ? { message: 'See server logs for deletion details.' } // Delete mode returns empty array, provide log info
        : { syncedCount: syncResults.length };

    res.status(200).json({
      message,
      mode: deleteMode ? 'delete' : 'sync',
      [detailsKey]: detailsValue
    });

  } catch (error) {
    console.error('API Collection sync/delete error:', error);
    res.status(500).json({
      message: 'Error during collection sync/delete process',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncCollections; 
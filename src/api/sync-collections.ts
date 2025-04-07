import { Request, Response } from 'express';
import { shopifyCollectionSyncService } from '../services/shopify-collection-sync.service';

export const syncCollections = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    const syncResults = await shopifyCollectionSyncService.syncCollections(limit);
    
    res.status(200).json({
      message: 'Collection sync completed successfully',
      syncedCollections: syncResults.length,
      totalCollections: syncResults.length
    });
  } catch (error) {
    console.error('Collection sync error:', error);
    res.status(500).json({
      message: 'Error syncing collections',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncCollections; 
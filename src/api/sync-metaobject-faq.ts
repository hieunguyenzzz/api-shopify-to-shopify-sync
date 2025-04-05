import { Request, Response } from 'express';
import { shopifyMetaobjectSyncService } from '../services/shopify-metaobject-sync.service';

export const syncMetaobjectFaq = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    // 'FAQs' is the type as specified in the query parameter
    const syncResults = await shopifyMetaobjectSyncService.syncMetaobjects('FAQs', limit);
    
    res.status(200).json({
      message: 'FAQ metaobject sync completed successfully',
      syncedMetaobjects: syncResults
    });
  } catch (error) {
    console.error('FAQ metaobject sync error:', error);
    res.status(500).json({
      message: 'Error syncing FAQ metaobjects',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncMetaobjectFaq; 
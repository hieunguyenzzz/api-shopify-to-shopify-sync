import { Request, Response } from 'express';
import { shopifyPageSyncService } from '../services/shopify-page-sync.service';

export const syncPages = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    const syncResults = await shopifyPageSyncService.syncPages(limit);
    
    res.status(200).json({
      message: 'Page sync completed successfully',
      syncedPages: syncResults
    });
  } catch (error) {
    console.error('Page sync error:', error);
    res.status(500).json({
      message: 'Error syncing pages',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncPages; 
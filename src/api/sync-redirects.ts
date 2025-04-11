import { Request, Response } from 'express';
import { shopifyRedirectSyncService } from '../services/shopify-redirect-sync.service';

export const syncRedirects = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    const syncResults = await shopifyRedirectSyncService.syncRedirects(limit);
    
    res.status(200).json({
      message: 'Redirect sync completed successfully',
      syncedRedirects: syncResults
    });
  } catch (error) {
    console.error('Redirect sync error:', error);
    res.status(500).json({
      message: 'Error syncing redirects',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncRedirects; 
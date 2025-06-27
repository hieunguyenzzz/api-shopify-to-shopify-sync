import { Request, Response } from 'express';
import { shopifyProductSyncService } from '../services/shopify-product-sync.service';

export const syncProducts = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const force = req.query.force !== undefined && req.query.force !== 'false' && req.query.force !== '0';
    
    const syncResults = await shopifyProductSyncService.syncProducts(limit, force);
    
    res.status(200).json({
      message: 'Product sync completed successfully',
      syncedProducts: syncResults,
      force: force
    });
  } catch (error) {
    console.error('Product sync error:', error);
    res.status(500).json({
      message: 'Error syncing products',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncProducts; 
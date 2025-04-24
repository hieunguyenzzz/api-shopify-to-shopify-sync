import { Request, Response } from 'express';
import { shopifyPriceListSyncService } from '../services/shopify-pricelist-sync.service';

export const syncPriceLists = async (req: Request, res: Response) => {
  try {
    const syncResults = await shopifyPriceListSyncService.syncPriceLists();
    
    res.status(200).json({
      message: 'Price list sync completed successfully',
      syncedPriceLists: syncResults
    });
  } catch (error) {
    console.error('Price list sync error:', error);
    res.status(500).json({
      message: 'Error syncing price lists',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncPriceLists; 
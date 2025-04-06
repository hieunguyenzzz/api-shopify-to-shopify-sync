import { Request, Response } from 'express';
import { shopifyMetaobjectSyncService } from '../services/shopify-metaobject-sync.service';

export const syncMetaobjects = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const type = req.query.type as string || 'FAQs';
    
    // Validate metaobject type
    const validTypes = ['FAQs', 'room_features', 'company_logo', 'product_feature', 'meeting_rooms_features'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message: `Invalid metaobject type. Supported types: ${validTypes.join(', ')}`
      });
    }
    
    const syncResults = await shopifyMetaobjectSyncService.syncMetaobjects(type, limit);
    
    res.status(200).json({
      message: `${type} metaobject sync completed successfully`,
      syncedMetaobjects: syncResults
    });
  } catch (error) {
    console.error(`Metaobject sync error:`, error);
    res.status(500).json({
      message: `Error syncing ${req.query.type || 'FAQs'} metaobjects`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncMetaobjects; 
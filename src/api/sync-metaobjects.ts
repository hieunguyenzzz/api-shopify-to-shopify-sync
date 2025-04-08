import { Request, Response } from 'express';
import { shopifyMetaobjectSyncService } from '../services/shopify-metaobject-sync.service';

// Define valid metaobject types
const validTypes = ['FAQs', 'room_features', 'company_logo', 'product_feature', 'meeting_rooms_features'];

/**
 * Syncs a single metaobject type
 */
async function syncSingleType(type: string, limit?: number): Promise<any> {
  return shopifyMetaobjectSyncService.syncMetaobjects(type, limit);
}

/**
 * Syncs all metaobject types sequentially
 */
async function syncAllTypes(limit?: number): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  
  for (const type of validTypes) {
    results[type] = await syncSingleType(type, limit);
  }
  
  return results;
}

export const syncMetaobjects = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const type = req.query.type as string;
    
    // If no type is provided, sync all types
    if (!type) {
      const allResults = await syncAllTypes(limit);
      return res.status(200).json({
        message: 'All metaobject types synced successfully',
        syncedMetaobjects: allResults
      });
    }
    
    // Validate metaobject type when specified
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message: `Invalid metaobject type. Supported types: ${validTypes.join(', ')}`
      });
    }
    
    const syncResults = await syncSingleType(type, limit);
    
    res.status(200).json({
      message: `${type} metaobject sync completed successfully`,
      syncedMetaobjects: syncResults
    });
  } catch (error) {
    console.error(`Metaobject sync error:`, error);
    res.status(500).json({
      message: `Error syncing metaobjects`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncMetaobjects; 
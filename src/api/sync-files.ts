import { Request, Response } from 'express';
import { shopifyFileSyncService } from '../services/shopify-file-sync.service';

export const syncFiles = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    
    const syncResults = await shopifyFileSyncService.syncFiles(limit);
    
    res.status(200).json({
      message: 'File sync completed successfully',
      syncedFiles: syncResults.length,
      totalFiles: syncResults.length
    });
  } catch (error) {
    console.error('File sync error:', error);
    res.status(500).json({
      message: 'Error syncing files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default syncFiles; 
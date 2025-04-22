import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

export interface FileMappingDocument {
  fileHash: string;
  shopifyFileId: string;
  externalFileId: string;
  url: string;
  mimeType: string;
  createdAt: Date;
  lastUsed: Date;
}

class MongoDBService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private fileMappingCollection: Collection<FileMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: MongoDBService = new MongoDBService();

  public static getInstance(): MongoDBService {
    return MongoDBService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = process.env.MONGODB_COLLECTION || 'file-mapping';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.fileMappingCollection = this.db.collection<FileMappingDocument>(collectionName);
      
      // Create index on fileHash for faster lookups
      await this.fileMappingCollection.createIndex({ fileHash: 1 }, { unique: true });
      // Create index on externalFileId for faster lookups
      await this.fileMappingCollection.createIndex({ externalFileId: 1 });

      this.initialized = true;
      console.log('MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  public async findFileByHash(fileHash: string): Promise<FileMappingDocument | null> {
    if (!this.initialized || !this.fileMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.fileMappingCollection!.findOne({ fileHash });
      
      if (result) {
        // Update the lastUsed timestamp
        await this.fileMappingCollection!.updateOne(
          { fileHash },
          { $set: { lastUsed: new Date() } }
        );
      }
      
      return result;
    } catch (error) {
      console.error('Error finding file by hash:', error);
      return null;
    }
  }

  public async findFileByExternalId(externalFileId: string): Promise<FileMappingDocument | null> {
    if (!this.initialized || !this.fileMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.fileMappingCollection!.findOne({ externalFileId });

      if (result) {
        // Update the lastUsed timestamp
        await this.fileMappingCollection!.updateOne(
          { externalFileId },
          { $set: { lastUsed: new Date() } }
        );
      }

      return result;
    } catch (error) {
      console.error('Error finding file by external ID:', error);
      return null;
    }
  }

  public async getAllFileMappings(): Promise<Map<string, FileMappingDocument>> {
    if (!this.initialized || !this.fileMappingCollection) {
      await this.initialize();
    }

    try {
      const mappings = await this.fileMappingCollection!.find({}).toArray();
      const mappingsMap = new Map<string, FileMappingDocument>();
      
      mappings.forEach(mapping => {
        mappingsMap.set(mapping.fileHash, mapping);
      });
      
      return mappingsMap;
    } catch (error) {
      console.error('Error retrieving all file mappings:', error);
      return new Map();
    }
  }

  public async saveFileMapping(
    fileHash: string,
    shopifyFileId: string,
    externalFileId: string,
    url: string,
    mimeType: string
  ): Promise<boolean> {
    if (!this.initialized || !this.fileMappingCollection) {
      await this.initialize();
    }

    try {
      const now = new Date();
      
      await this.fileMappingCollection!.updateOne(
        { fileHash },
        {
          $set: {
            shopifyFileId,
            externalFileId,
            url,
            mimeType,
            lastUsed: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      
      return true;
    } catch (error) {
      console.error('Error saving file mapping:', error);
      return false;
    }
  }

  public async deleteMappingByShopifyId(shopifyFileId: string): Promise<boolean> {
    if (!this.initialized || !this.fileMappingCollection) {
      await this.initialize();
    }

    try {
      console.log(`🗑️ Attempting to delete file mapping for Shopify ID: ${shopifyFileId}`);
      const result = await this.fileMappingCollection!.deleteOne({ shopifyFileId });

      if (result.deletedCount === 1) {
        console.log(`✅ Successfully deleted mapping for Shopify ID: ${shopifyFileId}`);
        return true;
      } else {
        console.warn(`⚠️ No mapping found or deleted for Shopify ID: ${shopifyFileId}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error deleting mapping for Shopify ID ${shopifyFileId}:`, error);
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.fileMappingCollection = null;
    }
  }
}

export default MongoDBService.getInstance(); 
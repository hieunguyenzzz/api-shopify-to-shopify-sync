import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface PageMappingDocument {
  externalPageId: string;
  shopifyPageId: string;
  pageHandle: string;
  lastUpdated: Date;
}

class PageMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private pageMappingCollection: Collection<PageMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: PageMappingService = new PageMappingService();

  public static getInstance(): PageMappingService {
    return PageMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'page-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.pageMappingCollection = this.db.collection<PageMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.pageMappingCollection.createIndex({ externalPageId: 1 }, { unique: true });
      await this.pageMappingCollection.createIndex({ shopifyPageId: 1 }, { unique: true });
      await this.pageMappingCollection.createIndex({ pageHandle: 1 }, { unique: true });
      
      this.initialized = true;
      console.log('Page Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for page mapping:', error);
      throw error;
    }
  }

  public async getShopifyPageId(externalPageId: string): Promise<string | null> {
    if (!this.initialized || !this.pageMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.pageMappingCollection!.findOne({ externalPageId });
      return result?.shopifyPageId || null;
    } catch (error) {
      console.error(`Error getting Shopify page ID for external ID ${externalPageId}:`, error);
      return null;
    }
  }

  public async savePageMapping(mapping: Omit<PageMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.pageMappingCollection) {
      await this.initialize();
    }

    try {
      await this.pageMappingCollection!.updateOne(
        { externalPageId: mapping.externalPageId },
        {
          $set: {
            ...mapping,
            lastUpdated: new Date()
          }
        },
        { upsert: true }
      );
      
      return true;
    } catch (error) {
      console.error(`Error saving page mapping for ID ${mapping.externalPageId}:`, error);
      return false;
    }
  }

  public async getAllPageMappings(): Promise<PageMappingDocument[]> {
    if (!this.initialized || !this.pageMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.pageMappingCollection!.find({}).toArray();
    } catch (error) {
      console.error('Error getting all page mappings:', error);
      return [];
    }
  }

  public async getMappingByHandle(pageHandle: string): Promise<PageMappingDocument | null> {
    if (!this.initialized || !this.pageMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.pageMappingCollection!.findOne({ pageHandle });
    } catch (error) {
      console.error(`Error getting page mapping for handle ${pageHandle}:`, error);
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.pageMappingCollection = null;
    }
  }
}

export const pageMappingService = PageMappingService.getInstance(); 
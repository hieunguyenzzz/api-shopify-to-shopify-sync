import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface RedirectMappingDocument {
  externalRedirectId: string;
  shopifyRedirectId: string;
  redirectPath: string;
  redirectHash: string;
  lastUpdated: Date;
}

class RedirectMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private redirectMappingCollection: Collection<RedirectMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: RedirectMappingService = new RedirectMappingService();

  public static getInstance(): RedirectMappingService {
    return RedirectMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'redirect-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.redirectMappingCollection = this.db.collection<RedirectMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.redirectMappingCollection.createIndex({ externalRedirectId: 1 }, { unique: true });
      await this.redirectMappingCollection.createIndex({ shopifyRedirectId: 1 }, { unique: true });
      await this.redirectMappingCollection.createIndex({ redirectPath: 1 }, { unique: true });
      await this.redirectMappingCollection.createIndex({ redirectHash: 1 });
      
      this.initialized = true;
      console.log('Redirect Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for redirect mapping:', error);
      throw error;
    }
  }

  public async getShopifyRedirectId(externalRedirectId: string): Promise<string | null> {
    if (!this.initialized || !this.redirectMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.redirectMappingCollection!.findOne({ externalRedirectId });
      return result?.shopifyRedirectId || null;
    } catch (error) {
      console.error(`Error getting Shopify redirect ID for external ID ${externalRedirectId}:`, error);
      return null;
    }
  }

  public async findRedirectByHash(redirectHash: string): Promise<RedirectMappingDocument | null> {
    if (!this.initialized || !this.redirectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.redirectMappingCollection!.findOne({ redirectHash });
    } catch (error) {
      console.error(`Error finding redirect by hash ${redirectHash}:`, error);
      return null;
    }
  }

  public async saveRedirectMapping(mapping: Omit<RedirectMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.redirectMappingCollection) {
      await this.initialize();
    }

    try {
      await this.redirectMappingCollection!.updateOne(
        { externalRedirectId: mapping.externalRedirectId },
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
      console.error(`Error saving redirect mapping for ID ${mapping.externalRedirectId}:`, error);
      return false;
    }
  }

  public async getAllRedirectMappings(): Promise<RedirectMappingDocument[]> {
    if (!this.initialized || !this.redirectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.redirectMappingCollection!.find({}).toArray();
    } catch (error) {
      console.error('Error getting all redirect mappings:', error);
      return [];
    }
  }

  public async getMappingByPath(redirectPath: string): Promise<RedirectMappingDocument | null> {
    if (!this.initialized || !this.redirectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.redirectMappingCollection!.findOne({ redirectPath });
    } catch (error) {
      console.error(`Error getting redirect mapping for path ${redirectPath}:`, error);
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.redirectMappingCollection = null;
    }
  }
}

export const redirectMappingService = RedirectMappingService.getInstance(); 
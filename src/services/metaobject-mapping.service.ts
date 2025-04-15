import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface MetaobjectMappingDocument {
  externalMetaobjectId: string;
  shopifyMetaobjectId: string;
  metaobjectHandle: string;
  metaobjectType: string;
  lastUpdated: Date;
  // Add the following line:
  metaobjectHash?: string; 
}

class MetaobjectMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private metaobjectMappingCollection: Collection<MetaobjectMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: MetaobjectMappingService = new MetaobjectMappingService();

  public static getInstance(): MetaobjectMappingService {
    return MetaobjectMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'metaobject-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.metaobjectMappingCollection = this.db.collection<MetaobjectMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.metaobjectMappingCollection.createIndex({ externalMetaobjectId: 1 }, { unique: true });
      await this.metaobjectMappingCollection.createIndex({ shopifyMetaobjectId: 1 }, { unique: true });
      await this.metaobjectMappingCollection.createIndex({ metaobjectHandle: 1 }, { unique: true });
      await this.metaobjectMappingCollection.createIndex({ metaobjectType: 1 });
      await this.metaobjectMappingCollection.createIndex({ metaobjectHash: 1 });
      
      this.initialized = true;
      console.log('Metaobject Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for metaobject mapping:', error);
      throw error;
    }
  }

  public async getShopifyMetaobjectId(externalMetaobjectId: string): Promise<string | null> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.metaobjectMappingCollection!.findOne({ externalMetaobjectId });
      return result?.shopifyMetaobjectId || null;
    } catch (error) {
      console.error(`Error getting Shopify metaobject ID for external ID ${externalMetaobjectId}:`, error);
      return null;
    }
  }

  public async saveMetaobjectMapping(mapping: Omit<MetaobjectMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      await this.metaobjectMappingCollection!.updateOne(
        { externalMetaobjectId: mapping.externalMetaobjectId },
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
      console.error(`Error saving metaobject mapping for ID ${mapping.externalMetaobjectId}:`, error);
      return false;
    }
  }

  public async getAllMetaobjectMappings(): Promise<MetaobjectMappingDocument[]> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.metaobjectMappingCollection!.find({}).toArray();
    } catch (error) {
      console.error('Error getting all metaobject mappings:', error);
      return [];
    }
  }

  public async getMappingByHandle(metaobjectHandle: string): Promise<MetaobjectMappingDocument | null> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.metaobjectMappingCollection!.findOne({ metaobjectHandle });
    } catch (error) {
      console.error(`Error getting metaobject mapping for handle ${metaobjectHandle}:`, error);
      return null;
    }
  }

  public async getMappingsByType(metaobjectType: string): Promise<MetaobjectMappingDocument[]> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.metaobjectMappingCollection!.find({ metaobjectType }).toArray();
    } catch (error) {
      console.error(`Error getting metaobject mappings for type ${metaobjectType}:`, error);
      return [];
    }
  }

  public async findMappingByHash(hash: string): Promise<MetaobjectMappingDocument | null> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.metaobjectMappingCollection!.findOne({ metaobjectHash: hash });
    } catch (error) {
      console.error(`Error finding metaobject mapping by hash ${hash}:`, error);
      return null;
    }
  }

  public async getMappingByExternalId(externalMetaobjectId: string): Promise<MetaobjectMappingDocument | null> {
    if (!this.initialized || !this.metaobjectMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.metaobjectMappingCollection!.findOne({ externalMetaobjectId });
    } catch (error) {
      console.error(`Error getting metaobject mapping for external ID ${externalMetaobjectId}:`, error);
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.metaobjectMappingCollection = null;
    }
  }
}

export const metaobjectMappingService = MetaobjectMappingService.getInstance(); 
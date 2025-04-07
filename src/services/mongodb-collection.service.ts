import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface CollectionMappingDocument {
  collectionHash: string;
  productsHash: string;
  shopifyCollectionId: string;
  externalCollectionId: string;
  productIds: string[];
  createdAt: Date;
  lastUpdated: Date;
}

class MongoDBCollectionService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collectionMappingCollection: Collection<CollectionMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: MongoDBCollectionService = new MongoDBCollectionService();

  public static getInstance(): MongoDBCollectionService {
    return MongoDBCollectionService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = process.env.MONGODB_COLLECTION_MAPPING || 'collection-mapping';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.collectionMappingCollection = this.db.collection<CollectionMappingDocument>(collectionName);
      
      // Create indices for faster lookups
      await this.collectionMappingCollection.createIndex({ collectionHash: 1 }, { unique: true });
      await this.collectionMappingCollection.createIndex({ externalCollectionId: 1 });
      await this.collectionMappingCollection.createIndex({ shopifyCollectionId: 1 });

      this.initialized = true;
      console.log('MongoDB collection service connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB collection service:', error);
      throw error;
    }
  }

  public async findCollectionByHash(collectionHash: string): Promise<CollectionMappingDocument | null> {
    if (!this.initialized || !this.collectionMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.collectionMappingCollection!.findOne({ collectionHash });
    } catch (error) {
      console.error('Error finding collection by hash:', error);
      return null;
    }
  }

  public async findCollectionByExternalId(externalCollectionId: string): Promise<CollectionMappingDocument | null> {
    if (!this.initialized || !this.collectionMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.collectionMappingCollection!.findOne({ externalCollectionId });
    } catch (error) {
      console.error('Error finding collection by external ID:', error);
      return null;
    }
  }

  public async saveCollectionMapping(
    collectionHash: string,
    productsHash: string,
    shopifyCollectionId: string,
    externalCollectionId: string,
    productIds: string[]
  ): Promise<boolean> {
    if (!this.initialized || !this.collectionMappingCollection) {
      await this.initialize();
    }

    try {
      const now = new Date();
      
      await this.collectionMappingCollection!.updateOne(
        { collectionHash },
        {
          $set: {
            productsHash,
            shopifyCollectionId,
            externalCollectionId,
            productIds,
            lastUpdated: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      
      return true;
    } catch (error) {
      console.error('Error saving collection mapping:', error);
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.collectionMappingCollection = null;
    }
  }
}

export default MongoDBCollectionService.getInstance(); 
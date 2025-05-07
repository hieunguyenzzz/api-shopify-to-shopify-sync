import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface ProductMappingDocument {
  externalProductId: string;
  shopifyProductId: string;
  productHandle: string;
  productHash: string;
  lastUpdated: Date;
}

class ProductMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private productMappingCollection: Collection<ProductMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: ProductMappingService = new ProductMappingService();

  public static getInstance(): ProductMappingService {
    return ProductMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'product-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.productMappingCollection = this.db.collection<ProductMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.productMappingCollection.createIndex({ externalProductId: 1 }, { unique: true });
      await this.productMappingCollection.createIndex({ shopifyProductId: 1 }, { unique: true });
      await this.productMappingCollection.createIndex({ productHandle: 1 }, { unique: true });
      await this.productMappingCollection.createIndex({ productHash: 1 });
      
      this.initialized = true;
      console.log('Product Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for product mapping:', error);
      throw error;
    }
  }

  public async getShopifyProductId(externalProductId: string): Promise<string | null> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.productMappingCollection!.findOne({ externalProductId });
      return result?.shopifyProductId || null;
    } catch (error) {
      console.error(`Error getting Shopify product ID for external ID ${externalProductId}:`, error);
      return null;
    }
  }

  public async findProductByHash(productHash: string): Promise<ProductMappingDocument | null> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.productMappingCollection!.findOne({ productHash });
    } catch (error) {
      console.error(`Error finding product by hash ${productHash}:`, error);
      return null;
    }
  }

  public async saveProductMapping(mapping: Omit<ProductMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      await this.productMappingCollection!.updateOne(
        { externalProductId: mapping.externalProductId },
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
      console.error(`Error saving product mapping for ID ${mapping.externalProductId}:`, error);
      return false;
    }
  }

  public async getAllProductMappings(): Promise<ProductMappingDocument[]> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.productMappingCollection!.find({}).toArray();
    } catch (error) {
      console.error('Error getting all product mappings:', error);
      return [];
    }
  }

  public async getMappingByHandle(productHandle: string): Promise<ProductMappingDocument | null> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.productMappingCollection!.findOne({ productHandle });
    } catch (error) {
      console.error(`Error getting product mapping for handle ${productHandle}:`, error);
      return null;
    }
  }

  public async getMappingByExternalProductId(externalProductId: string): Promise<ProductMappingDocument | null> {
    if (!this.initialized || !this.productMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.productMappingCollection!.findOne({ externalProductId });
    } catch (error) {
      console.error(`Error getting product mapping for external ID ${externalProductId}:`, error);
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.productMappingCollection = null;
    }
  }
}

export const productMappingService = ProductMappingService.getInstance(); 
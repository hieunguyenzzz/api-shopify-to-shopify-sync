import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface VariantMappingDocument {
  externalVariantId: string;
  shopifyVariantId: string;
  productHandle: string;
  sku: string;
  lastUpdated: Date;
}

class VariantIdMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private variantMappingCollection: Collection<VariantMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: VariantIdMappingService = new VariantIdMappingService();

  public static getInstance(): VariantIdMappingService {
    return VariantIdMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'variant-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.variantMappingCollection = this.db.collection<VariantMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.variantMappingCollection.createIndex({ externalVariantId: 1 }, { unique: true });
      await this.variantMappingCollection.createIndex({ sku: 1 }, { unique: true });
      await this.variantMappingCollection.createIndex({ productHandle: 1 });
      
      this.initialized = true;
      console.log('Variant Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for variant mapping:', error);
      throw error;
    }
  }

  public async getShopifyVariantId(sku: string): Promise<string | null> {
    if (!this.initialized || !this.variantMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.variantMappingCollection!.findOne({ sku });
      return result?.shopifyVariantId || null;
    } catch (error) {
      console.error(`Error getting Shopify variant ID for SKU ${sku}:`, error);
      return null;
    }
  }

  public async saveVariantMapping(mapping: Omit<VariantMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.variantMappingCollection) {
      await this.initialize();
    }

    try {
      await this.variantMappingCollection!.updateOne(
        { sku: mapping.sku },
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
      console.error(`Error saving variant mapping for SKU ${mapping.sku}:`, error);
      return false;
    }
  }

  public async getMappingsByProduct(productHandle: string): Promise<VariantMappingDocument[]> {
    if (!this.initialized || !this.variantMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.variantMappingCollection!.find({ productHandle }).toArray();
    } catch (error) {
      console.error(`Error getting variant mappings for product ${productHandle}:`, error);
      return [];
    }
  }

  public async getAllMappings(): Promise<Record<string, VariantMappingDocument>> {
    if (!this.initialized || !this.variantMappingCollection) {
      await this.initialize();
    }

    try {
      const mappings = await this.variantMappingCollection!.find({}).toArray();
      const mappingsRecord: Record<string, VariantMappingDocument> = {};
      
      for (const mapping of mappings) {
        mappingsRecord[mapping.sku] = mapping;
      }
      
      return mappingsRecord;
    } catch (error) {
      console.error('Error getting all variant mappings:', error);
      return {};
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.variantMappingCollection = null;
    }
  }
}

export const variantIdMappingService = VariantIdMappingService.getInstance(); 
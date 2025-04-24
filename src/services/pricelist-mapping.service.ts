import { MongoClient, Collection, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

interface PriceListMappingDocument {
  externalPriceListId: string;
  shopifyPriceListId: string;
  currency: string;
  name: string;
  priceListHash: string;
  lastUpdated: Date;
}

class PriceListMappingService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private priceListMappingCollection: Collection<PriceListMappingDocument> | null = null;
  private initialized = false;
  private dbName = 'syncing';

  private constructor() {}

  private static instance: PriceListMappingService = new PriceListMappingService();

  public static getInstance(): PriceListMappingService {
    return PriceListMappingService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const uri = process.env.MONGODB_URI;
      const collectionName = 'pricelist-mappings';
      const dbName = process.env.MONGODB_DB || this.dbName;
      
      if (!uri) {
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      this.client = new MongoClient(uri);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.priceListMappingCollection = this.db.collection<PriceListMappingDocument>(collectionName);
      
      // Create indexes for faster lookups
      await this.priceListMappingCollection.createIndex({ externalPriceListId: 1 }, { unique: true });
      await this.priceListMappingCollection.createIndex({ shopifyPriceListId: 1 });
      await this.priceListMappingCollection.createIndex({ currency: 1 });
      await this.priceListMappingCollection.createIndex({ priceListHash: 1 });
      
      this.initialized = true;
      console.log('Price List Mapping MongoDB connection established successfully');
    } catch (error) {
      console.error('Failed to connect to MongoDB for price list mapping:', error);
      throw error;
    }
  }

  public async getShopifyPriceListId(externalPriceListId: string): Promise<string | null> {
    if (!this.initialized || !this.priceListMappingCollection) {
      await this.initialize();
    }

    try {
      const result = await this.priceListMappingCollection!.findOne({ externalPriceListId });
      return result?.shopifyPriceListId || null;
    } catch (error) {
      console.error(`Error getting Shopify price list ID for external ID ${externalPriceListId}:`, error);
      return null;
    }
  }

  public async findPriceListByHash(priceListHash: string): Promise<PriceListMappingDocument | null> {
    if (!this.initialized || !this.priceListMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.priceListMappingCollection!.findOne({ priceListHash });
    } catch (error) {
      console.error(`Error finding price list by hash ${priceListHash}:`, error);
      return null;
    }
  }

  public async savePriceListMapping(mapping: Omit<PriceListMappingDocument, 'lastUpdated'>): Promise<boolean> {
    if (!this.initialized || !this.priceListMappingCollection) {
      await this.initialize();
    }

    try {
      await this.priceListMappingCollection!.updateOne(
        { externalPriceListId: mapping.externalPriceListId },
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
      console.error(`Error saving price list mapping for ID ${mapping.externalPriceListId}:`, error);
      return false;
    }
  }

  public async getAllPriceListMappings(): Promise<PriceListMappingDocument[]> {
    if (!this.initialized || !this.priceListMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.priceListMappingCollection!.find({}).toArray();
    } catch (error) {
      console.error('Error getting all price list mappings:', error);
      return [];
    }
  }

  public async getMappingByIdAndCurrency(shopifyPriceListId: string, currency: string): Promise<PriceListMappingDocument | null> {
    if (!this.initialized || !this.priceListMappingCollection) {
      await this.initialize();
    }

    try {
      return await this.priceListMappingCollection!.findOne({ shopifyPriceListId, currency });
    } catch (error) {
      console.error(`Error getting price list mapping for ID ${shopifyPriceListId} and currency ${currency}:`, error);
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.initialized = false;
      this.client = null;
      this.db = null;
      this.priceListMappingCollection = null;
    }
  }
}

export const priceListMappingService = PriceListMappingService.getInstance(); 
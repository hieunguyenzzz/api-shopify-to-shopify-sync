import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { 
  COLLECTION_CREATE_MUTATION,
  COLLECTION_UPDATE_MUTATION
} from '../graphql/shopify-mutations';
import mongoDBCollectionService from './mongodb-collection.service';
import crypto from 'crypto';
import { productMappingService } from './product-mapping.service';

// Load environment variables
dotenv.config();

// Define response types
interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
}

interface ShopifyCollection {
  id: string;
  handle: string;
  title: string;
  updatedAt: string;
  descriptionHtml: string;
  sortOrder: string;
  templateSuffix: string;
  products: {
    nodes: ShopifyProduct[];
    pageInfo: {
      hasNextPage: boolean;
    };
  };
}

interface ExternalCollectionsResponse {
  success: boolean;
  collections: ShopifyCollection[];
  timestamp: string;
}

interface CollectionCreateResponse {
  collectionCreate: {
    collection: {
      id: string;
      handle: string;
      title: string;
      descriptionHtml: string;
      sortOrder: string;
      templateSuffix: string;
      updatedAt: string;
    };
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface CollectionAddProductsResponse {
  collectionAddProducts: {
    collection: {
      id: string;
      handle: string;
      title: string;
      productsCount: number;
    };
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

class ShopifyCollectionSyncService {
  private graphqlClient: GraphQLClient;
  private externalCollectionsApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalCollectionsApiUrl = `${externalApiBaseUrl}/api/collections`;
  }

  // Fetch collections from external API
  async fetchExternalCollections(): Promise<ShopifyCollection[]> {
    try {
      console.log('🔍 Fetching external collections...');
      const response = await axios.get<ExternalCollectionsResponse>(this.externalCollectionsApiUrl);
      console.log(`✅ Successfully fetched ${response.data.collections.length} collections`);
      return response.data.collections;
    } catch (error) {
      console.error('❌ Error fetching external collections:', error);
      throw error;
    }
  }

  // Generate a hash for a collection based on its properties
  private generateCollectionHash(collection: ShopifyCollection): string {
    // Create a hash based on collection metadata
    const collectionData = `${collection.title}|${collection.handle}|${collection.descriptionHtml}|${collection.sortOrder}|${collection.templateSuffix}`;
    return crypto.createHash('md5').update(collectionData).digest('hex');
  }

  // Generate a hash for products in a collection
  private generateProductsHash(collection: ShopifyCollection): string {
    // Create a hash based on product IDs in a stable order
    const productIds = collection.products.nodes.map(product => product.id).sort().join('|');
    return crypto.createHash('md5').update(productIds).digest('hex');
  }

  // Check if a collection is already in our database
  async checkCollectionByHash(collectionHash: string, productsHash: string): Promise<{ 
    exists: boolean;
    shopifyCollectionId?: string;
    productsChanged?: boolean;
  }> {
    try {
      const existingCollection = await mongoDBCollectionService.findCollectionByHash(collectionHash);
      
      if (!existingCollection) {
        return { exists: false };
      }
      
      // Collection exists, check if products have changed
      const productsChanged = existingCollection.productsHash !== productsHash;
      
      return { 
        exists: true, 
        shopifyCollectionId: existingCollection.shopifyCollectionId,
        productsChanged 
      };
    } catch (error) {
      console.error('❌ Error checking collection by hash:', error);
      return { exists: false };
    }
  }

  // Create a collection mapping
  async createCollectionMapping(
    collectionHash: string,
    productsHash: string, 
    shopifyCollectionId: string, 
    externalCollectionId: string, 
    productIds: string[]
  ): Promise<void> {
    try {
      const success = await mongoDBCollectionService.saveCollectionMapping(
        collectionHash,
        productsHash,
        shopifyCollectionId,
        externalCollectionId,
        productIds
      );
      
      if (success) {
        console.log(`✅ Successfully created collection mapping for ID: ${shopifyCollectionId} (External ID: ${externalCollectionId})`);
      } else {
        console.error(`❌ Failed to create collection mapping for ID: ${shopifyCollectionId}`);
      }
    } catch (error) {
      console.error('❌ Error creating collection mapping:', error);
      throw error;
    }
  }

  // Update products for a collection in Shopify
  async updateCollectionProducts(shopifyCollectionId: string, productIds: string[]): Promise<boolean> {
    try {
      console.log(`🔄 Updating products for collection ID: ${shopifyCollectionId}`);
      
      const response = await this.graphqlClient.request<CollectionAddProductsResponse>(
        COLLECTION_UPDATE_MUTATION,
        { 
          id: shopifyCollectionId,
          productIds: productIds
        }
      );
      
      if (response.collectionAddProducts.userErrors && response.collectionAddProducts.userErrors.length > 0) {
        console.error('❌ Shopify API Error updating collection products:', response.collectionAddProducts.userErrors);
        return false;
      }
      
      console.log(`✅ Successfully updated products for collection: ${response.collectionAddProducts.collection.title}`);
      return true;
    } catch (error) {
      console.error('❌ Error updating collection products:', error);
      return false;
    }
  }

  // Sync a single collection
  async syncCollection(collection: ShopifyCollection): Promise<boolean> {
    try {
      console.log(`🔄 Syncing collection: ${collection.title}`);
      
      // Generate hashes for collection and its products
      const collectionHash = this.generateCollectionHash(collection);
      
      // Extract external product IDs (assuming these are external IDs needing mapping)
      // TODO: Verify if these are indeed external IDs or already Shopify GIDs
      const externalProductIds = collection.products.nodes.map((product: { id: string }) => product.id);
      
      // TODO: Recalculate productsHash based on *Shopify* GIDs if needed for accurate change detection
      const productsHash = this.generateProductsHash(collection);
      
      // Check if the collection already exists in our database
      const { exists, shopifyCollectionId, productsChanged } = await this.checkCollectionByHash(collectionHash, productsHash);
      
      // --- Map External Product IDs to Shopify GIDs ---
      const getShopifyGidPromises = externalProductIds.map(externalId => 
        productMappingService.getShopifyProductId(externalId)
      );
      const shopifyProductGidsNullable = await Promise.all(getShopifyGidPromises);
      const shopifyProductGids = shopifyProductGidsNullable.filter((gid: string | null): gid is string => gid !== null);
      
      if (shopifyProductGids.length !== externalProductIds.length) {
        console.warn(`⚠️ Could not map all external product IDs for collection "${collection.title}". Mapped ${shopifyProductGids.length}/${externalProductIds.length}.`);
        // Decide if you want to proceed with partial mapping or skip/error out
      }
      // -------------------------------------------------

      if (exists && shopifyCollectionId) {
        console.log(`Collection already exists in database: ${collection.title}`);
        
        // If products have changed, update them
        if (productsChanged) {
          console.log(`Products have changed for collection: ${collection.title}. Updating...`);
          // TODO: Implement update using COLLECTION_UPDATE_MUTATION with shopifyProductGids
          const productsUpdated = await this.updateCollectionProducts(shopifyCollectionId, shopifyProductGids); // Keep using old method for now
          
          if (productsUpdated) {
            // Update the mapping with the new products hash
            await this.createCollectionMapping(
              collectionHash,
              productsHash, // This hash might need recalculation based on shopifyProductGids
              shopifyCollectionId,
              collection.id,
              shopifyProductGids // Store mapped GIDs
            );
          }
          
          return productsUpdated;
        }
        
        // No changes needed
        console.log(`✅ No changes needed for collection: ${collection.title}`);
        return true;
      }
      
      // Collection doesn't exist in DB, create it in Shopify
      console.log(`🚀 Collection not found in DB. Creating collection in Shopify: ${collection.title}`);
      
      // Prepare input for the collectionCreate mutation, including mapped products
      const collectionInput = {
        title: collection.title,
        descriptionHtml: collection.descriptionHtml,
        sortOrder: collection.sortOrder,
        templateSuffix: collection.templateSuffix,
        products: shopifyProductGids // Add the mapped Shopify Product GIDs
      };
      
      try {
        // Create the collection in Shopify
        const response = await this.graphqlClient.request<CollectionCreateResponse>(
          COLLECTION_CREATE_MUTATION,
          { input: collectionInput }
        );
        
        if (response.collectionCreate.userErrors && response.collectionCreate.userErrors.length > 0) {
          console.error(`❌ Shopify API Error creating collection ${collection.title}:`, response.collectionCreate.userErrors);
          return false;
        }
        
        const createdShopifyCollection = response.collectionCreate.collection;
        
        if (!createdShopifyCollection || !createdShopifyCollection.id) {
          console.error(`❌ Shopify API returned invalid collection data for ${collection.title}`);
          return false;
        }
        
        const newShopifyCollectionId = createdShopifyCollection.id;
        console.log(`✅ Successfully created collection in Shopify: ${collection.title} (ID: ${newShopifyCollectionId}) with ${shopifyProductGids.length} products.`);
        
        // Removed the separate call to updateCollectionProducts
        // if (productIds.length > 0) { ... }
        
        // Store the mapping
        await this.createCollectionMapping(
          collectionHash,
          productsHash, // This hash might need recalculation based on shopifyProductGids
          newShopifyCollectionId,
          collection.id,
          shopifyProductGids // Store mapped GIDs
        );
        
        return true;
      } catch (gqlError) {
        console.error(`❌ GraphQL Error creating collection ${collection.title} in Shopify:`, gqlError);
        return false;
      }
    } catch (error) {
      console.error(`❌ Top-level error syncing collection ${collection.title}:`, error);
      return false;
    }
  }

  // Sync all collections
  async syncCollections(limit?: number): Promise<ShopifyCollection[]> {
    try {
      console.log('🔄 Starting collection sync process...');
      
      // Initialize MongoDB connection if not already initialized
      await mongoDBCollectionService.initialize();
      
      // Fetch collections from external API
      const externalCollections = await this.fetchExternalCollections();
      
      // Apply limit if specified
      const collectionsToSync = limit ? externalCollections.slice(0, limit) : externalCollections;
      
      console.log(`🔄 Syncing ${collectionsToSync.length} collections...`);
      
      const syncedCollections: ShopifyCollection[] = [];
      
      // Process collections in sequence to avoid rate limiting
      for (const collection of collectionsToSync) {
        const success = await this.syncCollection(collection);
        if (success) {
          syncedCollections.push(collection);
        }
      }
      
      console.log(`✅ Sync completed. Successfully processed ${syncedCollections.length} out of ${collectionsToSync.length} collections.`);
      
      return syncedCollections;
    } catch (error) {
      console.error('❌ Error syncing collections:', error);
      throw error;
    }
  }
}

export const shopifyCollectionSyncService = new ShopifyCollectionSyncService(); 
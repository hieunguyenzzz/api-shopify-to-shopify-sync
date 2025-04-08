import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { 
  COLLECTION_CREATE_MUTATION,
  COLLECTION_UPDATE_MUTATION,
  COLLECTION_BY_HANDLE_QUERY,
  COLLECTION_ADD_PRODUCTS_MUTATION,
  COLLECTION_PRODUCTS_QUERY
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

// --- Added RuleSet interfaces ---
interface CollectionRule {
  column: string; // e.g., "TAG", "TITLE", "PRODUCT_TYPE" etc. Needs mapping to Shopify's enum `CollectionRuleColumn`
  relation: string; // e.g., "EQUALS", "NOT_CONTAINS". Needs mapping to Shopify's enum `CollectionRuleRelation`
  condition: string;
}

interface CollectionRuleSet {
  appliedDisjunctively: boolean;
  rules: CollectionRule[];
}
// --- End Added RuleSet interfaces ---


interface ShopifyCollection {
  id: string; // This is the External ID in the context of fetchExternalCollections
  handle: string;
  title: string;
  updatedAt: string;
  descriptionHtml: string;
  sortOrder: string; // Needs mapping to Shopify's enum `CollectionSortOrder`
  templateSuffix: string;
  ruleSet?: CollectionRuleSet; // Optional ruleSet field
  products: {
    nodes: ShopifyProduct[]; // Products from the external source
    pageInfo: {
      hasNextPage: boolean;
    };
  };
}

interface CollectionByHandleResponse {
  collectionByHandle: ShopifyCollection | null; // Note: Shopify's response might differ slightly, adjust as needed
}

interface ExternalCollectionsResponse {
  success: boolean;
  collections: ShopifyCollection[]; // These now include the optional ruleSet
  timestamp: string;
}

// --- Added RuleSet Input interfaces (assuming structure for Shopify mutation) ---
interface CollectionRuleInput {
  column: string; // Should map to Shopify's CollectionRuleColumn enum
  relation: string; // Should map to Shopify's CollectionRuleRelation enum
  condition: string;
}

interface CollectionRuleSetInput {
  appliedDisjunctively: boolean;
  rules: CollectionRuleInput[];
}
// --- End Added RuleSet Input interfaces ---


interface CollectionCreateResponse {
  collectionCreate: {
    collection: {
      id: string;
      handle: string;
      title: string;
      descriptionHtml: string;
      sortOrder: string;
      templateSuffix: string;
      // ruleSet?: CollectionRuleSet; // Does Shopify return this on create? Check docs.
      updatedAt: string;
    };
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface CollectionUpdateResponse {
  collectionUpdate: {
    collection: {
      id: string;
      handle: string;
      title: string;
      descriptionHtml: string;
      sortOrder: string;
      templateSuffix: string;
      // ruleSet?: CollectionRuleSet; // Does Shopify return this on update? Check docs.
      updatedAt: string;
    };
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

// --- Define a type for the Collection Input (used in mutations) ---
// NOTE: You MUST ensure your GraphQL mutations (`COLLECTION_CREATE_MUTATION`, `COLLECTION_UPDATE_MUTATION`)
// are updated to accept a `$input: CollectionInput!` variable and include the `ruleSet` field within that input type.
// Example CollectionInput definition in GraphQL schema (check Shopify docs for exact types):
// input CollectionInput {
//   id: ID # Required for update, absent for create
//   handle: String
//   title: String
//   descriptionHtml: String
//   sortOrder: CollectionSortOrder
//   templateSuffix: String
//   ruleSet: CollectionRuleSetInput
//   # other fields...
// }
// input CollectionRuleSetInput {
//   appliedDisjunctively: Boolean!
//   rules: [CollectionRuleInput!]
// }
// input CollectionRuleInput {
//   column: CollectionRuleColumn!
//   relation: CollectionRuleRelation!
//   condition: String!
// }
interface ShopifyCollectionInput {
  id?: string; // Only for updates
  title: string;
  handle: string;
  descriptionHtml: string;
  sortOrder: string; // Ensure this matches Shopify's CollectionSortOrder enum
  templateSuffix: string;
  ruleSet?: CollectionRuleSetInput; // Add the ruleSet here
}
// --- End Collection Input type ---


interface CollectionAddProductsResponse {
  collectionAddProducts: {
    collection: {
      id: string;
      updatedAt: string;
      productsCount: ProductsCount;
    } | null;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface ProductsCount {
  count: number;
}

// Add interface for CollectionProducts query response
interface CollectionProductsResponse {
  collection: {
    id: string;
    products: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      edges: Array<{
        node: {
          id: string;
        };
      }>;
    };
  } | null; // Collection might be null if ID is invalid
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
    // Create a hash based on collection metadata, including a stable representation of ruleset
    let ruleSetString = 'null'; // Default if no ruleSet
    if (collection.ruleSet && collection.ruleSet.rules) {
       // Sort rules by column, then relation, then condition for stability
       const sortedRules = [...collection.ruleSet.rules].sort((a, b) => {
         if (a.column !== b.column) return a.column.localeCompare(b.column);
         if (a.relation !== b.relation) return a.relation.localeCompare(b.relation);
         return a.condition.localeCompare(b.condition);
       });
       const rulesData = sortedRules.map(r => `${r.column}|${r.relation}|${r.condition}`).join(';');
       ruleSetString = `${collection.ruleSet.appliedDisjunctively}|${rulesData}`;
    }

    const collectionData = `${collection.title}|${collection.handle}|${collection.descriptionHtml}|${collection.sortOrder}|${collection.templateSuffix}|${ruleSetString}`;
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
      // Allow sync to proceed by searching handle or creating new
      return { exists: false };
    }
  }

  // Find Shopify Collection by Handle
  private async findShopifyCollectionByHandle(handle: string): Promise<ShopifyCollection | null> {
    try {
      console.log(`🔎 Searching Shopify for collection with handle: ${handle}`);
      const response = await this.graphqlClient.request<CollectionByHandleResponse>(
        COLLECTION_BY_HANDLE_QUERY,
        { handle }
      );
      
      if (response.collectionByHandle) {
          console.log(`✅ Found collection in Shopify with handle: ${handle} (ID: ${response.collectionByHandle.id})`);
          return response.collectionByHandle;
      } else {
          console.log(`ℹ️ No collection found in Shopify with handle: ${handle}`);
          return null;
      }
    } catch (error) {
      console.error(`❌ Error finding Shopify collection by handle ${handle}:`, error);
      return null;
    }
  }

  // Helper to fetch all product IDs currently in a Shopify collection
  private async getCollectionProductIds(collectionId: string): Promise<Set<string>> {
    const existingProductIds = new Set<string>();
    let hasNextPage = true;
    let endCursor: string | null = null;
    const pageSize = 50; // Adjust page size as needed

    console.log(`🔎 Fetching existing product IDs for collection ${collectionId}...`);

    while (hasNextPage) {
      try {
        // Explicitly type the response
        const response: CollectionProductsResponse = await this.graphqlClient.request<CollectionProductsResponse>(
          COLLECTION_PRODUCTS_QUERY,
          {
            id: collectionId,
            first: pageSize,
            after: endCursor
          }
        );

        if (!response.collection) {
          console.error(`❌ Collection ${collectionId} not found while fetching products.`);
          // Decide how to handle: return empty set, throw error? Returning empty for now.
          return new Set<string>();
        }

        // Explicitly type the edge parameter
        response.collection.products.edges.forEach((edge: { node: { id: string } }) => {
          existingProductIds.add(edge.node.id);
        });

        hasNextPage = response.collection.products.pageInfo.hasNextPage;
        endCursor = response.collection.products.pageInfo.endCursor;

        if(hasNextPage) {
          console.log(`   ...fetched ${existingProductIds.size} product IDs, more pages exist.`);
        }

      } catch (error) {
        console.error(`❌ GraphQL Error fetching products for collection ${collectionId}:`, error);
        // Decide how to handle: return partial set, throw error? Throwing error for now.
        throw new Error(`Failed to fetch all products for collection ${collectionId}`);
      }
    }

    console.log(`✅ Fetched a total of ${existingProductIds.size} existing product IDs for collection ${collectionId}.`);
    return existingProductIds;
  }

  // Add helper to add products to a collection
  private async addProductsToCollection(collectionId: string, productGidsToAdd: string[]): Promise<boolean> {
    if (productGidsToAdd.length === 0) {
      console.log(`ℹ️ No products specified to add to collection ${collectionId}.`);
      return true; // Nothing to do
    }

    // 1. Get existing product IDs from Shopify
    let existingProductIds: Set<string>;
    try {
       existingProductIds = await this.getCollectionProductIds(collectionId);
    } catch (error) {
       console.error(`❌ Could not fetch existing products for collection ${collectionId}. Cannot proceed with adding products.`);
       return false;
    }

    // 2. Filter out products already in the collection
    const productsToActuallyAdd = productGidsToAdd.filter(gid => !existingProductIds.has(gid));

    if (productsToActuallyAdd.length === 0) {
      console.log(`ℹ️ All ${productGidsToAdd.length} specified products are already in collection ${collectionId}. No additions needed.`);
      return true;
    }

    // 3. Add only the missing products
    try {
      console.log(`➕ Adding ${productsToActuallyAdd.length} new products (out of ${productGidsToAdd.length} requested) to collection ${collectionId}...`);
      const response = await this.graphqlClient.request<CollectionAddProductsResponse>(
        COLLECTION_ADD_PRODUCTS_MUTATION,
        {
          id: collectionId,
          productIds: productsToActuallyAdd // Use the filtered list
        }
      );

      if (response.collectionAddProducts.userErrors?.length > 0) {
        console.error(`❌ Shopify API Error adding products to collection ${collectionId}:`, response.collectionAddProducts.userErrors);
        // Consider specific error handling, e.g., if product IDs are invalid
        return false; 
      }

      if (!response.collectionAddProducts.collection) {
        console.error(`❌ Shopify API returned null collection after adding products to ${collectionId}, potentially due to errors.`);
        return false;
      }

      console.log(`✅ Successfully added ${productsToActuallyAdd.length} products to collection ${collectionId}. New product count: ${response.collectionAddProducts.collection.productsCount.count}`);
      return true;

    } catch (gqlError) {
      console.error(`❌ GraphQL Error adding products to collection ${collectionId}:`, gqlError);
      return false;
    }
  }

  // Create or update a collection mapping
  async saveOrUpdateCollectionMapping(
    collectionHash: string,
    productsHash: string, 
    shopifyCollectionId: string, 
    externalCollectionId: string, 
    shopifyProductGids: string[]
  ): Promise<void> {
    try {
      const success = await mongoDBCollectionService.saveCollectionMapping(
        collectionHash,
        productsHash,
        shopifyCollectionId,
        externalCollectionId,
        shopifyProductGids
      );
      
      if (success) {
        console.log(`✅ Successfully saved/updated collection mapping for Shopify ID: ${shopifyCollectionId} (External ID: ${externalCollectionId})`);
      } else {
        console.error(`❌ Failed to save/update collection mapping for Shopify ID: ${shopifyCollectionId}`);
      }
    } catch (error) {
      console.error('❌ Error saving/updating collection mapping:', error);
    }
  }

  // Sync a single collection
  async syncCollection(collection: ShopifyCollection): Promise<boolean> {
    try {
      console.log(`🔄 Syncing collection: ${collection.title} (Handle: ${collection.handle}, External ID: ${collection.id})`);
      
      const collectionHash = this.generateCollectionHash(collection);
      const externalProductIds = collection.products.nodes.map(p => p.id);

      // --- Map External Product IDs to Shopify GIDs ---
      const getShopifyGidPromises = externalProductIds.map(externalId => 
        productMappingService.getShopifyProductId(externalId)
      );
      const shopifyProductGidsNullable = await Promise.all(getShopifyGidPromises);
      const shopifyProductGids = shopifyProductGidsNullable.filter((gid): gid is string => gid !== null);
      
      if (shopifyProductGids.length !== externalProductIds.length) {
        console.warn(`⚠️ Could not map all external product IDs for collection "${collection.title}". Mapped ${shopifyProductGids.length}/${externalProductIds.length}. Proceeding with mapped products.`);
      }
      
      // TODO: Recalculate productsHash based on *mapped Shopify GIDs* for accurate change detection
      // For now, using the original hash based on external product IDs
      const productsHash = this.generateProductsHash(collection); // Consider recalculating based on shopifyProductGids
      
      // 1. Check if the collection exists in our database by hash
      const { exists, shopifyCollectionId: existingMappedShopifyId, productsChanged } = await this.checkCollectionByHash(collectionHash, productsHash);
      
      // --- Prepare Input for Shopify Create/Update ---
      // Note: The 'products' field in collectionInput might not work for `collectionUpdate`.
      // The standard way is `collectionAddProducts` or `collectionRemoveProducts` mutations after update.
      // However, let's try including it in the input for `collectionUpdate` first.
      // Base input for create/update - ID will be added specifically for updates.
      const collectionBaseInput: ShopifyCollectionInput = { // Use the defined input type
        title: collection.title,
        handle: collection.handle, // Ensure handle is included for updates/creates
        descriptionHtml: collection.descriptionHtml,
        sortOrder: collection.sortOrder, // Ensure this value matches Shopify's CollectionSortOrder enum (e.g., MANUAL, BEST_SELLING)
        templateSuffix: collection.templateSuffix
        // NOTE: products removed - will be handled by collectionAddProducts
      };

      // --- Add ruleSet to input if present ---
      if (collection.ruleSet) {
        // Map the ruleSet structure to the format Shopify expects for input
        // IMPORTANT: Ensure the `column` and `relation` strings EXACTLY match
        // Shopify's expected Enum values (e.g., "TAG", "EQUALS").
        // You might need a mapping function if your external API uses different values.
        collectionBaseInput.ruleSet = {
            appliedDisjunctively: collection.ruleSet.appliedDisjunctively,
            rules: collection.ruleSet.rules.map(rule => ({
                column: rule.column, // e.g., "TAG" - Must match CollectionRuleColumn!
                relation: rule.relation, // e.g., "EQUALS" - Must match CollectionRuleRelation!
                condition: rule.condition
            }))
        };
      }
      // --- End Add ruleSet ---

      if (exists && existingMappedShopifyId) {
        // 2. Found in DB by Hash: Update Shopify collection if products changed
        console.log(`ℹ️ Collection found in local DB by hash: ${collection.title} (Shopify ID: ${existingMappedShopifyId})`);
        
        if (productsChanged) {
          console.log(`🔄 Products have changed for collection: ${collection.title}. Updating Shopify collection...`);
          
          try {
            // Attempt to update metadata and products together
             const updateResponse = await this.graphqlClient.request<CollectionUpdateResponse>(
              COLLECTION_UPDATE_MUTATION,
              {
                // Pass the entire input object, including the ID for updates
                input: { ...collectionBaseInput, id: existingMappedShopifyId }
              }
            );

            if (updateResponse.collectionUpdate.userErrors?.length > 0) {
              console.error(`❌ Shopify API Error updating collection ${collection.title} (ID: ${existingMappedShopifyId}):`, updateResponse.collectionUpdate.userErrors);
              return false; // Stop sync for this collection on error
            }

            console.log(`✅ Successfully updated collection metadata in Shopify: ${collection.title}`);
            
            // Now add/update products if they have changed
            const productsAdded = await this.addProductsToCollection(existingMappedShopifyId, shopifyProductGids);
            if (!productsAdded) {
               console.error(`❌ Failed to add/update products for updated collection ${collection.title}.`);
               return false; // Example: fail sync if products can't be added
            }
            
            // Update the mapping with the potentially new products hash
            await this.saveOrUpdateCollectionMapping(
              collectionHash,
              productsHash,
              existingMappedShopifyId,
              collection.id,
              shopifyProductGids
            );
            return true;

          } catch (gqlError) {
             console.error(`❌ GraphQL Error updating collection ${collection.title} (ID: ${existingMappedShopifyId}) in Shopify:`, gqlError);
             return false;
          }
        } else {
          console.log(`✅ No changes detected based on hash for collection: ${collection.title}`);
          return true;
        }

      } else {
        // 3. Not Found in DB by Hash: Search Shopify by handle
        console.log(`ℹ️ Collection not found in local DB by hash. Searching Shopify by handle: ${collection.handle}...`);
        const foundShopifyCollection = await this.findShopifyCollectionByHandle(collection.handle);

        if (foundShopifyCollection && foundShopifyCollection.id) {
           // 4. Found in Shopify by Handle: Update existing Shopify collection
           const targetShopifyId = foundShopifyCollection.id;
           console.log(`⤴️ Found existing collection in Shopify by handle: ${collection.handle} (ID: ${targetShopifyId}). Updating it...`);            
           try {
             // Use COLLECTION_UPDATE_MUTATION
             const updateResponse = await this.graphqlClient.request<CollectionUpdateResponse>(
               COLLECTION_UPDATE_MUTATION,
               {
                 // Pass the entire input object, including the ID for updates
                  input: { ...collectionBaseInput, id: targetShopifyId }
               }
             );

             if (updateResponse.collectionUpdate.userErrors?.length > 0) {
                console.error(`❌ Shopify API Error updating collection ${collection.title} (ID: ${targetShopifyId}) found by handle:`, updateResponse.collectionUpdate.userErrors);
                return false;
             }

             const updatedCollection = updateResponse.collectionUpdate.collection;
             console.log(`✅ Successfully updated collection metadata in Shopify (found by handle): ${updatedCollection.title} (ID: ${updatedCollection.id})`);
             
             // Now add/update products
             const productsAdded = await this.addProductsToCollection(targetShopifyId, shopifyProductGids);
             if (!productsAdded) {
                console.error(`❌ Failed to add/update products for collection ${collection.title} found by handle.`);
                return false; // Example: fail sync
             }
             
             // Create the mapping in our DB linking hash/external ID to this Shopify ID
             await this.saveOrUpdateCollectionMapping(
               collectionHash,
               productsHash,
               targetShopifyId,
               collection.id,
               shopifyProductGids
             );
             return true;

           } catch (gqlError) {
              console.error(`❌ GraphQL Error updating collection ${collection.title} (ID: ${targetShopifyId}) found by handle:`, gqlError);
              return false;
           }
        } else {
          // 5. Not Found by Handle: Create new collection in Shopify
          console.log(`🚀 No existing collection found by handle in Shopify. Creating new collection: ${collection.title}`);
          
          try {
            // Use COLLECTION_CREATE_MUTATION
            const createResponse = await this.graphqlClient.request<CollectionCreateResponse>(
              COLLECTION_CREATE_MUTATION,
              // Pass the input object *without* the ID for creates
              { input: collectionBaseInput }
            );
            
            if (createResponse.collectionCreate.userErrors?.length > 0) {
              console.error(`❌ Shopify API Error creating collection ${collection.title}:`, createResponse.collectionCreate.userErrors);
              return false;
            }
            
            const createdShopifyCollection = createResponse.collectionCreate.collection;
            if (!createdShopifyCollection?.id) {
               console.error(`❌ Shopify API returned invalid data after creating collection ${collection.title}`);
               return false;
            }
            
            const newShopifyCollectionId = createdShopifyCollection.id;
            console.log(`✅ Successfully created collection in Shopify: ${collection.title} (ID: ${newShopifyCollectionId}). Adding products...`);
            
            // Add products to the newly created collection
            const productsAdded = await this.addProductsToCollection(newShopifyCollectionId, shopifyProductGids);
            if (!productsAdded) {
              // Decide on behavior: delete collection, mark as failed, etc.
              console.error(`❌ Failed to add products to newly created collection ${collection.title}. The collection exists but is empty.`);
              // Consider adding cleanup logic here if needed (e.g., delete the created collection)
              return false; // Example: fail sync
            }
            
            // Store the mapping in our DB
            await this.saveOrUpdateCollectionMapping(
              collectionHash,
              productsHash,
              newShopifyCollectionId,
              collection.id,
              shopifyProductGids
            );
            return true;

          } catch (gqlError) {
            console.error(`❌ GraphQL Error creating collection ${collection.title} in Shopify:`, gqlError);
            return false;
          }
        }
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
      
      // Process collections sequentially
      for (const collection of collectionsToSync) {
        // Add a small delay between processing each collection to help avoid rate limits
        // Adjust delay time as needed (e.g., 500ms)
        await new Promise(resolve => setTimeout(resolve, 500)); 
        
        const success = await this.syncCollection(collection);
        if (success) {
          syncedCollections.push(collection);
        } else {
           console.log(`⚠️ Sync failed or was skipped for collection: ${collection.title} (Handle: ${collection.handle})`);
        }
      }
      
      console.log(`✅ Sync process completed. Successfully processed ${syncedCollections.length} out of ${collectionsToSync.length} collections.`);
      return syncedCollections;
    } catch (error) {
      console.error('❌ Error during the overall syncCollections process:', error);
      throw error;
    }
  }
}

export const shopifyCollectionSyncService = new ShopifyCollectionSyncService(); 
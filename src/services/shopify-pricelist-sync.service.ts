import axios from 'axios';
import dotenv from 'dotenv';
import { variantIdMappingService } from './variant-id-mapping.service';
import { priceListMappingService } from './pricelist-mapping.service';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import crypto from 'crypto';

dotenv.config();

interface PriceData {
  variantId: string;
  price: string;
  compareAtPrice: string;
  originType: string;
  sku?: string;
}

interface PriceList {
  id: string;
  name: string;
  currency: string;
  fixedPricesCount: number;
  prices: PriceData[];
}

interface PriceListResponse {
  success: boolean;
  priceLists: PriceList[];
}

interface ShopifyPriceInput {
  variantId: string;
  price: {
    amount: string;
    currencyCode: string;
  };
  compareAtPrice: {
    amount: string;
    currencyCode: string;
  } | null;
}

interface PriceListFixedPricesAddResponse {
  priceListFixedPricesAdd: {
    prices: Array<{
      compareAtPrice: {
        amount: string;
        currencyCode: string;
      } | null;
      price: {
        amount: string;
        currencyCode: string;
      };
    }>;
    userErrors: Array<{
      field: string;
      code: string;
      message: string;
    }>;
  };
}

export class ShopifyPriceListSyncService {
  private externalPriceListsApiUrl: string;
  private shopifyPriceLists: Map<string, string> = new Map(); // Map currency to price list ID

  constructor() {
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalPriceListsApiUrl = `${externalApiBaseUrl}/api/pricelists`;
  }

  // Generate a hash for a price list based on its properties
  private generatePriceListHash(priceList: PriceList): string {
    // Create a stable representation of prices
    const pricesString = priceList.prices
      .sort((a, b) => a.variantId.localeCompare(b.variantId))
      .map(p => `${p.variantId}:${p.price}:${p.compareAtPrice || 'null'}:${p.originType}`)
      .join('|');

    // Combine price list data
    const priceListData = [
      priceList.id,
      priceList.name,
      priceList.currency,
      pricesString
    ].join('|');

    return crypto.createHash('md5').update(priceListData).digest('hex');
  }

  // Fetch price lists from external API
  async fetchExternalPriceLists(): Promise<PriceList[]> {
    try {
      console.log('🔍 Fetching external price lists...');
      const response = await axios.get<PriceListResponse>(this.externalPriceListsApiUrl);
      
      if (!response.data.success) {
        throw new Error('External API reported unsuccessful response');
      }
      
      console.log(`✅ Successfully fetched ${response.data.priceLists.length} price lists`);
      return response.data.priceLists;
    } catch (error) {
      console.error('❌ Error fetching external price lists:', error);
      throw error;
    }
  }

  private async mapVariantIds(prices: PriceData[]): Promise<PriceData[]> {
    console.log(`🔍 Mapping ${prices.length} variant IDs...`);
    
    // Get all variant mappings
    const mappings = await variantIdMappingService.getAllMappings();
    
    // Keep track of how many variants were successfully mapped
    let successfullyMapped = 0;
    let alreadyValidIds = 0;
    let skuMapped = 0;
    let failed = 0;
    
    const mappedPrices = prices.map(price => {
      // If the price already has a valid Shopify variant ID, use it
      if (price.variantId && price.variantId.startsWith('gid://shopify/ProductVariant/')) {
        alreadyValidIds++;
        return price;
      }
      
      // If we have the SKU, try to look it up
      if (price.sku && mappings[price.sku]) {
        skuMapped++;
        successfullyMapped++;
        return {
          ...price,
          variantId: mappings[price.sku].shopifyVariantId
        };
      }
      
      // Handle external numeric IDs (if they exist) by looking them up in all mappings
      if (price.variantId) {
        // Check if this is a Shopify ID from another store (which would be an externalVariantId in our mappings)
        const potentialShopifyId = price.variantId.includes('gid://shopify/ProductVariant/') ? 
          price.variantId : 
          `gid://shopify/ProductVariant/${price.variantId}`;
          
        // Try to find a mapping that has this external ID
        const foundMapping = Object.values(mappings).find(
          mapping => mapping.externalVariantId === potentialShopifyId || mapping.externalVariantId === price.variantId
        );
        
        if (foundMapping) {
          successfullyMapped++;
          return {
            ...price,
            variantId: foundMapping.shopifyVariantId,
            sku: foundMapping.sku // Add the SKU for future reference
          };
        }
      }
      
      failed++;
      console.warn(`⚠️ Could not map variant ID for ${price.variantId || price.sku || 'unknown variant'}`);
      // If we can't map it, keep the original (but will be filtered out later)
      return price;
    });
    
    console.log(`📊 Variant mapping stats: ${alreadyValidIds} already valid, ${skuMapped} mapped by SKU, ${successfullyMapped - skuMapped} mapped by external ID, ${failed} failed`);
    
    return mappedPrices;
  }

  private async transformPriceData(priceList: PriceList): Promise<ShopifyPriceInput[]> {
    console.log(`🔧 Transforming prices for price list: ${priceList.name} (${priceList.currency})`);
    
    // First map external variant IDs to Shopify variant IDs if needed
    const mappedPrices = await this.mapVariantIds(priceList.prices);
    
    // Filter out prices without valid Shopify variant IDs
    const validPrices = mappedPrices.filter(price => 
      price.variantId && price.variantId.startsWith('gid://shopify/ProductVariant/')
    );
    
    console.log(`✅ Filtered to ${validPrices.length} prices with valid Shopify variant IDs out of ${priceList.prices.length} total`);
    
    // Verify all variant IDs exist in Shopify
    const verifiedPrices = await this.verifyVariantIds(validPrices);
    
    const transformedPrices = verifiedPrices.map(price => ({
      variantId: price.variantId,
      price: {
        amount: price.price,
        currencyCode: priceList.currency
      },
      compareAtPrice: price.compareAtPrice ? {
        amount: price.compareAtPrice,
        currencyCode: priceList.currency
      } : null
    }));
    
    console.log(`✅ Transformed ${transformedPrices.length} verified prices out of ${priceList.prices.length} total`);
    return transformedPrices;
  }
  
  // Verify that variant IDs actually exist in Shopify
  private async verifyVariantIds(prices: PriceData[]): Promise<PriceData[]> {
    if (prices.length === 0) return [];
    
    console.log(`🔍 Verifying ${prices.length} Shopify variant IDs...`);
    
    try {
      // Log a sample of variant IDs for debugging
      const sampleSize = Math.min(5, prices.length);
      console.log(`📝 Sample of variant IDs to verify (${sampleSize} of ${prices.length}):`);
      for (let i = 0; i < sampleSize; i++) {
        console.log(`   - ${prices[i].variantId} (SKU: ${prices[i].sku || 'unknown'})`);
      }
      
      // First, attempt to resolve all variant IDs using variantIdMappingService
      // to ensure we're using Shopify variant IDs when verifying
      const originalToShopifyIdMap = new Map<string, string>();
      const resolvedPrices = [...prices]; // Create a copy to modify
      const mappings = await variantIdMappingService.getAllMappings();
      
      // Pre-process all prices to ensure we're using the correct Shopify variant IDs
      for (let i = 0; i < resolvedPrices.length; i++) {
        const price = resolvedPrices[i];
        const originalId = price.variantId;
        
        // Skip if already a known valid Shopify ID (verified in a previous sync)
        if (price.originType === 'shopify_verified') {
          continue;
        }
        
        // Try to find by SKU first (most reliable)
        if (price.sku && mappings[price.sku]) {
          const shopifyId = mappings[price.sku].shopifyVariantId;
          resolvedPrices[i].variantId = shopifyId;
          originalToShopifyIdMap.set(originalId, shopifyId);
          console.log(`💡 Pre-resolved variant ID by SKU: ${price.sku} → ${shopifyId}`);
          continue;
        }
        
        // Try to find by externalVariantId in our mappings
        const foundByExternalId = Object.values(mappings).find(
          mapping => mapping.externalVariantId === originalId || 
                    (originalId && originalId.includes('gid://shopify/ProductVariant/') && 
                    mapping.externalVariantId === `gid://shopify/ProductVariant/${originalId.replace('gid://shopify/ProductVariant/', '')}`)
        );
        
        if (foundByExternalId) {
          resolvedPrices[i].variantId = foundByExternalId.shopifyVariantId;
          originalToShopifyIdMap.set(originalId, foundByExternalId.shopifyVariantId);
          console.log(`💡 Pre-resolved variant ID by external ID: ${originalId} → ${foundByExternalId.shopifyVariantId}`);
        }
      }
      
      // Batch variant IDs to avoid too large queries
      const batchSize = 50;
      const batches = [];
      
      for (let i = 0; i < resolvedPrices.length; i += batchSize) {
        batches.push(resolvedPrices.slice(i, i + batchSize));
      }
      
      const verifiedVariantIds = new Set<string>();
      
      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const variantIds = batch.map(p => p.variantId);
        
        // Construct a query to check multiple variants at once
        const variantIdStrings = variantIds.map(id => `"${id}"`).join(',');
        
        const VARIANT_CHECK_QUERY = `
          query {
            nodes(ids: [${variantIdStrings}]) {
              id
              ... on ProductVariant {
                id
              }
            }
          }
        `;
        
        const client = createShopifyGraphQLClient();
        const response = await client.request<{ nodes: Array<{ id: string } | null> }>(VARIANT_CHECK_QUERY);
        
        // Define a helper function to look up variant ID by SKU
        const lookupVariantIdBySku = async (sku: string): Promise<string | null> => {
          return await variantIdMappingService.getShopifyVariantId(sku);
        };
        
        // Filter null values and collect valid IDs
        for (let j = 0; j < response.nodes.length; j++) {
          const node = response.nodes[j];
          const variantId = variantIds[j];
          
          if (node) {
            verifiedVariantIds.add(variantId);
            
            // If this ID was mapped from an original ID, also mark the original as verified
            // This ensures we maintain the mapping for future reference
            for (const [originalId, shopifyId] of originalToShopifyIdMap.entries()) {
              if (shopifyId === variantId) {
                console.log(`✅ Verified mapped variant ID: ${originalId} → ${variantId}`);
              }
            }
          } else {
            console.warn(`⚠️ Variant ID does not exist in Shopify: ${variantId}`);
            
            // If the variant ID doesn't exist, try to find a mapping for it
            const correspondingVariant = batch[j];
            
            if (correspondingVariant.sku) {
              console.log(`🔄 Trying to find alternative mapping for SKU: ${correspondingVariant.sku}`);
              const shopifyVariantId = await lookupVariantIdBySku(correspondingVariant.sku);
              
              if (shopifyVariantId) {
                console.log(`✅ Found alternative mapping for ${correspondingVariant.sku}: ${shopifyVariantId}`);
                
                // Update all prices with this variant ID
                for (let k = 0; k < prices.length; k++) {
                  if (prices[k].variantId === correspondingVariant.variantId) {
                    prices[k].variantId = shopifyVariantId;
                  }
                }
                
                verifiedVariantIds.add(shopifyVariantId);
              }
            }
          }
        }
        
        // If processing multiple batches, wait a bit to avoid rate limiting
        if (batches.length > 1 && i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`✅ Verified ${verifiedVariantIds.size} valid variant IDs out of ${prices.length}`);
      
      // Update the original prices array with the verified IDs
      const updatedPrices = prices.map(price => {
        // If we found a mapping for this variant ID, use the Shopify ID
        const mappedId = originalToShopifyIdMap.get(price.variantId);
        if (mappedId && verifiedVariantIds.has(mappedId)) {
          return {
            ...price,
            variantId: mappedId,
            originType: 'shopify_verified' // Mark as verified for future syncs
          };
        }
        
        // If the original ID is verified, use it
        if (verifiedVariantIds.has(price.variantId)) {
          return {
            ...price,
            originType: 'shopify_verified' // Mark as verified for future syncs
          };
        }
        
        // Not verified, exclude from result
        return price;
      });
      
      // Return only prices with verified variant IDs
      return updatedPrices.filter(price => 
        verifiedVariantIds.has(price.variantId) || 
        (originalToShopifyIdMap.has(price.variantId) && verifiedVariantIds.has(originalToShopifyIdMap.get(price.variantId)!))
      );
    } catch (error) {
      console.error('❌ Error verifying variant IDs:', error);
      // If verification fails, return the original list but log the error
      return prices;
    }
  }

  // Create or update mapping in MongoDB
  private async createOrUpdatePriceListMapping(
    externalPriceListId: string,
    shopifyPriceListId: string,
    name: string,
    currency: string,
    priceListHash: string
  ): Promise<void> {
    try {
      await priceListMappingService.savePriceListMapping({
        externalPriceListId,
        shopifyPriceListId,
        name,
        currency,
        priceListHash
      });
      
      console.log(`✅ Successfully saved mapping for price list ${name} (${currency}) with hash ${priceListHash}`);
    } catch (error) {
      console.error(`❌ Error saving price list mapping for ${externalPriceListId}:`, error);
      throw error;
    }
  }

  // Fetch price lists from Shopify
  private async fetchShopifyPriceLists(): Promise<Map<string, string>> {
    try {
      console.log('🔍 Fetching Shopify price lists...');
      
      const PRICE_LISTS_QUERY = `
        query {
          priceLists(first: 20) {
            nodes {
              id
              name
              currency
              fixedPricesCount
            }
          }
        }
      `;
      
      interface ShopifyPriceListsResponse {
        priceLists: {
          nodes: Array<{
            id: string;
            name: string;
            currency: string;
            fixedPricesCount: number;
          }>;
        };
      }
      
      const client = createShopifyGraphQLClient();
      const response = await client.request<ShopifyPriceListsResponse>(PRICE_LISTS_QUERY);
      
      const priceLists = response.priceLists.nodes;
      console.log(`✅ Found ${priceLists.length} price lists in Shopify`);
      
      const currencyToPriceListMap = new Map<string, string>();
      
      priceLists.forEach((list) => {
        console.log(`📊 Shopify Price List: ${list.name} (${list.currency}) - ID: ${list.id}`);
        currencyToPriceListMap.set(list.currency, list.id);
      });
      
      return currencyToPriceListMap;
    } catch (error) {
      console.error('❌ Error fetching Shopify price lists:', error);
      throw error;
    }
  }

  async syncPriceList(priceList: PriceList): Promise<any> {
    try {
      console.log(`🔄 Syncing price list: ${priceList.name} (${priceList.currency})`);
      
      // Initialize the variant mapping service
      await variantIdMappingService.initialize();
      
      // Load Shopify price lists if we haven't already
      if (this.shopifyPriceLists.size === 0) {
        this.shopifyPriceLists = await this.fetchShopifyPriceLists();
      }
      
      // Find a matching price list ID for this currency
      const shopifyPriceListId = this.shopifyPriceLists.get(priceList.currency);
      
      if (!shopifyPriceListId) {
        console.warn(`⚠️ No matching Shopify price list found for currency ${priceList.currency}`);
        return {
          priceListId: priceList.id,
          name: priceList.name,
          currency: priceList.currency,
          status: 'skipped',
          reason: `No matching Shopify price list found for currency ${priceList.currency}`,
          syncedPricesCount: 0
        };
      }
      
      console.log(`🔍 Found matching Shopify price list with ID ${shopifyPriceListId} for currency ${priceList.currency}`);
      
      // Initialize the mapping service
      await priceListMappingService.initialize();
      
      // Generate hash for current price list
      const priceListHash = this.generatePriceListHash(priceList);
      console.log(`🔑 Generated hash for price list ${priceList.id}: ${priceListHash}`);
      
      // Check if we already have this price list with the same hash
      const existingMapping = await priceListMappingService.getShopifyPriceListId(priceList.id);
      
      if (existingMapping) {
        // Check if the hash matches
        const mappingByHash = await priceListMappingService.findPriceListByHash(priceListHash);
        if (mappingByHash && mappingByHash.externalPriceListId === priceList.id) {
          console.log(`⏭️ Skipping price list ${priceList.name} (${priceList.currency}) - no changes detected (hash: ${priceListHash})`);
          return {
            priceListId: priceList.id,
            name: priceList.name,
            currency: priceList.currency,
            status: 'skipped',
            reason: 'No changes detected (hash match)',
            syncedPricesCount: 0
          };
        }
        console.log(`🔄 Price list ${priceList.name} (${priceList.currency}) has changed - updating`);
      } else {
        console.log(`🆕 New price list detected: ${priceList.name} (${priceList.currency})`);
      }
      
      // Transform price data
      const transformedPrices = await this.transformPriceData(priceList);
      
      if (transformedPrices.length === 0) {
        console.warn(`⚠️ No valid prices found for price list ${priceList.id} with currency ${priceList.currency}`);
        return {
          priceListId: priceList.id,
          name: priceList.name,
          currency: priceList.currency,
          status: 'skipped',
          reason: 'No valid prices to sync',
          syncedPricesCount: 0
        };
      }
      
      // Process in batches to avoid large mutations
      const batchSize = 100;
      let totalSyncedPrices = 0;
      let errors = [];
      
      for (let i = 0; i < transformedPrices.length; i += batchSize) {
        const priceBatch = transformedPrices.slice(i, i + batchSize);
        
        try {
          console.log(`🔄 Sending GraphQL request to update batch of ${priceBatch.length} prices (${i + 1}-${Math.min(i + batchSize, transformedPrices.length)}) for price list ${shopifyPriceListId}...`);
          
          const PRICE_LIST_FIXED_PRICES_ADD_MUTATION = `
            mutation priceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
              priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
                prices {
                  compareAtPrice {
                    amount
                    currencyCode
                  }
                  price {
                    amount
                    currencyCode
                  }
                }
                userErrors {
                  field
                  code
                  message
                }
              }
            }
          `;

          const variables = {
            priceListId: shopifyPriceListId,
            prices: priceBatch
          };
          
          const client = createShopifyGraphQLClient();
          const response = await client.request<PriceListFixedPricesAddResponse>(
            PRICE_LIST_FIXED_PRICES_ADD_MUTATION,
            variables
          );
          
          if (response.priceListFixedPricesAdd.userErrors.length > 0) {
            console.warn(`⚠️ Batch ${i / batchSize + 1} had ${response.priceListFixedPricesAdd.userErrors.length} errors`);
            errors.push(...response.priceListFixedPricesAdd.userErrors);
          } else {
            totalSyncedPrices += priceBatch.length;
            console.log(`✅ Successfully synced batch ${i / batchSize + 1} with ${priceBatch.length} prices`);
          }
          
          // Wait a bit between batches to avoid rate limiting
          if (i + batchSize < transformedPrices.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`❌ Error syncing price batch ${i / batchSize + 1}:`, error);
          errors.push({
            message: error instanceof Error ? error.message : 'Unknown error',
            batch: i / batchSize + 1
          });
        }
      }
      
      // Update the mapping with new hash if at least some prices were synced
      if (totalSyncedPrices > 0) {
        await this.createOrUpdatePriceListMapping(
          priceList.id,
          shopifyPriceListId,
          priceList.name,
          priceList.currency,
          priceListHash
        );
        
        console.log(`✅ Successfully synced ${totalSyncedPrices} prices for price list ${shopifyPriceListId}`);
      }
      
      return {
        priceListId: priceList.id,
        shopifyPriceListId: shopifyPriceListId,
        name: priceList.name,
        currency: priceList.currency,
        status: totalSyncedPrices > 0 ? 'success' : 'error',
        syncedPricesCount: totalSyncedPrices,
        totalPrices: transformedPrices.length,
        errorCount: errors.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : [], // Only include first 10 errors
        hash: priceListHash
      };
    } catch (error) {
      console.error(`❌ Error syncing price list ${priceList.id}:`, error);
      return {
        priceListId: priceList.id,
        name: priceList.name,
        currency: priceList.currency,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public async syncPriceLists(): Promise<any[]> {
    try {
      console.log('🔄 Starting price list sync process...');
      
      // Initialize the services
      await variantIdMappingService.initialize();
      await priceListMappingService.initialize();
      
      const priceLists = await this.fetchExternalPriceLists();
      
      // First process AED currency as required
      const aedPriceLists = priceLists.filter(list => list.currency === 'AED');
      const otherPriceLists = priceLists.filter(list => list.currency !== 'AED');
      
      // Process AED first, then other currencies
      const sortedPriceLists = [...aedPriceLists];
      
      console.log(`🔄 Processing price lists: AED (${aedPriceLists.length}) first, then others (${otherPriceLists.length})`);
      
      const results = [];
      for (const priceList of sortedPriceLists) {
        const result = await this.syncPriceList(priceList);
        results.push(result);
      }
      
      const successCount = results.filter(r => r.status === 'success').length;
      const errorCount = results.filter(r => r.status === 'error').length;
      const skippedCount = results.filter(r => r.status === 'skipped').length;
      
      console.log(`✅ Price list sync completed. Success: ${successCount}, Failed: ${errorCount}, Skipped: ${skippedCount}`);
      
      return results;
    } catch (error) {
      console.error('❌ Error in price list sync process:', error);
      throw error;
    }
  }
}

export const shopifyPriceListSyncService = new ShopifyPriceListSyncService(); 
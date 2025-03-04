import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { 
  MutationProductSetArgs, 
  Product, 
  ProductSetInput,
  ProductSetPayload
} from '../types/shopify-generated';
import { ExternalProduct } from '../types/shopify-sync';
import { 
  PRODUCT_SET_MUTATION, 
  PRODUCT_BY_HANDLE_QUERY 
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
dotenv.config();

export class ShopifyProductSyncService {
  private shopifyAccessToken: string;
  private shopifyShopUrl: string;
  private graphqlClient: GraphQLClient;

  constructor() {
    this.shopifyAccessToken = process.env.SHOPIFY_TOKEN || '';
    this.shopifyShopUrl = process.env.SHOPIFY_APP_URL || '';
    this.graphqlClient = createShopifyGraphQLClient(
      this.shopifyShopUrl, 
      this.shopifyAccessToken
    );
  }

  // Fetch products from external API
  async fetchExternalProducts(): Promise<ExternalProduct[]> {
    try {
      console.log('🔍 Fetching external products...');
      const response = await axios.get('https://shopify-store-data-resolver.hieunguyen.dev/api/products');
      console.log(`✅ Successfully fetched ${response.data.products.length} products`);
      return response.data.products;
    } catch (error) {
      console.error('❌ Error fetching external products:', error);
      throw error;
    }
  }

  // Check if product exists by handle
  async checkProductByHandle(handle: string) {
    try {
      console.log(`🔍 Checking for existing product with handle: ${handle}`);
      
      const response = await this.graphqlClient.request<{
        productByIdentifier: Product
      }>(
        PRODUCT_BY_HANDLE_QUERY, 
        { identifier: { handle } }
      );

      const existingProduct = response.productByIdentifier;
      
      if (existingProduct) {
        console.log(`✅ Found existing product: ${existingProduct.title} (ID: ${existingProduct.id})`);
        return existingProduct;
      }
      
      console.log(`❌ No product found with handle: ${handle}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking product by handle:', error);
      throw error;
    }
  }

  // Prepare data for Shopify product set mutation
  async prepareProductData(externalProduct: ExternalProduct): Promise<MutationProductSetArgs> {
    console.log(`🔧 Preparing product for sync: ${externalProduct.title}`);
    
    // Check if product already exists
    const existingProduct = await this.checkProductByHandle(externalProduct.handle || '');
    
    const productInput: ProductSetInput = {
      title: externalProduct.title,
      descriptionHtml: externalProduct.description,
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      productOptions: externalProduct.options?.map(option => ({
        name: option.name,
        values: option.values.map(value => ({
          name: value
        }))
      })),
    };

    if (existingProduct) {
      productInput.id = existingProduct.id;
    }

    // Handle variants if exists
    if (externalProduct.variants && externalProduct.variants.length > 0) {
      console.log(`📦 Preparing ${externalProduct.variants.length} variants`);
      productInput.variants = externalProduct.variants.map((variant, index) => ({
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        optionValues: variant.selectedOptions.map((option) => ({name: option.value, optionName: option.name}))
      }));
    }

    return { input: productInput };
  }

  // Resolve and sync product to Shopify
  async syncProduct(productData: MutationProductSetArgs) {
    try {
      console.log(`🚀 Syncing product to Shopify: ${productData.input.title}`);
      console.log(productData.input.variants?.map((variant) => variant.optionValues));
      const response = await this.graphqlClient.request<{
        productSet: ProductSetPayload
      }>(
        PRODUCT_SET_MUTATION, 
        {...productData, synchronous: true}
      );

      const result = response.productSet;

      if (result.userErrors && result.userErrors.length > 0) {
        const errorMessage = result.userErrors.map((err) => err.message).join(', ');
        console.error(`❌ Sync error for product ${productData.input.title}: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      console.log(`✅ Successfully synced product: ${result.product?.title}`);
      return result.product;
    } catch (error) {
      console.error('❌ Error syncing product to Shopify:', error);
      throw error;
    }
  }

  // Main sync method
  async syncProducts(limit?: number) {
    console.log('🌟 Starting Shopify Product Sync Process');
    const startTime = Date.now();

    try {
      // Fetch external products
      const externalProducts = await this.fetchExternalProducts();

      // Apply limit if specified
      const productsToSync = limit ? externalProducts.slice(0, limit) : externalProducts;

      // Sync each product
      const syncResults = [];
      for (const [index, product] of productsToSync.entries()) {
        console.log(`\n📍 Processing Product ${index + 1}/${productsToSync.length}`);
        try {
          const preparedProductData = await this.prepareProductData(product);
          const syncedProduct = await this.syncProduct(preparedProductData);
          syncResults.push(syncedProduct);
        } catch (productSyncError) {
          console.error(`❌ Failed to sync product ${product.title}`, productSyncError);
          // Optionally, you can choose to continue or break here
        }
      }

      const endTime = Date.now();
      console.log(`\n🏁 Sync Complete
- Total Products: ${productsToSync.length}
- Successfully Synced: ${syncResults.length}
- Failed Products: ${productsToSync.length - syncResults.length}
- Total Time: ${(endTime - startTime) / 1000} seconds`);

      return syncResults;
    } catch (error) {
      console.error('❌ Complete product sync failed:', error);
      throw error;
    }
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
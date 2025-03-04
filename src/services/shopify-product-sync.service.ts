import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { 
  MutationProductSetArgs, 
  Product, 
  ProductSetInput,
  ProductSetPayload,
  FileCreateInput
} from '../types/shopify-generated';
import { ExternalProduct } from '../types/shopify-sync';
import { 
  PRODUCT_SET_MUTATION, 
  PRODUCT_BY_HANDLE_QUERY,
  FILE_CREATE_MUTATION
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';


export class ShopifyProductSyncService {
  private graphqlClient: GraphQLClient;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
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
      handle: externalProduct.handle,
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
      productInput.variants = externalProduct.variants.map((variant) => ({
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        optionValues: variant.selectedOptions.map((option) => ({name: option.value, optionName: option.name}))
      }));
    }

    // Upload global images metafield
    const globalImagesMetafield = externalProduct.metafields?.find(
      (m: { namespace: string, key: string }) => m.namespace === 'global' && m.key === 'images'
    );

    if (globalImagesMetafield) {
      try {
        // Parse the image URLs from the metafield value
        const imageUrls: string[] = JSON.parse(globalImagesMetafield.value);
        
        // Prepare file create inputs for upload
        const fileInputs: FileCreateInput[] = imageUrls.map((url: string) => ({
          originalSource: url,
          contentType: 'IMAGE'
        }));

        // Upload multiple files and get their media IDs
        const mediaIds = await this.uploadMultipleFiles(fileInputs);

        // Add metafields to the product input
        if (!productInput.metafields) {
          productInput.metafields = [];
        }

        // Add global.images metafield with media IDs
        productInput.metafields.push({
          namespace: 'global',
          key: 'images',
          type: 'list.file_reference',
          value: JSON.stringify(mediaIds)
        });

        console.log(`📸 Uploaded ${mediaIds.length} images for global.images metafield`);
      } catch (error) {
        console.error('❌ Error processing global images metafield:', error);
      }
    }

    return { input: productInput };
  }

  // Resolve and sync product to Shopify
  async syncProduct(productData: MutationProductSetArgs) {
    try {
      console.log(`🚀 Syncing product to Shopify: ${productData.input.title}`);
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

  async uploadFile(fileInput: FileCreateInput): Promise<string | null> {
    try {
      const response = await this.graphqlClient.request<{
        fileCreate: {
          files: Array<{ id: string }>;
          userErrors: Array<{ field: string; message: string }>;
        }
      }>(FILE_CREATE_MUTATION, { files: [fileInput] });

      if (response.fileCreate.userErrors.length > 0) {
        console.log('File Upload', response.fileCreate.userErrors);
        return null;
      }

      return response.fileCreate.files[0]?.id || null;
    } catch (error) {
        console.log('File Upload', error);
      return null;
    }
  }

  async uploadMultipleFiles(files: FileCreateInput[]): Promise<string[]> {
    try {
      const response = await this.graphqlClient.request<{
        fileCreate: {
          files: Array<{ id: string }>;
          userErrors: Array<{ field: string; message: string }>;
        }
      }>(FILE_CREATE_MUTATION, { files });

      if (response.fileCreate.userErrors.length > 0) {
        console.log('Multiple File Upload', response.fileCreate.userErrors);
        return [];
      }

      return response.fileCreate.files.map(file => file.id).filter(Boolean);
    } catch (error) {
        console.log('Multiple File Upload', error);
      return [];
    }
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { 
  MutationProductSetArgs, 
  Product, 
  ProductSetInput,
  ProductSetPayload,
  FileCreateInput,
  FileContentType,
  ProductStatus,
  ProductVariantSetInput
} from '../types/shopify-generated';
import { ExternalProduct } from '../types/shopify-sync';
import { 
  PRODUCT_SET_MUTATION, 
  PRODUCT_BY_HANDLE_QUERY,
  FILE_CREATE_MUTATION
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';

// Load environment variables
dotenv.config();

export class ShopifyProductSyncService {
  private graphqlClient: GraphQLClient;
  private externalProductsApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    this.externalProductsApiUrl = process.env.EXTERNAL_PRODUCTS_API_URL || 'https://shopify-store-data-resolver.hieunguyen.dev/api/products';
  }

  // Fetch products from external API
  async fetchExternalProducts(): Promise<ExternalProduct[]> {
    try {
      console.log('🔍 Fetching external products...');
      const response = await axios.get(this.externalProductsApiUrl);
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

  // Main function to prepare product data
  async prepareProductData(externalProduct: ExternalProduct): Promise<MutationProductSetArgs> {
    console.log(`🔧 Preparing product for sync: ${externalProduct.title}`);
    
    // Check if product already exists
    const existingProduct = await this.checkProductByHandle(externalProduct.handle || '');
    
    // Create base product input
    const productInput = this.createBaseProductInput(externalProduct, existingProduct);
    
    // Handle product images
    this.addProductImages(productInput, externalProduct);
    
    // Handle variants if exists
    if (externalProduct.variants && externalProduct.variants.length > 0) {
      productInput.variants = await this.prepareVariants(externalProduct.variants);
    }

    // Handle product metafields
    await this.processProductMetafields(productInput, externalProduct);

    return { input: productInput };
  }

  // Create base product input with core properties
  private createBaseProductInput(externalProduct: ExternalProduct, existingProduct: Product | null): ProductSetInput {
    const productInput: ProductSetInput = {
      title: externalProduct.title,
      handle: externalProduct.handle,
      descriptionHtml: externalProduct.description,
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      status: externalProduct.status as ProductStatus,
      templateSuffix: externalProduct.templateSuffix,
      seo: {
        title: externalProduct.seo.title,
        description: externalProduct.seo.description,
      },
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

    return productInput;
  }

  // Add product images
  private addProductImages(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const productImages = externalProduct.images.map(image => ({
      originalSource: image.url,
      contentType: FileContentType.Image,
    }));

    const variantImages = externalProduct.variants?.filter((variant: any) => variant.image?.url)
      .map((variant: any) => ({
        originalSource: variant.image.url,
        contentType: FileContentType.Image,
      })) || [];

    productInput.files = [...productImages, ...variantImages];
  }

  // Prepare variants data
  private async prepareVariants(variants: any[]): Promise<ProductVariantSetInput[]> {
    console.log(`📦 Preparing ${variants.length} variants`);
    
    return Promise.all(variants.map(async (variant) => {
      return this.prepareVariantData(variant);
    }));
  }

  // Prepare individual variant data
  private async prepareVariantData(variant: any): Promise<ProductVariantSetInput> {
    const variantData: ProductVariantSetInput = {
      sku: variant.sku,            
      file: variant.image?.url ? {
        originalSource: variant.image.url, 
        contentType: FileContentType.Image
      } : undefined,
      price: variant.price,          
      compareAtPrice: variant.compareAtPrice,
      optionValues: variant.selectedOptions.map((option: any) => ({
        name: option.value, 
        optionName: option.name
      })),
      metafields: []
    };
    
    await this.processVariantMetafields(variantData, variant);
    
    return variantData;
  }

  // Process variant metafields
  private async processVariantMetafields(variantData: ProductVariantSetInput, variant: any): Promise<void> {
    const variantImagesMetafield = variant.metafields?.find(
      (m: { namespace: string, key: string }) => m.namespace === 'global' && m.key === 'images'
    );
    
    if (variantImagesMetafield) {
      try {
        const mediaIds = await this.processImagesMetafield(variantImagesMetafield);
        
        // Add global.images metafield with media IDs
        if (!variantData.metafields) {
          variantData.metafields = [];
        }
        
        variantData.metafields.push({
          namespace: 'global',
          key: 'images',
          type: 'list.file_reference',
          value: JSON.stringify(mediaIds)
        });

        console.log(`📸 Uploaded ${mediaIds.length} images for variant ${variant.sku} global.images metafield`);
      } catch (error) {
        console.error(`❌ Error processing variant ${variant.sku} global.images metafield:`, error);
      }
    }
  }

  // Process product metafields
  private async processProductMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const globalImagesMetafield = externalProduct.metafields?.find(
      (m: { namespace: string, key: string }) => m.namespace === 'global' && m.key === 'images'
    );

    if (globalImagesMetafield) {
      try {
        const mediaIds = await this.processImagesMetafield(globalImagesMetafield);
        
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
  }

  // Process images metafield and upload files
  private async processImagesMetafield(imagesMetafield: { value: string }): Promise<string[]> {
    // Parse the image URLs from the metafield value
    const imageUrls: string[] = JSON.parse(imagesMetafield.value);
    
    // Prepare file create inputs for upload
    const fileInputs: FileCreateInput[] = imageUrls.map((url: string) => ({
      originalSource: url,
      contentType: FileContentType.Image
    }));

    // Upload multiple files and get their media IDs
    return this.uploadMultipleFiles(fileInputs);
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
        const errorMessage = result.userErrors.map((err: { message: string }) => err.message).join(', ');
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

      return response.fileCreate.files.map((file: { id: string }) => file.id).filter(Boolean);
    } catch (error) {
        console.log('Multiple File Upload', error);
      return [];
    }
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
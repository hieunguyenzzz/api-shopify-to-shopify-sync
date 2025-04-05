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
  FILE_CREATE_MUTATION,
  PRODUCT_WITH_VARIANTS_QUERY
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { variantIdMappingService } from './variant-id-mapping.service';
import mongoDBService from './mongodb.service';
import { generateFileHash, getMimeTypeFromUrl } from '../utils/file-hash.util';

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
    if (!existingProduct) {
      this.addProductImages(productInput, externalProduct);
    }
    
    // Handle variants if exists
    if (externalProduct.variants && externalProduct.variants.length > 0) {
      productInput.variants = await this.prepareVariants(externalProduct.variants, externalProduct.handle || '');
    }

    if (existingProduct) {
      productInput.variants = productInput.variants?.map((variant) => {
        return {...variant, file: undefined};
      });
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
  private async prepareVariants(variants: any[], productHandle: string): Promise<ProductVariantSetInput[]> {    
    
    return Promise.all(variants.map(async (variant) => {
      return this.prepareVariantData(variant, productHandle);
    }));
  }

  // Prepare individual variant data
  private async prepareVariantData(variant: any, productHandle: string): Promise<ProductVariantSetInput> {
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

        //console.log(`📸 Uploaded ${mediaIds.length} images for variant ${variant.sku} global.images metafield`);
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
      
      // Get the synced product with variants to map IDs
      if (result.product?.id) {
        const variantCount = productData.input.variants?.length || 0;
        await this.mapProductVariantIds(result.product.id, productData.input.handle || '', variantCount);
      }
      
      return result.product;
    } catch (error) {
      console.error('❌ Error syncing product to Shopify:', error);
      throw error;
    }
  }

  // Map product variant IDs between external and Shopify systems
  private async mapProductVariantIds(shopifyProductId: string, productHandle: string, variantCount: number): Promise<void> {
    try {
      // Check if mappings already exist with the same count
      const existingMappings = await variantIdMappingService.getMappingsByProduct(productHandle);
      
      if (existingMappings.length === variantCount && variantCount > 0) {
        console.log(`✅ Variant mappings already exist for ${productHandle} with ${variantCount} variants. Skipping remapping.`);
        return;
      }
      
      // Get full product data with variants from Shopify
      const response = await this.graphqlClient.request<{
        product: {
          id: string;
          handle: string;
          variants: {
            edges: Array<{
              node: {
                id: string;
                sku: string;
                title: string;
              }
            }>
          }
        }
      }>(PRODUCT_WITH_VARIANTS_QUERY, { id: shopifyProductId });
      
      const shopifyProduct = response.product;
      
      if (!shopifyProduct || !shopifyProduct.variants) {
        console.warn(`⚠️ Could not retrieve variants for product ${shopifyProductId}`);
        return;
      }
      
      // Get external product data to map variant IDs
      const externalProducts = await this.fetchExternalProducts();
      const externalProduct = externalProducts.find(p => p.handle === productHandle);
      
      if (!externalProduct) {
        console.warn(`⚠️ Could not find external product with handle ${productHandle}`);
        return;
      }
      
      // Map variants by SKU
      for (const { node: shopifyVariant } of shopifyProduct.variants.edges) {
        const externalVariant = externalProduct.variants?.find(v => v.sku === shopifyVariant.sku);
        
        if (externalVariant) {
          await this.trackSyncedVariant(
            externalVariant.sku,
            shopifyVariant.id,
            productHandle,
            shopifyVariant.sku
          );
        }
      }
    } catch (error) {
      console.error('❌ Error mapping variant IDs:', error);
    }
  }

  // Track each successfully synced product
  private async trackSyncedVariant(
    externalVariantId: string,
    shopifyVariantId: string,
    productHandle: string,
    sku: string
  ): Promise<void> {
    try {
      await variantIdMappingService.saveVariantMapping({
        externalVariantId,
        shopifyVariantId,
        productHandle,
        sku
      });
    } catch (error) {
      console.error('❌ Error tracking synced variant:', error);
    }
  }

  // Main sync method
  async syncProducts(limit?: number) {
    console.log('🌟 Starting Shopify Product Sync Process');
    const startTime = Date.now();

    try {
      // Initialize the variant ID mapper
      await variantIdMappingService.initialize();
      
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
      // Generate file hash for caching
      const url = fileInput.originalSource;
      const contentType = fileInput.contentType as string || getMimeTypeFromUrl(url);
      const fileHash = generateFileHash(url, contentType);
      
      // Check if file is already cached in MongoDB
      const cachedFile = await mongoDBService.findFileByHash(fileHash);
      
      if (cachedFile) {        
        return cachedFile.shopifyFileId;
      }
      
      // File not in cache, proceed with upload to Shopify
      console.log(`File cache miss for ${url} - uploading to Shopify`);
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
      
      const fileId = response.fileCreate.files[0]?.id || null;
      
      // Cache the file information in MongoDB if upload was successful
      if (fileId) {
        await mongoDBService.saveFileMapping(fileHash, fileId, url, contentType);
        console.log(`Cached new file with hash ${fileHash} and Shopify ID ${fileId}`);
      }

      return fileId;
    } catch (error) {
        console.log('File Upload', error);
        return null;
    }
  }

  async uploadMultipleFiles(files: FileCreateInput[]): Promise<string[]> {
    try {
      const fileIds: string[] = [];
      
      // Process each file individually to leverage the caching in uploadFile
      for (const fileInput of files) {
        const fileId = await this.uploadFile(fileInput);
        if (fileId) {
          fileIds.push(fileId);
        }
      }
      
      return fileIds;
    } catch (error) {
        console.log('Multiple File Upload', error);
        return [];
    }
  }
  
  // Get variant ID mapping for a specific SKU
  async getVariantIdMapping(sku: string): Promise<string | null> {
    return variantIdMappingService.getShopifyVariantId(sku);
  }
  
  // Get all variant ID mappings for a product
  async getProductVariantMappings(productHandle: string): Promise<any[]> {
    return variantIdMappingService.getMappingsByProduct(productHandle);
  }
  
  // Get all variant ID mappings
  async getAllVariantMappings(): Promise<Record<string, any>> {
    return variantIdMappingService.getAllMappings();
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
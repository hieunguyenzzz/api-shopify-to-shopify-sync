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
import { productMappingService } from './product-mapping.service';
import { metaobjectMappingService } from './metaobject-mapping.service';
import mongoDBService from './mongodb.service';
import { generateFileHash, getMimeTypeFromUrl } from '../utils/file-hash.util';

// Load environment variables
dotenv.config();

export class ShopifyProductSyncService {
  private graphqlClient: GraphQLClient;
  private externalProductsApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'https://shopify-store-data-resolver.hieunguyen.dev';
    this.externalProductsApiUrl = `${externalApiBaseUrl}/api/products`;
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
      descriptionHtml: externalProduct.descriptionHtml.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design"),
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      status: externalProduct.status as ProductStatus,
      templateSuffix: externalProduct.templateSuffix,
      seo: {
        title: externalProduct.seo?.title?.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design") ?? '',
        description: externalProduct.seo?.description?.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design") ?? '',
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
    if (!productInput.metafields) {
      productInput.metafields = [];
    }
    
    // Skip global.images metafield processing
    
    // Add custom metafields
    this.addCustomTextMetafields(productInput, externalProduct);
    this.addRichTextMetafields(productInput, externalProduct);
    //this.addCustomNumberMetafields(productInput, externalProduct);
    await this.addCustomFileReferenceMetafields(productInput, externalProduct);
    this.addJudgemeMetafields(productInput, externalProduct);
    this.addSprMetafields(productInput, externalProduct);
    this.addYoastSeoMetafields(productInput, externalProduct);
    this.addGlobalMetafields(productInput, externalProduct);
    
    // Add special metaobject reference metafields that require ID mapping
    await this.addFaqMetaobjectReferences(productInput, externalProduct);
    await this.addFeatureContentMetaobjectReferences(productInput, externalProduct);
    await this.addProductRoomsFeaturesMetaobjectReference(productInput, externalProduct);
    await this.addCompanyLogoMetaobjectReferences(productInput, externalProduct);

    // Add special product reference metafields that require ID mapping
    await this.addProductReferenceMetafields(productInput, externalProduct);
  }

  // Add custom text-based metafields
  private addCustomTextMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const textMetafields = [
      { namespace: 'custom', key: 'description', type: 'multi_line_text_field' },
      { namespace: 'custom', key: 'menu_subtitle', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'menu_title', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'subtitle', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'embed360url', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'youtube_url', type: 'single_line_text_field' },
      { namespace: 'my_fields', key: 'dulux_suite', type: 'single_line_text_field' },
      { namespace: 'my_fields', key: 'explore_page_url', type: 'url' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of textMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        let value = metafieldData.value;
        
        // Replace Soundbox Store with Quell Design if present
        if (typeof value === 'string' && value.includes('Soundbox Store')) {
          value = value.replace('Soundbox Store', 'Quell Design').replace('Sound box Store', 'Quell Design');        
        }

        if (typeof value === 'string' && value.includes('soundboxstore.com')) {
          value = value.replace('soundboxstore.com', 'quelldesign.com');
        }
        
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value
        });
      }
    }
  }

  // Add rich text metafields
  private addRichTextMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const richTextMetafields = [
      { namespace: 'custom', key: 'additional_content', type: 'rich_text_field' },
      { namespace: 'custom', key: 'additional_heading', type: 'single_line_text_field' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of richTextMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        let value = metafieldData.value;
        
        // Replace Soundbox Store with Quell Design if present
        if (typeof value === 'string' && value.includes('Soundbox Store')) {
          value = value.replace(/Soundbox Store/g, 'Quell Design').replace(/Sound box Store/g, 'Quell Design');        
        }

        if (typeof value === 'string' && value.includes('soundboxstore.com')) {
          value = value.replace(/soundboxstore.com/g, 'quelldesign.com');
        }
        
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value
        });
      }
    }
  }

  // Add custom number metafields
  private addCustomNumberMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const numberMetafields = [
      { namespace: 'custom', key: 'seats', type: 'number_integer' },
      { namespace: 'seo', key: 'hidden', type: 'number_integer' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of numberMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value: metafieldData.value
        });
      }
    }
  }

  // Add custom file reference metafields
  private async addCustomFileReferenceMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const fileMetafields = [
      { namespace: 'custom', key: 'menu_image', type: 'file_reference' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of fileMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      // Check if metafieldData exists and has an originalValue (externalFileId)
      if (metafieldData && metafieldData.originalValue) {
        // Look up the mapping in MongoDB using the externalFileId
        const mapping = await mongoDBService.findFileByExternalId(metafieldData.originalValue);

        if (mapping && mapping.shopifyFileId) {
          // Use the shopifyFileId from the mapping as the value
          productInput.metafields.push({
            namespace: metafield.namespace,
            key: metafield.key,
            type: metafield.type,
            value: mapping.shopifyFileId // Use the mapped Shopify File ID
          });
          console.log(`✅ Mapped file reference for ${metafield.namespace}.${metafield.key}: ${mapping.shopifyFileId}`);
        } else {
          // Log a warning if no mapping is found
          console.warn(`⚠️ No file mapping found for externalFileId: ${metafieldData.originalValue} (namespace: ${metafield.namespace}, key: ${metafield.key})`);
          // Optionally: Fallback or error handling logic here
          // For now, we just skip adding this metafield if mapping is missing
        }
      } else if (metafieldData) {
          // Log if originalValue is missing
          console.warn(`⚠️ Missing originalValue for file reference metafield: ${metafield.namespace}.${metafield.key}`);
      }
    }
  }

  // Add JudgeMe metafields
  private addJudgemeMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const judgemeMetafields = [
      { namespace: 'judgeme', key: 'badge', type: 'string' },
      { namespace: 'judgeme', key: 'widget', type: 'string' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of judgemeMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value: metafieldData.value
        });
      }
    }
  }

  // Add SPR metafields
  private addSprMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const sprMetafields = [
      { namespace: 'spr', key: 'reviews', type: 'multi_line_text_field' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of sprMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        let value = metafieldData.value;
        
        // Replace Soundbox Store with Quell Design if present
        if (typeof value === 'string' && value.includes('Soundbox Store')) {
          value = value.replace('Soundbox Store', 'Quell Design');
        }
        
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value
        });
      }
    }
  }

  // Add Yoast SEO metafields
  private addYoastSeoMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const yoastMetafields = [
      { namespace: 'yoast_seo', key: 'indexable', type: 'json' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of yoastMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value: metafieldData.value
        });
      }
    }
  }

  // Add Global metafields
  private addGlobalMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): void {
    const globalMetafields = [
      { namespace: 'global', key: 'title_tag', type: 'multi_line_text_field' },
      { namespace: 'global', key: 'description_tag', type: 'string' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    for (const metafield of globalMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        let value = metafieldData.value;
        
        // Replace Soundbox Store with Quell Design if present
        if (typeof value === 'string' && value.includes('Soundbox Store')) {
          value = value.replace('Soundbox Store', 'Quell Design');
        }
        
        productInput.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value
        });
      }
    }
  }

  // Add product reference metafields
  private async addProductReferenceMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const upsellMetafieldKey = 'upsell_products';
    
    // Find the upsell_products metafield
    const upsellMetafield = externalProduct.metafields?.find(
      m => m.namespace === 'custom' && m.key === upsellMetafieldKey
    );

    if (!upsellMetafield) {
      return;
    }

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    try {
      // Parse the product IDs from the metafield value
      const externalProductIds: string[] = JSON.parse(upsellMetafield.value);
      
      // Map the external product IDs to Shopify product IDs
      const shopifyProductIds: string[] = [];
      
      // Ensure product mapping service is initialized
      await productMappingService.initialize();
      
      // For each external product ID, find the corresponding Shopify product ID
      for (const externalProductId of externalProductIds) {
        // Try different ways to extract the product ID
        // Method 1: Extract from gid://shopify/Product/1234567890 format
        const numericId = externalProductId.match(/\/Product\/(\d+)$/)?.[1];
        
        // Method 2: Use the ID directly if it's just a number
        const directId = externalProductId.match(/^(\d+)$/)?.[1];
        
        // Try to find the mapping using either method
        let shopifyProductId = null;
        
        if (numericId) {
          // Look up the mapping in MongoDB using product ID
          shopifyProductId = await productMappingService.getShopifyProductId(numericId);
        } 
        
        if (!shopifyProductId && directId) {
          // If not found by numeric ID, try direct ID
          shopifyProductId = await productMappingService.getShopifyProductId(directId);
        }
        
        // If still not found, try the full ID format (shown in MongoDB screenshot)
        if (!shopifyProductId) {
          const fullId = `gid://shopify/Product/${externalProductId.replace(/^gid:\/\/shopify\/Product\//, '')}`;
          shopifyProductId = await productMappingService.getShopifyProductId(fullId);
        }
        
        // If still not found, try the ID without any formatting
        if (!shopifyProductId) {
          const plainId = externalProductId.replace(/^gid:\/\/shopify\/Product\//, '');
          shopifyProductId = await productMappingService.getShopifyProductId(plainId);
        }
        
        if (shopifyProductId) {
          shopifyProductIds.push(shopifyProductId);
        } else {
          console.warn(`⚠️ No mapping found for external product ID: ${externalProductId}`);
          
          // Get all mappings and log them for debugging
          const allMappings = await productMappingService.getAllProductMappings();
          console.log(`📊 Available mappings: ${allMappings.length}`);
          if (allMappings.length > 0) {
            console.log(`📝 Sample mapping: externalProductId=${allMappings[0].externalProductId}, shopifyProductId=${allMappings[0].shopifyProductId}`);
          }
        }
      }
      
      // Add the metafield with the mapped product IDs if we found any
      if (shopifyProductIds.length > 0) {
        productInput.metafields.push({
          namespace: 'custom',
          key: upsellMetafieldKey,
          type: 'list.product_reference',
          value: JSON.stringify(shopifyProductIds)
        });
        
        console.log(`✅ Mapped ${shopifyProductIds.length}/${externalProductIds.length} products for upsell_products metafield`);
      } else {
        console.warn(`⚠️ No product mappings found for upsell_products metafield`);
      }
    } catch (error) {
      console.error('❌ Error processing upsell_products metafield:', error);
    }
  }

  // Add FAQ metaobject reference metafields
  private async addFaqMetaobjectReferences(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const faqMetafieldKey = 'faqs';
    
    // Find the faqs metafield
    const faqMetafield = externalProduct.metafields?.find(
      m => m.namespace === 'custom' && m.key === faqMetafieldKey
    );

    if (!faqMetafield) {
      return;
    }

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    try {
      // Parse the metaobject IDs from the metafield value
      const externalMetaobjectIds: string[] = JSON.parse(faqMetafield.value);
      
      // Map the external metaobject IDs to Shopify metaobject IDs
      const shopifyMetaobjectIds: string[] = [];
      
      // Ensure metaobject mapping service is initialized
      await metaobjectMappingService.initialize();
      
      // For each external metaobject ID, find the corresponding Shopify metaobject ID
      for (const externalMetaobjectId of externalMetaobjectIds) {
        // Extract the ID from the gid://shopify/Metaobject/1234567890 format
        const numericId = externalMetaobjectId.match(/\/Metaobject\/(\d+)$/)?.[1];
        
        // Try to find the mapping using the extracted ID
        let shopifyMetaobjectId = null;
        
        if (numericId) {
          // Look up the mapping in MongoDB using metaobject ID
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(numericId);
        }
        
        // If not found by numeric ID, try the full ID format
        if (!shopifyMetaobjectId) {
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
        }
        
        // If still not found, try the ID without any formatting
        if (!shopifyMetaobjectId) {
          const plainId = externalMetaobjectId.replace(/^gid:\/\/shopify\/Metaobject\//, '');
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(plainId);
        }
        
        if (shopifyMetaobjectId) {
          shopifyMetaobjectIds.push(shopifyMetaobjectId);
        } else {
          console.warn(`⚠️ No mapping found for external metaobject ID: ${externalMetaobjectId}`);
        }
      }
      
      // Add the metafield with the mapped metaobject IDs if we found any
      if (shopifyMetaobjectIds.length > 0) {
        productInput.metafields.push({
          namespace: 'custom',
          key: faqMetafieldKey,
          type: 'list.metaobject_reference',
          value: JSON.stringify(shopifyMetaobjectIds)
        });
        
        console.log(`✅ Mapped ${shopifyMetaobjectIds.length}/${externalMetaobjectIds.length} metaobjects for faqs metafield`);
      } else {
        console.warn(`⚠️ No metaobject mappings found for faqs metafield`);
      }
    } catch (error) {
      console.error('❌ Error processing faqs metafield:', error);
    }
  }

  // Add feature content metaobject reference metafields
  private async addFeatureContentMetaobjectReferences(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const featureContentMetafieldKey = 'feature_content';
    
    // Find the feature_content metafield
    const featureContentMetafield = externalProduct.metafields?.find(
      m => m.namespace === 'custom' && m.key === featureContentMetafieldKey
    );

    if (!featureContentMetafield) {
      return;
    }

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    try {
      // Parse the metaobject IDs from the metafield value
      const externalMetaobjectIds: string[] = JSON.parse(featureContentMetafield.value);
      
      // Map the external metaobject IDs to Shopify metaobject IDs
      const shopifyMetaobjectIds: string[] = [];
      
      // Ensure metaobject mapping service is initialized
      await metaobjectMappingService.initialize();
      
      // For each external metaobject ID, find the corresponding Shopify metaobject ID
      for (const externalMetaobjectId of externalMetaobjectIds) {
        // Extract the ID from the gid://shopify/Metaobject/1234567890 format
        const numericId = externalMetaobjectId.match(/\/Metaobject\/(\d+)$/)?.[1];
        
        // Try to find the mapping using the extracted ID
        let shopifyMetaobjectId = null;
        
        if (numericId) {
          // Look up the mapping in MongoDB using metaobject ID
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(numericId);
        }
        
        // If not found by numeric ID, try the full ID format
        if (!shopifyMetaobjectId) {
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
        }
        
        // If still not found, try the ID without any formatting
        if (!shopifyMetaobjectId) {
          const plainId = externalMetaobjectId.replace(/^gid:\/\/shopify\/Metaobject\//, '');
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(plainId);
        }
        
        if (shopifyMetaobjectId) {
          shopifyMetaobjectIds.push(shopifyMetaobjectId);
        } else {
          console.warn(`⚠️ No mapping found for external metaobject ID (feature_content): ${externalMetaobjectId}`);
        }
      }
      
      // Add the metafield with the mapped metaobject IDs if we found any
      if (shopifyMetaobjectIds.length > 0) {
        productInput.metafields.push({
          namespace: 'custom',
          key: featureContentMetafieldKey,
          type: 'list.metaobject_reference',
          value: JSON.stringify(shopifyMetaobjectIds)
        });
        
        console.log(`✅ Mapped ${shopifyMetaobjectIds.length}/${externalMetaobjectIds.length} metaobjects for ${featureContentMetafieldKey} metafield`);
      } else {
        console.warn(`⚠️ No metaobject mappings found for ${featureContentMetafieldKey} metafield`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${featureContentMetafieldKey} metafield:`, error);
    }
  }

  // Add product rooms features metaobject reference metafield
  private async addProductRoomsFeaturesMetaobjectReference(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const metafieldKey = 'product_rooms_features';
    const namespace = 'custom';
    
    // Find the metafield
    const metafieldData = externalProduct.metafields?.find(
      m => m.namespace === namespace && m.key === metafieldKey
    );

    if (!metafieldData || !metafieldData.value) {
      return; // Metafield not found or has no value
    }

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    try {
      const externalMetaobjectId = metafieldData.value;
      
      // Ensure metaobject mapping service is initialized
      await metaobjectMappingService.initialize();
      
      // Map the external metaobject ID to Shopify metaobject ID
      let shopifyMetaobjectId: string | null = null;
      
      // Extract the ID from the gid://shopify/Metaobject/1234567890 format
      const numericId = externalMetaobjectId.match(/\/Metaobject\/(\d+)$/)?.[1];
      
      if (numericId) {
        shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(numericId);
      }
      
      if (!shopifyMetaobjectId) {
        shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
      }
      
      if (!shopifyMetaobjectId) {
        const plainId = externalMetaobjectId.replace(/^gid:\/\/shopify\/Metaobject\//, '');
        shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(plainId);
      }
        
      if (shopifyMetaobjectId) {
        productInput.metafields.push({
          namespace: namespace,
          key: metafieldKey,
          type: 'metaobject_reference', // Single reference type
          value: shopifyMetaobjectId
        });
        console.log(`✅ Mapped metaobject reference for ${namespace}.${metafieldKey}: ${shopifyMetaobjectId}`);
      } else {
        console.warn(`⚠️ No mapping found for external metaobject ID (${namespace}.${metafieldKey}): ${externalMetaobjectId}`);
      }

    } catch (error) {
      console.error(`❌ Error processing ${namespace}.${metafieldKey} metafield:`, error);
    }
  }

  // Add company logo metaobject reference metafields
  private async addCompanyLogoMetaobjectReferences(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const metafieldKey = 'company_logo';
    const namespace = 'custom';
    
    // Find the metafield
    const metafieldData = externalProduct.metafields?.find(
      m => m.namespace === namespace && m.key === metafieldKey
    );

    if (!metafieldData || !metafieldData.value) {
      return; // Metafield not found or has no value
    }

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    try {
      // Parse the metaobject IDs from the metafield value
      const externalMetaobjectIds: string[] = JSON.parse(metafieldData.value);
      
      // Map the external metaobject IDs to Shopify metaobject IDs
      const shopifyMetaobjectIds: string[] = [];
      
      // Ensure metaobject mapping service is initialized
      await metaobjectMappingService.initialize();
      
      // For each external metaobject ID, find the corresponding Shopify metaobject ID
      for (const externalMetaobjectId of externalMetaobjectIds) {
        let shopifyMetaobjectId: string | null = null;
        const numericId = externalMetaobjectId.match(/\/Metaobject\/(\d+)$/)?.[1];
        
        if (numericId) {
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(numericId);
        }
        
        if (!shopifyMetaobjectId) {
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
        }
        
        if (!shopifyMetaobjectId) {
          const plainId = externalMetaobjectId.replace(/^gid:\/\/shopify\/Metaobject\//, '');
          shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(plainId);
        }
        
        if (shopifyMetaobjectId) {
          shopifyMetaobjectIds.push(shopifyMetaobjectId);
        } else {
          console.warn(`⚠️ No mapping found for external metaobject ID (${namespace}.${metafieldKey}): ${externalMetaobjectId}`);
        }
      }
      
      // Add the metafield with the mapped metaobject IDs if we found any
      if (shopifyMetaobjectIds.length > 0) {
        productInput.metafields.push({
          namespace: namespace,
          key: metafieldKey,
          type: 'list.metaobject_reference',
          value: JSON.stringify(shopifyMetaobjectIds)
        });
        
        console.log(`✅ Mapped ${shopifyMetaobjectIds.length}/${externalMetaobjectIds.length} metaobjects for ${namespace}.${metafieldKey} metafield`);
      } else {
        console.warn(`⚠️ No metaobject mappings found for ${namespace}.${metafieldKey} metafield`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${namespace}.${metafieldKey} metafield:`, error);
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
        const productHandle = productData.input.handle || '';
        const shopifyProductId = result.product.id;
        
        // Map variant IDs
        const variantCount = productData.input.variants?.length || 0;
        await this.mapProductVariantIds(shopifyProductId, productHandle, variantCount);
        
        // Create product mapping between external API and Shopify
        await this.createProductMapping(shopifyProductId, productHandle);
      }
      
      return result.product;
    } catch (error) {
      console.error('❌ Error syncing product to Shopify:', error);
      throw error;
    }
  }

  // Create product mapping between external API and Shopify
  private async createProductMapping(shopifyProductId: string, productHandle: string): Promise<void> {
    try {
      // Initialize product mapping service
      await productMappingService.initialize();
      
      // Check if mapping already exists for this product handle
      const existingMapping = await productMappingService.getMappingByHandle(productHandle);
      
      if (existingMapping) {
        console.log(`✅ Product mapping already exists for handle ${productHandle}. Skipping.`);
        return;
      }
      
      // Get external product data to create the mapping
      const externalProducts = await this.fetchExternalProducts();
      const externalProduct = externalProducts.find(p => p.handle === productHandle);
      
      if (!externalProduct) {
        console.warn(`⚠️ Could not find external product with handle ${productHandle}`);
        return;
      }
      
      // Create the product mapping
      await productMappingService.saveProductMapping({
        externalProductId: externalProduct.id,
        shopifyProductId,
        productHandle
      });
      
      console.log(`✅ Created product mapping for handle ${productHandle}`);
    } catch (error) {
      console.error('❌ Error creating product mapping:', error);
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
      // Initialize services
      await variantIdMappingService.initialize();
      await productMappingService.initialize();
      
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
        await mongoDBService.saveFileMapping(fileHash, fileId, '', url, contentType);
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
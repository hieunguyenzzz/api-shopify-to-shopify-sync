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
  PRODUCT_BY_IDENTIFIER_QUERY,
  PRODUCT_BY_ID_QUERY,
  FILE_CREATE_MUTATION,
  PRODUCT_WITH_VARIANTS_QUERY,
  COLLECTION_PUBLISH_MUTATION
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { variantIdMappingService } from './variant-id-mapping.service';
import { productMappingService } from './product-mapping.service';
import { metaobjectMappingService } from './metaobject-mapping.service';
import mongoDBService from './mongodb.service';
import { generateFileHash, getMimeTypeFromUrl } from '../utils/file-hash.util';
import crypto from 'crypto';
import { openAIService } from './openai.service';

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

  // Generate a hash for a product based on its properties
  private generateProductHash(product: ExternalProduct): string {
    // Create a stable representation of variants
    let variantsString = 'null';
    if (product.variants && product.variants.length > 0) {
      const sortedVariants = [...product.variants].sort((a, b) => {
        if (a.sku !== b.sku) return a.sku.localeCompare(b.sku);
        // Convert prices to numbers before comparing
        const priceA = typeof a.price === 'string' ? parseFloat(a.price) : a.price;
        const priceB = typeof b.price === 'string' ? parseFloat(b.price) : b.price;
        return priceA - priceB;
      });
      
      variantsString = sortedVariants.map(v => {
        const optionsString = v.selectedOptions
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(o => `${o.name}:${o.value}`)
          .join('|');
        
        return `${v.sku}|${v.price}|${v.compareAtPrice || ''}|${optionsString}`;
      }).join(';');
    }

    // Create a stable representation of options
    let optionsString = 'null';
    if (product.options && product.options.length > 0) {
      optionsString = product.options
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(o => {
          const sortedValues = [...o.values].sort();
          return `${o.name}:${sortedValues.join('|')}`;
        })
        .join(';');
    }

    // Create a stable representation of images
    let imagesString = 'null';
    if (product.images && product.images.length > 0) {
      imagesString = product.images
        .map(img => img.url)
        .sort()
        .join('|');
    }

    // Create a stable representation of metafields
    let metafieldsString = 'null';
    if (product.metafields && product.metafields.length > 0) {
      metafieldsString = product.metafields
        .sort((a, b) => {
          if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
          return a.key.localeCompare(b.key);
        })
        .map(m => `${m.namespace}:${m.key}:${m.value}`)
        .join('|');
    }

    // Create a stable representation of variant metafields
    let variantMetafieldsString = 'null';
    if (product.variants && product.variants.length > 0) {
      const variantsWithMetafields = product.variants.filter(v => v.metafields && v.metafields.length > 0);
      
      if (variantsWithMetafields.length > 0) {
        variantMetafieldsString = variantsWithMetafields
          .sort((a, b) => a.sku.localeCompare(b.sku))
          .map(variant => {
            const sortedMetafields = variant.metafields
              .sort((a, b) => {
                if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
                return a.key.localeCompare(b.key);
              })
              .map(m => `${m.namespace}:${m.key}:${m.value}`)
              .join('~');
            
            return `${variant.sku}:${sortedMetafields}`;
          })
          .join(';');
      }
    }

    // Combine core product data and additional components
    const productData = [
      product.title,
      product.handle,
      product.descriptionHtml,
      product.productType,
      product.vendor,
      product.tags.sort().join(','),
      product.status,
      product.templateSuffix,
      product.seo?.title || '',
      product.seo?.description || '',
      variantsString,
      optionsString,
      imagesString,
      metafieldsString,
      variantMetafieldsString
    ].join('|');

    return crypto.createHash('md5').update(productData).digest('hex');
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
  async checkProductByHandle(handle: string): Promise<Product | null> {
    try {
      console.log(`🔍 Checking for existing product with handle: ${handle}`);
      
      const response = await this.graphqlClient.request<{
        productByIdentifier: Product
      }>(
        PRODUCT_BY_IDENTIFIER_QUERY, 
        { 
          identifier: { 
            handle 
          }
        }
      );

      const existingProduct = response.productByIdentifier;
      
      if (existingProduct) {
        console.log(`✅ Found existing product by handle: ${existingProduct.title} (ID: ${existingProduct.id})`);
        return existingProduct;
      }
      
      console.log(`❌ No product found with handle: ${handle}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking product by handle:', error);
      throw error;
    }
  }

  // Check if product exists by handle
  async checkProductByShopifyId(productId: string): Promise<Product | null> {
    try {
      console.log(`🔍 Checking for existing product with Shopify ID: ${productId}`);
      
      const response = await this.graphqlClient.request<{
        product: Product
      }>(
        PRODUCT_BY_ID_QUERY, 
        { id: productId }
      );

      const existingProduct = response.product;
      
      if (existingProduct) {
        console.log(`✅ Found existing product: ${existingProduct.title} (ID: ${existingProduct.id})`);
        return existingProduct;
      }
      
      console.log(`❌ No product found with Shopify ID: ${productId}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking product by Shopify ID:', error);
      throw error;
    }
  }

  async checkProductByExternalId(externalProductId: string): Promise<Product | null> {
    try {
      console.log(`🗺️ Looking up Shopify ID for external product ID: ${externalProductId}`);
      await productMappingService.initialize(); // Ensure service is initialized
      const shopifyId = await productMappingService.getShopifyProductId(externalProductId);

      if (shopifyId) {
        console.log(`✅ Found mapping: External ID ${externalProductId} -> Shopify ID ${shopifyId}`);
        return this.checkProductByShopifyId(shopifyId);
      }
      
      console.log(`❌ No mapping found for external product ID: ${externalProductId}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking product by external ID:', error);
      throw error;
    }
  }

  // Main function to prepare product data
  async prepareProductData(externalProduct: ExternalProduct): Promise<MutationProductSetArgs> {
    console.log(`🔧 Preparing product for sync: ${externalProduct.title}`);
    
    // Check if product already exists using external ID
    let existingProduct = await this.checkProductByExternalId(externalProduct.id);
    
    // If no product found by external ID, check by handle
    if (!existingProduct && externalProduct.handle) {
      console.log(`🔍 No product found by external ID, checking by handle: ${externalProduct.handle}`);
      existingProduct = await this.checkProductByHandle(externalProduct.handle);
    }
    
    // Create base product input
    const productInput = await this.createBaseProductInput(externalProduct, existingProduct);
    
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
  private async createBaseProductInput(externalProduct: ExternalProduct, existingProduct: Product | null): Promise<ProductSetInput> {
    console.log(`🔄 Preparing base product data for ${externalProduct.title}...`);
    
    // Process title with OpenAI
    let title = externalProduct.title;
    if (title && title.length > 0) {
      // Replace 'Coworker' with 'Quell+' (case insensitive)
      if (title.match(/coworker/i)) {
        title = title.replace(/coworker/gi, 'Quell+');
        console.log(`✅ Replaced 'Coworker' with 'Quell+' in title`);
      }

      if (title.includes('Soundbox') || title.includes('Kabine')) {
        try {
          console.log(`🔄 Rewriting product title...`);
          title = await openAIService.rewriteContent(title);
          console.log(`✅ Successfully rewrote product title`);
        } catch (error) {
          console.error(`❌ Error rewriting product title:`, error);
          // Fall back to manual replacement
          title = title.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design").replace(/Kabine/g, "Kozee");
        }
      }
    }
    
    // Process description with OpenAI
    let descriptionHtml = externalProduct.descriptionHtml;
    if (descriptionHtml && descriptionHtml.length > 0) {
      // Replace 'Coworker' with 'Quell+' (case insensitive)
      if (descriptionHtml.match(/coworker/i)) {
        descriptionHtml = descriptionHtml.replace(/coworker/gi, 'Quell+');
        console.log(`✅ Replaced 'Coworker' with 'Quell+' in description`);
      }

      try {
        console.log(`🔄 Rewriting product description...`);
        const prompt = 'Rewrite the following HTML product description with some changes to wording while preserving all HTML tags and structure exactly. Replace any occurrence of "Kabine" with "Kozee", "Soundbox Store" with "Quell Design", and "Coworker" with "Quell+". Do not modify any URLs, IDs, or product specifications. Only provide the rewritten text without any explanations.';
        descriptionHtml = await openAIService.rewriteContent(descriptionHtml, prompt);
        console.log(`✅ Successfully rewrote product description`);
      } catch (error) {
        console.error(`❌ Error rewriting product description:`, error);
        // Fall back to manual replacement
        descriptionHtml = descriptionHtml.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design");
      }
    }
    
    // Process SEO content with OpenAI
    let seoTitle = externalProduct.seo?.title ?? '';
    let seoDescription = externalProduct.seo?.description ?? '';
    
    if (seoTitle && seoTitle.length > 0) {
      try {
        console.log(`🔄 Rewriting SEO title...`);
        seoTitle = await openAIService.rewriteContent(seoTitle);
        console.log(`✅ Successfully rewrote SEO title`);
      } catch (error) {
        console.error(`❌ Error rewriting SEO title:`, error);
        seoTitle = seoTitle.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design");
      }
    }
    
    if (seoDescription && seoDescription.length > 0) {
      try {
        console.log(`🔄 Rewriting SEO description...`);
        seoDescription = await openAIService.rewriteContent(seoDescription);
        console.log(`✅ Successfully rewrote SEO description`);
      } catch (error) {
        console.error(`❌ Error rewriting SEO description:`, error);
        seoDescription = seoDescription.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design");
      }
    }

    const productInput: ProductSetInput = {
      title,
      handle: externalProduct.handle,
      descriptionHtml,
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      status: externalProduct.status as ProductStatus,
      templateSuffix: externalProduct.templateSuffix,
      seo: {
        title: seoTitle,
        description: seoDescription,
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
    // Process images metafield
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
      } catch (error) {
        console.error(`❌ Error processing variant ${variant.sku} global.images metafield:`, error);
      }
    }

    // Initialize metafields array if needed
    if (!variantData.metafields) {
      variantData.metafields = [];
    }

    // Process simple string and number_decimal metafields
    //await this.processSimpleVariantMetafields(variantData, variant);
    
    // Process bundle variant reference metafield
    await this.processBundleVariantReference(variantData, variant);
  }

  // Process simple string and number_decimal metafields for variants
  private async processSimpleVariantMetafields(variantData: ProductVariantSetInput, variant: any): Promise<void> {
    if (!variant.metafields) return;

    // Define supported metafields with their types
    const simpleMetafields = [
      { namespace: 'global', key: 'harmonized_system_code', type: 'string' },
      { namespace: 'global', key: 'stock', type: 'number_decimal' },
      // Delivery fee metafields for different regions
      { namespace: 'global', key: 'delivery-fee-AT', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-BE', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-CH', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-DE', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-DK', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-ES', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-eur', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-FR', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-GB', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-gbp', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-IT', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-NL', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-NO', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-nok', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-PT', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-SE', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-sek', type: 'number_decimal' },
      { namespace: 'global', key: 'delivery-fee-IE', type: 'number_decimal' }
    ];

    // Also detect any delivery-fee-* metafields dynamically
    const deliveryFeeRegex = /^delivery-fee-/;
    const dynamicDeliveryFees = variant.metafields
      .filter((m: any) => m.namespace === 'global' && deliveryFeeRegex.test(m.key))
      .map((m: any) => ({ namespace: 'global', key: m.key, type: 'number_decimal' }));

    // Combine predefined and dynamically discovered metafields
    const allMetafields = [...simpleMetafields, ...dynamicDeliveryFees];

    // Process each metafield
    for (const metafield of allMetafields) {
      const metafieldData = variant.metafields.find(
        (m: any) => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData) {
        if (!variantData.metafields) {
          variantData.metafields = [];
        }
        
        variantData.metafields.push({
          namespace: metafield.namespace,
          key: metafield.key,
          type: metafield.type,
          value: metafieldData.value
        });
      }
    }
  }

  // Process bundle variant reference metafield
  private async processBundleVariantReference(variantData: ProductVariantSetInput, variant: any): Promise<void> {
    if (!variant.metafields) return;

    // Find the bundle metafield
    const bundleMetafield = variant.metafields.find(
      (m: any) => m.namespace === 'custom' && m.key === 'bundle'
    );

    if (!bundleMetafield) return;

    try {
      // Parse the variant IDs from the metafield value
      const externalVariantIds: string[] = JSON.parse(bundleMetafield.value);
      
      // Map the external variant IDs to Shopify variant IDs
      const shopifyVariantIds: string[] = [];
      
      // Ensure variant ID mapping service is initialized
      await variantIdMappingService.initialize();
      
      // For each external variant ID, find the corresponding Shopify variant ID
      for (const externalVariantId of externalVariantIds) {
        // Extract the ID from the gid://shopify/ProductVariant/1234567890 format
        const numericId = externalVariantId.match(/\/ProductVariant\/(\d+)$/)?.[1];
        
        // Try to find the mapping using the extracted ID
        let shopifyVariantId = null;
        
        if (numericId) {
          // Look up the mapping in using variant ID
          shopifyVariantId = await variantIdMappingService.getShopifyVariantId(numericId);
        }
        
        // If not found by numeric ID, try the full ID format
        if (!shopifyVariantId) {
          // Try using the external ID (if service has a method to look up by external ID)
          const mappings = await variantIdMappingService.getAllMappings();
          const mapping = Object.values(mappings).find((m: any) => 
            m.externalVariantId === externalVariantId);
          
          if (mapping) {
            shopifyVariantId = mapping.shopifyVariantId;
          }
        }
        
        // If still not found, try the ID without any formatting
        if (!shopifyVariantId) {
          const plainId = externalVariantId.replace(/^gid:\/\/shopify\/ProductVariant\//, '');
          shopifyVariantId = await variantIdMappingService.getShopifyVariantId(plainId);
        }
        
        if (shopifyVariantId) {
          shopifyVariantIds.push(shopifyVariantId);
        } else {
          console.warn(`⚠️ No mapping found for external variant ID: ${externalVariantId}`);
        }
      }
      
      // Add the metafield with the mapped variant IDs if we found any
      if (shopifyVariantIds.length > 0) {
        if (!variantData.metafields) {
          variantData.metafields = [];
        }
        
        variantData.metafields.push({
          namespace: 'custom',
          key: 'bundle',
          type: 'list.variant_reference',
          value: JSON.stringify(shopifyVariantIds)
        });
        
        console.log(`✅ Mapped ${shopifyVariantIds.length}/${externalVariantIds.length} variants for bundle metafield`);
      } else {
        console.warn(`⚠️ No variant mappings found for bundle metafield`);
      }
    } catch (error) {
      console.error(`❌ Error processing bundle metafield:`, error);
    }
  }

  // Process product metafields
  private async processProductMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    if (!productInput.metafields) {
      productInput.metafields = [];
    }
    
    // Skip global.images metafield processing
    
    // Add custom metafields
    await this.addCustomTextMetafields(productInput, externalProduct);
    await this.addRichTextMetafields(productInput, externalProduct);
    this.addCustomNumberMetafields(productInput, externalProduct);
    await this.addCustomFileReferenceMetafields(productInput, externalProduct);
    await this.addSprMetafields(productInput, externalProduct);
    this.addJudgemeMetafields(productInput, externalProduct);
    this.addYoastSeoMetafields(productInput, externalProduct);
    await this.addGlobalMetafields(productInput, externalProduct);
    
    // Add special metaobject reference metafields that require ID mapping
    await this.addFaqMetaobjectReferences(productInput, externalProduct);
    await this.addFeatureContentMetaobjectReferences(productInput, externalProduct);
    await this.addProductRoomsFeaturesMetaobjectReference(productInput, externalProduct);
    await this.addCompanyLogoMetaobjectReferences(productInput, externalProduct);
    await this.addAcousticEnvironmentMetaobjectReference(productInput, externalProduct);

    // Add special product reference metafields that require ID mapping
    await this.addProductReferenceMetafields(productInput, externalProduct);
    
    // Add page reference metafields
    await this.addPageReferenceMetafields(productInput, externalProduct);
  }

  // Add custom text-based metafields
  private async addCustomTextMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const textMetafields = [
      { namespace: 'custom', key: 'description', type: 'multi_line_text_field' },
      { namespace: 'custom', key: 'menu_subtitle', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'menu_title', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'subtitle', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'embed360url', type: 'single_line_text_field' },
      { namespace: 'custom', key: 'youtube_url', type: 'single_line_text_field' },
      { namespace: 'my_fields', key: 'dulux_suite', type: 'single_line_text_field' },
      { namespace: 'my_fields', key: 'explore_page_url', type: 'url' },
      { namespace: 'custom', key: 'ticks_content', type: 'multi_line_text_field' }
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
        
        // Only rewrite content if it's a string and not a URL or embed URL
        if (typeof value === 'string' && 
            !metafield.key.includes('url') && 
            !metafield.type.includes('url')) {
          try {
            console.log(`🔄 Rewriting content for ${metafield.namespace}.${metafield.key}...`);
            value = await openAIService.rewriteContent(value);
            console.log(`✅ Successfully rewrote content for ${metafield.namespace}.${metafield.key}`);
          } catch (error) {
            console.error(`❌ Error rewriting content for ${metafield.namespace}.${metafield.key}:`, error);
            // Fall back to manual replacement if OpenAI fails
            if (value.includes('Soundbox Store')) {
              value = value.replace(/Soundbox Store/g, 'Quell Design').replace(/Sound box Store/g, 'Quell Design');
            }
            if (value.includes('soundboxstore.com')) {
              value = value.replace(/soundboxstore.com/g, 'quelldesign.com');
            }
          }
        } else if (typeof value === 'string') {
          // For URLs, just do simple replacement
          if (value.includes('soundboxstore.com')) {
            value = value.replace(/soundboxstore.com/g, 'quelldesign.com');
          }
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
  private async addRichTextMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
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
        
        if (typeof value === 'string') {
          try {
            console.log(`🔄 Rewriting content for ${metafield.namespace}.${metafield.key}...`);
            // Use a special prompt for rich text to preserve HTML structure
            const prompt = 'Rewrite the following HTML/rich text content with some changes to wording while preserving all HTML tags and structure exactly. Replace any occurrence of "Kabine" with "Kozee" and "Soundbox Store" with "Quell Design". Do not modify any URLs or IDs. Only provide the rewritten text without any explanations.';
            // value = await openAIService.rewriteContent(value, prompt);
            console.log(`✅ Successfully rewrote content for ${metafield.namespace}.${metafield.key}`);
          } catch (error) {
            console.error(`❌ Error rewriting content for ${metafield.namespace}.${metafield.key}:`, error);
            // Fall back to manual replacement if OpenAI fails
            if (value.includes('Soundbox Store')) {
              value = value.replace(/Soundbox Store/g, 'Quell Design').replace(/Sound box Store/g, 'Quell Design');
            }
            if (value.includes('soundboxstore.com')) {
              value = value.replace(/soundboxstore.com/g, 'quelldesign.com');
            }
          }
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
      { namespace: 'custom', key: 'seats', type: 'single_line_text_field' },
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
  private async addSprMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
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
        
        // Only process if it's a string with content
        if (typeof value === 'string' && value.trim().length > 0) {
          try {
            console.log(`🔄 Rewriting content for ${metafield.namespace}.${metafield.key}...`);
            value = await openAIService.rewriteContent(value);
            console.log(`✅ Successfully rewrote content for ${metafield.namespace}.${metafield.key}`);
          } catch (error) {
            console.error(`❌ Error rewriting content for ${metafield.namespace}.${metafield.key}:`, error);
            // Fall back to manual replacement if OpenAI fails
            if (value.includes('Soundbox Store')) {
              value = value.replace(/Soundbox Store/g, 'Quell Design');
            }
          }
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
  private async addGlobalMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
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
        
        if (typeof value === 'string' && value.trim().length > 0) {
          try {
            console.log(`🔄 Rewriting content for ${metafield.namespace}.${metafield.key}...`);
            value = await openAIService.rewriteContent(value);
            console.log(`✅ Successfully rewrote content for ${metafield.namespace}.${metafield.key}`);
          } catch (error) {
            console.error(`❌ Error rewriting content for ${metafield.namespace}.${metafield.key}:`, error);
            // Fall back to manual replacement if OpenAI fails
            if (value.includes('Soundbox Store')) {
              value = value.replace(/Soundbox Store/g, 'Quell Design');
            }
          }
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

  // Add acoustic environment metaobject reference metafield
  private async addAcousticEnvironmentMetaobjectReference(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const metafieldKey = 'acoustic_environment_next';
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

  // Process images metafield and look up file IDs from MongoDB mapping using external GIDs
  private async processImagesMetafield(imagesMetafield: any): Promise<string[]> {
    // Log the input metafield for debugging
  
    const shopifyFileIds: string[] = [];

    // Use originalValue, assuming it contains source store GIDs
    if (!imagesMetafield || !imagesMetafield.originalValue) {
      console.warn('⚠️ Images metafield is missing or has no originalValue. Cannot perform lookup.');
      return [];
    }

    try {
      // Parse the external media GIDs (source store GIDs) from the originalValue field
      const externalMediaGids: string[] = JSON.parse(imagesMetafield.originalValue);
      console.log(`Parsed ${externalMediaGids.length} external GIDs from originalValue.`);

      // Ensure MongoDBService is initialized
      await mongoDBService.initialize();

      // Look up each external GID in the MongoDB mapping
      for (const externalGid of externalMediaGids) {
        if (!externalGid || typeof externalGid !== 'string') {
          console.warn(`⚠️ Invalid external GID found: ${externalGid}. Skipping.`);
          continue;
        }
        
        // Use findFileByExternalId to find the mapping based on the source GID
        console.log(`   Looking up external GID: ${externalGid}`);
        const mapping = await mongoDBService.findFileByExternalId(externalGid);

        if (mapping && mapping.shopifyFileId) {
          shopifyFileIds.push(mapping.shopifyFileId);
          console.log(`   ✅ Found mapping: ${externalGid} -> ${mapping.shopifyFileId}`);
        } else {
          console.warn(`   ⚠️ No file mapping found for external GID: ${externalGid}`);
          // Do not upload - just report missing mapping
        }
      }

      console.log(`✅ Finished lookup. Found ${shopifyFileIds.length}/${externalMediaGids.length} file IDs from mapping.`);
      return shopifyFileIds;

    } catch (error) {
      console.error(`❌ Error processing images metafield lookup:`, error);
      if (error instanceof SyntaxError) {
          console.error(`   ⚠️ Check if originalValue is valid JSON: ${imagesMetafield.originalValue}`);
      }
      console.error(`   Metafield details: ${JSON.stringify(imagesMetafield)}`);
      return []; // Return empty array on error
    }
  }

  // Resolve and sync product to Shopify
  async syncProduct(productData: MutationProductSetArgs, externalProduct: ExternalProduct): Promise<any> {
    try {
      console.log(`🚀 Syncing product to Shopify: ${productData.input.title}`);    
      if ( productData.input.title == 'Access Meeting Booth - Large') {
        let a = 1
      }

      const response = await this.graphqlClient.request<{
        productSet: ProductSetPayload
      }>(
        PRODUCT_SET_MUTATION, 
        {...productData, synchronous: true}
      );

      const result = response.productSet;

      if (result.userErrors && result.userErrors.length > 0) {
        // Iterate through errors to find and remove potentially invalid file mappings
        for (const err of result.userErrors) {
          const match = err.message.match(/Value references non-existent resource (gid:\\\/\\\/shopify\\\/MediaImage\\\/\d+)/);
          if (match && match[1]) {
            const invalidShopifyId = match[1];
            console.warn(`Detected non-existent resource error for Shopify ID: ${invalidShopifyId}`);
            // Attempt to remove the invalid mapping from MongoDB
            await mongoDBService.deleteMappingByShopifyId(invalidShopifyId);
          }
        }
        
        const errorMessage = result.userErrors.map((err: { message: string }) => err.message).join(', ');
        console.error(`❌ Sync error for product ${productData.input.title}: ${errorMessage}`);
        throw new Error(errorMessage);
      }
      
      // Get the synced product with variants to map IDs
      if (result.product?.id) {
        const productHandle = productData.input.handle || '';
        const shopifyProductId = result.product.id;
        
        // Generate product hash
        const productHash = this.generateProductHash(externalProduct);
        
        // Map variant IDs
        const variantCount = productData.input.variants?.length || 0;
        await this.mapProductVariantIds(shopifyProductId, productHandle, variantCount);
        
        // Create product mapping between external API and Shopify
        // Check if a mapping already exists with this external product ID
        await productMappingService.initialize();
        const existingMapping = await productMappingService.getMappingByExternalProductId(externalProduct.id);
        
        // If no mapping exists, create one (this handles both new products and products found by handle)
        if (!existingMapping) {
          await this.createProductMapping(shopifyProductId, productHandle, productHash, externalProduct.id);
        } else {
          // Update the existing mapping with the new hash
          await productMappingService.saveProductMapping({
            externalProductId: externalProduct.id,
            shopifyProductId,
            productHandle,
            productHash
          });
          console.log(`✅ Updated product mapping for handle ${productHandle} with hash ${productHash}`);
        }
        
        // Publish the product
        const publishResult = await this.publishProduct(shopifyProductId);
        if (!publishResult) {
          console.warn(`⚠️ Failed to publish product ${productData.input.title} (ID: ${shopifyProductId}), but product was synced successfully.`);
        }
      }
      
      return result.product;
    } catch (error) {
      console.error('❌ Error syncing product to Shopify:', error);
      throw error;
    }
  }

  // Create product mapping between external API and Shopify
  private async createProductMapping(
    shopifyProductId: string, 
    productHandle: string, 
    productHash: string, 
    externalProductId: string
  ): Promise<void> {
    try {
      // Initialize product mapping service
      await productMappingService.initialize();
      
      // Create the product mapping
      await productMappingService.saveProductMapping({
        externalProductId,
        shopifyProductId,
        productHandle,
        productHash
      });
      
      console.log(`✅ Created product mapping for handle ${productHandle} with hash ${productHash}`);
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
          // Use variant's unique identifier - in this case, we're using the product's external ID 
          // combined with the SKU as there's no specific variant ID in the external system
          await this.trackSyncedVariant(
            externalVariant.id,
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

  // Publish a product to the specified publication
  async publishProduct(shopifyProductId: string): Promise<boolean> {
    try {
      console.log(`📢 Publishing product to publication: ${shopifyProductId}`);
      
      // Define the interface for the response
      interface ProductPublishResponse {
        publishablePublish: {
          publishable: {
            publishedOnPublication: boolean;
          } | null;
          shop: {
            id: string;
          };
          userErrors: Array<{
            field: string;
            message: string;
          }>;
        }
      }
      
      const response = await this.graphqlClient.request<ProductPublishResponse>(
        COLLECTION_PUBLISH_MUTATION,
        { id: shopifyProductId }
      );

      if (response.publishablePublish.userErrors?.length > 0) {
        console.error(`❌ Shopify API Error publishing product ${shopifyProductId}:`, 
                     response.publishablePublish.userErrors);
        return false;
      }

      if (!response.publishablePublish.publishable) {
        console.error(`❌ Shopify API returned null publishable after publishing product ${shopifyProductId}`);
        return false;
      }

      const publishedOnPublication = response.publishablePublish.publishable.publishedOnPublication;
      console.log(`✅ Successfully published product ${shopifyProductId}. Published on publication: ${publishedOnPublication}`);
      return true;
    } catch (error) {
      console.error(`❌ Error publishing product ${shopifyProductId}:`, error);
      return false;
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
      const skippedProducts = [];
      
      for (const [index, product] of productsToSync.entries()) {
        
        console.log(`\n📍 Processing Product ${index + 1}/${productsToSync.length}`);
        
        try {
          // Generate hash for the current product
          const productHash = this.generateProductHash(product);
          
          // Check if we already have this product with the same hash, using externalProductId
          const existingMapping = await productMappingService.getMappingByExternalProductId(product.id);
          
          if (existingMapping && existingMapping.productHash === productHash) {
            console.log(`⏭️ Skipping product ${product.title} - no changes detected (hash: ${productHash})`);
            skippedProducts.push(product);
            continue;
          } else if (existingMapping) {
            console.log(`🔄 Product ${product.title} has changed - updating (old hash: ${existingMapping.productHash}, new hash: ${productHash})`);
          } else {
            console.log(`🆕 New product detected: ${product.title} (hash: ${productHash})`);
          }
          
          // Proceed with syncing the product
          const preparedProductData = await this.prepareProductData(product);
          const syncedProduct = await this.syncProduct(preparedProductData, product);
          syncResults.push(syncedProduct);
        } catch (productSyncError) {
          console.error(`❌ Failed to sync product ${product.title}`, productSyncError);
        }
      }

      const endTime = Date.now();
      console.log(`\n🏁 Sync Complete
- Total Products: ${productsToSync.length}
- Successfully Synced: ${syncResults.length}
- Skipped (No Changes): ${skippedProducts.length}
- Failed Products: ${productsToSync.length - syncResults.length - skippedProducts.length}
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

  // Add page reference metafields
  private async addPageReferenceMetafields(productInput: ProductSetInput, externalProduct: ExternalProduct): Promise<void> {
    const pageReferenceMetafields = [
      { namespace: 'custom', key: 'page360', type: 'page_reference' }
    ];

    if (!productInput.metafields) {
      productInput.metafields = [];
    }

    // Import the page mapping service
    const { pageMappingService } = await import('./page-mapping.service');

    // Ensure page mapping service is initialized
    await pageMappingService.initialize();

    for (const metafield of pageReferenceMetafields) {
      const metafieldData = externalProduct.metafields?.find(
        m => m.namespace === metafield.namespace && m.key === metafield.key
      );

      if (metafieldData && metafieldData.value) {
        try {
          // Extract the ID from the gid://shopify/Page/1234567890 format
          const numericId = metafieldData.value.match(/\/Page\/(\d+)$/)?.[1];
          
          // Try to find the mapping using the extracted ID
          let shopifyPageId: string | null = null;
          
          if (numericId) {
            // Look up the mapping in MongoDB using page ID
            shopifyPageId = await pageMappingService.getShopifyPageId(numericId);
          }
          
          // If not found by numeric ID, try the full ID format
          if (!shopifyPageId) {
            shopifyPageId = await pageMappingService.getShopifyPageId(metafieldData.value);
          }
          
          // If still not found, try the ID without any formatting
          if (!shopifyPageId) {
            const plainId = metafieldData.value.replace(/^gid:\/\/shopify\/Page\//, '');
            shopifyPageId = await pageMappingService.getShopifyPageId(plainId);
          }
          
          if (shopifyPageId) {
            productInput.metafields.push({
              namespace: metafield.namespace,
              key: metafield.key,
              type: metafield.type,
              value: shopifyPageId
            });
            console.log(`✅ Mapped page reference for ${metafield.namespace}.${metafield.key}: ${shopifyPageId}`);
          } else {
            console.warn(`⚠️ No mapping found for external page ID: ${metafieldData.value}`);
          }
        } catch (error) {
          console.error(`❌ Error processing ${metafield.namespace}.${metafield.key} metafield:`, error);
        }
      }
    }
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
import axios from 'axios';
import { 
  MutationProductSetArgs, 
  ProductSetInput 
} from '../types/shopify-generated';
import { ExternalProduct } from '../types/shopify-sync';

export class ShopifyProductSyncService {
  private shopifyAccessToken: string;
  private shopifyShopUrl: string;

  constructor() {
    this.shopifyAccessToken = process.env.SHOPIFY_TOKEN || '';
    this.shopifyShopUrl = process.env.SHOPIFY_APP_URL || '';
  }

  // Fetch products from external API
  async fetchExternalProducts(): Promise<ExternalProduct[]> {
    try {
      const response = await axios.get('https://shopify-store-data-resolver.hieunguyen.dev/api/products');
      return response.data.products;
    } catch (error) {
      console.error('Error fetching external products:', error);
      throw error;
    }
  }

  // Prepare data for Shopify product set mutation
  prepareProductData(externalProduct: ExternalProduct): MutationProductSetArgs {
    const productInput: ProductSetInput = {
      id: externalProduct.id,
      title: externalProduct.title,
      descriptionHtml: externalProduct.description,
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      productOptions: externalProduct.options?.map(option => ({
        name: option.name,
        values: option.values.map(value => ({
          name: value,
          id: value
        }))
      })),
    };

    // Handle variants if exists
    if (externalProduct.variants && externalProduct.variants.length > 0) {
      productInput.variants = externalProduct.variants.map((variant, index) => ({
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        optionValues: externalProduct.options 
          ? externalProduct.options.map((option, optionIndex) => ({
              name: option.name,
              value: option.values[index] || option.values[0]
            }))
          : []
      }));
    }

    return { input: productInput };
  }

  // Resolve and sync product to Shopify
  async resolveProductSync(productData: MutationProductSetArgs) {
    try {
      const graphqlEndpoint = `https://${this.shopifyShopUrl}/admin/api/2025-01/graphql.json`;
      
      const mutation = `
        mutation productSet($input: ProductInput!) {
          productSet(input: $input) {
            product {
              id
              title
              productType
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await axios.post(
        graphqlEndpoint,
        {
          query: mutation,
          variables: productData
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.shopifyAccessToken
          }
        }
      );

      const result = response.data.data.productSet;

      if (result.userErrors && result.userErrors.length > 0) {
        throw new Error(result.userErrors.map((err: any) => err.message).join(', '));
      }

      return result.product;
    } catch (error) {
      console.error('Error syncing product to Shopify:', error);
      throw error;
    }
  }

  // Main sync method
  async syncProducts() {
    try {
      // Fetch external products
      const externalProducts = await this.fetchExternalProducts();

      // Sync each product
      const syncResults = [];
      for (const product of externalProducts) {
        const preparedProductData = this.prepareProductData(product);
        const syncedProduct = await this.resolveProductSync(preparedProductData);
        syncResults.push(syncedProduct);
      }

      return syncResults;
    } catch (error) {
      console.error('Complete product sync failed:', error);
      throw error;
    }
  }
}

// Export an instance for easy use
export const shopifyProductSyncService = new ShopifyProductSyncService(); 
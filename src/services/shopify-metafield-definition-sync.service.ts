import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import axios from 'axios';

// TypeScript interfaces for metafield definitions
interface MetafieldInfo {
  namespace: string;
  key: string;
  type: string;
  ownerType: 'PRODUCT' | 'PRODUCTVARIANT';
}

interface MetafieldDefinitionResponse {
  metafieldDefinitions: {
    edges: Array<{
      node: {
        id: string;
        namespace: string;
        key: string;
        name: string;
        ownerType: string;
      };
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

interface MetafieldDefinitionCreateResponse {
  metafieldDefinitionCreate: {
    createdDefinition: {
      id: string;
      namespace: string;
      key: string;
      name: string;
    } | null;
    userErrors: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}

// GraphQL Queries
const METAFIELD_DEFINITIONS_QUERY = `
  query GetMetafieldDefinitions($ownerType: MetafieldOwnerType!, $after: String) {
    metafieldDefinitions(first: 250, ownerType: $ownerType, after: $after) {
      edges {
        node {
          id
          namespace
          key
          name
          ownerType
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const METAFIELD_DEFINITION_CREATE_MUTATION = `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        name
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export class ShopifyMetafieldDefinitionSyncService {
  private graphqlClient: GraphQLClient;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
  }

  /**
   * Detects all required metafield definitions by fetching products from external API
   */
  async detectRequiredMetafieldDefinitions(): Promise<MetafieldInfo[]> {
    console.log('🔍 Detecting required metafield definitions from source products...');

    try {
      const externalApiUrl = process.env.EXTERNAL_API_URL;
      if (!externalApiUrl) {
        throw new Error('EXTERNAL_API_URL is not defined in environment variables');
      }

      // Fetch products from external API
      const response = await axios.get(`${externalApiUrl}/api/products`);
      const products = response.data.products || [];

      console.log(`📦 Analyzing ${products.length} products for metafield definitions...`);

      const metafieldMap = new Map<string, MetafieldInfo>();

      // Scan product-level metafields
      for (const product of products) {
        if (product.metafields && Array.isArray(product.metafields)) {
          for (const metafield of product.metafields) {
            const key = `PRODUCT:${metafield.namespace}.${metafield.key}`;
            if (!metafieldMap.has(key)) {
              metafieldMap.set(key, {
                namespace: metafield.namespace,
                key: metafield.key,
                type: metafield.type,
                ownerType: 'PRODUCT'
              });
            }
          }
        }

        // Scan variant-level metafields
        if (product.variants && Array.isArray(product.variants)) {
          for (const variant of product.variants) {
            if (variant.metafields && Array.isArray(variant.metafields)) {
              for (const metafield of variant.metafields) {
                const key = `PRODUCTVARIANT:${metafield.namespace}.${metafield.key}`;
                if (!metafieldMap.has(key)) {
                  metafieldMap.set(key, {
                    namespace: metafield.namespace,
                    key: metafield.key,
                    type: metafield.type,
                    ownerType: 'PRODUCTVARIANT'
                  });
                }
              }
            }
          }
        }
      }

      const detectedMetafields = Array.from(metafieldMap.values());
      console.log(`✅ Detected ${detectedMetafields.length} unique metafield definitions`);

      // Log summary by namespace
      const namespaceGroups = detectedMetafields.reduce((acc, mf) => {
        acc[mf.namespace] = (acc[mf.namespace] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('📊 Metafield definitions by namespace:');
      for (const [namespace, count] of Object.entries(namespaceGroups)) {
        console.log(`   - ${namespace}: ${count} fields`);
      }

      return detectedMetafields;
    } catch (error) {
      console.error('❌ Error detecting metafield definitions:', error);
      throw error;
    }
  }

  /**
   * Get all existing metafield definitions from Shopify for a given owner type
   */
  private async getExistingMetafieldDefinitions(ownerType: 'PRODUCT' | 'PRODUCTVARIANT'): Promise<Set<string>> {
    const existingDefinitions = new Set<string>();
    let hasNextPage = true;
    let cursor: string | null = null;

    console.log(`🔍 Fetching existing ${ownerType} metafield definitions from target store...`);

    try {
      while (hasNextPage) {
        const variables: any = { ownerType };
        if (cursor) {
          variables.after = cursor;
        }

        const response = await this.graphqlClient.request<MetafieldDefinitionResponse>(
          METAFIELD_DEFINITIONS_QUERY,
          variables
        );

        const edges = response.metafieldDefinitions.edges;
        for (const edge of edges) {
          const key = `${edge.node.namespace}.${edge.node.key}`;
          existingDefinitions.add(key);
        }

        hasNextPage = response.metafieldDefinitions.pageInfo.hasNextPage;
        cursor = response.metafieldDefinitions.pageInfo.endCursor;
      }

      console.log(`✅ Found ${existingDefinitions.size} existing ${ownerType} definitions`);
      return existingDefinitions;
    } catch (error) {
      console.error(`❌ Error fetching existing ${ownerType} metafield definitions:`, error);
      throw error;
    }
  }

  /**
   * Get metaobject definition ID by type
   */
  private async getMetaobjectDefinitionId(metaobjectType: string): Promise<string | null> {
    const query = `
      query GetMetaobjectDefinition($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
        }
      }
    `;

    try {
      const response: any = await this.graphqlClient.request(query, { type: metaobjectType });
      return response.metaobjectDefinitionByType?.id || null;
    } catch (error) {
      console.error(`❌ Error fetching metaobject definition for type ${metaobjectType}:`, error);
      return null;
    }
  }

  /**
   * Get metaobject type for metaobject reference fields
   */
  private getMetaobjectTypeForField(namespace: string, key: string): string | null {
    // Map metafield keys to their corresponding metaobject types
    const metaobjectMapping: Record<string, string> = {
      'faqs': 'FAQs',
      'feature_content': 'product_feature',
      'product_rooms_features': 'product_rooms_features',
      'company_logo': 'company_logo',
      'acoustic_environment_next': 'acoustic_environment_next',
      'furniture': 'furniture',
      'upsell_items': 'upsell_item'
    };

    return metaobjectMapping[key] || null;
  }

  /**
   * Hardcoded method to create metaobject reference metafield definitions
   */
  private async createHardcodedMetaobjectReferenceDefinitions(): Promise<void> {
    console.log('\n🔧 Creating hardcoded metaobject reference metafield definitions...\n');

    const metaobjectReferenceFields = [
      { key: 'faqs', metaobjectType: 'FAQs', isList: true },
      { key: 'feature_content', metaobjectType: 'product_feature', isList: true },
      { key: 'product_rooms_features', metaobjectType: 'product_rooms_features', isList: false },
      { key: 'company_logo', metaobjectType: 'company_logo', isList: true },
      { key: 'acoustic_environment_next', metaobjectType: 'acoustic_environment_next', isList: false }
    ];

    for (const field of metaobjectReferenceFields) {
      try {
        // Get the metaobject definition ID
        const metaobjectDefId = await this.getMetaobjectDefinitionId(field.metaobjectType);

        if (!metaobjectDefId) {
          console.error(`❌ Could not find metaobject definition for type: ${field.metaobjectType}`);
          continue;
        }

        console.log(`✅ Found metaobject definition ID for ${field.metaobjectType}: ${metaobjectDefId}`);

        // Generate human-readable name
        const name = field.key
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        const fieldType = field.isList ? 'list.metaobject_reference' : 'metaobject_reference';

        const definition = {
          namespace: 'custom',
          key: field.key,
          name: name,
          type: fieldType,
          ownerType: 'PRODUCT',
          validations: [
            {
              name: 'metaobject_definition_id',
              value: metaobjectDefId
            }
          ]
        };

        const response = await this.graphqlClient.request<MetafieldDefinitionCreateResponse>(
          METAFIELD_DEFINITION_CREATE_MUTATION,
          { definition }
        );

        if (response.metafieldDefinitionCreate.userErrors.length > 0) {
          const errors = response.metafieldDefinitionCreate.userErrors;

          // Check if it already exists
          const alreadyExists = errors.some(e =>
            e.message.includes('already exists') ||
            e.code === 'TAKEN'
          );

          if (alreadyExists) {
            console.log(`⏭️  Metafield definition custom.${field.key} already exists`);
          } else {
            console.error(`❌ Error creating metafield definition custom.${field.key}:`, errors);
          }
        } else {
          console.log(`✅ Created metafield definition: PRODUCT custom.${field.key} (${fieldType})`);
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`❌ Error creating metafield definition custom.${field.key}:`, error);
      }
    }

    console.log('\n✅ Hardcoded metaobject reference metafield definitions processed\n');
  }

  /**
   * Create a metafield definition in Shopify
   */
  private async createMetafieldDefinition(metafield: MetafieldInfo): Promise<boolean> {
    try {
      // Skip reserved namespaces that cannot be created
      const reservedNamespaces = ['reviews', 'shopify', 'spr', 'judgeme', 'yoast_seo', 'mm-google-shopping', 'mc-facebook', 'globo--filter--product_recommendation'];
      if (reservedNamespaces.includes(metafield.namespace)) {
        console.log(`⏭️  Skipped (reserved namespace): ${metafield.ownerType} ${metafield.namespace}.${metafield.key}`);
        return false;
      }

      // Skip invalid types (map 'string' to proper type if needed)
      const validTypes = [
        'boolean', 'color', 'date_time', 'date', 'dimension', 'json', 'money',
        'multi_line_text_field', 'number_decimal', 'number_integer', 'rating',
        'rich_text_field', 'single_line_text_field', 'url', 'file_reference',
        'page_reference', 'product_reference', 'collection_reference',
        'variant_reference', 'metaobject_reference', 'list.file_reference',
        'list.product_reference', 'list.collection_reference', 'list.variant_reference',
        'list.metaobject_reference', 'list.single_line_text_field', 'list.url'
      ];

      let fieldType = metafield.type;

      // Map invalid types to valid ones
      if (fieldType === 'string') {
        fieldType = 'single_line_text_field';
      }

      if (!validTypes.includes(fieldType)) {
        console.log(`⏭️  Skipped (invalid type '${fieldType}'): ${metafield.ownerType} ${metafield.namespace}.${metafield.key}`);
        return false;
      }

      // Generate a human-readable name from the key
      const name = metafield.key
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      const definition: any = {
        namespace: metafield.namespace,
        key: metafield.key,
        name: name,
        type: fieldType,
        ownerType: metafield.ownerType
      };

      // Add validations for metaobject_reference types
      if (fieldType === 'metaobject_reference' || fieldType === 'list.metaobject_reference') {
        const metaobjectType = this.getMetaobjectTypeForField(metafield.namespace, metafield.key);
        if (metaobjectType) {
          definition.validations = [
            {
              name: 'metaobject_definition_id',
              value: JSON.stringify({ metaobject_definition_type: metaobjectType })
            }
          ];
        } else {
          console.log(`⏭️  Skipped (no metaobject mapping for): ${metafield.ownerType} ${metafield.namespace}.${metafield.key}`);
          return false;
        }
      }

      const response = await this.graphqlClient.request<MetafieldDefinitionCreateResponse>(
        METAFIELD_DEFINITION_CREATE_MUTATION,
        { definition }
      );

      if (response.metafieldDefinitionCreate.userErrors.length > 0) {
        const errors = response.metafieldDefinitionCreate.userErrors;
        console.error(`❌ Error creating metafield definition ${metafield.namespace}.${metafield.key}:`, errors);
        return false;
      }

      console.log(`✅ Created metafield definition: ${metafield.ownerType} ${metafield.namespace}.${metafield.key} (${fieldType})`);
      return true;
    } catch (error) {
      console.error(`❌ Error creating metafield definition ${metafield.namespace}.${metafield.key}:`, error);
      return false;
    }
  }

  /**
   * Ensure all required metafield definitions exist in Shopify
   */
  async ensureMetafieldDefinitionsExist(requiredDefinitions: MetafieldInfo[]): Promise<void> {
    console.log('\n🔧 Ensuring metafield definitions exist in target store...\n');

    try {
      // Get existing definitions for both owner types
      const existingProductDefs = await this.getExistingMetafieldDefinitions('PRODUCT');
      const existingVariantDefs = await this.getExistingMetafieldDefinitions('PRODUCTVARIANT');

      let createdCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const metafield of requiredDefinitions) {
        const key = `${metafield.namespace}.${metafield.key}`;
        const existingDefs = metafield.ownerType === 'PRODUCT' ? existingProductDefs : existingVariantDefs;

        if (existingDefs.has(key)) {
          console.log(`⏭️  Skipped (already exists): ${metafield.ownerType} ${key}`);
          skippedCount++;
          continue;
        }

        // Create the definition
        const success = await this.createMetafieldDefinition(metafield);
        if (success) {
          createdCount++;
        } else {
          failedCount++;
        }

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      console.log('\n📊 Metafield definition sync summary:');
      console.log(`   ✅ Created: ${createdCount}`);
      console.log(`   ⏭️  Skipped (already exist): ${skippedCount}`);
      console.log(`   ❌ Failed: ${failedCount}`);
      console.log('');
    } catch (error) {
      console.error('❌ Error ensuring metafield definitions exist:', error);
      throw error;
    }
  }

  /**
   * Main sync method: detect and create all required metafield definitions
   */
  async syncMetafieldDefinitions(): Promise<void> {
    console.log('\n🚀 Starting metafield definition sync...\n');

    try {
      // Step 1: Create hardcoded metaobject reference definitions first
      await this.createHardcodedMetaobjectReferenceDefinitions();

      // Step 2: Detect required definitions from source products
      const requiredDefinitions = await this.detectRequiredMetafieldDefinitions();

      // Step 3: Ensure they all exist in target store
      await this.ensureMetafieldDefinitionsExist(requiredDefinitions);

      console.log('✅ Metafield definition sync completed successfully!\n');
    } catch (error) {
      console.error('❌ Metafield definition sync failed:', error);
      throw error;
    }
  }
}

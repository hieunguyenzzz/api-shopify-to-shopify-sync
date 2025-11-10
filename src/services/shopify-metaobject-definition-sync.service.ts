import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import {
  METAOBJECT_DEFINITION_BY_TYPE_QUERY,
  METAOBJECT_DEFINITION_CREATE_MUTATION
} from '../graphql/shopify-mutations';

// TypeScript interfaces for metaobject definitions
interface FieldDefinition {
  key: string;
  name: string;
  type: string;
  required?: boolean;
  validations?: Array<{ name: string; value: string }>;
}

interface MetaobjectDefinitionInput {
  name: string;
  type: string;
  displayNameKey?: string;
  fieldDefinitions: FieldDefinition[];
  access?: {
    storefront: string;
  };
}

interface MetaobjectDefinitionResponse {
  metaobjectDefinitionByType: {
    id: string;
    type: string;
    name: string;
  } | null;
}

interface MetaobjectDefinitionCreateResponse {
  metaobjectDefinitionCreate: {
    metaobjectDefinition: {
      id: string;
      type: string;
      name: string;
    };
    userErrors: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}

/**
 * Hardcoded metaobject definitions based on source Shopify store structure
 */
const METAOBJECT_DEFINITIONS: Record<string, MetaobjectDefinitionInput> = {
  room_features: {
    name: 'Room Features',
    type: 'room_features',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'admin_title', name: 'Admin Title', type: 'single_line_text_field' },
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'description', name: 'Description', type: 'rich_text_field' },
      { key: 'hotspot_point_left', name: 'Hotspot Point Left', type: 'number_integer' },
      { key: 'hotspot_point_right', name: 'Hotspot Point Right', type: 'number_integer' }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  FAQs: {
    name: 'FAQs',
    type: 'FAQs',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'question', name: 'Question', type: 'single_line_text_field' },
      { key: 'text', name: 'Text', type: 'rich_text_field' }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  company_logo: {
    name: 'Company Logo',
    type: 'company_logo',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'logo', name: 'Logo', type: 'file_reference' }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  product_feature: {
    name: 'Product Feature',
    type: 'product_feature',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'heading', name: 'Heading', type: 'single_line_text_field' },
      { key: 'detection', name: 'Detection', type: 'rich_text_field' },
      { key: 'image', name: 'Image', type: 'file_reference' },
      { key: 'youtube_video', name: 'Youtube Video', type: 'url' }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  product_rooms_features: {
    name: 'Product Rooms Features',
    type: 'product_rooms_features',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'seo_title', name: 'SEO Title', type: 'single_line_text_field' },
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'content', name: 'Content', type: 'multi_line_text_field' },
      { key: 'close_video', name: 'Close Video', type: 'file_reference' },
      { key: 'close_thumbnail', name: 'Close Thumbnail', type: 'file_reference' },
      { key: 'open_video', name: 'Open Video', type: 'file_reference' },
      { key: 'open_thumbnail', name: 'Open Thumbnail', type: 'file_reference' },
      {
        key: 'room_features',
        name: 'Room Features',
        type: 'list.metaobject_reference',
        validations: [{ name: 'metaobject_definition_type', value: 'room_features' }]
      }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  meeting_rooms_features: {
    name: 'Meeting Rooms Features',
    type: 'meeting_rooms_features',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'seo_title', name: 'SEO Title', type: 'single_line_text_field' },
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'content', name: 'Content', type: 'multi_line_text_field' },
      { key: 'close_video', name: 'Close Video', type: 'file_reference' },
      { key: 'close_thumbnail', name: 'Close Thumbnail', type: 'file_reference' },
      { key: 'open_video', name: 'Open Video', type: 'file_reference' },
      { key: 'open_thumbnail', name: 'Open Thumbnail', type: 'file_reference' },
      {
        key: 'room_features',
        name: 'Room Features',
        type: 'list.metaobject_reference',
        validations: [{ name: 'metaobject_definition_type', value: 'room_features' }]
      }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  environment_item: {
    name: 'Environment Item',
    type: 'environment_item',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'heading', name: 'Heading', type: 'single_line_text_field' },
      { key: 'sub_heading', name: 'Sub Heading', type: 'rich_text_field' }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  },
  acoustic_environment_next: {
    name: 'Acoustic Environment Next',
    type: 'acoustic_environment_next',
    displayNameKey: 'title',
    fieldDefinitions: [
      { key: 'title', name: 'Title', type: 'single_line_text_field', required: true },
      { key: 'background_image', name: 'Background Image', type: 'file_reference' },
      { key: 'background_image_mobile_', name: 'Background Image Mobile', type: 'file_reference' },
      { key: 'heading', name: 'Heading', type: 'single_line_text_field' },
      { key: 'sub_heading', name: 'Sub Heading', type: 'rich_text_field' },
      { key: 'sub_heading_2', name: 'Sub Heading 2', type: 'rich_text_field' },
      {
        key: 'environment_items',
        name: 'Environment Items',
        type: 'list.metaobject_reference',
        validations: [{ name: 'metaobject_definition_type', value: 'environment_item' }]
      }
    ],
    access: {
      storefront: 'PUBLIC_READ'
    }
  }
};

export class ShopifyMetaobjectDefinitionSyncService {
  private graphqlClient: GraphQLClient;
  private checkedDefinitions: Set<string> = new Set();

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
  }

  /**
   * Check if a metaobject definition exists in the target store
   */
  async checkDefinitionExists(type: string): Promise<boolean> {
    try {
      console.log(`🔍 Checking if metaobject definition '${type}' exists...`);

      const response = await this.graphqlClient.request<MetaobjectDefinitionResponse>(
        METAOBJECT_DEFINITION_BY_TYPE_QUERY,
        { type }
      );

      if (response.metaobjectDefinitionByType) {
        console.log(`✅ Definition '${type}' already exists (ID: ${response.metaobjectDefinitionByType.id})`);
        return true;
      }

      console.log(`❌ Definition '${type}' does not exist`);
      return false;
    } catch (error) {
      console.error(`❌ Error checking definition for type '${type}':`, error);
      return false;
    }
  }

  /**
   * Get the GID of a metaobject definition by type
   */
  async getDefinitionId(type: string): Promise<string | null> {
    try {
      const response = await this.graphqlClient.request<MetaobjectDefinitionResponse>(
        METAOBJECT_DEFINITION_BY_TYPE_QUERY,
        { type }
      );

      return response.metaobjectDefinitionByType?.id || null;
    } catch (error) {
      console.error(`❌ Error fetching definition ID for type '${type}':`, error);
      return null;
    }
  }

  /**
   * Create a metaobject definition in the target store
   * Handles dependencies by resolving referenced metaobject definition IDs first
   */
  async createDefinition(type: string): Promise<boolean> {
    try {
      const definition = JSON.parse(JSON.stringify(METAOBJECT_DEFINITIONS[type])); // Deep clone

      if (!definition) {
        console.error(`❌ No hardcoded definition found for type: ${type}`);
        return false;
      }

      // Resolve metaobject_definition_type validations to GIDs
      for (const field of definition.fieldDefinitions) {
        if (field.validations) {
          for (const validation of field.validations) {
            if (validation.name === 'metaobject_definition_type') {
              // Ensure the referenced type exists first
              const referencedType = validation.value;
              await this.ensureDefinitionExists(referencedType);

              // Get the GID of the referenced type
              const gid = await this.getDefinitionId(referencedType);
              if (!gid) {
                console.error(`❌ Could not get GID for referenced type: ${referencedType}`);
                return false;
              }

              // Replace the validation with the GID
              validation.name = 'metaobject_definition_id';
              validation.value = gid;
            }
          }
        }
      }

      console.log(`🔧 Creating metaobject definition: ${definition.name} (${type})`);

      const response = await this.graphqlClient.request<MetaobjectDefinitionCreateResponse>(
        METAOBJECT_DEFINITION_CREATE_MUTATION,
        { definition }
      );

      if (response.metaobjectDefinitionCreate.userErrors.length > 0) {
        console.error(`❌ Error creating definition '${type}':`, JSON.stringify(response.metaobjectDefinitionCreate.userErrors, null, 2));
        return false;
      }

      console.log(`✅ Successfully created definition: ${type} (ID: ${response.metaobjectDefinitionCreate.metaobjectDefinition.id})`);
      return true;
    } catch (error) {
      console.error(`❌ Error creating definition for type '${type}':`, error);
      return false;
    }
  }

  /**
   * Ensure a metaobject definition exists (check first, create if needed)
   * Uses caching to avoid redundant checks during a sync session
   */
  async ensureDefinitionExists(type: string): Promise<boolean> {
    // Check cache first
    if (this.checkedDefinitions.has(type)) {
      return true;
    }

    // Check if exists
    const exists = await this.checkDefinitionExists(type);

    if (exists) {
      this.checkedDefinitions.add(type);
      return true;
    }

    // Create if doesn't exist
    const created = await this.createDefinition(type);

    if (created) {
      this.checkedDefinitions.add(type);
    }

    return created;
  }

  /**
   * Clear the cache of checked definitions (useful between sync runs)
   */
  clearCache(): void {
    this.checkedDefinitions.clear();
  }
}

export const shopifyMetaobjectDefinitionSyncService = new ShopifyMetaobjectDefinitionSyncService();

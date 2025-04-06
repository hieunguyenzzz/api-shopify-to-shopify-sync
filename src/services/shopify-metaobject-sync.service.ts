import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { ExternalMetaobject, ExternalMetaobjectsResponse } from '../types/metaobject.types';
import { 
  METAOBJECT_CREATE_MUTATION,
  METAOBJECT_UPDATE_MUTATION,
  METAOBJECTS_BY_TYPE_QUERY
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { metaobjectMappingService } from './metaobject-mapping.service';
import MongoDBService from './mongodb.service';

// Load environment variables
dotenv.config();

// Define response types
interface ShopifyMetaobject {
  id: string;
  handle: string;
  type: string;
  displayName: string;
  fields: {
    key: string;
    value: string;
  }[];
  updatedAt?: string;
}

interface MetaobjectEdge {
  node: ShopifyMetaobject;
}

interface MetaobjectsResponse {
  metaobjects: {
    edges: MetaobjectEdge[];
  };
}

interface MetaobjectCreateResponse {
  metaobjectCreate: {
    metaobject: ShopifyMetaobject;
    userErrors: Array<{
      field: string;
      message: string;
      code: string;
    }>;
  }
}

interface MetaobjectUpdateResponse {
  metaobjectUpdate: {
    metaobject: ShopifyMetaobject;
    userErrors: Array<{
      field: string;
      message: string;
      code: string;
    }>;
  }
}

// Define a custom error for missing mappings
class MappingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingNotFoundError';
  }
}

export class ShopifyMetaobjectSyncService {
  private graphqlClient: GraphQLClient;
  private externalMetaobjectsApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalMetaobjectsApiUrl = `${externalApiBaseUrl}/api/metaobjects`;
  }

  // Fetch metaobjects from external API
  async fetchExternalMetaobjects(type: string): Promise<ExternalMetaobject[]> {
    try {
      console.log(`🔍 Fetching external metaobjects of type ${type}...`);
      const response = await axios.get<ExternalMetaobjectsResponse>(
        `${this.externalMetaobjectsApiUrl}?type=${type}`
      );
      
      if (!response.data.success) {
        throw new Error('Failed to fetch metaobjects from external API');
      }
      
      console.log(`✅ Successfully fetched ${response.data.metaobjects.length} metaobjects of type ${type}`);
      return response.data.metaobjects;
    } catch (error) {
      console.error(`❌ Error fetching external metaobjects of type ${type}:`, error);
      throw error;
    }
  }

  // Check if metaobject exists by handle and type
  async checkMetaobjectByHandle(handle: string, type: string): Promise<ShopifyMetaobject | null> {
    try {
      console.log(`🔍 Checking for existing metaobject with handle: ${handle} and type: ${type}`);
      
      const response = await this.graphqlClient.request<MetaobjectsResponse>(
        METAOBJECTS_BY_TYPE_QUERY, 
        { 
          type: type,
          first: 250 // Max allowed by the API
        }
      );

      const existingMetaobject = response.metaobjects.edges
        .map(edge => edge.node)
        .find(metaobject => metaobject.handle === handle);
      
      if (existingMetaobject) {
        console.log(`✅ Found existing metaobject: ${existingMetaobject.displayName} (ID: ${existingMetaobject.id})`);
        return existingMetaobject;
      }
      
      console.log(`❌ No metaobject found with handle: ${handle} and type: ${type}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking metaobject by handle:', error);
      return null;
    }
  }

  // Prepare metaobject data for create/update
  async prepareMetaobjectData(externalMetaobject: ExternalMetaobject) {
    console.log(`🔧 Preparing metaobject data for sync: ${externalMetaobject.displayName}`);
    
    // Determine the target Shopify type
    const shopifyType = externalMetaobject.type === 'meeting_rooms_features' 
      ? 'product_rooms_features' 
      : externalMetaobject.type;
    
    // Check if metaobject already exists using the target Shopify type
    const existingMetaobject = await this.checkMetaobjectByHandle(
      externalMetaobject.handle, 
      shopifyType // Use shopifyType here
    );
    
    // Process fields asynchronously
    const processedFieldsPromises = externalMetaobject.fields.map(async (field) => {
      let processedValue = field.value === null ? "" : field.value;

      // Handle string replacement first (applies to all string-based values potentially)
      if (typeof processedValue === 'string') {
        processedValue = processedValue.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design");
      }

      // Handle file_reference type
      if (field.type === 'file_reference') {
        try {
          // Attempt to parse even if replacement happened, as the core structure might be JSON
          const fileData = JSON.parse(processedValue);
          const externalFileId = fileData.id;

          if (externalFileId && typeof externalFileId === 'string') {
            console.log(`🔍 [File Ref] Looking up mapping for external ID: ${externalFileId}`);
            const mapping = await MongoDBService.findFileByExternalId(externalFileId);

            if (mapping && mapping.shopifyFileId) {
              console.log(`✅ [File Ref] Found Shopify ID: ${mapping.shopifyFileId}`);
              // Directly assign the Shopify ID string to processedValue
              processedValue = mapping.shopifyFileId; 
            } else {
              // Throw error instead of warning if mapping is not found
              throw new MappingNotFoundError(`Could not find Shopify mapping for external file ID: ${externalFileId}`);
            }
          } else {
             // Handle cases where parsing succeeded but externalFileId is invalid or missing (e.g., field.value was "{}")
             // Set processedValue to empty string in this scenario.
             console.log(`ℹ️ [File Ref] Parsed JSON but found no valid external file ID for field ${field.key}. Setting value to empty string.`);
             processedValue = ""; 
          }
        } catch (parseError) {
          // If parsing fails, it might just be a plain string. Log error only if it looks like JSON.
          if (processedValue.trim().startsWith('{') && processedValue.trim().endsWith('}')) {
             console.error(`❌ [File Ref] Error parsing value for field ${field.key}:`, parseError);
          }
          // If it wasn't a MappingNotFoundError, rethrow or handle differently if needed
          if (!(parseError instanceof MappingNotFoundError)) {
             // Decide if a parse error should also cause a skip, for now, we keep the potentially string-replaced value
            console.warn(`⚠️ [File Ref] Failed to parse potentially JSON value for ${field.key}. Using potentially modified string value.`);
          } else {
            // Rethrow the MappingNotFoundError to be caught later
            throw parseError;
          }
        }
      }
      // Handle list.metaobject_reference type
      else if (field.type === 'list.metaobject_reference') {
        try {
          const externalIds: string[] = JSON.parse(processedValue);
          
          if (Array.isArray(externalIds)) {
            console.log(`🔍 [Metaobject List] Processing ${externalIds.length} external IDs for field ${field.key}`);
            
            const shopifyIdsPromises = externalIds.map(async (externalId) => {
              if (typeof externalId !== 'string') {
                 console.warn(`⚠️ [Metaobject List] Skipping non-string ID in list: ${externalId}`);
                 return externalId; // Keep non-string items as is? Or filter?
              }
              const shopifyId = await metaobjectMappingService.getShopifyMetaobjectId(externalId);
              if (shopifyId) {
                 console.log(`✅ [Metaobject List] Mapped ${externalId} to ${shopifyId}`);
                return shopifyId;
              } else {
                console.warn(`⚠️ [Metaobject List] Could not find Shopify mapping for external ID: ${externalId}. Keeping original.`);
                return externalId; // Keep original ID if mapping not found
              }
            });
            
            const resolvedShopifyIds = await Promise.all(shopifyIdsPromises);
            processedValue = JSON.stringify(resolvedShopifyIds);
            console.log(`✅ [Metaobject List] Processed field ${field.key}. New value: ${processedValue}`);
          }
        } catch (parseError) {
           console.error(`❌ [Metaobject List] Error parsing value for field ${field.key}:`, parseError);
          // Keep the potentially string-replaced value if parsing fails
        }
      }

      // Ensure the final value is not null or undefined, default to empty string
      const finalValue = processedValue === null || typeof processedValue === 'undefined' ? "" : processedValue;

      return {
        key: field.key,
        value: finalValue // Use finalValue here
      };
    });
    
    // Wait for all field processing promises to resolve
    const processedFields = await Promise.all(processedFieldsPromises);

    const metaobjectInput = {
      handle: externalMetaobject.handle,
      fields: processedFields
    };

    if (existingMetaobject) {
      // For update, return the ID separately
      return {
        id: existingMetaobject.id,
        input: metaobjectInput
      };
    }
    // when creating a new metaobject, we need to include the type
    // Use the shopifyType when setting the type for creation
    return { input: {...metaobjectInput, type: shopifyType} };
  }

  // Create a new metaobject
  async createMetaobject(metaobjectData: { input: any, externalMetaobjectId: string }): Promise<ShopifyMetaobject> {
    try {
      console.log(`🔧 Creating new metaobject: ${metaobjectData.input.handle}`);
      
      const response = await this.graphqlClient.request<MetaobjectCreateResponse>(
        METAOBJECT_CREATE_MUTATION,
        { metaobject: metaobjectData.input }
      );
      
      if (response.metaobjectCreate.userErrors.length > 0) {
        console.error('❌ Error creating metaobject:', response.metaobjectCreate.userErrors);
        throw new Error(`Failed to create metaobject: ${response.metaobjectCreate.userErrors[0].message}`);
      }
      
      const metaobjectId = response.metaobjectCreate.metaobject.id;
      const handle = response.metaobjectCreate.metaobject.handle;
      const type = response.metaobjectCreate.metaobject.type;
      
      console.log(`✅ Successfully created metaobject: ${handle} (ID: ${metaobjectId})`);
      
      // Save mapping
      await this.createMetaobjectMapping(
        metaobjectData.externalMetaobjectId,
        metaobjectId,
        handle,
        type
      );
      
      return response.metaobjectCreate.metaobject;
    } catch (error) {
      console.error('❌ Error creating metaobject:', error);
      throw error;
    }
  }

  // Update an existing metaobject
  async updateMetaobject(metaobjectData: { id: string, input: any }): Promise<ShopifyMetaobject> {
    try {
      console.log(`🔧 Updating metaobject with ID: ${metaobjectData.id}`);
      
      const response = await this.graphqlClient.request<MetaobjectUpdateResponse>(
        METAOBJECT_UPDATE_MUTATION,
        { 
          id: metaobjectData.id,
          metaobject: metaobjectData.input
        }
      );
      
      if (response.metaobjectUpdate.userErrors.length > 0) {
        console.error('❌ Error updating metaobject:', response.metaobjectUpdate.userErrors);
        throw new Error(`Failed to update metaobject: ${response.metaobjectUpdate.userErrors[0].message}`);
      }
      
      console.log(`✅ Successfully updated metaobject: ${metaobjectData.input.handle}`);
      return response.metaobjectUpdate.metaobject;
    } catch (error) {
      console.error('❌ Error updating metaobject:', error);
      throw error;
    }
  }

  // Sync a single metaobject
  async syncMetaobject(externalMetaobject: ExternalMetaobject): Promise<ShopifyMetaobject | null> {
    try {
      // Prepare metaobject data
      const metaobjectData = await this.prepareMetaobjectData(externalMetaobject);
      
      // Check if we already have a mapping for this metaobject
      const existingMapping = await metaobjectMappingService.getMappingByHandle(externalMetaobject.handle);
      
      if (metaobjectData.id || existingMapping) {
        // Update existing metaobject
        const shopifyId = metaobjectData.id || existingMapping?.shopifyMetaobjectId;
        
        if (!shopifyId) {
          // This case might indicate an issue if prepareMetaobjectData didn't find an ID but a mapping exists?
          // Or if the mapping exists but doesn't have the shopifyId - though prepareMetaobjectData should handle mapping lookup.
          console.warn(`⚠️ Potential inconsistency for ${externalMetaobject.handle}. Mapping exists but update ID not determined directly. Using mapping ID.`);
          if (!existingMapping?.shopifyMetaobjectId) {
             throw new Error(`Cannot update metaobject: missing Shopify ID for ${externalMetaobject.handle} despite existing mapping.`);
          }
          // Use the ID from the mapping if metaobjectData didn't provide one
          const idToUse = metaobjectData.id || existingMapping.shopifyMetaobjectId;
          
          const result = await this.updateMetaobject({
            id: idToUse,
            input: metaobjectData.input
          });
          
          // Ensure mapping exists
          await this.ensureMetaobjectMapping(
            externalMetaobject.id,
            idToUse,
            externalMetaobject.handle,
            externalMetaobject.type
          );
          
          return result;

        } else {
           // Normal update path where ID was found by prepareMetaobjectData or consistent mapping
           const result = await this.updateMetaobject({
            id: shopifyId,
            input: metaobjectData.input
          });
          
          // Ensure mapping exists
          await this.ensureMetaobjectMapping(
            externalMetaobject.id,
            shopifyId,
            externalMetaobject.handle,
            externalMetaobject.type
          );
          
          return result;
        }
      } else {
        // Create new metaobject
        return await this.createMetaobject({
          input: metaobjectData.input,
          externalMetaobjectId: externalMetaobject.id
        });
      }
    } catch (error) {
      // Catch the specific MappingNotFoundError to skip the item
      if (error instanceof MappingNotFoundError) {
        console.warn(`⏭️ Skipping metaobject ${externalMetaobject.handle}: ${error.message}`);
        return null; // Indicate that sync was skipped
      }
      // Re-throw other errors
      console.error(`❌ Error syncing metaobject ${externalMetaobject.handle}:`, error);
      throw error;
    }
  }

  // Ensure metaobject mapping exists
  private async ensureMetaobjectMapping(
    externalMetaobjectId: string,
    shopifyMetaobjectId: string,
    metaobjectHandle: string,
    metaobjectType: string
  ): Promise<void> {
    try {
      // Check if we already have a mapping for this external ID
      const existingMappingByExternalId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
      
      if (existingMappingByExternalId) {
        // Mapping already exists for this external ID, ensure it points to the correct Shopify ID
        if (existingMappingByExternalId !== shopifyMetaobjectId) {
          console.log(`🔄 Updating mapping for external ID ${externalMetaobjectId} to point to new Shopify ID ${shopifyMetaobjectId}`);
          await metaobjectMappingService.saveMetaobjectMapping({
            externalMetaobjectId,
            shopifyMetaobjectId,
            metaobjectHandle,
            metaobjectType
          });
        }
        return;
      }
      
      // Check if we already have a mapping for this Shopify ID
      const existingMappingByHandle = await metaobjectMappingService.getMappingByHandle(metaobjectHandle);
      
      if (existingMappingByHandle) {
        // Mapping already exists for this handle, ensure it points to the correct external ID
        if (existingMappingByHandle.externalMetaobjectId !== externalMetaobjectId) {
          console.log(`🔄 Updating mapping for handle ${metaobjectHandle} to point to new external ID ${externalMetaobjectId}`);
          await metaobjectMappingService.saveMetaobjectMapping({
            externalMetaobjectId,
            shopifyMetaobjectId,
            metaobjectHandle,
            metaobjectType
          });
        }
        return;
      }
      
      // No mapping exists, create a new one
      await this.createMetaobjectMapping(externalMetaobjectId, shopifyMetaobjectId, metaobjectHandle, metaobjectType);
    } catch (error) {
      console.error('❌ Error ensuring metaobject mapping:', error);
      throw error;
    }
  }

  // Create a new metaobject mapping
  private async createMetaobjectMapping(
    externalMetaobjectId: string,
    shopifyMetaobjectId: string,
    metaobjectHandle: string,
    metaobjectType: string
  ): Promise<void> {
    try {
      console.log(`📝 Creating mapping for metaobject: ${metaobjectHandle}`);
      await metaobjectMappingService.saveMetaobjectMapping({
        externalMetaobjectId,
        shopifyMetaobjectId,
        metaobjectHandle,
        metaobjectType
      });
    } catch (error) {
      console.error('❌ Error creating metaobject mapping:', error);
      throw error;
    }
  }

  // Sync all metaobjects of a specific type
  async syncMetaobjects(type: string, limit?: number): Promise<ShopifyMetaobject[]> {
    try {
      console.log(`🔄 Starting sync of metaobjects for type: ${type}`);
      
      // Fetch all external metaobjects
      const externalMetaobjects = await this.fetchExternalMetaobjects(type);
      
      // Apply limit if provided
      const metaobjectsToSync = limit 
        ? externalMetaobjects.slice(0, limit) 
        : externalMetaobjects;
      
      console.log(`🔄 Syncing ${metaobjectsToSync.length} metaobjects...`);
      
      // Process metaobjects in sequence to avoid rate limiting issues
      const results: ShopifyMetaobject[] = [];
      
      for (const metaobject of metaobjectsToSync) {
        try {
          const result = await this.syncMetaobject(metaobject);
          if (result) {
            results.push(result);
            console.log(`✅ Synced metaobject: ${metaobject.handle}`);
          }
        } catch (error) {
          console.error(`❌ Error syncing metaobject ${metaobject.handle}:`, error);
          // Continue with the next metaobject
        }
      }
      
      console.log(`🎉 Completed sync of ${results.length}/${metaobjectsToSync.length} metaobjects`);
      return results;
    } catch (error) {
      console.error('❌ Error syncing metaobjects:', error);
      throw error;
    }
  }
}

export const shopifyMetaobjectSyncService = new ShopifyMetaobjectSyncService(); 
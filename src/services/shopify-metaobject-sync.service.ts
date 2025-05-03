import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import crypto from 'crypto';
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
import { openAIService } from './openai.service';

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

  // Generate a hash for a metaobject based on its properties
  private generateMetaobjectHash(metaobject: ExternalMetaobject): string {
    // Use the target Shopify type if different from external type
    const shopifyType = metaobject.type === 'meeting_rooms_features' 
      ? 'product_rooms_features' 
      : metaobject.type;

    // Sort fields by key for stability
    const sortedFields = [...metaobject.fields].sort((a, b) => 
      a.key.localeCompare(b.key)
    );

    // Create a stable string representation of fields
    const fieldsString = sortedFields
      .map(field => `${field.key}|${field.type}|${JSON.stringify(field.value ?? "")}`) // Stringify value consistently
      .join(';');

    const metaobjectCoreData = `${metaobject.handle}|${shopifyType}`;
    const metaobjectFullData = `${metaobjectCoreData}|${fieldsString}`;
    
    return crypto.createHash('md5').update(metaobjectFullData).digest('hex');
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
  async createMetaobject(metaobjectData: { input: any, externalMetaobjectId: string, metaobjectHash: string }): Promise<ShopifyMetaobject> {
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
      
      // Save mapping, including the hash
      await this.createMetaobjectMapping(
        metaobjectData.externalMetaobjectId,
        metaobjectId,
        handle,
        type, // Use the type returned by Shopify for mapping
        metaobjectData.metaobjectHash // Pass the hash
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
    // Generate hash from the raw external metaobject data
    const metaobjectHash = this.generateMetaobjectHash(externalMetaobject);
    console.log(`ℹ️ Generated hash for ${externalMetaobject.handle}: ${metaobjectHash}`);

    try {
      // --- Hash Check ---
      // Assume metaobjectMappingService has a method to find by hash
      // We need to ensure metaobjectMappingService is updated to handle this
      const existingMappingByHash = await metaobjectMappingService.findMappingByHash(metaobjectHash); 
      
      if (existingMappingByHash) {
          console.log(`✅ Skipping metaobject ${externalMetaobject.handle}: Hash ${metaobjectHash} already exists in mapping (Shopify ID: ${existingMappingByHash.shopifyMetaobjectId}).`);
          // Optionally return the existing Shopify object if needed, or null to indicate no action taken
          // For now, returning null as the primary goal is skipping redundant updates.
          return null; 
      }
      console.log(`ℹ️ No existing mapping found for hash ${metaobjectHash}. Proceeding with sync...`);
      // --- End Hash Check ---

      // Prepare metaobject data (this checks Shopify by handle internally)
      const metaobjectData = await this.prepareMetaobjectData(externalMetaobject);
      
      // Check if we already have a mapping for this metaobject by handle and type
      // This provides more precise mapping by considering both handle and original type
      // Determine the target Shopify type for consistency
      const shopifyType = externalMetaobject.type === 'meeting_rooms_features' 
        ? 'product_rooms_features' 
        : externalMetaobject.type;
      const existingMappingByHandleAndType = await metaobjectMappingService.getMappingByHandleAndType(
        externalMetaobject.handle,
        shopifyType
      );
      
      if (metaobjectData.id || existingMappingByHandleAndType) {
        // Update existing metaobject
        const shopifyId = metaobjectData.id || existingMappingByHandleAndType?.shopifyMetaobjectId;
        
        if (!shopifyId) {
          console.warn(`⚠️ Potential inconsistency for ${externalMetaobject.handle}. Mapping exists but update ID not determined directly. Using mapping ID.`);
          if (!existingMappingByHandleAndType?.shopifyMetaobjectId) {
             throw new Error(`Cannot update metaobject: missing Shopify ID for ${externalMetaobject.handle} despite existing mapping.`);
          }
          const idToUse = existingMappingByHandleAndType.shopifyMetaobjectId;
          
          const result = await this.updateMetaobject({
            id: idToUse,
            input: metaobjectData.input
          });
          
          // Ensure mapping exists, passing the NEW hash
          await this.ensureMetaobjectMapping(
            externalMetaobject.id,
            idToUse,
            externalMetaobject.handle,
            shopifyType, // Use shopifyType for mapping consistency
            metaobjectHash // Pass the hash
          );
          
          return result;
          
        } else {
          let rewriteContent = await openAIService.rewriteContent(JSON.stringify(metaobjectData.input));
           // Normal update path where ID was found by prepareMetaobjectData or consistent mapping
           const result = await this.updateMetaobject({
            id: shopifyId,
            input: JSON.parse(rewriteContent)
          });
          
          // Ensure mapping exists, passing the NEW hash
          await this.ensureMetaobjectMapping(
            externalMetaobject.id,
            shopifyId,
            externalMetaobject.handle,
            shopifyType, // Use shopifyType for mapping consistency
            metaobjectHash // Pass the hash
          );
          
          return result;
        }
      } else {
        // Create new metaobject
        // Pass hash to createMetaobject to be saved in mapping
        return await this.createMetaobject({
          input: metaobjectData.input,
          externalMetaobjectId: externalMetaobject.id,
          metaobjectHash: metaobjectHash // Pass hash here
        });
      }
    } catch (error) {
      if (error instanceof MappingNotFoundError) {
        console.warn(`⏭️ Skipping metaobject ${externalMetaobject.handle}: ${error.message}`);
        return null; 
      }
      console.error(`❌ Error syncing metaobject ${externalMetaobject.handle}:`, error);
      throw error; // Re-throw other errors
    }
  }

  // Ensure metaobject mapping exists
  // Modify to accept hash
  private async ensureMetaobjectMapping(
    externalMetaobjectId: string,
    shopifyMetaobjectId: string,
    metaobjectHandle: string,
    metaobjectType: string, // This is the original external type
    metaobjectHash: string // Add hash parameter
  ): Promise<void> {
    try {
      // Assume metaobjectMappingService has getMappingByExternalId that returns hash
      const existingMappingByExternalId = await metaobjectMappingService.getMappingByExternalId(externalMetaobjectId); 
      
      if (existingMappingByExternalId) {
        // Mapping already exists for this external ID. Update if Shopify ID or hash differs.
        if (existingMappingByExternalId.shopifyMetaobjectId !== shopifyMetaobjectId || existingMappingByExternalId.metaobjectHash !== metaobjectHash) {
          console.log(`🔄 Updating mapping for external ID ${externalMetaobjectId}. ShopifyID: ${shopifyMetaobjectId}, Hash: ${metaobjectHash}`);
          // Assume saveMetaobjectMapping accepts hash
          await metaobjectMappingService.saveMetaobjectMapping({
            externalMetaobjectId,
            shopifyMetaobjectId,
            metaobjectHandle,
            metaobjectType, // Use original type passed in
            metaobjectHash // Pass the hash
          });
        } else {
           console.log(`✅ Mapping for external ID ${externalMetaobjectId} is up-to-date.`);
        }
        return;
      }
      
      // Check by handle only if not found by external ID (less common scenario for updates)
      // Assume getMappingByHandle also returns hash
      const existingMappingByHandle = await metaobjectMappingService.getMappingByHandleAndType(
        metaobjectHandle,
        metaobjectType
      );
      
      if (existingMappingByHandle) {
         // Mapping exists by handle, but not external ID. Update if external ID or hash differs.
        if (existingMappingByHandle.externalMetaobjectId !== externalMetaobjectId || existingMappingByHandle.metaobjectHash !== metaobjectHash) {
           console.log(`🔄 Updating mapping found by handle ${metaobjectHandle}. ExternalID: ${externalMetaobjectId}, ShopifyID: ${shopifyMetaobjectId}, Hash: ${metaobjectHash}`);
          // Assume saveMetaobjectMapping accepts hash
          await metaobjectMappingService.saveMetaobjectMapping({
            externalMetaobjectId,
            shopifyMetaobjectId,
            metaobjectHandle,
            metaobjectType,
            metaobjectHash // Pass the hash
          });
        } else {
             console.log(`✅ Mapping for handle ${metaobjectHandle} is up-to-date.`);
        }
        return;
      }
      
      // No mapping exists by external ID or handle, create a new one
      console.log(`📝 No existing mapping found for ${externalMetaobjectId} or ${metaobjectHandle}. Creating new mapping.`);
      // Pass hash to create mapping
      await this.createMetaobjectMapping(externalMetaobjectId, shopifyMetaobjectId, metaobjectHandle, metaobjectType, metaobjectHash);
    } catch (error) {
      console.error('❌ Error ensuring metaobject mapping:', error);
      throw error;
    }
  }

  // Create a new metaobject mapping
  // Modify to accept hash
  private async createMetaobjectMapping(
    externalMetaobjectId: string,
    shopifyMetaobjectId: string,
    metaobjectHandle: string,
    metaobjectType: string, // This is the Shopify type from creation response
    metaobjectHash: string // Add hash parameter
  ): Promise<void> {
    try {
      console.log(`📝 Creating mapping for metaobject: ${metaobjectHandle} with Hash: ${metaobjectHash}`);
      // Assume saveMetaobjectMapping now accepts metaobjectHash
      await metaobjectMappingService.saveMetaobjectMapping({
        externalMetaobjectId,
        shopifyMetaobjectId,
        metaobjectHandle,
        metaobjectType, // Use Shopify type here
        metaobjectHash // Pass the hash
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
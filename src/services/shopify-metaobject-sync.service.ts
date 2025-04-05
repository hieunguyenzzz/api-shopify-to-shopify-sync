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
    
    // Check if metaobject already exists
    const existingMetaobject = await this.checkMetaobjectByHandle(
      externalMetaobject.handle, 
      externalMetaobject.type
    );
    
    // Process fields for MetaobjectFieldInput - only include key and value, not type
    const processedFields = externalMetaobject.fields.map(field => {
      return {
        key: field.key,
        value: field.value
      };
    });
    
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

    return { input: {...metaobjectInput, type: externalMetaobject.type} };
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
  async syncMetaobject(externalMetaobject: ExternalMetaobject): Promise<ShopifyMetaobject> {
    try {
      // Prepare metaobject data
      const metaobjectData = await this.prepareMetaobjectData(externalMetaobject);
      
      // Check if we already have a mapping for this metaobject
      const existingMapping = await metaobjectMappingService.getMappingByHandle(externalMetaobject.handle);
      
      if (metaobjectData.id || existingMapping) {
        // Update existing metaobject
        const shopifyId = metaobjectData.id || existingMapping?.shopifyMetaobjectId;
        
        if (!shopifyId) {
          throw new Error(`Cannot update metaobject: missing Shopify ID for ${externalMetaobject.handle}`);
        }
        
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
      } else {
        // Create new metaobject
        return await this.createMetaobject({
          input: metaobjectData.input,
          externalMetaobjectId: externalMetaobject.id
        });
      }
    } catch (error) {
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
          results.push(result);
          console.log(`✅ Synced metaobject: ${metaobject.handle}`);
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
import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { ExternalRedirect } from '../types/shopify-sync';
import { 
  URL_REDIRECT_CREATE_MUTATION,
  URL_REDIRECT_UPDATE_MUTATION,
  URL_REDIRECTS_QUERY
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { redirectMappingService } from './redirect-mapping.service';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

// Define response types
interface ShopifyRedirect {
  id: string;
  path: string;
  target: string;
}

interface RedirectEdge {
  node: ShopifyRedirect;
}

interface RedirectsResponse {
  urlRedirects: {
    edges: RedirectEdge[];
  };
}

interface RedirectCreateResponse {
  urlRedirectCreate: {
    urlRedirect: ShopifyRedirect;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface RedirectUpdateResponse {
  urlRedirectUpdate: {
    urlRedirect: ShopifyRedirect;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface ExternalRedirectsResponse {
  success: boolean;
  redirects: ExternalRedirect[];
}

export class ShopifyRedirectSyncService {
  private graphqlClient: GraphQLClient;
  private externalRedirectsApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalRedirectsApiUrl = `${externalApiBaseUrl}/api/redirects`;
  }

  // Generate a hash for a redirect based on its properties
  private generateRedirectHash(redirect: ExternalRedirect): string {
    // Combine path and target to create a unique hash
    const redirectData = [
      redirect.path,
      redirect.target
    ].join('|');

    return crypto.createHash('md5').update(redirectData).digest('hex');
  }

  // Fetch redirects from external API
  async fetchExternalRedirects(): Promise<ExternalRedirect[]> {
    try {
      console.log('🔍 Fetching external redirects...');
      const response = await axios.get<ExternalRedirectsResponse>(this.externalRedirectsApiUrl);
      
      if (!response.data.success) {
        throw new Error('External API reported unsuccessful response');
      }
      
      console.log(`✅ Successfully fetched ${response.data.redirects.length} redirects`);
      return response.data.redirects;
    } catch (error) {
      console.error('❌ Error fetching external redirects:', error);
      throw error;
    }
  }

  // Check if redirect exists by path
  async checkRedirectByPath(path: string): Promise<ShopifyRedirect | null> {
    try {
      console.log(`🔍 Checking for existing redirect with path: ${path}`);
      
      const response = await this.graphqlClient.request<RedirectsResponse>(
        URL_REDIRECTS_QUERY, 
        { 
          query: `path:${path}`,
          first: 1
        }
      );

      // Extract the first redirect from the edges array if it exists
      const existingRedirect = response.urlRedirects.edges.length > 0 
        ? response.urlRedirects.edges[0].node 
        : null;
      
      if (existingRedirect) {
        console.log(`✅ Found existing redirect: ${existingRedirect.path} -> ${existingRedirect.target} (ID: ${existingRedirect.id})`);
        return existingRedirect;
      }
      
      console.log(`❌ No redirect found with path: ${path}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking redirect by path:', error);
      return null;
    }
  }

  // Prepare redirect data for create/update
  async prepareRedirectData(externalRedirect: ExternalRedirect) {
    try {
      console.log(`🔧 Preparing redirect data for sync: ${externalRedirect.path} -> ${externalRedirect.target}`);
      
      const redirectInput = {
        path: externalRedirect.path,
        target: externalRedirect.target
      };

      return { input: redirectInput };
    } catch (error) {
      console.error(`❌ Error preparing redirect data for ${externalRedirect.path}:`, error);
      throw error;
    }
  }

  // Create a new redirect
  async createRedirect(redirectData: { input: any, externalRedirectId: string, redirectHash: string }): Promise<ShopifyRedirect> {
    try {
      console.log(`🔧 Creating new redirect: ${redirectData.input.path} -> ${redirectData.input.target}`);
      
      const response = await this.graphqlClient.request<RedirectCreateResponse>(
        URL_REDIRECT_CREATE_MUTATION,
        { urlRedirect: redirectData.input }
      );
      
      if (response.urlRedirectCreate.userErrors.length > 0) {
        console.error('❌ Error creating redirect:', response.urlRedirectCreate.userErrors);
        throw new Error(`Failed to create redirect: ${response.urlRedirectCreate.userErrors[0].message}`);
      }
      
      const redirectId = response.urlRedirectCreate.urlRedirect.id;
      const redirectPath = response.urlRedirectCreate.urlRedirect.path;
      
      console.log(`✅ Successfully created redirect: ${redirectData.input.path} -> ${redirectData.input.target} (ID: ${redirectId})`);
      
      // Save mapping with hash
      await this.createRedirectMapping(redirectData.externalRedirectId, redirectId, redirectPath, redirectData.redirectHash);
      
      return response.urlRedirectCreate.urlRedirect;
    } catch (error) {
      console.error('❌ Error creating redirect:', error);
      throw error;
    }
  }

  // Update an existing redirect
  async updateRedirect(redirectData: { input: any, id: string, redirectHash: string, externalRedirectId: string }): Promise<ShopifyRedirect> {
    try {
      console.log(`🔧 Updating redirect: ${redirectData.input.path} -> ${redirectData.input.target}`);
      
      const response = await this.graphqlClient.request<RedirectUpdateResponse>(
        URL_REDIRECT_UPDATE_MUTATION,
        { 
          id: redirectData.id, 
          urlRedirect: redirectData.input 
        }
      );
      
      if (response.urlRedirectUpdate.userErrors.length > 0) {
        console.error('❌ Error updating redirect:', response.urlRedirectUpdate.userErrors);
        throw new Error(`Failed to update redirect: ${response.urlRedirectUpdate.userErrors[0].message}`);
      }
      
      console.log(`✅ Successfully updated redirect: ${redirectData.input.path} -> ${redirectData.input.target}`);
      
      // Update mapping with new hash
      await this.updateRedirectMapping(
        redirectData.externalRedirectId, 
        redirectData.id, 
        response.urlRedirectUpdate.urlRedirect.path, 
        redirectData.redirectHash
      );
      
      return response.urlRedirectUpdate.urlRedirect;
    } catch (error) {
      console.error('❌ Error updating redirect:', error);
      throw error;
    }
  }

  // Create or update a redirect based on whether it exists
  async syncRedirect(externalRedirect: ExternalRedirect): Promise<ShopifyRedirect | null> {
    try {
      console.log(`🔄 Syncing redirect: ${externalRedirect.path} -> ${externalRedirect.target}`);
      
      // Generate hash for current redirect
      const redirectHash = this.generateRedirectHash(externalRedirect);
      
      // Check if we already have this redirect with the same hash
      await redirectMappingService.initialize();
      const existingMapping = await redirectMappingService.getMappingByPath(externalRedirect.path);
      
      if (existingMapping && existingMapping.redirectHash === redirectHash) {
        console.log(`⏭️ Skipping redirect ${externalRedirect.path} - no changes detected (hash: ${redirectHash})`);
        return null;
      } else if (existingMapping) {
        console.log(`🔄 Redirect ${externalRedirect.path} has changed - updating (old hash: ${existingMapping.redirectHash}, new hash: ${redirectHash})`);
      } else {
        console.log(`🆕 New redirect detected: ${externalRedirect.path} -> ${externalRedirect.target} (hash: ${redirectHash})`);
      }
      
      const redirectData = await this.prepareRedirectData(externalRedirect);
      const existingRedirect = await this.checkRedirectByPath(externalRedirect.path);
      
      let result: ShopifyRedirect;
      
      if (existingRedirect) {
        result = await this.updateRedirect({
          input: redirectData.input,
          id: existingRedirect.id,
          redirectHash,
          externalRedirectId: externalRedirect.id
        });
      } else {
        result = await this.createRedirect({
          input: redirectData.input,
          externalRedirectId: externalRedirect.id,
          redirectHash
        });
      }
            
      return result;
    } catch (error) {
      console.error(`❌ Error syncing redirect ${externalRedirect.path}:`, error);
      throw error;
    }
  }

  // Create mapping between external redirect ID and Shopify redirect ID
  private async createRedirectMapping(
    externalRedirectId: string, 
    shopifyRedirectId: string, 
    redirectPath: string, 
    redirectHash: string
  ): Promise<void> {
    try {
      await redirectMappingService.saveRedirectMapping({
        externalRedirectId,
        shopifyRedirectId,
        redirectPath,
        redirectHash
      });
      
      console.log(`✅ Successfully mapped external redirect ${externalRedirectId} to Shopify redirect ${shopifyRedirectId} with hash ${redirectHash}`);
    } catch (error) {
      console.error(`❌ Error creating redirect mapping for ${externalRedirectId}:`, error);
      throw error;
    }
  }

  // Update existing redirect mapping with new hash
  private async updateRedirectMapping(
    externalRedirectId: string, 
    shopifyRedirectId: string, 
    redirectPath: string, 
    redirectHash: string
  ): Promise<void> {
    try {
      await redirectMappingService.saveRedirectMapping({
        externalRedirectId,
        shopifyRedirectId,
        redirectPath,
        redirectHash
      });
      
      console.log(`✅ Successfully updated mapping for redirect ${redirectPath} with new hash ${redirectHash}`);
    } catch (error) {
      console.error(`❌ Error updating redirect mapping for ${externalRedirectId}:`, error);
      throw error;
    }
  }

  // Main function to sync all redirects
  async syncRedirects(limit?: number): Promise<any[]> {
    try {
      console.log('🔄 Starting redirect sync process...');
      
      // Initialize mapping service
      await redirectMappingService.initialize();
      
      const externalRedirects = await this.fetchExternalRedirects();
      const redirectsToSync = limit ? externalRedirects.slice(0, limit) : externalRedirects;
      
      console.log(`🔄 Syncing ${redirectsToSync.length} redirects...`);
      
      const results = [];
      const skippedByHash = [];
      
      for (const redirect of redirectsToSync) {
        try {
          const result = await this.syncRedirect(redirect);
          
          // Check if sync was skipped due to unchanged hash
          if (result === null) {
            const redirectHash = this.generateRedirectHash(redirect);
            const existingMapping = await redirectMappingService.getMappingByPath(redirect.path);
            
            if (existingMapping && existingMapping.redirectHash === redirectHash) {
              skippedByHash.push(redirect);
              results.push({
                path: redirect.path,
                target: redirect.target,
                status: 'skipped',
                reason: 'No changes detected (hash match)'
              });
            }
          } else {
            results.push({
              path: redirect.path,
              target: redirect.target,
              status: 'success',
              shopifyId: result.id
            });
          }
        } catch (error) {
          console.error(`❌ Error syncing redirect ${redirect.path}:`, error);
          results.push({
            path: redirect.path,
            target: redirect.target,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      console.log(`✅ Redirect sync completed. Success: ${results.filter(r => r.status === 'success').length}, Failed: ${results.filter(r => r.status === 'error').length}, Skipped: ${results.filter(r => r.status === 'skipped').length} (${skippedByHash.length} due to no changes)`);
      
      return results;
    } catch (error) {
      console.error('❌ Error in redirect sync process:', error);
      throw error;
    }
  }
}

export const shopifyRedirectSyncService = new ShopifyRedirectSyncService(); 
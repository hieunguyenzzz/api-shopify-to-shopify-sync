import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { ExternalPage } from '../types/shopify-sync';
import { 
  PAGE_CREATE_MUTATION,
  PAGE_UPDATE_MUTATION,
  PAGES_QUERY
} from '../graphql/shopify-mutations';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { pageMappingService } from './page-mapping.service';
import { metaobjectMappingService } from './metaobject-mapping.service';

// Custom error for missing mappings
class MissingMetaobjectMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingMetaobjectMappingError';
  }
}

// Load environment variables
dotenv.config();

// Define response types
interface ShopifyPage {
  id: string;
  title: string;
  handle: string;
  body?: string;
  bodySummary?: string;
  createdAt?: string;
  updatedAt?: string;
  onlineStoreUrl?: string;
  metafields?: {
    edges: Array<{
      node: {
        id: string;
        namespace: string;
        key: string;
        value: string;
      }
    }>
  };
}

interface PageEdge {
  node: ShopifyPage;
}

interface PagesResponse {
  pages: {
    edges: PageEdge[];
  };
}

interface PageCreateResponse {
  pageCreate: {
    page: ShopifyPage;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface PageUpdateResponse {
  pageUpdate: {
    page: ShopifyPage;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

interface ExternalPagesResponse {
  pages: ExternalPage[];
}

export class ShopifyPageSyncService {
  private graphqlClient: GraphQLClient;
  private externalPagesApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalPagesApiUrl = `${externalApiBaseUrl}/api/pages`;
  }

  // Fetch pages from external API
  async fetchExternalPages(): Promise<ExternalPage[]> {
    try {
      console.log('🔍 Fetching external pages...');
      const response = await axios.get<ExternalPagesResponse>(this.externalPagesApiUrl);
      console.log(`✅ Successfully fetched ${response.data.pages.length} pages`);
      return response.data.pages;
    } catch (error) {
      console.error('❌ Error fetching external pages:', error);
      throw error;
    }
  }

  // Check if page exists by handle
  async checkPageByHandle(handle: string): Promise<ShopifyPage | null> {
    try {
      console.log(`🔍 Checking for existing page with handle: ${handle}`);
      
      const response = await this.graphqlClient.request<PagesResponse>(
        PAGES_QUERY, 
        { 
          query: `handle:${handle}`,
          first: 1
        }
      );

      // Extract the first page from the edges array if it exists
      const existingPage = response.pages.edges.length > 0 
        ? response.pages.edges[0].node 
        : null;
      
      if (existingPage) {
        console.log(`✅ Found existing page: ${existingPage.title} (ID: ${existingPage.id})`);
        return existingPage;
      }
      
      console.log(`❌ No page found with handle: ${handle}`);
      return null;
    } catch (error) {
      console.error('❌ Error checking page by handle:', error);
      return null;
    }
  }

  // Prepare page data for create/update
  async preparePageData(externalPage: ExternalPage) {
    try {
      console.log(`🔧 Preparing page data for sync: ${externalPage.title}`);
      
      const existingPage = await this.checkPageByHandle(externalPage.handle);
      const processedBodyHtml = externalPage.bodyHtml.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design");
      
      const processedMetafields = externalPage.metafields 
        ? await Promise.all(externalPage.metafields.map(async (metafield) => {
            if (metafield.type === 'metaobject_reference') {
              await metaobjectMappingService.initialize();
              const externalMetaobjectId = metafield.value;
              const shopifyMetaobjectId = await metaobjectMappingService.getShopifyMetaobjectId(externalMetaobjectId);
              
              if (shopifyMetaobjectId) {
                return {
                  namespace: metafield.namespace,
                  key: metafield.key,
                  value: shopifyMetaobjectId,
                  type: metafield.type,
                };
              } else {
                // Throw specific error if mapping is missing
                throw new MissingMetaobjectMappingError(`Could not find Shopify metaobject ID for external ID: ${externalMetaobjectId} on page ${externalPage.handle}.`);
              }
            } else {
              return {
                namespace: metafield.namespace,
                key: metafield.key,
                value: metafield.value.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design"),
                type: metafield.type,
              };
            }
          })) 
        : [];

      // No need to filter nulls anymore as we throw an error
      const finalMetafields = processedMetafields;

      const pageInput = {
        title: externalPage.title.replace(/Soundbox Store/g, "Quell Design").replace(/Sound box Store/g, "Quell Design"),
        handle: externalPage.handle,
        body: processedBodyHtml,
        isPublished: true,
        templateSuffix: externalPage.templateSuffix,
        metafields: finalMetafields,
      };

      if (existingPage) {
        // For update, we need the ID
        return {
          input: {
            id: existingPage.id,
            ...pageInput
          }
        };
      }

      return { input: pageInput };
    } catch (error) {
      if (error instanceof MissingMetaobjectMappingError) {
        console.warn(`⚠️ Skipping page ${externalPage.handle}: ${error.message}`);
        return null; // Signal preparation failure
      } else {
        // Re-throw other unexpected errors
        console.error(`❌ Unexpected error preparing page data for ${externalPage.handle}:`, error);
        throw error;
      }
    }
  }

  // Create a new page
  async createPage(pageData: { input: any, externalPageId: string }): Promise<ShopifyPage> {
    try {
      console.log(`🔧 Creating new page: ${pageData.input.title}`);
      
      const response = await this.graphqlClient.request<PageCreateResponse>(
        PAGE_CREATE_MUTATION,
        { page: pageData.input }
      );
      
      if (response.pageCreate.userErrors.length > 0) {
        console.error('❌ Error creating page:', response.pageCreate.userErrors);
        throw new Error(`Failed to create page: ${response.pageCreate.userErrors[0].message}`);
      }
      
      const pageId = response.pageCreate.page.id;
      const handle = response.pageCreate.page.handle;
      
      console.log(`✅ Successfully created page: ${pageData.input.title} (ID: ${pageId})`);
      
      // Save mapping
      await this.createPageMapping(pageData.externalPageId || pageData.input.handle, pageId, handle);
      
      return response.pageCreate.page;
    } catch (error) {
      console.error('❌ Error creating page:', error);
      throw error;
    }
  }

  // Update an existing page
  async updatePage(pageData: { input: any }): Promise<ShopifyPage> {
    try {
      console.log(`🔧 Updating page: ${pageData.input.title}`);
      
      // Extract the ID from the input and remove it from the page data
      const { id, ...pageInput } = pageData.input;
      
      const response = await this.graphqlClient.request<PageUpdateResponse>(
        PAGE_UPDATE_MUTATION,
        { 
          id, 
          page: pageInput 
        }
      );
      
      if (response.pageUpdate.userErrors.length > 0) {
        console.error('❌ Error updating page:', response.pageUpdate.userErrors);
        throw new Error(`Failed to update page: ${response.pageUpdate.userErrors[0].message}`);
      }
      
      console.log(`✅ Successfully updated page: ${pageData.input.title}`);
      
      return response.pageUpdate.page;
    } catch (error) {
      console.error('❌ Error updating page:', error);
      throw error;
    }
  }

  // Create or update a page based on whether it exists
  async syncPage(externalPage: ExternalPage): Promise<ShopifyPage | null> {
    try {
      console.log(`🔄 Syncing page: ${externalPage.title}`);
      
      const pageData = await this.preparePageData(externalPage);
      
      // If preparePageData returned null, skip this page
      if (!pageData) {
        console.log(`⏭️ Skipping sync for page ${externalPage.handle} due to missing metaobject mapping.`);
        return null; 
      }

      const existingPage = await this.checkPageByHandle(externalPage.handle);
      
      let result: ShopifyPage;
      
      if (existingPage) {
        result = await this.updatePage({
          input: {
            ...pageData.input,
            id: existingPage.id
          }
        });
      } else {
        // Store externalPageId in a separate variable since it's not part of the PageCreateInput
        const externalPageId = externalPage.id;
        result = await this.createPage({
          input: pageData.input,
          externalPageId  // Pass this separately for mapping purposes
        });
      }
      
      // Check if mapping exists and create it if it doesn't
      await this.ensurePageMapping(externalPage.id, result.id, result.handle);
      
      return result;
    } catch (error) {
      console.error(`❌ Error syncing page ${externalPage.title}:`, error);
      throw error;
    }
  }

  // Ensure mapping exists between external page ID and Shopify page ID
  private async ensurePageMapping(externalPageId: string, shopifyPageId: string, pageHandle: string): Promise<void> {
    try {
      // Initialize the page mapping service
      await pageMappingService.initialize();
      
      // Check if mapping already exists by external ID
      const existingShopifyId = await pageMappingService.getShopifyPageId(externalPageId);
      // Check if mapping already exists by handle
      const existingHandleMapping = await pageMappingService.getMappingByHandle(pageHandle);
      
      if (!existingShopifyId && !existingHandleMapping) {
        // Create new mapping if it doesn't exist
        await this.createPageMapping(externalPageId, shopifyPageId, pageHandle);
      } else if (existingShopifyId && existingShopifyId !== shopifyPageId) {
        // Update mapping if the Shopify ID has changed
        console.log(`ℹ️ Updating page mapping for external ID ${externalPageId}`);
        await pageMappingService.savePageMapping({
          externalPageId,
          shopifyPageId,
          pageHandle
        });
      } else if (existingHandleMapping && existingHandleMapping.externalPageId !== externalPageId) {
        // Update mapping if the external ID has changed but handle remains the same
        console.log(`ℹ️ Updating page mapping for handle ${pageHandle}`);
        await pageMappingService.savePageMapping({
          externalPageId,
          shopifyPageId,
          pageHandle
        });
      } else {
        console.log(`✅ Page mapping already exists for ${pageHandle}`);
      }
    } catch (error) {
      console.error(`❌ Error ensuring page mapping: ${error}`);
      // Don't throw the error - just log it so sync can continue
    }
  }

  // Create mapping between external page ID and Shopify page ID
  private async createPageMapping(externalPageId: string, shopifyPageId: string, pageHandle: string): Promise<void> {
    try {
      await pageMappingService.savePageMapping({
        externalPageId,
        shopifyPageId,
        pageHandle
      });
      
      console.log(`✅ Successfully mapped external page ${externalPageId} to Shopify page ${shopifyPageId}`);
    } catch (error) {
      console.error(`❌ Error creating page mapping for ${externalPageId}:`, error);
      throw error;
    }
  }

  // Main function to sync all pages
  async syncPages(limit?: number): Promise<any[]> {
    try {
      console.log('🔄 Starting page sync process...');
      
      const externalPages = await this.fetchExternalPages();
      const pagesToSync = limit ? externalPages.slice(0, limit) : externalPages;
      
      console.log(`🔄 Syncing ${pagesToSync.length} pages...`);
      
      const results = [];
      
      for (const page of pagesToSync) {
        try {
          const result = await this.syncPage(page);
          
          // Check if sync was skipped
          if (result === null) {
            results.push({
              title: page.title,
              handle: page.handle,
              status: 'skipped',
              reason: 'Missing metaobject mapping'
            });
          } else {
            results.push({
              title: page.title,
              handle: page.handle,
              status: 'success',
              shopifyId: result.id
            });
          }
        } catch (error) {
          console.error(`❌ Error syncing page ${page.title}:`, error);
          results.push({
            title: page.title,
            handle: page.handle,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      console.log(`✅ Page sync completed. Success: ${results.filter(r => r.status === 'success').length}, Failed: ${results.filter(r => r.status === 'error').length}, Skipped: ${results.filter(r => r.status === 'skipped').length}`);
      
      return results;
    } catch (error) {
      console.error('❌ Error in page sync process:', error);
      throw error;
    }
  }
}

export const shopifyPageSyncService = new ShopifyPageSyncService(); 
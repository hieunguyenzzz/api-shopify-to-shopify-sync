import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { FILE_CREATE_MUTATION } from '../graphql/shopify-mutations';
import mongoDBService from './mongodb.service';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

// Define response types
interface ShopifyFile {
  id: string;
  filename: string;
  url: string;
  mediaType: string;
  originalUploadSize: number;
  createdAt: string;
  updatedAt: string;
  status: string;
  mimeType: string;
}

interface ExternalFilesResponse {
  success: boolean;
  files: ShopifyFile[];
  totalFiles: number;
  timestamp: string;
  fromCache: boolean;
  estimatedTokens: number;
}

interface FileCreateResponse {
  fileCreate: {
    files: Array<{
      id: string;
      alt: string;
      createdAt: string;
    }>;
    userErrors: Array<{
      field: string;
      message: string;
    }>;
  }
}

class ShopifyFileSyncService {
  private graphqlClient: GraphQLClient;
  private externalFilesApiUrl: string;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalFilesApiUrl = `${externalApiBaseUrl}/api/files`;
  }

  // Fetch files from external API
  async fetchExternalFiles(): Promise<ShopifyFile[]> {
    try {
      console.log('🔍 Fetching external files...');
      const response = await axios.get<ExternalFilesResponse>(this.externalFilesApiUrl);
      console.log(`✅ Successfully fetched ${response.data.files.length} files out of ${response.data.totalFiles} total files`);
      return response.data.files;
    } catch (error) {
      console.error('❌ Error fetching external files:', error);
      throw error;
    }
  }

  // Generate a hash for a file based on its properties
  private generateFileHash(file: ShopifyFile): string {
    const fileData = `${file.filename}|${file.url}|${file.mediaType}|${file.mimeType}`;
    return crypto.createHash('md5').update(fileData).digest('hex');
  }

  // Check if a file is already in our database
  async checkFileByHash(fileHash: string): Promise<boolean> {
    try {
      const existingFile = await mongoDBService.findFileByHash(fileHash);
      return existingFile !== null;
    } catch (error) {
      console.error('❌ Error checking file by hash:', error);
      return false;
    }
  }

  // Create a file mapping
  async createFileMapping(fileHash: string, shopifyFileId: string, externalFileId: string, url: string, mimeType: string): Promise<void> {
    try {
      const success = await mongoDBService.saveFileMapping(fileHash, shopifyFileId, externalFileId, url, mimeType);
      if (success) {
        console.log(`✅ Successfully created file mapping for file ID: ${shopifyFileId} (External ID: ${externalFileId})`);
      } else {
        console.error(`❌ Failed to create file mapping for file ID: ${shopifyFileId}`);
      }
    } catch (error) {
      console.error('❌ Error creating file mapping:', error);
      throw error;
    }
  }

  // Sync a single file
  async syncFile(file: ShopifyFile): Promise<boolean> {
    try {
      console.log(`🔄 Syncing file: ${file.filename}`);
      
      // Generate hash for the file
      const fileHash = this.generateFileHash(file);
      
      // Check if the file already exists in our database
      const fileExists = await this.checkFileByHash(fileHash);
      
      if (fileExists) {
        console.log(`✅ File already exists in the database: ${file.filename}`);
        return true;
      }
      
      // Check if the mediaType is 'OTHER' and skip if it is
      if (file.mediaType === 'OTHER') {
        console.log(`⏭️ Skipping file with mediaType 'OTHER': ${file.filename}`);
        // We return true because skipping isn't an error, the sync process for this file just doesn't proceed.
        // If you want skipped files to be counted differently, you might adjust the return value or add logging elsewhere.
        return true;
      }
      
      // File doesn't exist in DB, create it in Shopify
      console.log(`🚀 File not found in DB. Creating file in Shopify: ${file.filename}`);

      // Prepare input for the fileCreate mutation
      // Assuming file.mediaType is compatible with Shopify's FileContentType enum (e.g., 'IMAGE', 'VIDEO')
      const fileInput = {
        originalSource: file.url,
        filename: file.filename,
        contentType: file.mediaType, // Use mediaType from the external API response
        // alt: file.filename // Optional: Add alt text if desired
      };

      try {
          const response = await this.graphqlClient.request<FileCreateResponse>(
              FILE_CREATE_MUTATION,
              { files: [fileInput] } // The mutation expects an array of files
          );

          if (response.fileCreate.userErrors && response.fileCreate.userErrors.length > 0) {
              console.error(`❌ Shopify API Error creating file ${file.filename}:`, response.fileCreate.userErrors);
              return false; // Fail the sync for this file if Shopify returns errors
          }

          // Check if files array exists and has elements
          if (!response.fileCreate.files || response.fileCreate.files.length === 0) {
               console.error(`❌ Shopify API did not return file data for ${file.filename}`);
               return false; 
          }

          const createdShopifyFile = response.fileCreate.files[0];

          // Check if the created file object and its ID are valid
          if (!createdShopifyFile || !createdShopifyFile.id) {
               console.error(`❌ Shopify API returned invalid file data for ${file.filename}`);
               return false;
          }

          const newShopifyFileId = createdShopifyFile.id;
          console.log(`✅ Successfully created file in Shopify: ${file.filename} (ID: ${newShopifyFileId})`);

          // Now store the mapping with the *new* Shopify file ID from the mutation response
          await this.createFileMapping(fileHash, newShopifyFileId, file.id, file.url, file.mimeType);

          return true; // Successfully created in Shopify and mapped

      } catch (gqlError) {
           console.error(`❌ GraphQL Error creating file ${file.filename} in Shopify:`, gqlError);
           return false; // Fail the sync for this file if the GraphQL request fails
      }
      
    } catch (error) {
      console.error(`❌ Top-level error syncing file ${file.filename}:`, error);
      return false;
    }
  }

  // Sync all files
  async syncFiles(limit?: number): Promise<ShopifyFile[]> {
    try {
      console.log('🔄 Starting file sync process...');
      
      // Initialize MongoDB connection if not already initialized
      await mongoDBService.initialize();
      
      // Fetch files from external API
      const externalFiles = await this.fetchExternalFiles();
      
      // Apply limit if specified
      const filesToSync = limit ? externalFiles.slice(0, limit) : externalFiles;
      
      console.log(`🔄 Syncing ${filesToSync.length} files...`);
      
      const syncedFiles: ShopifyFile[] = [];
      
      // Process files in sequence to avoid rate limiting
      for (const file of filesToSync) {
        const success = await this.syncFile(file);
        if (success) {
          // Only add successfully synced files (including skipped ones, if 'true' is returned)
          // Adjust logic here if skipped files shouldn't be in the final `syncedFiles` array
          syncedFiles.push(file);
        }
      }
      
      console.log(`✅ Sync completed. Successfully processed ${syncedFiles.length} out of ${filesToSync.length} files.`);
      
      return syncedFiles;
    } catch (error) {
      console.error('❌ Error syncing files:', error);
      throw error;
    }
  }
}

export const shopifyFileSyncService = new ShopifyFileSyncService(); 
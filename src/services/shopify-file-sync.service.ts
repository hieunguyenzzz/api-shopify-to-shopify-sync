import axios from 'axios';
import dotenv from 'dotenv';
import { GraphQLClient } from 'graphql-request';
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { FILE_CREATE_MUTATION, STAGED_UPLOADS_CREATE_MUTATION } from '../graphql/shopify-mutations';
import mongoDBService, { FileMappingDocument } from './mongodb.service';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import FormData from 'form-data';

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
  alt?: string;
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

interface StagedUploadResponse {
  stagedUploadsCreate: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{
        name: string;
        value: string;
      }>;
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
  private fileMappingsCache: Map<string, FileMappingDocument> | null = null;

  constructor() {
    this.graphqlClient = createShopifyGraphQLClient();
    const externalApiBaseUrl = process.env.EXTERNAL_API_URL || 'http://localhost:5173';
    this.externalFilesApiUrl = `${externalApiBaseUrl}/api/files`;
  }

  // Load all file mappings from MongoDB
  private async loadFileMappings(): Promise<void> {
    if (this.fileMappingsCache === null) {
      this.fileMappingsCache = await mongoDBService.getAllFileMappings();
      console.log(`📋 Loaded ${this.fileMappingsCache.size} file mappings from MongoDB`);
    }
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

  // Check if a file is already in our database using the cache
  async checkFileByHash(fileHash: string): Promise<boolean> {
    try {
      await this.loadFileMappings();
      return this.fileMappingsCache!.has(fileHash);
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
        // Update the cache with the new mapping
        if (this.fileMappingsCache !== null) {
          const now = new Date();
          this.fileMappingsCache.set(fileHash, {
            fileHash,
            shopifyFileId,
            externalFileId,
            url,
            mimeType,
            createdAt: now,
            lastUsed: now
          });
        }
        console.log(`✅ Successfully created file mapping for file ID: ${shopifyFileId} (External ID: ${externalFileId})`);
      } else {
        console.error(`❌ Failed to create file mapping for file ID: ${shopifyFileId}`);
      }
    } catch (error) {
      console.error('❌ Error creating file mapping:', error);
      throw error;
    }
  }

  // Helper function to get file size from URL
  private async getFileSizeFromUrl(url: string): Promise<number> {
    try {
      const response = await axios.head(url);
      const contentLength = response.headers['content-length'];
      return contentLength ? parseInt(contentLength, 10) : 0;
    } catch (error) {
      console.error(`❌ Error getting file size for URL ${url}:`, error);
      return 0;
    }
  }

  // Helper function to download file from URL to temp directory
  private async downloadFile(url: string, filename: string): Promise<string> {
    try {
      const tempDir = path.join(__dirname, '../../temp');
      
      // Create temp directory if it doesn't exist
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const filePath = path.join(tempDir, filename);
      const writer = fs.createWriteStream(filePath);
      
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      });
      
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
      });
    } catch (error) {
      console.error(`❌ Error downloading file from ${url}:`, error);
      throw error;
    }
  }

  // Upload video file using staged uploads
  private async uploadVideoFile(file: ShopifyFile): Promise<string | null> {
    try {
      console.log(`🎬 Processing video file: ${file.filename}`);
      
      // 1. Get file size
      const fileSize = await this.getFileSizeFromUrl(file.url);
      if (!fileSize) {
        console.error(`❌ Could not determine file size for ${file.filename}`);
        return null;
      }
      
      // Extract the file extension from the URL
      const urlExtension = this.getFileExtensionFromUrl(file.url);
      // Ensure the filename has the correct extension
      const filename = this.ensureCorrectFileExtension(file.filename, urlExtension);
      
      // 2. Create staged upload
      const stagedUploadInput = {
        filename,
        mimeType: file.mimeType,
        resource: "VIDEO",
        fileSize: String(fileSize),
        httpMethod: "POST"
      };
      
      const stagedUploadResponse = await this.graphqlClient.request<StagedUploadResponse>(
        STAGED_UPLOADS_CREATE_MUTATION,
        { input: [stagedUploadInput] }
      );
      
      if (stagedUploadResponse.stagedUploadsCreate.userErrors.length > 0) {
        console.error(`❌ Staged upload creation failed for ${file.filename}:`, 
          stagedUploadResponse.stagedUploadsCreate.userErrors);
        return null;
      }
      
      const stagedTarget = stagedUploadResponse.stagedUploadsCreate.stagedTargets[0];
      const { url, parameters, resourceUrl } = stagedTarget;
      
      // 3. Download the file to a temp location
      const tempFilePath = await this.downloadFile(file.url, filename);
      
      // 4. Upload file to staged URL
      const formData = new FormData();
      
      // Add all parameters from the staged upload response
      parameters.forEach(param => {
        formData.append(param.name, param.value);
      });
      
      // Add the file itself
      const fileBuffer = await promisify(fs.readFile)(tempFilePath);
      formData.append('file', fileBuffer, {
        filename,
        contentType: file.mimeType
      });
      
      // Upload to the staged URL
      await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders()
        }
      });
      
      // 5. Clean up the temp file
      await promisify(fs.unlink)(tempFilePath);
      
      console.log(`✅ Successfully uploaded video to staged URL for ${file.filename}`);
      
      // Return the resourceUrl to be used in fileCreate mutation
      return resourceUrl;
      
    } catch (error) {
      console.error(`❌ Error uploading video file ${file.filename}:`, error);
      return null;
    }
  }

  // Helper function to get file extension from URL
  private getFileExtensionFromUrl(url: string): string {
    // Parse the URL to extract the extension
    try {
      const urlPath = new URL(url).pathname;
      const extension = path.extname(urlPath);
      return extension || '.mp4'; // Default to .mp4 if no extension found
    } catch (error) {
      console.warn(`⚠️ Failed to extract file extension from URL: ${url}`);
      return '.mp4'; // Default to .mp4
    }
  }

  // Helper function to ensure filename has correct extension
  private ensureCorrectFileExtension(filename: string, requiredExtension: string): string {
    // If the filename already has the correct extension, return it as is
    if (path.extname(filename) === requiredExtension) {
      return filename;
    }
    
    // Strip any existing extension and add the required one
    const nameWithoutExtension = path.basename(filename, path.extname(filename));
    const correctedFilename = `${nameWithoutExtension}${requiredExtension}`;
    
    console.log(`📝 Correcting filename extension: "${filename}" -> "${correctedFilename}"`);
    return correctedFilename;
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
        return true;
      } else if (file.mediaType === 'VIDEO') {
        console.log(`🎬 Detected video file: ${file.filename}`);
        
        // Special handling for video files
        const resourceUrl = await this.uploadVideoFile(file);
        
        if (!resourceUrl) {
          console.error(`❌ Failed to process video file: ${file.filename}`);
          return false;
        }
        
        // Extract the file extension from the URL and ensure filename has correct extension
        const urlExtension = this.getFileExtensionFromUrl(file.url);      
        
        // Create file in Shopify using the resource URL
        const fileInput: {
          originalSource: string;
          contentType: string;
          alt?: string;
        } = {
          originalSource: resourceUrl,
          contentType: file.mediaType
        };

        if (file.alt && typeof file.alt === 'string' && file.alt.trim() !== '') {
          fileInput.alt = file.alt;
        }
        
        try {
          const response = await this.graphqlClient.request<FileCreateResponse>(
            FILE_CREATE_MUTATION,
            { files: [fileInput] }
          );
          
          if (response.fileCreate.userErrors && response.fileCreate.userErrors.length > 0) {
            console.error(`❌ Shopify API Error creating video file ${file.filename}:`, response.fileCreate.userErrors);
            return false;
          }
          
          if (!response.fileCreate.files || response.fileCreate.files.length === 0) {
            console.error(`❌ Shopify API did not return file data for video ${file.filename}`);
            return false;
          }
          
          const createdShopifyFile = response.fileCreate.files[0];
          
          if (!createdShopifyFile || !createdShopifyFile.id) {
            console.error(`❌ Shopify API returned invalid file data for video ${file.filename}`);
            return false;
          }
          
          const newShopifyFileId = createdShopifyFile.id;
          console.log(`✅ Successfully created video file in Shopify: ${file.filename} (ID: ${newShopifyFileId})`);
          
          // Store the mapping
          await this.createFileMapping(fileHash, newShopifyFileId, file.id, file.url, file.mimeType);
          
          return true;
        } catch (gqlError) {
          console.error(`❌ GraphQL Error creating video file ${file.filename} in Shopify:`, gqlError);
          return false;
        }
      }
      
      // Handle non-video files with the original approach
      // File doesn't exist in DB, create it in Shopify
      console.log(`🚀 File not found in DB. Creating file in Shopify: ${file.filename}`);

      // Prepare input for the fileCreate mutation
      const fileInput: {
        originalSource: string;
        filename: string;
        contentType: string;
        alt?: string;
      } = {
        originalSource: file.url,
        filename: file.filename,
        contentType: file.mediaType,
      };

      // Add alt text if it exists and is a non-empty string on the source file object
      if (file.alt && typeof file.alt === 'string' && file.alt.trim() !== '') {
        fileInput.alt = file.alt;
      }

      try {
        const response = await this.graphqlClient.request<FileCreateResponse>(
          FILE_CREATE_MUTATION,
          { files: [fileInput] }
        );

        if (response.fileCreate.userErrors && response.fileCreate.userErrors.length > 0) {
          console.error(`❌ Shopify API Error creating file ${file.filename}:`, response.fileCreate.userErrors);
          return false;
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
      
      // Load all file mappings up front
      await this.loadFileMappings();
      
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
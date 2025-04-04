import fs from 'fs/promises';
import path from 'path';

interface VariantMapping {
  externalVariantId: string;
  shopifyVariantId: string;
  productHandle: string;
  sku: string;
  lastUpdated: string;
}

/**
 * Manages mappings between external variant IDs and Shopify variant IDs.
 * Provides functionality to save and retrieve mappings from a JSON file.
 */
export class VariantIdMapper {
  private mappingFilePath: string;
  private mappings: Record<string, VariantMapping> = {};
  private initialized = false;

  /**
   * Creates a new VariantIdMapper instance.
   * @param filePath Optional custom path for the mapping file
   */
  constructor(filePath?: string) {
    this.mappingFilePath = filePath || path.join(process.cwd(), 'data', 'variant-id-mappings.json');
  }

  /**
   * Initializes the mapper by loading existing mappings from file.
   * Creates the file if it doesn't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Ensure directory exists
      const dirPath = path.dirname(this.mappingFilePath);
      await fs.mkdir(dirPath, { recursive: true });
      
      try {
        // Try to read existing file
        const data = await fs.readFile(this.mappingFilePath, 'utf8');
        this.mappings = JSON.parse(data);
      } catch (error) {
        // File doesn't exist or is invalid, create empty mappings
        this.mappings = {};
        await this.saveMappings();
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('❌ Error initializing variant ID mapper:', error);
      throw error;
    }
  }

  /**
   * Saves the current mappings to the file.
   */
  private async saveMappings(): Promise<void> {
    try {
      await fs.writeFile(
        this.mappingFilePath, 
        JSON.stringify(this.mappings, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('❌ Error saving variant ID mappings:', error);
      throw error;
    }
  }

  /**
   * Adds or updates a mapping between external and Shopify variant IDs.
   */
  async addMapping(
    externalVariantId: string,
    shopifyVariantId: string,
    productHandle: string,
    sku: string
  ): Promise<void> {
    if (!this.initialized) await this.initialize();
    
    this.mappings[externalVariantId] = {
      externalVariantId,
      shopifyVariantId,
      productHandle,
      sku,
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveMappings();
  }

  /**
   * Gets the Shopify variant ID for a given external variant ID.
   * @returns The Shopify variant ID or null if not found
   */
  async getShopifyVariantId(externalVariantId: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();
    return this.mappings[externalVariantId]?.shopifyVariantId || null;
  }

  /**
   * Gets the external variant ID for a given Shopify variant ID.
   * @returns The external variant ID or null if not found
   */
  async getExternalVariantId(shopifyVariantId: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();
    
    for (const key in this.mappings) {
      if (this.mappings[key].shopifyVariantId === shopifyVariantId) {
        return this.mappings[key].externalVariantId;
      }
    }
    
    return null;
  }

  /**
   * Gets all variant mappings.
   */
  async getAllMappings(): Promise<Record<string, VariantMapping>> {
    if (!this.initialized) await this.initialize();
    return { ...this.mappings };
  }

  /**
   * Gets all mappings for a specific product handle.
   */
  async getMappingsByProduct(productHandle: string): Promise<VariantMapping[]> {
    if (!this.initialized) await this.initialize();
    
    return Object.values(this.mappings)
      .filter(mapping => mapping.productHandle === productHandle);
  }
}

// Export a singleton instance for convenience
export const variantIdMapper = new VariantIdMapper(); 
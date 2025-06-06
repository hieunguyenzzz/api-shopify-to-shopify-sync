# Shopify GraphQL Integration Project Analysis

## Project Overview

This project is a Node.js application built with TypeScript that integrates with Shopify's GraphQL API. The main purpose appears to be synchronizing data between Shopify and another system, likely a database. The application provides various API endpoints to trigger synchronization of different Shopify resources such as products, pages, metaobjects, files, collections, redirects, and price lists.

## Project Structure

```
├── src/
│   ├── api/               # API endpoint handlers
│   ├── graphql/           # GraphQL queries
│   ├── scripts/           # Utility scripts
│   ├── services/          # Service layer for business logic
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── index.ts           # Main application entry point
├── scripts/               # Build and configuration scripts
│   └── generate-shopify-types.js  # GraphQL code generation config
├── .env.example           # Example environment variables
├── package.json           # Project dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── Dockerfile             # Docker configuration
```

## Core Technologies

- **TypeScript**: The project is built with TypeScript for type safety
- **Express**: Web framework for handling HTTP requests
- **GraphQL/GraphQL-Codegen**: For querying the Shopify API and generating type definitions
- **MongoDB**: Used for storing mapping data and caching
- **Redis**: Likely used for caching or job queuing
- **dotenv**: For loading environment variables

## Main Features

The application provides a set of REST API endpoints to trigger synchronization of various Shopify resources:

1. **Product Synchronization** (`/api/sync-products`)
2. **Page Synchronization** (`/api/sync-pages`)
3. **Metaobject Synchronization** (`/api/sync-metaobjects`)
4. **File Synchronization** (`/api/sync-files`)
5. **Collection Synchronization** (`/api/sync-collections`)
6. **Redirect Synchronization** (`/api/sync-redirects`)
7. **Price List Synchronization** (`/api/sync-pricelists`)
8. **Full Synchronization** (`/api/sync-everything`)

## Service Architecture

The application uses several services to manage data mappings between Shopify and likely another system. These services handle the core business logic for data synchronization:

### Data Services

- **MongoDB Service** (`mongodb.service.ts`): General file caching and database operations
- **Variant ID Mapping Service** (`variant-id-mapping.service.ts`): Maps Shopify product variants to target system IDs
- **Page Mapping Service** (`page-mapping.service.ts`): Maps Shopify pages to target system pages
- **Metaobject Mapping Service** (`metaobject-mapping.service.ts`): Maps Shopify metaobjects to target system entities
- **MongoDB Collection Service** (`mongodb-collection.service.ts`): Maps Shopify collections to target system collections
- **Redirect Mapping Service** (`redirect-mapping.service.ts`): Maps Shopify redirects to target system redirects
- **Price List Mapping Service** (`pricelist-mapping.service.ts`): Maps Shopify price lists to target system pricing structures

### MongoDB Mapping Mechanisms

The project uses MongoDB as a persistence layer to store mappings between Shopify entities and their counterparts in the target system. Each entity type has its own dedicated mapping service with similar patterns but specific implementations:

#### 1. File Mapping (`mongodb.service.ts`)

**Document Structure:**
```typescript
interface FileMappingDocument {
  fileHash: string;       // MD5 hash of file properties for identification
  shopifyFileId: string;  // Shopify file ID (gid)
  externalFileId: string; // Target system file ID
  url: string;            // Original file URL
  mimeType: string;       // File MIME type
  createdAt: Date;        // When the mapping was created
  lastUsed: Date;         // When the mapping was last accessed
}
```

**Key Features:**
- Uses a singleton pattern for service instantiation
- Maintains an in-memory cache of file mappings for performance
- Creates unique indexes on `fileHash` for fast lookups
- Implements methods for finding files by hash or external ID
- Supports stale mapping detection and cleanup
- Handles file download and upload for various media types

#### 2. Variant Mapping (`variant-id-mapping.service.ts`)

**Document Structure:**
```typescript
interface VariantMappingDocument {
  externalVariantId: string; // Target system variant ID
  shopifyVariantId: string;  // Shopify variant ID
  productHandle: string;     // Product handle for grouping
  sku: string;               // Stock Keeping Unit
  lastUpdated: Date;         // When the mapping was last updated
}
```

**Key Features:**
- Creates unique indexes on `externalVariantId` and `sku`
- Creates a non-unique index on `productHandle` for efficient grouping
- Provides methods to look up variant mappings by SKU
- Supports retrieving all variants for a specific product
- Maintains a centralized mapping between Shopify and external variants

#### 3. Page Mapping (`page-mapping.service.ts`)

**Document Structure:**
```typescript
interface PageMappingDocument {
  externalPageId: string; // Target system page ID
  shopifyPageId: string;  // Shopify page ID
  pageHandle: string;     // Unique page handle/slug
  pageHash: string;       // Hash of page content for change detection
  lastUpdated: Date;      // When the mapping was last updated
}
```

**Key Features:**
- Creates unique indexes on `externalPageId`, `shopifyPageId`, and `pageHandle`
- Creates a non-unique index on `pageHash` for content-based lookups
- Supports finding pages by hash to detect duplicates or unchanged content
- Provides methods to look up pages by handle
- Enables efficient synchronization by detecting content changes

#### 4. Metaobject Mapping (`metaobject-mapping.service.ts`)

**Document Structure:**
```typescript
interface MetaobjectMappingDocument {
  externalMetaobjectId: string; // Target system metaobject ID
  shopifyMetaobjectId: string;  // Shopify metaobject ID
  metaobjectHandle: string;     // Unique metaobject handle
  metaobjectType: string;       // Type of metaobject (e.g., FAQs, room_features)
  metaobjectHash?: string;      // Optional hash for content change detection
  lastUpdated: Date;            // When the mapping was last updated
}
```

**Key Features:**
- Creates unique indexes on `externalMetaobjectId` and `shopifyMetaobjectId`
- Creates non-unique indexes on `metaobjectType` and `metaobjectHash`
- Supports finding metaobjects by type, handle, or content hash
- Handles multiple metaobject types within a single collection
- Enables metaobject lookups by type and handle combination

#### 5. Collection Mapping (`mongodb-collection.service.ts`)

**Document Structure:**
```typescript
interface CollectionMappingDocument {
  collectionHash: string;      // Hash of collection properties
  productsHash: string;        // Hash of product IDs in the collection
  shopifyCollectionId: string; // Shopify collection ID
  externalCollectionId: string; // Target system collection ID
  productIds: string[];        // Array of product IDs in the collection
  createdAt: Date;             // When the mapping was created
  lastUpdated: Date;           // When the mapping was last updated
}
```

**Key Features:**
- Creates a unique index on `collectionHash`
- Creates non-unique indexes on `externalCollectionId` and `shopifyCollectionId`
- Supports finding collections by hash to detect changes
- Includes a `productsHash` to efficiently detect changes in collection membership
- Stores the actual product IDs in the collection
- Implements deletion capability for collection mappings

Each mapping service follows a similar pattern:
1. Singleton instantiation
2. Lazy initialization of MongoDB connection
3. Collection and index creation
4. CRUD operations for mappings
5. Helper methods for specific lookup patterns
6. Proper connection cleanup

This architecture ensures that data mappings between Shopify and the target system are maintained efficiently, with optimized lookup patterns and change detection mechanisms.

### Synchronization Services

- **Shopify Product Sync Service** (`shopify-product-sync.service.ts`): Handles product synchronization logic
  - Fetches products using GraphQL queries
  - Processes product data (including variants, images, and metadata)
  - Performs automatic text replacements (e.g., replacing "Coworker" with "Quell+" in titles and descriptions)
  - Updates product mappings in the database

- **Shopify Page Sync Service** (`shopify-page-sync.service.ts`): Handles page synchronization logic
  - Fetches pages using GraphQL queries
  - Processes page content and metadata
  - Updates page mappings in the database

- **Shopify Metaobject Sync Service** (`shopify-metaobject-sync.service.ts`): Handles metaobject synchronization
  - Supports multiple metaobject types
  - Fetches metaobjects using GraphQL queries
  - Processes metaobject fields and relationships
  - Updates metaobject mappings in the database

- **Shopify File Sync Service** (`shopify-file-sync.service.ts`): Handles file synchronization
  - Fetches file metadata from Shopify
  - Downloads file content when needed
  - Caches files in MongoDB or filesystem
  - Updates file mappings in the database

- **Shopify Collection Sync Service** (`shopify-collection-sync.service.ts`): Handles collection synchronization
  - Supports both sync and delete operations
  - Fetches collections using GraphQL queries
  - Processes collection data, including product associations
  - Updates collection mappings in the database

- **Shopify Redirect Sync Service** (`shopify-redirect-sync.service.ts`): Handles redirect synchronization
  - Fetches URL redirects from Shopify
  - Processes redirect data
  - Updates redirect mappings in the database

- **Shopify Price List Sync Service** (`shopify-pricelist-sync.service.ts`): Handles price list synchronization
  - Fetches price list data from Shopify
  - Processes pricing information
  - Updates price list mappings in the database

### Synchronization Workflow

The synchronization services follow a consistent pattern across different entity types. The general workflow for each sync operation is:

1. **Initialization**:
   - Initialize MongoDB connection if not already done
   - Set up GraphQL client with authentication
   - Prepare any caches or in-memory structures

2. **Data Fetching**:
   - Construct GraphQL queries with appropriate pagination
   - Send requests to Shopify GraphQL API
   - Handle pagination to retrieve all records if limit parameter is not provided

3. **Processing and Transformation**:
   - Parse response data from Shopify
   - Transform data to match target system requirements
   - Perform text replacements (e.g., replace "Coworker" with "Quell+" in product titles and descriptions)
   - Generate content hashes for change detection
   - Apply any business rules or filters

4. **Mapping and Persistence**:
   - Check if entity already exists using hash or ID comparison
   - Create new mappings for new entities
   - Update mappings for changed entities
   - Skip unchanged entities for efficiency

5. **Cleanup**:
   - Detect and remove stale mappings
   - Release resources
   - Log sync completion statistics

**Example: File Sync Workflow**

The file synchronization process demonstrates this pattern clearly:

1. Fetch all file IDs from Shopify using GraphQL pagination
2. Load all existing file mappings from MongoDB into a cache
3. Compare the local mappings against Shopify data to identify stale mappings
4. Remove any mappings that no longer exist in Shopify
5. Fetch files from the external system that need to be synchronized
6. For each file:
   - Generate a hash based on file properties
   - Check if the file already exists in the mapping cache
   - If it exists, skip processing
   - If it's new, create the file in Shopify via GraphQL mutation
   - Handle special cases (like video files) with appropriate upload methods
   - Create a mapping between the external file and the Shopify file
7. Return statistics about the sync operation

This workflow ensures efficient synchronization by:
- Minimizing unnecessary API calls
- Using content hashing to detect changes
- Maintaining a mapping layer for future operations
- Cleaning up stale data

Each service is responsible for a specific domain of functionality, with clear separation of concerns. The mapping services handle the persistence layer, while the sync services contain the business logic for data synchronization.

## GraphQL Type Generation

A key feature of this project is the automatic generation of TypeScript types from the Shopify GraphQL schema:

- Uses `@graphql-codegen` to generate TypeScript types
- Connects to the Shopify GraphQL API using environment variables
- Generates types in `src/types/shopify-generated.ts`
- Environment variables required:
  - `SHOPIFY_TOKEN`: Shopify access token
  - `SHOPIFY_APP_URL`: Shopify store URL

## API Implementation

Each synchronization endpoint follows a similar pattern, with specific implementations tailored to the data type being synchronized. Below is a detailed breakdown of each API endpoint:

### 1. Product Synchronization (`/api/sync-products`)

**Implementation**: `src/api/sync-products.ts`

- **Purpose**: Synchronizes product data from Shopify to the target system
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of products processed
- **Process**:
  1. Accepts an optional limit parameter for controlling batch size
  2. Calls the `shopifyProductSyncService.syncProducts()` method
  3. Returns success with count of synced products or error information
- **Response**: JSON object containing sync status and product count

### 2. Page Synchronization (`/api/sync-pages`)

**Implementation**: `src/api/sync-pages.ts`

- **Purpose**: Synchronizes page content from Shopify to the target system
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of pages processed
- **Process**:
  1. Accepts an optional limit parameter for controlling batch size
  2. Calls the `shopifyPageSyncService.syncPages()` method
  3. Returns success with count of synced pages or error information
- **Response**: JSON object containing sync status and page count

### 3. Metaobject Synchronization (`/api/sync-metaobjects`)

**Implementation**: `src/api/sync-metaobjects.ts`

- **Purpose**: Synchronizes metaobjects (custom data structures) from Shopify
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of metaobjects processed
  - `type`: Optional query parameter to specify a particular metaobject type
- **Process**:
  1. Validates the metaobject type if provided (supports types: 'FAQs', 'room_features', 'company_logo', 'product_feature', 'meeting_rooms_features', 'environment_item', 'acoustic_environment_next')
  2. If no type is specified, syncs all supported metaobject types sequentially
  3. Calls the `shopifyMetaobjectSyncService.syncMetaobjects()` method
  4. Returns success with details of synced metaobjects
- **Response**: JSON object containing sync status and metaobject details
- **Note**: Includes a backwards compatibility route for FAQs at `/api/sync-metaobject-faq`

### 4. File Synchronization (`/api/sync-files`)

**Implementation**: `src/api/sync-files.ts`

- **Purpose**: Synchronizes files (images, documents, etc.) from Shopify
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of files processed
- **Process**:
  1. Accepts an optional limit parameter for controlling batch size
  2. Calls the `shopifyFileSyncService.syncFiles()` method
  3. Returns success with count of synced files or error information
- **Response**: JSON object containing sync status, count of synced files, and total files processed

### 5. Collection Synchronization (`/api/sync-collections`)

**Implementation**: `src/api/sync-collections.ts`

- **Purpose**: Synchronizes product collections from Shopify
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of collections processed
  - `delete`: Optional flag to enable deletion mode instead of sync
- **Process**:
  1. Accepts an optional limit parameter and checks for delete mode flag
  2. Based on the mode, either syncs collections or processes collection deletions
  3. Calls the `shopifyCollectionSyncService.syncCollections()` method with appropriate parameters
  4. Returns success with appropriate details based on the operation mode
- **Response**: JSON object containing operation mode, status, and details about synchronized or deleted collections

### 6. Redirect Synchronization (`/api/sync-redirects`)

**Implementation**: `src/api/sync-redirects.ts`

- **Purpose**: Synchronizes URL redirects from Shopify
- **Parameters**:
  - `limit`: Optional query parameter to limit the number of redirects processed
- **Process**:
  1. Accepts an optional limit parameter for controlling batch size
  2. Calls the `shopifyRedirectSyncService.syncRedirects()` method
  3. Returns success with details of synced redirects or error information
- **Response**: JSON object containing sync status and redirect details

### 7. Price List Synchronization (`/api/sync-pricelists`)

**Implementation**: `src/api/sync-pricelists.ts`

- **Purpose**: Synchronizes price lists from Shopify
- **Process**:
  1. Unlike other endpoints, does not accept a limit parameter
  2. Calls the `shopifyPriceListSyncService.syncPriceLists()` method
  3. Returns success with details of synced price lists or error information
- **Response**: JSON object containing sync status and price list details

### 8. Full Synchronization (`/api/sync-everything`)

This endpoint likely orchestrates the synchronization of all resource types in a specific order, handling dependencies between different data types.

## Deployment

The application includes:
- A Dockerfile for containerization
- Environment variable configuration
- TypeScript build process

## Scheduled Tasks

The project includes scripts for checking and verifying data mappings, which could be run as scheduled tasks:
- `variant-mappings`: Checks variant mappings between systems

## Key Dependencies

- **express**: Web server framework
- **graphql** and **graphql-request**: For interacting with Shopify's GraphQL API
- **mongodb**: For database operations
- **redis** and **ioredis**: For caching and data storage
- **axios**: For HTTP requests
- **dotenv**: For environment variable management
- **typescript**: For static typing
- **@graphql-codegen**: For generating TypeScript types from the GraphQL schema

This application appears to be a well-structured integration service that keeps data synchronized between Shopify and another system using a combination of GraphQL for data fetching and MongoDB for mapping storage.

  ## Product Content Processing

  The application includes content transformation capabilities during the product synchronization process:

  1. **Text Replacements**:
   - Automatically replaces occurrences of "Coworker" with "Quell+" in product titles and descriptions (case-insensitive)
   - Performs brand name standardization (e.g., replacing "Soundbox Store" with "Quell Design")
   - Ensures consistent product branding across the entire catalog

  2. **AI-Enhanced Content Processing**:
   - Uses OpenAI service to enhance and rewrite product titles and descriptions when needed
   - Falls back to manual text replacements if AI processing fails
   - Preserves HTML structure and formatting while improving content

  3. **Content Standardization**:
   - Ensures consistent branding across all product content
   - Maintains SEO-friendly content while standardizing terminology

  This processing helps maintain brand consistency across the product catalog and improves content quality during the synchronization process.
      id: existingProduct ? existingProduct.id : undefined,
      handle: externalProduct.handle,
      title: title,
      descriptionHtml: descriptionHtml,
      productType: externalProduct.productType,
      vendor: externalProduct.vendor,
      tags: externalProduct.tags,
      status: externalProduct.status as ProductStatus,
      templateSuffix: externalProduct.templateSuffix,
      seo: externalProduct.seo ? {
        title: externalProduct.seo.title,
        description: externalProduct.seo.description
      } : undefined,
      productOptions: externalProduct.options?.map(option => ({
        name: option.name,
        values: option.values.map(value => ({ name: value }))
      }))
    };

    console.log(`✅ Base product data prepared for ${productInput.title}`);
    return productInput;
  }
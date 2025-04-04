# Shopify Variant ID Mapping

This feature provides a way to map external variant IDs to Shopify variant IDs during product sync operations. This mapping is useful for maintaining relationships between external product data and Shopify products, especially when updating products or tracking inventory.

## How It Works

1. When products are synced to Shopify, the service automatically creates mappings between external variant IDs (based on SKU) and Shopify variant IDs.
2. These mappings are stored in a JSON file located at `data/variant-id-mappings.json`.
3. The mappings include metadata such as product handle, SKU, and last update timestamp.

## Using the Variant Mapping Tool

A command-line tool is provided to view and check variant mappings:

### View All Mappings

```bash
npm run variant-mappings all
# or simply
npm run variant-mappings
```

### View Mappings for a Specific Product

```bash
npm run variant-mappings product PRODUCT_HANDLE
```

Replace `PRODUCT_HANDLE` with your product's handle.

### Look Up a Specific Variant by SKU

```bash
npm run variant-mappings sku VARIANT_SKU
```

Replace `VARIANT_SKU` with your variant's SKU.

## Programmatic Access to Mappings

The variant mapper is also available programmatically in your code:

```typescript
import { variantIdMapper } from '../utils/variant-id-mapper';

// Initialize the mapper
await variantIdMapper.initialize();

// Add a mapping
await variantIdMapper.addMapping(
  externalVariantId,
  shopifyVariantId,
  productHandle,
  sku
);

// Get Shopify variant ID from external ID
const shopifyId = await variantIdMapper.getShopifyVariantId(externalVariantId);

// Get external variant ID from Shopify ID
const externalId = await variantIdMapper.getExternalVariantId(shopifyVariantId);

// Get all mappings
const allMappings = await variantIdMapper.getAllMappings();

// Get mappings for a specific product
const productMappings = await variantIdMapper.getMappingsByProduct(productHandle);
```

## Mapping File Structure

The mapping file uses this structure:

```json
{
  "externalVariantId1": {
    "externalVariantId": "externalVariantId1",
    "shopifyVariantId": "gid://shopify/ProductVariant/12345678901234",
    "productHandle": "product-handle",
    "sku": "SKU123",
    "lastUpdated": "2023-04-12T15:30:45.123Z"
  },
  "externalVariantId2": {
    ...
  }
}
``` 
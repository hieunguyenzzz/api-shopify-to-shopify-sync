import { shopifyProductSyncService } from '../services/shopify-product-sync.service';
import { variantIdMappingService } from '../services/variant-id-mapping.service';

// Initialize the variant mapper
async function initialize() {
  await variantIdMappingService.initialize();
}

// Get and display all mappings
async function showAllMappings() {
  const mappings = await shopifyProductSyncService.getAllVariantMappings();
  console.log('\n📊 All Variant Mappings:');
  console.log('=======================');
  
  const mappingEntries = Object.values(mappings);
  
  if (mappingEntries.length === 0) {
    console.log('No mappings found. Run a product sync first to create mappings.');
    return;
  }
  
  console.table(
    mappingEntries.map(mapping => ({
      'External ID': mapping.externalVariantId,
      'Shopify ID': mapping.shopifyVariantId,
      'Product': mapping.productHandle,
      'SKU': mapping.sku,
      'Last Updated': new Date(mapping.lastUpdated).toLocaleString()
    }))
  );
}

// Get mappings for a specific product
async function showProductMappings(productHandle: string) {
  const mappings = await shopifyProductSyncService.getProductVariantMappings(productHandle);
  
  console.log(`\n📊 Variant Mappings for Product: ${productHandle}`);
  console.log('===========================================');
  
  if (mappings.length === 0) {
    console.log(`No mappings found for product ${productHandle}. Run a product sync first to create mappings.`);
    return;
  }
  
  console.table(
    mappings.map(mapping => ({
      'External ID': mapping.externalVariantId,
      'Shopify ID': mapping.shopifyVariantId,
      'SKU': mapping.sku,
      'Last Updated': new Date(mapping.lastUpdated).toLocaleString()
    }))
  );
}

// Get mapping for a specific SKU
async function showVariantMapping(sku: string) {
  const shopifyId = await shopifyProductSyncService.getVariantIdMapping(sku);
  
  console.log(`\n🔍 Variant Mapping for SKU: ${sku}`);
  console.log('==============================');
  
  if (!shopifyId) {
    console.log(`No mapping found for SKU ${sku}. Run a product sync first to create mappings.`);
    return;
  }
  
  console.log(`External SKU: ${sku}`);
  console.log(`Shopify ID: ${shopifyId}`);
}

// Main function
async function main() {
  // Process command line arguments
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  const param = args[1];

  try {
    // Initialize the ID mapper
    await initialize();
    
    switch (command) {
      case 'product':
        if (!param) {
          console.error('❌ Error: Please provide a product handle');
          process.exit(1);
        }
        await showProductMappings(param);
        break;
        
      case 'sku':
        if (!param) {
          console.error('❌ Error: Please provide a SKU');
          process.exit(1);
        }
        await showVariantMapping(param);
        break;
        
      case 'all':
      default:
        await showAllMappings();
        break;
    }
  } finally {
    // Close MongoDB connection
    await variantIdMappingService.close();
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
}); 
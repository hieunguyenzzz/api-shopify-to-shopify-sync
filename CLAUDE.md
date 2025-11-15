this project is for syncing data from one shopify store to another shopify store, the .env will define source shopify data and target shopify data. as well as mongo db for storing the mapping and redis to speed up the syncing if running mupltiple times

```
.env
EXTERNAL_API_URL=http://soundboxstore-dataresolver-wiqyv0-a36244-45-82-64-178.traefik.me
SHOPIFY_TOKEN=shpat_xxxx
SHOPIFY_APP_URL=xxxx.myshopify.com
MONGODB_URI=mongodb://mongo:xxx@x.x.x.x:27019/?tls=false
MONGODB_COLLECTION=file-mapping
MONGODB_DB=syncing
REDIS_URL=redis://default:xxxx@x.x.x.x:6379
OPENROUTER_API_KEY=sk-or-v1-xxxx
OPENROUTER_MODEL=openai/gpt-4o-mini
TARGET_SITE_TITLE=Quell Design
SHOPIFY_RATE_LIMIT_DELAY=300
SHOPIFY_MAX_RETRIES=3
```

## Rate Limiting Configuration

The application includes automatic rate limiting and retry logic for Shopify API calls:

- `SHOPIFY_RATE_LIMIT_DELAY`: Minimum delay in milliseconds between API requests (default: 300ms)
- `SHOPIFY_MAX_RETRIES`: Maximum number of retry attempts when throttled (default: 3)

When Shopify's API rate limit is hit, the application will:
1. Automatically detect throttle errors
2. Calculate the appropriate wait time based on Shopify's restore rate
3. Retry the request after waiting
4. Use exponential backoff if throttle status is unavailable


the EXTERNAL_API_URL is source data
SHOPIFY_TOKEN and SHOPIFY_APP_URL belong to target shopify data

## Sync Order

The sync-everything endpoint processes data in this order:

1. **Files** - Sync media files and assets
2. **Redirects** - Sync URL redirects
3. **Metaobjects** - Sync custom metaobject data (FAQs, features, etc.)
4. **Product Metafield Definitions** - Detect and create all required metafield definitions dynamically from source products
5. **Pages** - Sync pages
6. **Collections** - Sync product collections
7. **Products** - Sync products (after metafield definitions are created)
8. **Price Lists** - Sync price lists

## Product Metafield Definition Sync

The application automatically detects and creates metafield definitions before syncing products:

- **Dynamic Detection**: Scans all products from the source API to identify required metafield definitions
- **Auto-Creation**: Creates missing metafield definitions in the target store
- **Coverage**: Handles both product-level and variant-level metafields
- **Types Supported**: All Shopify metafield types including single_line_text_field, multi_line_text_field, list.metaobject_reference, file_reference, etc.

This prevents errors like "Value requires that you have a metafield definition with the key: X" during product sync.

## Some terms I might use when prompting

when I mention product sync, I am referring to api/sync-products.ts
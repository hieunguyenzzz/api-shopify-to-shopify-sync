# Shopify GraphQL Type Generation

## Setup

1. Install dependencies:
```bash
npm install
```

2. Environment Variables:
Create a `.env` file with the following:
```
SHOPIFY_TOKEN=your_shopify_access_token
SHOPIFY_APP_URL=your-shop.myshopify.com
```

## Generating Types

Run the following command to generate TypeScript types:
```bash
npm run generate:shopify-types
```

## Configuration Details

- `scripts/generate-shopify-types.js`: Configures type generation for Shopify GraphQL schema
  - Uses `dotenv` to load environment variables
  - Dynamically constructs Shopify GraphQL schema URL
- Generated types are output to:
  - `src/types/shopify-generated.ts`: Base schema types
  - `src/types/shopify-operations.ts`: Operation-specific types

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Ensure `.env` file exists in the project root
   - Verify both `SHOPIFY_TOKEN` and `SHOPIFY_APP_URL` are set
   - Check for typos in variable names

2. **Network Connectivity**
   - Confirm you have a stable internet connection
   - Verify the Shopify GraphQL endpoint is accessible
   - Check your Shopify app's URL is correct

3. **Dependency Problems**
   ```bash
   # Reinstall dependencies
   npm ci
   
   # Ensure all dependencies are installed
   npm install
   ```

4. **Verbose Debugging**
   ```bash
   # Run with additional logging
   DEBUG=* npm run generate:shopify-types
   ```

### Verification Checklist
- [ ] `.env` file exists
- [ ] All required environment variables are set
- [ ] Network connection is stable
- [ ] Dependencies are correctly installed
- [ ] Shopify app URL is correct

## Adding GraphQL Queries

1. Place GraphQL query files in `src/graphql/`
2. Queries will be automatically typed when you run `npm run generate:shopify-types`

## Example Query Usage

```typescript
import { GetProductsQuery } from './types/shopify-operations';

async function fetchProducts() {
  const variables = { first: 10 };
  // Use the generated types with your GraphQL client
}
```

### Notes
- Requires internet connection to fetch Shopify GraphQL schema
- Environment variables must be correctly set
- Recommended to use the latest version of Node.js 
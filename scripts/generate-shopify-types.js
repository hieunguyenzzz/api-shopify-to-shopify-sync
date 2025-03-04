const { CodegenConfig } = require('@graphql-codegen/cli');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();


module.exports = {
  overwrite: true,
  schema: {
    [`https://${process.env.SHOPIFY_APP_URL}/admin/api/2025-01/graphql.json`]: {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN
      }
    }
  },
  generates: {
    './src/types/shopify-generated.ts': {
      plugins: ['typescript'],
      config: {
        skipTypename: true,
        declarationKind: 'type',
        scalars: {
          DateTime: 'string',
          Decimal: 'number',
          URL: 'string'
        },
        enumsAsConst: true,
        commentDescriptions: false,
        disableDescriptions: true,
        useTypeImports: true
      }
    }
  }
}; 
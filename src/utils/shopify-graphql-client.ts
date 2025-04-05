import { GraphQLClient } from 'graphql-request';
import dotenv from 'dotenv';
dotenv.config();

export const createShopifyGraphQLClient = (
): GraphQLClient => {
  let apiVersion = '2025-04';
  let shopUrl = process.env.SHOPIFY_APP_URL || '';
  let shopifyToken = process.env.SHOPIFY_TOKEN || '';
  return new GraphQLClient(
    `https://${shopUrl}/admin/api/${apiVersion}/graphql.json`, 
    {
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json'
      }
    }
  );
}; 
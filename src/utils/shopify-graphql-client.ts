import { GraphQLClient } from 'graphql-request';

export const createShopifyGraphQLClient = (
  shopUrl: string, 
  shopifyToken: string, 
  apiVersion: string = '2025-01'
): GraphQLClient => {
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
import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';
import { gql } from 'graphql-request';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export async function testShopify() {
  try {
    console.log('Testing Shopify API connection...');

    // Create GraphQL client
    const client = createShopifyGraphQLClient();
    console.log('✅ Shopify GraphQL client created');

    // Test query to get shop information
    const query = gql`
      query {
        shop {
          name
          email
          currencyCode
          primaryDomain {
            host
            url
          }
        }
      }
    `;

    console.log('Sending test query to Shopify API...');
    const response: any = await client.request(query);

    if (response && response.shop) {
      console.log('✅ Successfully connected to Shopify!');
      console.log(`   Shop Name: ${response.shop.name}`);
      console.log(`   Email: ${response.shop.email}`);
      console.log(`   Currency: ${response.shop.currencyCode}`);
      console.log(`   Domain: ${response.shop.primaryDomain.host}`);
    } else {
      throw new Error('Invalid response from Shopify API');
    }

    // Test query to count products
    const countQuery = gql`
      query {
        products(first: 1) {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    const countResponse: any = await client.request(countQuery);
    if (countResponse && countResponse.products) {
      const productCount = countResponse.products.edges.length;
      console.log(`✅ Successfully queried products (found ${productCount > 0 ? 'at least 1' : 'none'})`);
      if (productCount > 0) {
        console.log(`   Example: ${countResponse.products.edges[0].node.title}`);
      }
    }

    console.log('✅ Shopify API tests passed!');
  } catch (error) {
    console.error('❌ Shopify test failed:', error);
    throw error;
  }
}

// If run directly, execute the test
if (require.main === module) {
  testShopify().catch(() => process.exit(1));
}

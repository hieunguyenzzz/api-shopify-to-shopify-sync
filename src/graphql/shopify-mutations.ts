export const PRODUCT_SET_MUTATION = `
  mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id    
      }
      productSetOperation {
        id
        status
        userErrors {
          code
          field
          message
        }
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;


export const PRODUCT_BY_HANDLE_QUERY = `
  query productByIdentifier($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id
      handle
      title
      variants(first: 50) {
        edges {
          node {
            id
            sku
            title
          }
        }
      }
    }
  }
`;

export const FILE_CREATE_MUTATION = `
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      alt
      createdAt
    }
    userErrors {
      field
      message
    }
  }
}`;

export const PRODUCT_WITH_VARIANTS_QUERY = `
  query productWithVariants($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      variants(first: 50) {
        edges {
          node {
            id
            sku
            title
            price
          }
        }
      }
    }
  }
`;

export const PAGE_CREATE_MUTATION = `
  mutation pageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PAGE_UPDATE_MUTATION = `
  mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PAGES_QUERY = `
  query getPages($query: String, $first: Int) {
    pages(query: $query, first: $first) {
      edges {
        node {
          id
          title
          handle
          body
          bodySummary
          createdAt
          updatedAt        
          metafields(first: 50) {
            edges {
              node {
                id
                namespace
                key
                value
              }
            }
          }
        }
      }
    }
  }
`;

// Add more Shopify-related mutations as needed 
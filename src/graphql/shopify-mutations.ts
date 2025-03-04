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

// Add more Shopify-related mutations as needed 
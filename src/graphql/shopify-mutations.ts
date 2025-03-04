export const PRODUCT_SET_MUTATION = `
  mutation productSet($input: ProductInput!) {
    productSet(input: $input) {
      product {
        id
        title
        productType
        handle
        descriptionHtml
        vendor
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        productType
        handle
        descriptionHtml
        vendor
      }
      userErrors {
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

// Add more Shopify-related mutations as needed 
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

export const METAOBJECTS_BY_TYPE_QUERY = `
  query getMetaobjectsByType($type: String!, $first: Int) {
    metaobjects(type: $type, first: $first) {
      edges {
        node {
          id
          handle
          type
          displayName
          fields {
            key
            value
          }
          updatedAt
        }
      }
    }
  }
`;

export const METAOBJECT_CREATE_MUTATION = `
  mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
        displayName
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_UPDATE_MUTATION = `
  mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
        displayName
        fields {
          key
          value
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const COLLECTION_CREATE_MUTATION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
        title
        descriptionHtml
        sortOrder
        templateSuffix
        updatedAt
        ruleSet {
          appliedDisjunctively
          rules {
            column
            relation
            condition
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_UPDATE_MUTATION = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        handle
        title
        descriptionHtml
        sortOrder
        templateSuffix
        updatedAt
        ruleSet {
          appliedDisjunctively
          rules {
            column
            relation
            condition
          }
        }
        # products field might not be returned by default, check API version if needed
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_BY_HANDLE_QUERY = `
  query collectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      handle
      title
      updatedAt
      descriptionHtml
      sortOrder
      templateSuffix
      # Add products connection if needed later, e.g.:
      # products(first: 10) {
      #   nodes { id }
      # }
    }
  }
`;

export const COLLECTION_ADD_PRODUCTS_MUTATION = `
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
        updatedAt
        productsCount {
          count
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_PRODUCTS_QUERY = `
  query collectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      id
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

// Deletes a collection by its GID
export const COLLECTION_DELETE_MUTATION = `
  mutation collectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors {
        field
        message
      }
    }
  }
`;

// Add more Shopify-related mutations as needed 
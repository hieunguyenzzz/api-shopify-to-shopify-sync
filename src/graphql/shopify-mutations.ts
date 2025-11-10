import { createShopifyGraphQLClient } from '../utils/shopify-graphql-client';

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

export const PRODUCT_BY_IDENTIFIER_QUERY = `
  query productByIdentifier($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) {
      id
      title
      handle
      # Add other fields you might need
    }
  }
`;

export const PRODUCT_BY_ID_QUERY = `
  query productById($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      # Add other fields you might need
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

export const STAGED_UPLOADS_CREATE_MUTATION = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
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
  query getPages($first: Int, $after: String) {
    pages(first: $first, after: $after) {
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
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
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
        image {
          url
          altText
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
        image {
          url
          altText
        }
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

// Query to fetch publications (sales channels)
export const PUBLICATIONS_QUERY = `
  query getPublications {
    publications(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export const COLLECTION_PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $publicationId: ID!) {
    publishablePublish(id: $id, input: [{publicationId: $publicationId}]) {
      publishable {
        publishedOnPublication(publicationId: $publicationId)
      }
      shop {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const URL_REDIRECT_CREATE_MUTATION = `
  mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const URL_REDIRECT_UPDATE_MUTATION = `
  mutation urlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const URL_REDIRECTS_QUERY = `
  query getUrlRedirects($query: String, $first: Int) {
    urlRedirects(query: $query, first: $first) {
      edges {
        node {
          id
          path
          target
        }
      }
    }
  }
`;

// Metaobject Definition Queries and Mutations
export const METAOBJECT_DEFINITIONS_QUERY = `
  query getMetaobjectDefinitions($first: Int!) {
    metaobjectDefinitions(first: $first) {
      edges {
        node {
          id
          name
          type
          displayNameKey
          description
          access {
            admin
            storefront
          }
          fieldDefinitions {
            key
            name
            description
            required
            type {
              name
              category
            }
            validations {
              name
              value
            }
          }
        }
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE_MUTATION = `
  mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
        displayNameKey
        description
        access {
          admin
          storefront
        }
        fieldDefinitions {
          key
          name
          description
          required
          type {
            name
            category
          }
          validations {
            name
            value
          }
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

export const METAOBJECT_DEFINITION_UPDATE_MUTATION = `
  mutation metaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
        displayNameKey
        description
        access {
          admin
          storefront
        }
        fieldDefinitions {
          key
          name
          description
          required
          type {
            name
            category
          }
          validations {
            name
            value
          }
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

export const METAOBJECT_DEFINITION_BY_TYPE_QUERY = `
  query getMetaobjectDefinitionByType($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      name
      type
      displayNameKey
      description
      access {
        admin
        storefront
      }
      fieldDefinitions {
        key
        name
        description
        required
        type {
          name
          category
        }
        validations {
          name
          value
        }
      }
    }
  }
`;

// Add more Shopify-related mutations as needed 
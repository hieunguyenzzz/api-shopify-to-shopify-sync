export interface ExternalProduct {
  id: string;
  handle?: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  images: {
    altText: string;
    url: string;
  }[];
  seo: {
    title: string;
    description: string;
  };
  templateSuffix: string;
  variants?: {
    sku: string;
    title: string;
    price: string;
    compareAtPrice?: string;
    inventoryQuantity?: number;
    image: {
      altText: string;
      url: string;
    };
    selectedOptions: {
      name: string;
      value: string;
    }[],
    metafields: {
      namespace: string;
      key: string;
      value: string;
      type: string;
      originalValue?: string;
    }[];
  }[];
  options?: {
    name: string;
    values: string[];
  }[];
  metafields?: {
    namespace: string;
    key: string;
    value: string;
    type: string;
    originalValue?: string;
  }[];
}

export interface ExternalPage {
  id: string;
  handle: string;
  title: string;
  bodyHtml: string;
  author: string;
  publishedAt?: string;
  templateSuffix?: string;
  seo?: {
    title: string;
    description: string;
  };
  metafields?: {
    namespace: string;
    key: string;
    value: string;
    type: string;
    originalValue?: string;
  }[];
}

export interface ExternalRedirect {
  id: string;
  path: string;
  target: string;
}

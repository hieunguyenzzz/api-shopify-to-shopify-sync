export interface ExternalProduct {
  id: string;
  handle?: string;
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags?: string[];
  images: {
    altText: string;
    url: string;
  }[];
  variants?: {
    sku: string;
    title: string;
    price: string;
    compareAtPrice?: string;
    inventoryQuantity?: number;
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

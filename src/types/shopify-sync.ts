export interface ExternalProduct {
  id: string;
  handle?: string;
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags?: string[];
  variants?: {
    price: string;
    compareAtPrice?: string;
    inventoryQuantity?: number;
    selectedOptions: {
      name: string;
      value: string;
    }[];
  }[];
  options?: {
    name: string;
    values: string[];
  }[];
}

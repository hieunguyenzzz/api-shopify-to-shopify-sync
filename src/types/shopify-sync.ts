import { 
  MutationProductSetArgs, 
  ProductInput 
} from './shopify-generated';

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
  }[];
  options?: {
    name: string;
    values: string[];
  }[];
}

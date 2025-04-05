export interface ExternalMetaobject {
  id: string;
  handle: string;
  type: string;
  displayName: string;
  fields: ExternalMetaobjectField[];
  updatedAt: string;
}

export interface ExternalMetaobjectField {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export interface ExternalMetaobjectsResponse {
  success: boolean;
  metaobjects: ExternalMetaobject[];
} 
import crypto from 'crypto';

/**
 * Generates a consistent hash for a file based on its URL and mimeType
 * @param url The URL of the file
 * @param mimeType The MIME type of the file
 * @returns A SHA-256 hash string that uniquely identifies the file
 */
export function generateFileHash(url: string, mimeType: string): string {
  const data = `${url}|${mimeType}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Extracts the MIME type from a file URL or filename
 * @param url The URL or filename
 * @returns The detected MIME type or 'application/octet-stream' if unknown
 */
export function getMimeTypeFromUrl(url: string): string {
  // Extract extension from URL
  const extension = url.split('.').pop()?.toLowerCase();
  
  if (!extension) {
    return 'application/octet-stream';
  }
  
  // Map of common extensions to MIME types
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'mp4': 'video/mp4',
    'webm': 'video/webm'
  };
  
  return mimeTypes[extension] || 'application/octet-stream';
} 
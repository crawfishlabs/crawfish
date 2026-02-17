/**
 * @claw/core — File/Blob Storage Adapter
 *
 * Abstracts file upload, download, and URL generation.
 * Implementations: FirebaseStorageAdapter, S3Adapter, R2Adapter, etc.
 */

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  public?: boolean;
}

export interface StorageFile {
  path: string;
  url: string;
  size: number;
  contentType: string;
  createdAt: Date;
}

export interface CrawfishStorage {
  /** Upload a file and return its public/signed URL. */
  upload(path: string, data: Buffer | Uint8Array, options?: UploadOptions): Promise<string>;

  /** Download a file as a Buffer. */
  download(path: string): Promise<Buffer>;

  /** Generate a time-limited signed URL. */
  getSignedUrl(path: string, expiresInMs: number): Promise<string>;

  /** Delete a file. */
  delete(path: string): Promise<void>;

  /** List files under a prefix. */
  list?(prefix: string, limit?: number): Promise<StorageFile[]>;
}

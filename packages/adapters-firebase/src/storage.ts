/**
 * Firebase Cloud Storage implementation of CrawfishStorage.
 */
import * as admin from 'firebase-admin';
import type { CrawfishStorage, UploadOptions, StorageFile } from '@claw/core';

export class FirebaseStorageAdapter implements CrawfishStorage {
  private bucket: ReturnType<admin.storage.Storage['bucket']>;

  constructor(bucketName?: string, app?: admin.app.App) {
    const storage = (app ?? admin.app()).storage();
    this.bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
  }

  async upload(path: string, data: Buffer | Uint8Array, options?: UploadOptions): Promise<string> {
    const file = this.bucket.file(path);
    await file.save(Buffer.from(data), {
      contentType: options?.contentType ?? 'application/octet-stream',
      metadata: options?.metadata,
      public: options?.public,
    });

    if (options?.public) {
      await file.makePublic();
      return `https://storage.googleapis.com/${this.bucket.name}/${path}`;
    }

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return url;
  }

  async download(path: string): Promise<Buffer> {
    const [contents] = await this.bucket.file(path).download();
    return contents;
  }

  async getSignedUrl(path: string, expiresInMs: number): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
    return url;
  }

  async delete(path: string): Promise<void> {
    await this.bucket.file(path).delete();
  }

  async list(prefix: string, limit?: number): Promise<StorageFile[]> {
    const [files] = await this.bucket.getFiles({ prefix, maxResults: limit });
    return Promise.all(
      files.map(async (file) => {
        const [metadata] = await file.getMetadata();
        return {
          path: file.name,
          url: `https://storage.googleapis.com/${this.bucket.name}/${file.name}`,
          size: Number(metadata.size ?? 0),
          contentType: String(metadata.contentType ?? 'application/octet-stream'),
          createdAt: new Date(String(metadata.timeCreated)),
        };
      })
    );
  }
}

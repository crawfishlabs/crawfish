/**
 * @fileoverview Media processing utilities for image handling
 */

import * as admin from 'firebase-admin';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessingOptions, MediaMetadata, UploadResult, DeletionOptions } from './types';

/**
 * Process and upload an image
 */
export async function processAndUploadImage(
  buffer: Buffer,
  userId: string,
  originalName: string,
  category: MediaMetadata['category'],
  options: ImageProcessingOptions = {}
): Promise<UploadResult> {
  try {
    const fileId = uuidv4();
    const bucket = admin.storage().bucket();
    
    // Process image with sharp
    const metadata = await sharp(buffer).metadata();
    let processedBuffer = buffer;
    
    if (options.width || options.height || options.format || options.quality) {
      let sharpInstance = sharp(buffer);
      
      if (options.width || options.height) {
        sharpInstance = sharpInstance.resize({
          width: options.width,
          height: options.height,
          fit: options.fit || 'cover',
          withoutEnlargement: true,
        });
      }
      
      if (options.format) {
        switch (options.format) {
          case 'jpeg':
            sharpInstance = sharpInstance.jpeg({ quality: options.quality || 85 });
            break;
          case 'png':
            sharpInstance = sharpInstance.png({ quality: options.quality || 85 });
            break;
          case 'webp':
            sharpInstance = sharpInstance.webp({ quality: options.quality || 85 });
            break;
          case 'avif':
            sharpInstance = sharpInstance.avif({ quality: options.quality || 85 });
            break;
        }
      }
      
      processedBuffer = await sharpInstance.toBuffer();
    }
    
    // Upload to Firebase Storage
    const storagePath = `media/${userId}/${category}/${fileId}`;
    const file = bucket.file(storagePath);
    
    await file.save(processedBuffer, {
      metadata: {
        contentType: options.format ? `image/${options.format}` : metadata.format ? `image/${metadata.format}` : 'image/jpeg',
        cacheControl: 'public, max-age=3600',
      },
    });
    
    // Make file publicly accessible
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    
    // Create metadata document
    const mediaMetadata: MediaMetadata = {
      fileId,
      userId,
      originalName,
      size: processedBuffer.length,
      mimeType: options.format ? `image/${options.format}` : metadata.format ? `image/${metadata.format}` : 'image/jpeg',
      dimensions: {
        width: metadata.width || 0,
        height: metadata.height || 0,
      },
      storagePath,
      publicUrl,
      uploadedAt: admin.firestore.Timestamp.now(),
      category,
      status: 'ready',
    };
    
    // Save metadata to Firestore
    const db = admin.firestore();
    await db.collection('media_files').doc(fileId).set(mediaMetadata);
    
    return {
      fileId,
      storagePath,
      publicUrl,
      metadata: mediaMetadata,
    };
  } catch (error) {
    console.error('Error processing and uploading image:', error);
    throw error;
  }
}

/**
 * Generate thumbnails for an image
 */
export async function generateThumbnails(
  fileId: string,
  originalBuffer: Buffer
): Promise<Record<string, string>> {
  try {
    const bucket = admin.storage().bucket();
    const thumbnailSizes = {
      small: { width: 150, height: 150 },
      medium: { width: 300, height: 300 },
      large: { width: 600, height: 600 },
    };
    
    const thumbnails: Record<string, string> = {};
    
    for (const [size, dimensions] of Object.entries(thumbnailSizes)) {
      const thumbnailBuffer = await sharp(originalBuffer)
        .resize(dimensions.width, dimensions.height, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      const thumbnailPath = `thumbnails/${fileId}/${size}.jpg`;
      const file = bucket.file(thumbnailPath);
      
      await file.save(thumbnailBuffer, {
        metadata: {
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=3600',
        },
      });
      
      await file.makePublic();
      thumbnails[size] = `https://storage.googleapis.com/${bucket.name}/${thumbnailPath}`;
    }
    
    // Update media metadata with thumbnail URLs
    const db = admin.firestore();
    await db.collection('media_files').doc(fileId).update({
      thumbnails,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    
    return thumbnails;
  } catch (error) {
    console.error('Error generating thumbnails:', error);
    throw error;
  }
}

/**
 * Delete a media file and its thumbnails
 */
export async function deleteMediaFile(
  fileId: string,
  options: DeletionOptions = {}
): Promise<void> {
  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    
    // Get file metadata
    const doc = await db.collection('media_files').doc(fileId).get();
    if (!doc.exists) {
      throw new Error('File not found');
    }
    
    const metadata = doc.data() as MediaMetadata;
    
    if (options.softDelete) {
      // Mark as deleted instead of removing
      await doc.ref.update({
        status: 'deleted',
        deletedAt: admin.firestore.Timestamp.now(),
        deletionReason: options.reason,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    } else {
      // Delete from storage
      await bucket.file(metadata.storagePath).delete({ ignoreNotFound: true });
      
      // Delete thumbnails if requested
      if (options.includeThumbnails && metadata.thumbnails) {
        for (const size of ['small', 'medium', 'large']) {
          const thumbnailPath = `thumbnails/${fileId}/${size}.jpg`;
          await bucket.file(thumbnailPath).delete({ ignoreNotFound: true });
        }
      }
      
      // Remove metadata document
      await doc.ref.delete();
    }
  } catch (error) {
    console.error('Error deleting media file:', error);
    throw error;
  }
}

/**
 * Get media file metadata
 */
export async function getMediaFile(fileId: string): Promise<MediaMetadata | null> {
  try {
    const db = admin.firestore();
    const doc = await db.collection('media_files').doc(fileId).get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data() as MediaMetadata;
  } catch (error) {
    console.error('Error getting media file:', error);
    return null;
  }
}

/**
 * List media files for a user
 */
export async function listUserMediaFiles(
  userId: string,
  category?: MediaMetadata['category'],
  limit = 50
): Promise<MediaMetadata[]> {
  try {
    const db = admin.firestore();
    let query = db.collection('media_files')
      .where('userId', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .limit(limit);
    
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => doc.data() as MediaMetadata);
  } catch (error) {
    console.error('Error listing user media files:', error);
    return [];
  }
}
/**
 * @fileoverview Types for media processing and file management
 */

import * as admin from 'firebase-admin';

/**
 * Supported image formats
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  /** Target width */
  width?: number;
  /** Target height */
  height?: number;
  /** Output format */
  format?: ImageFormat;
  /** Quality (1-100) */
  quality?: number;
  /** Whether to maintain aspect ratio */
  maintainAspectRatio?: boolean;
  /** Resize strategy */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

/**
 * Media file metadata
 */
export interface MediaMetadata {
  /** File ID */
  fileId: string;
  /** User ID who uploaded */
  userId: string;
  /** Original filename */
  originalName: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** File dimensions (for images) */
  dimensions?: {
    width: number;
    height: number;
  };
  /** Storage path */
  storagePath: string;
  /** Public URL */
  publicUrl?: string;
  /** Upload timestamp */
  uploadedAt: admin.firestore.Timestamp;
  /** File category */
  category: 'profile' | 'meal' | 'workout' | 'progress' | 'other';
  /** Processing status */
  status: 'pending' | 'processing' | 'ready' | 'failed';
  /** Processing error */
  error?: string;
  /** Thumbnails */
  thumbnails?: {
    small: string;
    medium: string;
    large: string;
  };
}

/**
 * Upload result
 */
export interface UploadResult {
  /** File ID */
  fileId: string;
  /** Storage path */
  storagePath: string;
  /** Public URL */
  publicUrl: string;
  /** File metadata */
  metadata: MediaMetadata;
}

/**
 * Meal photo analysis result
 */
export interface MealAnalysisResult {
  /** Detected food items */
  foods: Array<{
    name: string;
    confidence: number;
    calories?: number;
    macros?: {
      protein: number;
      carbs: number;
      fat: number;
    };
  }>;
  /** Total estimated calories */
  totalCalories: number;
  /** Analysis confidence */
  confidence: number;
  /** Processing time in ms */
  processingTime: number;
  /** Analysis timestamp */
  timestamp: admin.firestore.Timestamp;
}

/**
 * File deletion options
 */
export interface DeletionOptions {
  /** Whether to delete thumbnails */
  includeThumbnails?: boolean;
  /** Whether to mark as deleted instead of permanent removal */
  softDelete?: boolean;
  /** Reason for deletion */
  reason?: string;
}
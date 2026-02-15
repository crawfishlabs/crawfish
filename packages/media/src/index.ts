/**
 * @fileoverview Claw Platform Media Module
 * @description Media processing, image handling, and file management
 */

export * from './types';
export { 
  processAndUploadImage,
  generateThumbnails,
  deleteMediaFile,
  getMediaFile,
  listUserMediaFiles
} from './processor';
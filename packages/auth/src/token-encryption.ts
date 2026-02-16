/**
 * @fileoverview Token Encryption/Decryption for OAuth Tokens
 * @description Securely encrypt/decrypt OAuth tokens before storing in Firestore
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class TokenEncryption {
  private static getEncryptionKey(): Buffer {
    const keyString = process.env.TOKEN_ENCRYPTION_KEY;
    if (!keyString) {
      throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
    }
    
    // If the key is base64 encoded, decode it
    if (keyString.startsWith('base64:')) {
      return Buffer.from(keyString.substring(7), 'base64');
    }
    
    // Otherwise, derive key from string using scrypt
    return crypto.scryptSync(keyString, 'salt', KEY_LENGTH);
  }

  /**
   * Encrypt a token for secure storage
   */
  static async encrypt(plaintext: string): Promise<string> {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(IV_LENGTH);
      
      const cipher = crypto.createCipher(ALGORITHM, key);
      cipher.setAAD(Buffer.from('oauth-token', 'utf8'));
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine IV + authTag + encrypted data
      const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
      
      return combined.toString('base64');
    } catch (error) {
      console.error('Error encrypting token:', error);
      throw new Error('Token encryption failed');
    }
  }

  /**
   * Decrypt a token for use
   */
  static async decrypt(encryptedData: string): Promise<string> {
    try {
      const key = this.getEncryptionKey();
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract components
      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
      
      const decipher = crypto.createDecipher(ALGORITHM, key);
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from('oauth-token', 'utf8'));
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Error decrypting token:', error);
      throw new Error('Token decryption failed');
    }
  }

  /**
   * Generate a new encryption key for initial setup
   */
  static generateEncryptionKey(): string {
    const key = crypto.randomBytes(KEY_LENGTH);
    return 'base64:' + key.toString('base64');
  }

  /**
   * Validate that encryption/decryption works with current key
   */
  static async validateEncryption(): Promise<boolean> {
    try {
      const testData = 'test-oauth-token-' + Date.now();
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);
      return testData === decrypted;
    } catch (error) {
      console.error('Token encryption validation failed:', error);
      return false;
    }
  }

  /**
   * Rotate encryption key (re-encrypt all existing tokens)
   * This would need to be run as a migration when changing keys
   */
  static async rotateKey(
    oldKey: string, 
    newKey: string,
    updateTokenCallback: (encryptedToken: string, newEncryptedToken: string) => Promise<void>
  ): Promise<void> {
    // Store current key
    const currentKey = process.env.TOKEN_ENCRYPTION_KEY;
    
    try {
      // Temporarily set old key for decryption
      process.env.TOKEN_ENCRYPTION_KEY = oldKey;
      
      // This would need to be implemented to fetch all encrypted tokens
      // and re-encrypt them with the new key
      const tokens = []; // Fetch all encrypted tokens from database
      
      for (const token of tokens) {
        const decrypted = await this.decrypt(token.encrypted);
        
        // Set new key for encryption
        process.env.TOKEN_ENCRYPTION_KEY = newKey;
        const newEncrypted = await this.encrypt(decrypted);
        
        // Update in database
        await updateTokenCallback(token.encrypted, newEncrypted);
        
        // Reset to old key for next iteration
        process.env.TOKEN_ENCRYPTION_KEY = oldKey;
      }
      
      // Finally, set the new key
      process.env.TOKEN_ENCRYPTION_KEY = newKey;
      
    } catch (error) {
      // Restore original key on error
      process.env.TOKEN_ENCRYPTION_KEY = currentKey;
      throw error;
    }
  }
}

// Utility functions for key management
export const TokenKeyUtils = {
  /**
   * Check if encryption key is properly configured
   */
  isKeyConfigured(): boolean {
    return !!process.env.TOKEN_ENCRYPTION_KEY;
  },

  /**
   * Get key info (without exposing the actual key)
   */
  getKeyInfo(): { 
    configured: boolean; 
    isBase64: boolean; 
    keyLength: number | null;
  } {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (!key) {
      return { configured: false, isBase64: false, keyLength: null };
    }
    
    const isBase64 = key.startsWith('base64:');
    let keyLength: number | null = null;
    
    try {
      if (isBase64) {
        keyLength = Buffer.from(key.substring(7), 'base64').length;
      } else {
        keyLength = Buffer.from(key).length;
      }
    } catch {
      // Invalid key format
    }
    
    return { configured: true, isBase64, keyLength };
  },

  /**
   * Validate key format and strength
   */
  validateKey(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    
    if (!key) {
      errors.push('TOKEN_ENCRYPTION_KEY is not set');
      return { valid: false, errors };
    }
    
    if (key.length < 32) {
      errors.push('Encryption key is too short (minimum 32 characters)');
    }
    
    if (key.startsWith('base64:')) {
      try {
        const decoded = Buffer.from(key.substring(7), 'base64');
        if (decoded.length < KEY_LENGTH) {
          errors.push(`Base64 decoded key is too short (minimum ${KEY_LENGTH} bytes)`);
        }
      } catch {
        errors.push('Invalid base64 key format');
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
};
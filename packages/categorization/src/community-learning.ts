import * as crypto from 'crypto';
import { CommunityMapping, CategorizationStore } from './models';

/**
 * Privacy-safe community categorization learning.
 * No user IDs are stored — only descriptor → category vote counts.
 */
export class CommunityLearning {
  constructor(private store: CategorizationStore) {}

  /**
   * Normalize a descriptor for consistent hashing.
   */
  private normalize(descriptor: string): string {
    return descriptor
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Hash a normalized descriptor for storage key.
   */
  private hash(descriptor: string): string {
    const normalized = this.normalize(descriptor);
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Record a user's categorization (privacy-safe — no user ID stored).
   */
  async recordCategorization(cleanedDescriptor: string, category: string): Promise<void> {
    const descriptorHash = this.hash(cleanedDescriptor);
    const existing = await this.store.getCommunityMapping(descriptorHash);

    if (existing) {
      existing.categoryVotes[category] = (existing.categoryVotes[category] || 0) + 1;
      existing.totalVotes++;
      existing.lastUpdated = new Date();

      // Recompute top category and confidence
      let maxVotes = 0;
      let topCategory = '';
      for (const [cat, votes] of Object.entries(existing.categoryVotes)) {
        if (votes > maxVotes) {
          maxVotes = votes;
          topCategory = cat;
        }
      }
      existing.topCategory = topCategory;
      existing.confidence = maxVotes / existing.totalVotes;

      await this.store.saveCommunityMapping(descriptorHash, existing);
    } else {
      const mapping: CommunityMapping = {
        descriptor: this.normalize(cleanedDescriptor),
        categoryVotes: { [category]: 1 },
        topCategory: category,
        confidence: 1.0,
        totalVotes: 1,
        lastUpdated: new Date(),
      };
      await this.store.saveCommunityMapping(descriptorHash, mapping);
    }
  }

  /**
   * Get community consensus for a descriptor.
   * Returns null if confidence < 0.8 or votes < 10.
   */
  async getCommunityCategory(cleanedDescriptor: string): Promise<CommunityMapping | null> {
    const descriptorHash = this.hash(cleanedDescriptor);
    const mapping = await this.store.getCommunityMapping(descriptorHash);

    if (!mapping) return null;
    if (mapping.confidence < 0.8 || mapping.totalVotes < 10) return null;

    return mapping;
  }

  /**
   * Get raw community mapping regardless of thresholds.
   */
  async getRawMapping(cleanedDescriptor: string): Promise<CommunityMapping | null> {
    const descriptorHash = this.hash(cleanedDescriptor);
    return this.store.getCommunityMapping(descriptorHash);
  }
}

import * as admin from 'firebase-admin';

export interface KBArticle {
  id: string;
  appId: string;
  title: string;
  content: string;
  tags: string[];
  category: 'getting-started' | 'account' | 'billing' | 'features' | 'troubleshooting';
  helpfulness_score: number;
  created_at: Date;
  updated_at: Date;
}

const KB_COLLECTION = 'knowledge_base';

function getDb() {
  return admin.firestore();
}

/**
 * Semantic search over FAQ/help articles. Uses keyword matching with Firestore;
 * upgrade to Meilisearch or vector embeddings for true semantic search.
 */
export async function searchKnowledgeBase(query: string, appId: string): Promise<KBArticle[]> {
  const db = getDb();
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(t => t.length > 2);

  // Fetch articles for the app (or global articles with appId='*')
  const snapshot = await db.collection(KB_COLLECTION)
    .where('appId', 'in', [appId, '*'])
    .orderBy('helpfulness_score', 'desc')
    .limit(100)
    .get();

  const articles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KBArticle));

  // Score and rank by term overlap in title, content, and tags
  const scored = articles.map(article => {
    const haystack = `${article.title} ${article.content} ${(article.tags || []).join(' ')}`.toLowerCase();
    const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
    return { article, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.article.helpfulness_score - a.article.helpfulness_score)
    .slice(0, 10)
    .map(s => s.article);
}

/**
 * Fetch a single KB article by ID.
 */
export async function getArticle(articleId: string): Promise<KBArticle | null> {
  const db = getDb();
  const doc = await db.collection(KB_COLLECTION).doc(articleId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as KBArticle;
}

/**
 * AI-powered article suggestion based on ticket content.
 * Extracts key phrases from the ticket message and searches the KB.
 */
export async function suggestArticles(ticketMessage: string): Promise<KBArticle[]> {
  // Extract potential app ID from message context; default to wildcard search
  const appIdMatch = ticketMessage.match(/\b(claw-fitness|claw-nutrition|claw-budget|claw-meetings)\b/i);
  const appId = appIdMatch ? appIdMatch[1].toLowerCase() : '*';

  return searchKnowledgeBase(ticketMessage, appId);
}

/**
 * Rate an article's helpfulness (thumbs up/down).
 */
export async function rateArticle(articleId: string, helpful: boolean): Promise<void> {
  const db = getDb();
  const ref = db.collection(KB_COLLECTION).doc(articleId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return;
    const current = (doc.data()?.helpfulness_score as number) || 0;
    tx.update(ref, {
      helpfulness_score: current + (helpful ? 1 : -1),
      updated_at: new Date(),
    });
  });
}

/**
 * Create or update a KB article (admin).
 */
export async function upsertArticle(article: Omit<KBArticle, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<KBArticle> {
  const db = getDb();
  const now = new Date();
  if (article.id) {
    const ref = db.collection(KB_COLLECTION).doc(article.id);
    await ref.update({ ...article, updated_at: now });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() } as KBArticle;
  } else {
    const data = { ...article, helpfulness_score: 0, created_at: now, updated_at: now };
    const ref = await db.collection(KB_COLLECTION).add(data);
    return { id: ref.id, ...data } as KBArticle;
  }
}

/**
 * Delete a KB article (admin).
 */
export async function deleteArticle(articleId: string): Promise<void> {
  const db = getDb();
  await db.collection(KB_COLLECTION).doc(articleId).delete();
}

/**
 * Pulsar Knowledge Base Manager
 * Handles storage, retrieval, and RAG for user knowledge documents
 * Adapted for Electron desktop app
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class KnowledgeBase {
  constructor() {
    this.dataPath = path.join(app.getPath('userData'), 'knowledge-base.json');
    this.CHUNK_SIZE = 500;
    this.CHUNK_OVERLAP = 50;
  }

  /**
   * Add a document to the knowledge base
   */
  addDocument(name, content, metadata = {}) {
    const kb = this.getAll();

    // Parse and chunk the document
    const chunks = this.chunkDocument(content);
    const processedChunks = chunks.map((chunk, index) => ({
      id: `${Date.now()}-${index}`,
      text: chunk,
      keywords: this.extractKeywords(chunk),
      section: this.detectSection(chunk)
    }));

    const doc = {
      id: Date.now().toString(),
      name,
      content,
      chunks: processedChunks,
      metadata: {
        ...metadata,
        addedAt: new Date().toISOString(),
        size: content.length,
        chunkCount: processedChunks.length
      }
    };

    kb.documents.push(doc);
    this.save(kb);

    console.log(`[KnowledgeBase] Added document: ${name} (${processedChunks.length} chunks)`);
    return doc;
  }

  /**
   * Remove a document
   */
  removeDocument(docId) {
    const kb = this.getAll();
    kb.documents = kb.documents.filter(d => d.id !== docId);
    this.save(kb);
    console.log(`[KnowledgeBase] Removed document: ${docId}`);
    return { success: true };
  }

  /**
   * Get all documents
   */
  getAll() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        return JSON.parse(data);
      }
      return { documents: [], version: 1 };
    } catch (error) {
      console.error('[KnowledgeBase] Failed to load:', error);
      return { documents: [], version: 1 };
    }
  }

  /**
   * Save knowledge base
   */
  save(kb) {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(kb, null, 2));
      return true;
    } catch (error) {
      console.error('[KnowledgeBase] Failed to save:', error);
      return false;
    }
  }

  /**
   * Search knowledge base using keyword matching
   */
  search(query, options = {}) {
    const {
      maxResults = 5,
      minScore = 0.1
    } = options;

    const kb = this.getAll();
    const queryKeywords = this.extractKeywords(query);

    if (queryKeywords.length === 0) {
      return [];
    }

    // Score all chunks
    const scoredChunks = [];

    for (const doc of kb.documents) {
      for (const chunk of doc.chunks) {
        const score = this.calculateScore(queryKeywords, chunk.keywords, chunk.text, query);

        if (score >= minScore) {
          scoredChunks.push({
            docId: doc.id,
            docName: doc.name,
            chunkId: chunk.id,
            text: chunk.text,
            section: chunk.section,
            score
          });
        }
      }
    }

    // Sort by score and return top results
    scoredChunks.sort((a, b) => b.score - a.score);
    return scoredChunks.slice(0, maxResults);
  }

  /**
   * Get relevant context for content generation
   */
  getContext(topic, options = {}) {
    const results = this.search(topic, options);

    if (results.length === 0) {
      return null;
    }

    // Combine top results into context
    const context = results
      .map(r => `[From: ${r.docName}${r.section ? ` - ${r.section}` : ''}]\n${r.text}`)
      .join('\n\n---\n\n');

    return {
      context,
      sources: results.map(r => ({
        docName: r.docName,
        section: r.section,
        score: r.score
      }))
    };
  }

  /**
   * Chunk a document into smaller pieces
   */
  chunkDocument(content) {
    const chunks = [];

    // First, try to split by markdown sections
    const sections = content.split(/(?=^#{1,3}\s)/m);

    for (const section of sections) {
      if (section.length <= this.CHUNK_SIZE) {
        if (section.trim()) {
          chunks.push(section.trim());
        }
      } else {
        // Split large sections by paragraphs
        const paragraphs = section.split(/\n\n+/);
        let currentChunk = '';

        for (const para of paragraphs) {
          if ((currentChunk + para).length <= this.CHUNK_SIZE) {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            // If single paragraph is too long, split by sentences
            if (para.length > this.CHUNK_SIZE) {
              const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
              currentChunk = '';
              for (const sentence of sentences) {
                if ((currentChunk + sentence).length <= this.CHUNK_SIZE) {
                  currentChunk += sentence;
                } else {
                  if (currentChunk) chunks.push(currentChunk.trim());
                  currentChunk = sentence;
                }
              }
            } else {
              currentChunk = para;
            }
          }
        }

        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
      }
    }

    return chunks;
  }

  /**
   * Extract keywords from text
   */
  extractKeywords(text) {
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'dare', 'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who', 'whom',
      'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(word =>
        word.length > 2 &&
        !stopWords.has(word) &&
        !/^\d+$/.test(word)
      );

    const freq = {};
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  }

  /**
   * Detect section/heading from chunk
   */
  detectSection(text) {
    const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
    return headingMatch ? headingMatch[1].trim() : null;
  }

  /**
   * Calculate relevance score between query and chunk
   */
  calculateScore(queryKeywords, chunkKeywords, chunkText, queryText) {
    let score = 0;
    const chunkKeywordsSet = new Set(chunkKeywords);
    const chunkTextLower = chunkText.toLowerCase();
    const queryTextLower = queryText.toLowerCase();

    // Keyword overlap score
    for (const keyword of queryKeywords) {
      if (chunkKeywordsSet.has(keyword)) {
        score += 0.3;
      }
    }

    // Exact phrase match bonus
    if (chunkTextLower.includes(queryTextLower)) {
      score += 0.5;
    }

    // Partial phrase match
    const queryWords = queryTextLower.split(/\s+/);
    let consecutiveMatches = 0;
    for (let i = 0; i < queryWords.length - 1; i++) {
      const phrase = queryWords.slice(i, i + 2).join(' ');
      if (chunkTextLower.includes(phrase)) {
        consecutiveMatches++;
      }
    }
    score += consecutiveMatches * 0.2;

    // Normalize score
    return Math.min(score, 1);
  }

  /**
   * Get statistics about the knowledge base
   */
  getStats() {
    const kb = this.getAll();

    const totalSize = kb.documents.reduce((sum, doc) => sum + doc.metadata.size, 0);
    const totalChunks = kb.documents.reduce((sum, doc) => sum + doc.chunks.length, 0);

    return {
      documentCount: kb.documents.length,
      totalSize,
      totalChunks,
      documents: kb.documents.map(doc => ({
        id: doc.id,
        name: doc.name,
        size: doc.metadata.size,
        chunkCount: doc.chunks.length,
        addedAt: doc.metadata.addedAt
      }))
    };
  }

  /**
   * Clear all documents
   */
  clear() {
    this.save({ documents: [], version: 1 });
    console.log('[KnowledgeBase] Knowledge base cleared');
    return { success: true };
  }

  /**
   * Export knowledge base
   */
  export() {
    return this.getAll();
  }

  /**
   * Import knowledge base
   */
  import(data) {
    if (data && data.documents) {
      this.save(data);
      console.log(`[KnowledgeBase] Imported ${data.documents.length} documents`);
      return { success: true, count: data.documents.length };
    }
    return { success: false, error: 'Invalid data format' };
  }
}

module.exports = new KnowledgeBase();

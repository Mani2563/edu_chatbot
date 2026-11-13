/**
 * Deterministic Okapi BM25 Lexical Retrieval Engine
 * Strictly reproducible lexical relevance ranking with source attribution
 */

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'by', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * Tokenize string into normalized lowercase terms
 */
export function tokenize(text, removeStopwords = true) {
  if (!text || typeof text !== 'string') return [];

  const rawTokens = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !/^\d+$/.test(t));

  if (!removeStopwords) return rawTokens;

  const filtered = rawTokens.filter(t => !STOP_WORDS.has(t));
  // If all tokens were filtered out (e.g. "what is that"), fall back to raw tokens
  return filtered.length > 0 ? filtered : rawTokens;
}

/**
 * Compute Term Frequencies for a token array
 */
function getTermFrequencies(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

/**
 * Okapi BM25 Ranking Engine
 */
export class BM25Engine {
  constructor(chunks, options = {}) {
    this.k1 = options.k1 ?? 1.5;   // Term saturation parameter
    this.b = options.b ?? 0.75;    // Length normalization parameter
    this.minScoreThreshold = options.threshold ?? 0.05;

    this.chunks = chunks || [];
    this.N = this.chunks.length;

    // Corpus statistics
    this.chunkTokens = [];
    this.chunkTFs = [];
    this.chunkLengths = [];
    this.docFreqs = new Map(); // term -> count of docs containing term
    this.totalLength = 0;

    this._indexCorpus();
  }

  _indexCorpus() {
    for (const chunk of this.chunks) {
      const tokens = tokenize(chunk.content || '');
      const tf = getTermFrequencies(tokens);
      const len = tokens.length;

      this.chunkTokens.push(tokens);
      this.chunkTFs.push(tf);
      this.chunkLengths.push(len);
      this.totalLength += len;

      for (const term of tf.keys()) {
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
      }
    }

    this.avgdl = this.N > 0 ? this.totalLength / this.N : 0;
  }

  /**
   * Robertson-Spärck Jones Okapi IDF
   */
  _computeIDF(term) {
    const n = this.docFreqs.get(term) || 0;
    if (n === 0) return 0;
    // Standard Okapi BM25 IDF formulation with floor protection
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  /**
   * Score a single chunk against query tokens
   */
  _scoreChunk(chunkIdx, queryTokens) {
    if (this.N === 0 || queryTokens.length === 0) return 0;

    const tfMap = this.chunkTFs[chunkIdx];
    const docLen = this.chunkLengths[chunkIdx];
    let score = 0;

    for (const term of queryTokens) {
      const freq = tfMap.get(term) || 0;
      if (freq === 0) continue;

      const idf = this._computeIDF(term);
      const numerator = freq * (this.k1 + 1);
      const denominator = freq + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1)));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Search corpus and return ranked results with exact source attribution
   */
  search(query, topK = 5) {
    if (!query || typeof query !== 'string' || this.N === 0) {
      return {
        query: query || '',
        hasEvidence: false,
        results: []
      };
    }

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return {
        query,
        hasEvidence: false,
        results: []
      };
    }

    const scoredChunks = [];

    for (let i = 0; i < this.N; i++) {
      const score = this._scoreChunk(i, queryTokens);
      if (score >= this.minScoreThreshold) {
        const chunk = this.chunks[i];
        scoredChunks.push({
          chunkId: chunk.id,
          documentId: chunk.document_id,
          fileName: chunk.metadata?.fileName || 'document',
          chunkIndex: chunk.chunk_index,
          pageNumber: chunk.page_number,
          sectionTitle: chunk.section_title || 'Unidentified section',
          content: chunk.content,
          score: parseFloat(score.toFixed(4))
        });
      }
    }

    // Sort descending by deterministic BM25 score
    scoredChunks.sort((a, b) => b.score - a.score);

    const topResults = scoredChunks.slice(0, topK);

    return {
      query,
      hasEvidence: topResults.length > 0,
      totalMatched: scoredChunks.length,
      results: topResults
    };
  }
}


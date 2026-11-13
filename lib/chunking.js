import crypto from 'crypto';
import { detectSectionTitle } from './document-parser.js';

/**
 * Splits document pages into semantic, sentence-boundary aware, metadata-rich chunks
 * Preserves page numbers, section headers, character offsets, and integer chunk indexes
 */
export function chunkDocument(pages, options = {}) {
  const {
    documentId,
    userId,
    fileName = 'unknown-document',
    targetSize = 800,
    minSize = 150,
    overlapSize = 120
  } = options;

  if (!documentId) throw new Error('documentId is required for chunking');
  if (!userId) throw new Error('userId is required for chunking');

  const chunks = [];
  let chunkIndex = 0;
  let currentSection = 'Unidentified section';
  let runningCharOffset = 0;

  for (const page of pages) {
    const pageNumber = page.pageNumber || null;
    const pageText = (page.text || '').trim();

    if (!pageText) continue;

    // Detect section updates on this page
    currentSection = detectSectionTitle(pageText, currentSection);

    // Split page into paragraphs
    const rawParagraphs = pageText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    // Further split oversized paragraphs into sentences to respect natural linguistic boundaries
    const sentences = [];
    for (const para of rawParagraphs) {
      if (para.length > targetSize) {
        // Split on sentence boundaries: periods, question marks, exclamation marks followed by whitespace
        const splitSentences = para.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
        sentences.push(...splitSentences);
      } else {
        sentences.push(para);
      }
    }

    let currentChunkText = '';
    let chunkStartChar = runningCharOffset;

    for (const segment of sentences) {
      // Check if segment introduces a section title
      const newSection = detectSectionTitle(segment, null);
      if (newSection && newSection !== 'Unidentified section') {
        currentSection = newSection;
      }

      if ((currentChunkText + ' ' + segment).trim().length <= targetSize) {
        currentChunkText = currentChunkText ? `${currentChunkText} ${segment}` : segment;
      } else {
        // If current chunk has reached minimum size, commit it
        if (currentChunkText.length >= minSize) {
          const chunkId = crypto.randomUUID();
          const cleanContent = currentChunkText.trim();
          const chunkEndChar = chunkStartChar + cleanContent.length;

          chunks.push({
            id: chunkId,
            document_id: documentId,
            user_id: userId,
            chunk_index: chunkIndex++,
            content: cleanContent,
            page_number: pageNumber,
            section_title: currentSection,
            metadata: {
              fileName,
              wordCount: cleanContent.split(/\s+/).filter(Boolean).length,
              charLength: cleanContent.length,
              startChar: chunkStartChar,
              endChar: chunkEndChar
            }
          });

          // Carry over tail for sentence/paragraph-aware overlap
          const overlap = cleanContent.slice(-overlapSize);
          currentChunkText = `${overlap} ${segment}`;
          chunkStartChar = chunkEndChar - overlap.length;
        } else {
          // If smaller than minSize, append segment anyway
          currentChunkText = currentChunkText ? `${currentChunkText} ${segment}` : segment;
        }
      }
    }

    // Flush remaining content on page
    if (currentChunkText.trim().length > 0) {
      const chunkId = crypto.randomUUID();
      const cleanContent = currentChunkText.trim();
      const chunkEndChar = chunkStartChar + cleanContent.length;

      chunks.push({
        id: chunkId,
        document_id: documentId,
        user_id: userId,
        chunk_index: chunkIndex++,
        content: cleanContent,
        page_number: pageNumber,
        section_title: currentSection,
        metadata: {
          fileName,
          wordCount: cleanContent.split(/\s+/).filter(Boolean).length,
          charLength: cleanContent.length,
          startChar: chunkStartChar,
          endChar: chunkEndChar
        }
      });
      runningCharOffset = chunkEndChar;
    }
  }

  // Edge case: very short document
  if (chunks.length === 0 && pages.length > 0) {
    const combinedText = pages.map(p => p.text).join('\n\n').trim();
    if (combinedText) {
      chunks.push({
        id: crypto.randomUUID(),
        document_id: documentId,
        user_id: userId,
        chunk_index: 0,
        content: combinedText,
        page_number: pages[0]?.pageNumber || null,
        section_title: currentSection,
        metadata: {
          fileName,
          wordCount: combinedText.split(/\s+/).filter(Boolean).length,
          charLength: combinedText.length,
          startChar: 0,
          endChar: combinedText.length
        }
      });
    }
  }

  return chunks;
}

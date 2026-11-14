import { createRequire } from 'module';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * Parses raw file buffer based on extension/type
 * Returns structured array of page objects: [{ pageNumber: 1, text: '...' }]
 */
export async function parseDocument(buffer, filename) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Document buffer is empty');
  }

  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'pdf':
      return await parsePdf(buffer);
    case 'docx':
      return await parseDocx(buffer);
    case 'txt':
      return parseTxt(buffer);
    default:
      throw new Error(`Unsupported document extension: .${ext}. Only .pdf, .docx, and .txt are supported.`);
  }
}

/**
 * Parse PDF and preserve page numbers
 * Industry approach: try strict parse first, then lenient fallback for corrupted PDFs
 */
async function parsePdf(buffer) {
  // Attempt 1: Full page-level parse with custom renderer
  try {
    const options = {
      pagerender: function (pageData) {
        return pageData.getTextContent().then(function (textContent) {
          let lastY, text = '';
          for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          return `\n[[GAPFINDER_PAGE_${pageData.pageIndex + 1}]]\n${text}`;
        });
      }
    };

    const data = await pdfParse(buffer, options);
    const pages = extractPagesFromText(data.text || '');

    if (pages.length > 0) return pages;
  } catch (err) {
    console.warn(`PDF strict parse failed: ${err.message}. Trying lenient mode...`);
  }

  // Attempt 2: Lenient fallback — default pdf-parse without custom renderer
  try {
    const data = await pdfParse(buffer);
    const text = (data.text || '').trim();

    if (!text) {
      throw new Error('PDF document contained no readable text content');
    }

    // Return as single page since we lost page boundaries
    return [{ pageNumber: 1, text }];
  } catch (err) {
    // Final error — give user a clear message
    const msg = err.message || '';
    if (msg.includes('XRef') || msg.includes('stream') || msg.includes('token')) {
      throw new Error(
        'This PDF file appears to be corrupted or uses an unsupported format. ' +
        'Please try re-exporting or re-saving the PDF from the original source, ' +
        'or convert it to a .txt or .docx file and upload again.'
      );
    }
    throw new Error(`Failed to parse PDF document: ${msg}`);
  }
}

/**
 * Extract pages from text using GAPFINDER_PAGE markers
 */
function extractPagesFromText(fullText) {
  const pageSplits = fullText.split(/\[\[GAPFINDER_PAGE_(\d+)\]\]/);
  const pages = [];

  if (pageSplits.length <= 1) {
    const trimmed = fullText.trim();
    if (trimmed.length > 0) {
      pages.push({ pageNumber: 1, text: trimmed });
    }
  } else {
    for (let i = 1; i < pageSplits.length; i += 2) {
      const pageNum = parseInt(pageSplits[i], 10);
      const text = (pageSplits[i + 1] || '').trim();
      if (text.length > 0) {
        pages.push({ pageNumber: pageNum, text });
      }
    }
  }
  return pages;
}

/**
 * Parse DOCX document using Mammoth
 */
async function parseDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    if (!text) {
      throw new Error('DOCX document contained no readable text content');
    }
    // DOCX files do not have explicit physical page counts without rendering layout engine
    return [{ pageNumber: 1, text }];
  } catch (err) {
    throw new Error(`Failed to parse DOCX document: ${err.message}`);
  }
}

/**
 * Parse plain text document
 */
function parseTxt(buffer) {
  try {
    const text = buffer.toString('utf-8').trim();
    if (!text) {
      throw new Error('TXT document is empty');
    }
    return [{ pageNumber: 1, text }];
  } catch (err) {
    throw new Error(`Failed to parse TXT document: ${err.message}`);
  }
}

/**
 * Heuristically detects section title from a chunk of text
 * Uses honest fallback 'Unidentified section' if no clear heading is found
 */
export function detectSectionTitle(text, previousHeading = null) {
  if (!text) return previousHeading || 'Unidentified section';

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Common textbook boilerplate and exercise callouts to ignore as section titles
  const BOILERPLATE_REGEX = /^(SCERT|TELANGANA|DO THIS|THINK AND DISCUSS|THINK - DISCUSS|THINK-DISCUSS|TRY THIS|ACTIVITY|EXERCISE|NOTE|PLEDGE|CHAPTERCONTENTS|OUR NATIONAL ANTHEM)/i;

  for (const line of lines.slice(0, 4)) {
    if (BOILERPLATE_REGEX.test(line)) continue;

    // Reject lines containing mathematical equations, equality, or arithmetic operators
    if (/[=+×÷<>√]/.test(line)) continue;

    // Check for explicit Chapter / Section / Unit headings
    if (/^(Chapter|Unit|Topic|Module|Part)\s+[\dIVXLCDM\w\.\-]+/i.test(line) && line.length < 80) {
      return line.slice(0, 100);
    }

    // Check for numbered outline headers (e.g., "1.1 Introduction" or "14.3 Mode")
    // Rejects dimension/unit lines like "1.5 cm", "55.44 cm"
    if (/^\d{1,2}(\.\d+)+\s+[A-Za-z]{2,}/.test(line) && !/\b(cm|mm|m|km|kg|g|s|kmph)\b/i.test(line) && line.length < 80) {
      return line.slice(0, 100);
    }

    // Check for short uppercase headers (must contain letters, cannot be numbers/symbols)
    if (/[A-Z]{3,}/.test(line) && line === line.toUpperCase() && line.length > 3 && line.length < 60 && !/[.!?]$/.test(line)) {
      return line;
    }
  }

  return previousHeading || 'Unidentified section';
}


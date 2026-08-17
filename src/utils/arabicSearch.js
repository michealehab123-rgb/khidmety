/**
 * Utility functions for advanced Arabic text normalization and fuzzy searching.
 * Solves common issues with Arabic typos (ة/ه, أ/إ/آ/ا, ى/ي, diacritics, word order, and character substitutions).
 */

// Tashkeel / Diacritics regex
const TASHKEEL_REGEX = /[\u064B-\u0652\u0640]/g;

// Eastern Arabic numerals mapping
const ARABIC_DIGITS_MAP = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
};

/**
 * Normalizes Arabic string for flexible matching:
 * - Removes diacritics (tashkeel) and tatweel
 * - Normalizes Alef variants (أ, إ, آ, ٱ, ء, ؤ, ئ) -> ا
 * - Normalizes Teh Marbuta and Heh (ة -> ه)
 * - Normalizes Alef Maqsura and Yeh (ى -> ي)
 * - Converts Eastern Arabic digits to standard ASCII digits
 * - Converts to lowercase & cleans extra punctuation/spaces
 */
export const normalizeArabic = (text) => {
  if (!text) return '';
  let str = String(text);

  // Convert Eastern Arabic numerals to standard digits
  str = str.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => ARABIC_DIGITS_MAP[d] || d);

  // Remove diacritics & tatweel
  str = str.replace(TASHKEEL_REGEX, '');

  // Normalize Alef, Hamza, Teh Marbuta, Alef Maqsura
  str = str
    .replace(/[أإآٱءؤئ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

  // Convert to lowercase and replace punctuation/symbols with space
  str = str.toLowerCase().replace(/[^\w\u0600-\u06FF\s]/g, ' ');

  // Collapse multiple whitespace
  return str.replace(/\s+/g, ' ').trim();
};

/**
 * Computes Levenshtein Distance between two normalized strings.
 */
export const getLevenshteinDistance = (a, b) => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = (a[i - 1] === b[j - 1]) ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
};

/**
 * Checks if a query token matches a target token (exact, prefix, substring, or fuzzy).
 */
export const matchToken = (qToken, tToken) => {
  if (!qToken || !tToken) return false;

  // 1. Direct substring match
  if (tToken.includes(qToken)) return true;

  // 2. Prefix match
  if (qToken.length >= 3 && tToken.startsWith(qToken)) return true;

  // 3. Fuzzy match (Levenshtein distance for typo tolerance)
  const qLen = qToken.length;
  const tLen = tToken.length;

  // For very short query tokens (<= 3 chars), require exact prefix/substring match
  if (qLen <= 3) return false;

  // Maximum allowed distance depends on token length
  let maxDistance = 1;
  if (qLen >= 6) maxDistance = 2;

  // Compare against prefix of target if target is longer
  if (tLen >= qLen) {
    const targetPrefix = tToken.substring(0, Math.min(tLen, qLen + 1));
    if (getLevenshteinDistance(qToken, targetPrefix) <= maxDistance) {
      return true;
    }
  }

  return getLevenshteinDistance(qToken, tToken) <= maxDistance;
};

/**
 * Main fuzzy match function. Checks if all words in `query` match at least one word in `targetText`.
 * Also handles numbers/codes and phone search without spaces.
 */
export const matchArabicText = (query, targetText) => {
  if (!query || !query.trim()) return true;
  if (!targetText) return false;

  const normQuery = normalizeArabic(query);
  const normTarget = normalizeArabic(targetText);

  if (!normQuery) return true;
  if (!normTarget) return false;

  // Quick direct substring match on full normalized text
  if (normTarget.includes(normQuery)) return true;

  // Remove spaces for numeric/phone matching (e.g., searching phone numbers or codes)
  const rawQueryDigits = normQuery.replace(/\D/g, '');
  const rawTargetDigits = normTarget.replace(/\D/g, '');
  if (rawQueryDigits.length >= 3 && rawTargetDigits.includes(rawQueryDigits)) {
    return true;
  }

  const queryTokens = normQuery.split(' ').filter(Boolean);
  const targetTokens = normTarget.split(' ').filter(Boolean);

  if (queryTokens.length === 0) return true;
  if (targetTokens.length === 0) return false;

  // Every token in query must match at least one token in target
  return queryTokens.every(qToken => 
    targetTokens.some(tToken => matchToken(qToken, tToken))
  );
};

/**
 * Helper to filter an array of items by search query across specified/extracted fields.
 * @param {Array} items - Array of objects
 * @param {String} query - User search term
 * @param {Function|Array} fieldExtractor - Function (item => string/array) or Array of field names
 */
export const filterByArabicSearch = (items, query, fieldExtractor) => {
  if (!items || !Array.isArray(items)) return [];
  if (!query || !query.trim()) return items;

  return items.filter(item => {
    let values = [];
    if (typeof fieldExtractor === 'function') {
      const extracted = fieldExtractor(item);
      values = Array.isArray(extracted) ? extracted : [extracted];
    } else if (Array.isArray(fieldExtractor)) {
      values = fieldExtractor.map(f => item[f]);
    } else if (typeof fieldExtractor === 'string') {
      values = [item[fieldExtractor]];
    } else {
      // Default: inspect name, code, phone, phones
      values = [
        item.name,
        item.code,
        item.phone,
        ...(Array.isArray(item.phones) ? item.phones : [])
      ];
    }

    const combinedText = values.filter(Boolean).join(' ');
    return matchArabicText(query, combinedText);
  });
};

/**
 * Normalizes compound prefixes in Arabic names (e.g. "عبد الله" -> "عبدالله", "أبو " -> "ابو ").
 */
export const normalizeCompoundNames = (text) => {
  if (!text) return '';
  let str = String(text);
  return str
    .replace(/\bعبد\s+/g, 'عبد')
    .replace(/\bأبو\s+/g, 'ابو')
    .replace(/\bابو\s+/g, 'ابو')
    .replace(/\bأم\s+/g, 'ام')
    .replace(/\bام\s+/g, 'ام')
    .replace(/\bمار\s+/g, 'مار');
};

/**
 * Combined normalization: Arabic letters + compound names + trim extra spaces.
 */
export const normalizeArabicAndCompound = (text) => {
  if (!text) return '';
  const norm = normalizeArabic(text);
  return normalizeCompoundNames(norm).replace(/\s+/g, ' ').trim();
};

/**
 * Calculates a matching score (0 to 100) between a user-input name and a student's full name.
 */
export const calculateNameMatchScore = (inputName, studentName) => {
  if (!inputName || !studentName) return 0;

  const normInput = normalizeArabicAndCompound(inputName);
  const normStudent = normalizeArabicAndCompound(studentName);

  if (!normInput || !normStudent) return 0;

  // Exact match
  if (normInput === normStudent) return 100;

  // Student name starts with input name (e.g. input "ماريو عماد" and student "ماريو عماد فايز")
  if (normStudent.startsWith(normInput)) return 95;

  const inputTokens = normInput.split(' ').filter(Boolean);
  const studentTokens = normStudent.split(' ').filter(Boolean);

  if (inputTokens.length === 0 || studentTokens.length === 0) return 0;

  // Count how many input tokens match student tokens
  let matchedTokensCount = 0;
  for (let i = 0; i < inputTokens.length; i++) {
    const qToken = inputTokens[i];
    const matchesAny = studentTokens.some(tToken => matchToken(qToken, tToken));
    if (matchesAny) {
      matchedTokensCount++;
    }
  }

  const ratio = matchedTokensCount / inputTokens.length;

  if (ratio === 1) {
    // All input words match in student name
    let inOrder = true;
    let lastIdx = -1;
    for (const qToken of inputTokens) {
      const idx = studentTokens.findIndex((tToken, idx) => idx > lastIdx && matchToken(qToken, tToken));
      if (idx !== -1) {
        lastIdx = idx;
      } else {
        inOrder = false;
        break;
      }
    }
    return inOrder ? 90 : 80;
  } else if (ratio >= 0.66) {
    return 60;
  } else if (ratio >= 0.5) {
    return 40;
  }

  return 0;
};


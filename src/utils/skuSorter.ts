export const MODEL_ORDER = [
  'M7',
  'M95',
  'M108',
  'R08',
  'LR08',
  'R011',
  'R013',
  'PR021',
  'PR022',
  'PR025',
  'AIM7',
  'AIM95',
  'AIM108',
  'MR08AI',
  'LAIR08',
  'AIR011',
  'AIR013',
  'MR021',
  'MR022',
  'MR025'
];

// Sort model prefixes by length descending so longer/more specific prefixes are matched first
const MODELS_BY_LENGTH_DESC = [...MODEL_ORDER].sort((a, b) => b.length - a.length);

/**
 * Extracts a dynamic series/model prefix from a SKU code or name when it does not match predefined models.
 * E.g. "SKU-ABC-01" -> "ABC", "M95H" -> "M95", "M108P" -> "M108". Never returns "Lainnya".
 */
export function extractDynamicModelPrefix(code?: string, name?: string): string {
  let rawCode = (code || '').trim().toUpperCase();
  
  // Clean off common generic prefixes
  if (rawCode.startsWith('SKU-') || rawCode.startsWith('SKU_') || rawCode.startsWith('SKU ')) {
    rawCode = rawCode.substring(4).trim();
  }

  if (rawCode) {
    const parts = rawCode.split(/[-_/\s]+/);
    if (parts.length > 0 && parts[0]) {
      const p = parts[0];
      const match = p.match(/^([A-Z]+\d+)[A-Z]$/);
      if (match) {
        return match[1];
      }
      return p;
    }
    return rawCode;
  }

  let rawName = (name || '').trim().toUpperCase();
  if (rawName.startsWith('SKU-') || rawName.startsWith('SKU_') || rawName.startsWith('SKU ')) {
    rawName = rawName.substring(4).trim();
  }
  if (rawName) {
    const parts = rawName.split(/[-_/\s]+/);
    if (parts.length > 0 && parts[0]) {
      const p = parts[0];
      const match = p.match(/^([A-Z]+\d+)[A-Z]$/);
      if (match) {
        return match[1];
      }
      return p;
    }
    return rawName;
  }

  return 'SKU';
}

/**
 * Determines the model group index for a SKU code or name based on the defined MODEL_ORDER sequence.
 * Returns 999 if no known model prefix matches.
 */
export function getSkuGroupIndex(code?: string, name?: string): number {
  const candidateStrings = [code || '', name || ''].filter(Boolean);

  for (const rawStr of candidateStrings) {
    const cleanStr = rawStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const upperStr = rawStr.toUpperCase().trim();

    // Pass 1: Starts with model (longest prefix first)
    for (const model of MODELS_BY_LENGTH_DESC) {
      if (cleanStr.startsWith(model)) {
        return MODEL_ORDER.indexOf(model);
      }
    }

    // Pass 2: Word boundary regex match (e.g. "SKU-M7-01")
    for (const model of MODELS_BY_LENGTH_DESC) {
      const regex = new RegExp(`(?:^|[^A-Z0-9])${model}(?:[^A-Z0-9]|$)`);
      if (regex.test(upperStr)) {
        return MODEL_ORDER.indexOf(model);
      }
    }

    // Pass 3: Substring match on clean string
    for (const model of MODELS_BY_LENGTH_DESC) {
      if (cleanStr.includes(model)) {
        return MODEL_ORDER.indexOf(model);
      }
    }
  }

  return 999;
}

/**
 * Gets the model name (e.g. "M7", "R08", or dynamically extracted prefix) for grouping headers.
 * Guarantees no "Lainnya" output.
 */
export function getSkuModelName(code?: string, name?: string): string {
  const index = getSkuGroupIndex(code, name);
  if (index >= 0 && index < MODEL_ORDER.length) {
    return MODEL_ORDER[index];
  }
  return extractDynamicModelPrefix(code, name);
}

/**
 * Comparator function to sort SKUs or items by model series order,
 * and within each model series group, sort by variation/color code.
 */
export function compareSkusByModelAndVariant<T extends { id?: string; logicalSkuId?: string; skuId?: string; name?: string; skuName?: string }>(a: T, b: T): number {
  const codeA = (a.id || a.logicalSkuId || a.skuId || '').trim();
  const codeB = (b.id || b.logicalSkuId || b.skuId || '').trim();
  const nameA = (a.name || a.skuName || '').trim();
  const nameB = (b.name || b.skuName || '').trim();

  const groupA = getSkuGroupIndex(codeA, nameA);
  const groupB = getSkuGroupIndex(codeB, nameB);

  const modelNameA = getSkuModelName(codeA, nameA);
  const modelNameB = getSkuModelName(codeB, nameB);

  if (groupA !== groupB) {
    if (groupA < 999 && groupB < 999) {
      return groupA - groupB;
    }
    if (groupA < 999) return -1;
    if (groupB < 999) return 1;

    // Both 999: compare extracted model names alphabetically
    const modelComp = modelNameA.localeCompare(modelNameB, undefined, { numeric: true, sensitivity: 'base' });
    if (modelComp !== 0) return modelComp;
  } else if (groupA === 999 && groupB === 999 && modelNameA !== modelNameB) {
    return modelNameA.localeCompare(modelNameB, undefined, { numeric: true, sensitivity: 'base' });
  }

  // Same model group: sort by code / variation naturally
  const codeComp = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  if (codeComp !== 0) return codeComp;

  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Sorts an array of SKU objects in-place or returns a new sorted array.
 */
export function sortSkusByModelAndVariant<T extends { id?: string; logicalSkuId?: string; skuId?: string; name?: string; skuName?: string }>(skus: T[]): T[] {
  return [...skus].sort(compareSkusByModelAndVariant);
}


import { JoyError } from './types.js';

const ANCHOR_ALIASES: Record<string, string[]> = {
  'app-module-imports': [
    '// joy:anchor app-module-imports',
    '// @joy:imports',
  ],
  'app-module-declarations': [
    '// joy:anchor app-module-declarations',
    '// @joy:modules',
  ],
};

function getAnchorPatterns(anchorName: string): string[] {
  return (
    ANCHOR_ALIASES[anchorName] ?? [
      `// joy:anchor ${anchorName}`,
      `/* joy:anchor ${anchorName} */`,
      `<!-- joy:anchor ${anchorName} -->`,
    ]
  );
}

export function hasAnchor(source: string, anchorName: string): boolean {
  const patterns = getAnchorPatterns(anchorName);
  return patterns.some((p) => source.includes(p));
}

export function insertAtAnchor(
  source: string,
  anchorName: string,
  insertion: string,
  opts?: { arrayItem?: boolean }
): string {
  const patterns = getAnchorPatterns(anchorName);
  const matchedPattern = patterns.find((p) => source.includes(p));
  if (!matchedPattern) {
    throw new JoyError(
      'E_ANCHOR_MISSING',
      `Missing anchor "${anchorName}" (expected "${patterns[0]}"). Run "joy init" first.`,
      1
    );
  }

  const trimmedInsertion = insertion.trim();
  if (source.includes(trimmedInsertion)) {
    return source;
  }

  const lines = source.split('\n');
  const anchorIdx = lines.findIndex((line) => line.includes(matchedPattern));
  if (anchorIdx === -1) {
    throw new JoyError(
      'E_ANCHOR_MISSING',
      `Missing anchor "${anchorName}". Run "joy init" first.`,
      1
    );
  }

  if (opts?.arrayItem && anchorIdx > 0) {
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const prev = lines[i].trim();
      if (!prev || prev.startsWith('//') || prev.startsWith('/*')) continue;
      if (!prev.endsWith('[') && !prev.endsWith(',')) {
        lines[i] = `${lines[i]},`;
      }
      break;
    }
  }

  lines.splice(anchorIdx, 0, insertion);
  return lines.join('\n');
}

export function ensureNestAppModuleAnchors(source: string): string {
  let result = source;

  if (!hasAnchor(result, 'app-module-imports')) {
    const lines = result.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith('import ') || trimmed.startsWith('} from ')) {
        lastImportIdx = i;
      }
      if (trimmed.startsWith('@Module')) break;
    }
    if (lastImportIdx !== -1) {
      lines.splice(lastImportIdx + 1, 0, '// joy:anchor app-module-imports');
      result = lines.join('\n');
    } else {
      result = `// joy:anchor app-module-imports\n${result}`;
    }
  }

  if (!hasAnchor(result, 'app-module-declarations')) {
    const importsIdx = result.indexOf('imports:');
    if (importsIdx !== -1) {
      const openBracketIdx = result.indexOf('[', importsIdx);
      if (openBracketIdx !== -1) {
        let depth = 0;
        let closeBracketIdx = -1;
        for (let i = openBracketIdx; i < result.length; i++) {
          if (result[i] === '[') depth++;
          else if (result[i] === ']') {
            depth--;
            if (depth === 0) {
              closeBracketIdx = i;
              break;
            }
          }
        }
        if (closeBracketIdx !== -1) {
          const beforeClose = result.slice(0, closeBracketIdx);
          const afterClose = result.slice(closeBracketIdx);
          const trimmedBefore = beforeClose.trimEnd();
          const needsComma =
            !trimmedBefore.endsWith('[') && !trimmedBefore.endsWith(',');
          const prefix = needsComma ? `${trimmedBefore},\n` : `${trimmedBefore}\n`;
          result = `${prefix}    // joy:anchor app-module-declarations\n  ${afterClose}`;
        }
      }
    }
  }

  return result;
}

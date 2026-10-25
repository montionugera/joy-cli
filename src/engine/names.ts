export function toKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export function toSnake(input: string): string {
  return toKebab(input).replace(/-/g, '_');
}

export function toPascal(input: string): string {
  return toKebab(input)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function toCamel(input: string): string {
  const pascal = toPascal(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toPluralKebab(input: string): string {
  const k = toKebab(input);
  if (k.endsWith('y') && !/[aeiou]y$/.test(k)) {
    return `${k.slice(0, -1)}ies`;
  }
  if (k.endsWith('s') || k.endsWith('x') || k.endsWith('ch') || k.endsWith('sh')) {
    return `${k}es`;
  }
  return `${k}s`;
}

export function toPluralSnake(input: string): string {
  return toPluralKebab(input).replace(/-/g, '_');
}

export function isPascalCase(input: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(input);
}

export function isKebabRoute(input: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(input);
}

import type { Collection } from './types';

// --- URL Helpers --------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isSafeBookmarkUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return !!parsed && ALLOWED_PROTOCOLS.has(parsed.protocol);
}

export function canFetchPreview(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.trim();
  if (!hostname) {
    return false;
  }

  return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function sanitizeBookmarkUrl(url: string): string | null {
  const trimmed = url.trim();
  return isSafeBookmarkUrl(trimmed) ? trimmed : null;
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function getFavicon(url: string): string {
  try {
    const { origin } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return '';
  }
}

// --- Date Helpers -------------------------------------------------------------

export function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000;
  const h = 3_600_000;
  const d = 86_400_000;

  if (diff < m) return 'Just now';
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;

  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- ID Generator -------------------------------------------------------------

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// --- Tag parsing --------------------------------------------------------------

export function parseTags(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean);
}

// --- Collection Hierarchy -----------------------------------------------------

export interface CollectionNode extends Collection {
  children: CollectionNode[];
  depth: number;
}

export function buildCollectionTree(collections: Collection[], parentId?: string, depth = 0): CollectionNode[] {
  return collections
    .filter(c => c.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({
      ...c,
      depth,
      children: buildCollectionTree(collections, c.id, depth + 1)
    }));
}

export function flattenCollectionTree(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.reduce((acc, node) => {
    return [...acc, node, ...flattenCollectionTree(node.children)];
  }, [] as CollectionNode[]);
}

export function getCollectionDescendants(collections: Collection[], id: string): Set<string> {
  const descendants = new Set<string>();
  const children = collections.filter(c => c.parentId === id);
  for (const child of children) {
    descendants.add(child.id);
    const childDescendants = getCollectionDescendants(collections, child.id);
    childDescendants.forEach(d => descendants.add(d));
  }
  return descendants;
}

import {
  addBookmark,
  addCollection,
  deleteBookmark,
  deleteCollection,
  getBookmarks,
  getCollections,
  moveToTrash,
  restoreFromTrash,
  updateBookmark,
  updateCollection,
  saveBookmarks,
  saveCollections,
  getInitialState,
  updateSettings,
} from './storage';
import { COLLECTION, type AppState, type Bookmark, type Collection } from './types';
import { canFetchPreview, generateId, getDomain, getFavicon, isSafeBookmarkUrl, sanitizeBookmarkUrl } from './utils';
import { getAiSummary } from './ai';



async function fetchLinkPreview(url: string): Promise<string | undefined> {
  if (!canFetchPreview(url)) {
    return undefined;
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000); // 2s timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    
    if (!res.ok) return undefined;
    
    // Read only a chunk of the response to avoid downloading large files
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < 150000) { // first 150KB should be enough for head tags
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel();
    
    // Very basic regex to find og:image
    const ogImageMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) || 
                         text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
    
    if (ogImageMatch && ogImageMatch[1]) {
      // Handle relative URLs
      if (ogImageMatch[1].startsWith('/')) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${ogImageMatch[1]}`;
      }
      return ogImageMatch[1];
    }
    
    // Fallback to twitter image
    const twitImageMatch = text.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                           text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i);
    if (twitImageMatch && twitImageMatch[1]) {
      if (twitImageMatch[1].startsWith('/')) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${twitImageMatch[1]}`;
      }
      return twitImageMatch[1];
    }
  } catch (error) {
    console.debug('Failed to fetch link preview for', url, error);
  }
  return undefined;
}

async function togglePinBookmark(id: string) {
  const bookmarks = await getBookmarks();
  const index = bookmarks.findIndex((b) => b.id === id);
  if (index !== -1) {
    bookmarks[index].pinned = !bookmarks[index].pinned;
    bookmarks[index].updatedAt = Date.now();
    await saveBookmarks(bookmarks);
  }
  return await getState();
}

// ─── State helper ─────────────────────────────────────────────────────────────

async function getState(): Promise<AppState> {
  return await getInitialState();
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'bm-save-page',
    title: 'Save to Bookmark Manager',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'bm-save-page') return;

  const rawUrl = info.linkUrl ?? info.pageUrl ?? tab?.url ?? '';
  const url = sanitizeBookmarkUrl(rawUrl);
  if (!url) return;

  let title = info.linkUrl ? getDomain(info.linkUrl) : (tab?.title ?? '');
  const favicon = getFavicon(url);

  const coverUrl = await fetchLinkPreview(url);
  const autoTags: string[] = [];

  const bookmarks = await getBookmarks();
  const existing = bookmarks.find(b => b.url === url);

  if (existing) {
    existing.tags = Array.from(new Set([...existing.tags, ...autoTags]));
    existing.updatedAt = Date.now();
    if (coverUrl && !existing.coverUrl) {
      existing.coverUrl = coverUrl;
    }
    await updateBookmark(existing);
    return;
  }

  // Try to use AI summarization if possible
  const state = await getState();
  let aiCollectionId: string | null = null;
  if (state.settings?.enableAi && url) {
    const aiResult = await getAiSummary({ 
      title: tab?.title || title, 
      url,
      collections: state.collections.map(c => ({ id: c.id, name: c.name }))
    });
    if (aiResult) {
      if (aiResult.collectionId) {
        // verify it exists just in case AI hallucinates
        const isValid = state.collections.some(c => c.id === aiResult.collectionId);
        if (isValid) aiCollectionId = aiResult.collectionId;
      }
      const lowerTags = aiResult.tags.map((t: string) => t.toLowerCase());
      autoTags.push(...lowerTags);
      if (aiResult.title) {
        title = aiResult.title;
      }
    }
  }

  const bookmark: Bookmark = {
    id: generateId(),
    url,
    title,
    favicon,
    tags: Array.from(new Set(autoTags)),
    collectionId: aiCollectionId || COLLECTION.UNSORTED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    coverUrl
  };

  await addBookmark(bookmark);
});

// ─── Message Handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'BM:getState': {
          sendResponse(await getState());
          break;
        }

        case 'BM:updateSettings': {
          await updateSettings(message.payload);
          sendResponse(await getState());
          break;
        }

        case 'BM:addBookmark': {
          const payload = message.payload as Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt' | 'coverUrl' | 'pinned'>;
          const safeUrl = sanitizeBookmarkUrl(payload.url);
          if (!safeUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          const coverUrl = await fetchLinkPreview(safeUrl);

          const bookmark: Bookmark = {
            ...payload,
            url: safeUrl,
            id: generateId(),
            tags: Array.from(new Set((payload.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            coverUrl,
            pinned: false,
          };
          await addBookmark(bookmark);
          sendResponse(await getState());
          break;
        }

        case 'BM:updateBookmark': {
          const payload = message.payload as Bookmark;
          const safeUrl = sanitizeBookmarkUrl(payload.url);
          if (!safeUrl) {
            sendResponse({ error: 'Invalid or unsupported bookmark URL' });
            break;
          }

          await updateBookmark({
            ...payload,
            url: safeUrl,
            tags: Array.from(new Set((payload.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
            updatedAt: Date.now()
          });
          sendResponse(await getState());
          break;
        }

        case 'BM:deleteBookmark': {
          await deleteBookmark(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkDelete': {
          const ids = message.ids as string[];
          const bms = await getBookmarks();
          const next = bms.filter(b => !ids.includes(b.id));
          await saveBookmarks(next); // Use saveBookmarks from storage
          sendResponse({ ...(await getState()), bookmarks: next });
          break;
        }

        case 'BM:moveToTrash': {
          await moveToTrash(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:bulkMoveToTrash': {
          const ids = message.ids as string[];
          const bms = await getBookmarks();
          const next = bms.map(b => ids.includes(b.id) ? { ...b, collectionId: COLLECTION.TRASH, updatedAt: Date.now() } : b);
          await saveBookmarks(next);
          sendResponse({ ...(await getState()), bookmarks: next });
          break;
        }

        case 'BM:restoreFromTrash': {
          await restoreFromTrash(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:togglePin': {
          sendResponse(await togglePinBookmark(message.id as string));
          break;
        }

        case 'BM:addCollection': {
          const payload = message.payload as Omit<Collection, 'id' | 'createdAt'>;
          const collection: Collection = {
            ...payload,
            id: generateId(),
            createdAt: Date.now(),
          };
          await addCollection(collection);
          sendResponse(await getState());
          break;
        }

        case 'BM:updateCollection': {
          const payload = message.payload as Collection;
          await updateCollection(payload);
          sendResponse(await getState());
          break;
        }

        case 'BM:deleteCollection': {
          await deleteCollection(message.id as string);
          sendResponse(await getState());
          break;
        }

        case 'BM:importBrowser': {
          const tree = await chrome.bookmarks.getTree();
          const bookmarks = await getBookmarks();
          const existingUrls = new Set(bookmarks.map((b) => b.url));

          const newBookmarks: Bookmark[] = [];

          function traverse(nodes: chrome.bookmarks.BookmarkTreeNode[]) {
            for (const node of nodes) {
              if (node.url && !existingUrls.has(node.url)) {
                newBookmarks.push({
                  id: generateId(),
                  url: node.url,
                  title: node.title || getDomain(node.url),
                  favicon: getFavicon(node.url),
                  tags: [],
                  collectionId: COLLECTION.UNSORTED,
                  createdAt: node.dateAdded ?? Date.now(),
                  updatedAt: Date.now(),
                  pinned: false,
                });
              }
              if (node.children) traverse(node.children);
            }
          }

          traverse(tree);
          const allBookmarks = [...newBookmarks, ...bookmarks];
          await saveBookmarks(allBookmarks);
          sendResponse({ ...(await getState()), imported: newBookmarks.length });
          break;
        }

        case 'BM:importData': {
          const { bookmarks, collections } = message.payload as { bookmarks: Bookmark[], collections: Collection[] };
          const existingBms = await getBookmarks();
          const existingCols = await getCollections();

          const sanitizedBookmarks = (Array.isArray(bookmarks) ? bookmarks : [])
            .map((bookmark) => {
              const safeUrl = sanitizeBookmarkUrl(bookmark?.url || '');
              if (!safeUrl || typeof bookmark?.id !== 'string') {
                return null;
              }

              return {
                ...bookmark,
                url: safeUrl,
                title: typeof bookmark.title === 'string' ? bookmark.title : getDomain(safeUrl),
                favicon: typeof bookmark.favicon === 'string' ? bookmark.favicon : getFavicon(safeUrl),
                tags: Array.from(new Set((Array.isArray(bookmark.tags) ? bookmark.tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
                note: typeof bookmark.note === 'string' ? bookmark.note : undefined,
                collectionId: typeof bookmark.collectionId === 'string' ? bookmark.collectionId : COLLECTION.UNSORTED,
                createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
                updatedAt: typeof bookmark.updatedAt === 'number' ? bookmark.updatedAt : Date.now(),
                pinned: Boolean(bookmark.pinned),
                coverUrl: typeof bookmark.coverUrl === 'string' && isSafeBookmarkUrl(bookmark.coverUrl) ? bookmark.coverUrl : undefined,
              };
            })
            .filter(Boolean);

          const sanitizedCollections = (Array.isArray(collections) ? collections : [])
            .filter((collection) => collection && typeof collection.id === 'string' && typeof collection.name === 'string')
            .map((collection) => ({
              ...collection,
              parentId: typeof collection.parentId === 'string' ? collection.parentId : undefined,
            }));

          const newBms = [...existingBms];
          for (const b of sanitizedBookmarks) {
            const idx = newBms.findIndex(x => x.id === b.id);
            if (idx >= 0) newBms[idx] = b; else newBms.push(b);
          }

          const newCols = [...existingCols];
          for (const c of sanitizedCollections) {
            const idx = newCols.findIndex(x => x.id === c.id);
            if (idx >= 0) newCols[idx] = c; else newCols.push(c);
          }

          await saveBookmarks(newBms);
          await saveCollections(newCols);
          sendResponse(await getState());
          break;
        }

        case 'BM:getCurrentTab': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({
            url: tab?.url ?? '',
            title: tab?.title ?? '',
            favicon: tab?.favIconUrl ?? (tab?.url ? getFavicon(tab.url) : ''),
          });
          break;
        }

        case 'BM:generateAISummary': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url) {
            const aiResult = await getAiSummary({ title: tab.title || '', url: tab.url });
            if (aiResult && aiResult.tags) {
              aiResult.tags = aiResult.tags.map((t: string) => t.toLowerCase());
            }
            sendResponse({ success: true, aiResult });
            break;
          }
          sendResponse({ success: false, error: 'Could not get tab URL' });
          break;
        }

        case 'BM:refreshPreviews': {
          const bookmarks = await getBookmarks();
          const toUpdate = bookmarks.filter(b => !b.coverUrl);
          
          let updated = false;
          const batchSize = 5;
          for (let i = 0; i < toUpdate.length; i += batchSize) {
            const batch = toUpdate.slice(i, i + batchSize);
            await Promise.all(batch.map(async (b) => {
              const coverUrl = await fetchLinkPreview(b.url);
              if (coverUrl) {
                b.coverUrl = coverUrl;
                updated = true;
              }
            }));
            if (updated) {
              await saveBookmarks(bookmarks);
            }
          }
          sendResponse(await getState());
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ error: String(err) });
    }
  })();

  return true; // keep channel open for async
});

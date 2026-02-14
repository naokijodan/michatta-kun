// みちゃった君 - Background Script
// ストレージ管理（IndexedDB）+ 商品情報取得

// ==============================
// IndexedDB設定
// ==============================
const DB_NAME = 'MichattaKunDB';
const DB_VERSION = 2;
const STORE_VIEWED = 'viewedItems';
const STORE_SETTINGS = 'settings';

// chrome.storage.localのキー（移行用・バックアップ用）
const STORAGE_KEY = 'mercari_viewed_items';
const ALERT_KEY = 'mercari_alert_settings';
const PREMIUM_KEY = 'mercari_premium_unlocked';
const MIGRATION_KEY = 'michatta_migration_v2';

// ==============================
// LRUキャッシュ
// ==============================
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    // アクセスしたら最新に移動
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 最古のエントリを削除
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getAll() {
    const items = {};
    this.cache.forEach((value, key) => {
      items[key] = value;
    });
    return items;
  }

  setMultiple(items) {
    for (const [key, value] of Object.entries(items)) {
      this.set(key, value);
    }
  }
}

// キャッシュインスタンス
const viewedItemsCache = new LRUCache(1000);

// ==============================
// IndexedDB操作
// ==============================
let db = null;

async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[みちゃった君 BG] IndexedDB初期化エラー:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[みちゃった君 BG] IndexedDB初期化完了');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_VIEWED)) {
        const viewedStore = database.createObjectStore(STORE_VIEWED, { keyPath: 'id' });
        viewedStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('[みちゃった君 BG] viewedItemsストア作成');
      }

      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        console.log('[みちゃった君 BG] settingsストア作成');
      }
    };
  });
}

// ==============================
// 閲覧済み商品の操作
// ==============================

async function getViewedItems() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_VIEWED, 'readonly');
    const store = tx.objectStore(STORE_VIEWED);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = {};
        request.result.forEach(item => {
          items[item.id] = item.timestamp;
        });
        // キャッシュを更新
        viewedItemsCache.setMultiple(items);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getViewedItemsエラー:', error);
    return {};
  }
}

async function getViewedItemsBatch(ids) {
  // まずキャッシュから取得
  const result = {};
  const missingIds = [];

  for (const id of ids) {
    if (viewedItemsCache.has(id)) {
      result[id] = viewedItemsCache.get(id);
    } else {
      missingIds.push(id);
    }
  }

  // キャッシュにないものはIndexedDBから取得
  if (missingIds.length > 0) {
    try {
      const database = await initDB();
      const tx = database.transaction(STORE_VIEWED, 'readonly');
      const store = tx.objectStore(STORE_VIEWED);

      for (const id of missingIds) {
        const item = await new Promise((resolve) => {
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (item) {
          result[id] = item.timestamp;
          viewedItemsCache.set(id, item.timestamp);
        }
      }
    } catch (error) {
      console.error('[みちゃった君 BG] getViewedItemsBatchエラー:', error);
    }
  }

  return result;
}

async function saveViewedItem(itemId) {
  const timestamp = Date.now();

  try {
    const database = await initDB();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    store.put({ id: itemId, timestamp });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュに追加
    viewedItemsCache.set(itemId, timestamp);

    // バックアップ（非同期、エラーは無視）
    backupToStorageLocal();

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveViewedItemエラー:', error);
    return false;
  }
}

async function saveViewedItemsBulk(items) {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    for (const [id, timestamp] of Object.entries(items)) {
      store.put({ id, timestamp });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュに追加
    viewedItemsCache.setMultiple(items);

    // バックアップ
    backupToStorageLocal();

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveViewedItemsBulkエラー:', error);
    return false;
  }
}

async function getViewedItemsCount() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_VIEWED, 'readonly');
    const store = tx.objectStore(STORE_VIEWED);

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getViewedItemsCountエラー:', error);
    return 0;
  }
}

async function clearAllViewedItems() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    store.clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュクリア
    viewedItemsCache.clear();

    // バックアップもクリア
    chrome.storage.local.set({ [STORAGE_KEY]: {} });

    console.log('[みちゃった君 BG] 全履歴を削除しました');
    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] clearAllViewedItemsエラー:', error);
    return false;
  }
}

// バックアップ（非同期）
async function backupToStorageLocal() {
  try {
    const items = await getViewedItems();
    chrome.storage.local.set({ [STORAGE_KEY]: items });
  } catch (error) {
    console.error('[みちゃった君 BG] バックアップエラー:', error);
  }
}

// ==============================
// 設定の操作
// ==============================

const DEFAULT_ALERT_SETTINGS = {
  ratings: 100,
  badRate: 5,
  listedDays: 180,
  updatedDays: 90,
  shipping47: false,
  shipping8: false
};

async function getAlertSettings() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve) => {
      const request = store.get('alertSettings');
      request.onsuccess = () => {
        const result = request.result;
        resolve({ ...DEFAULT_ALERT_SETTINGS, ...(result?.value || {}) });
      };
      request.onerror = () => resolve(DEFAULT_ALERT_SETTINGS);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getAlertSettingsエラー:', error);
    return DEFAULT_ALERT_SETTINGS;
  }
}

async function saveAlertSettings(settings) {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    store.put({ key: 'alertSettings', value: settings });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // バックアップ
    chrome.storage.local.set({ [ALERT_KEY]: settings });

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveAlertSettingsエラー:', error);
    return false;
  }
}

async function isPremiumUnlocked() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve) => {
      const request = store.get('premiumUnlocked');
      request.onsuccess = () => {
        resolve(request.result?.value === true);
      };
      request.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] isPremiumUnlockedエラー:', error);
    return false;
  }
}

async function unlockPremium() {
  try {
    const database = await initDB();
    const tx = database.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    store.put({ key: 'premiumUnlocked', value: true });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // バックアップ
    chrome.storage.local.set({ [PREMIUM_KEY]: true });

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] unlockPremiumエラー:', error);
    return false;
  }
}

// ==============================
// データ移行
// ==============================

async function migrateFromStorageLocal() {
  try {
    // 移行済みチェック
    const migrationStatus = await new Promise((resolve) => {
      chrome.storage.local.get([MIGRATION_KEY], (result) => {
        resolve(result[MIGRATION_KEY]);
      });
    });

    if (migrationStatus === 'completed') {
      console.log('[みちゃった君 BG] 移行済み');
      return;
    }

    console.log('[みちゃった君 BG] データ移行開始...');

    // 旧データを取得
    const legacyData = await new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY, ALERT_KEY, PREMIUM_KEY], (result) => {
        resolve(result);
      });
    });

    // 閲覧済み商品を移行
    const viewedItems = legacyData[STORAGE_KEY] || {};
    const itemCount = Object.keys(viewedItems).length;

    if (itemCount > 0) {
      console.log(`[みちゃった君 BG] ${itemCount}件の閲覧履歴を移行中...`);

      // 100件ずつ段階的に移行
      const entries = Object.entries(viewedItems);
      const batchSize = 100;

      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const batchItems = Object.fromEntries(batch);
        await saveViewedItemsBulk(batchItems);
        console.log(`[みちゃった君 BG] 移行進捗: ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
      }

      console.log('[みちゃった君 BG] 閲覧履歴の移行完了');
    }

    // アラート設定を移行
    if (legacyData[ALERT_KEY]) {
      await saveAlertSettings(legacyData[ALERT_KEY]);
      console.log('[みちゃった君 BG] アラート設定を移行完了');
    }

    // 会員情報を移行
    if (legacyData[PREMIUM_KEY]) {
      await unlockPremium();
      console.log('[みちゃった君 BG] 会員情報を移行完了');
    }

    // 移行完了フラグ
    chrome.storage.local.set({ [MIGRATION_KEY]: 'completed' });
    console.log('[みちゃった君 BG] 全移行完了');

  } catch (error) {
    console.error('[みちゃった君 BG] 移行エラー:', error);
  }
}

// ==============================
// メッセージハンドラ
// ==============================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ストレージ操作
  if (request.action === 'storage') {
    handleStorageMessage(request, sendResponse);
    return true; // 非同期レスポンス
  }

  // 商品詳細取得
  if (request.action === 'fetchItemDetails') {
    fetchItemDetailsInBackground(request.itemId, request.itemUrl)
      .then(details => sendResponse({ success: true, details }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // バックグラウンドで新しいタブを開く
  if (request.action === 'openInBackground') {
    chrome.tabs.create({ url: request.url, active: false });
  }
});

async function handleStorageMessage(request, sendResponse) {
  const { method, params } = request;

  try {
    let result;

    switch (method) {
      case 'getViewedItems':
        result = await getViewedItems();
        sendResponse({ success: true, items: result });
        break;

      case 'getViewedItemsBatch':
        result = await getViewedItemsBatch(params.ids);
        sendResponse({ success: true, items: result });
        break;

      case 'saveViewedItem':
        result = await saveViewedItem(params.itemId);
        sendResponse({ success: result });
        break;

      case 'saveViewedItemsBulk':
        result = await saveViewedItemsBulk(params.items);
        sendResponse({ success: result });
        break;

      case 'getViewedItemsCount':
        result = await getViewedItemsCount();
        sendResponse({ success: true, count: result });
        break;

      case 'clearAllViewedItems':
        result = await clearAllViewedItems();
        sendResponse({ success: result });
        break;

      case 'getAlertSettings':
        result = await getAlertSettings();
        sendResponse({ success: true, settings: result });
        break;

      case 'saveAlertSettings':
        result = await saveAlertSettings(params.settings);
        sendResponse({ success: result });
        break;

      case 'isPremiumUnlocked':
        result = await isPremiumUnlocked();
        sendResponse({ success: true, unlocked: result });
        break;

      case 'unlockPremium':
        result = await unlockPremium();
        sendResponse({ success: result });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown method' });
    }
  } catch (error) {
    console.error('[みちゃった君 BG] ストレージ操作エラー:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ==============================
// 商品詳細取得（既存機能）
// ==============================

async function fetchItemDetailsInBackground(itemId, itemUrl) {
  return new Promise((resolve, reject) => {
    const checkUrl = itemUrl + (itemUrl.includes('?') ? '&' : '?') + '_mcheck=1';

    chrome.tabs.create({
      url: checkUrl,
      active: false
    }, (tab) => {
      const tabId = tab.id;
      let timeoutId;
      let retryCount = 0;
      const maxRetries = 2;

      timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
        reject(new Error('タイムアウト'));
      }, 15000);

      const tryGetDetails = () => {
        console.log('[みちゃった君 BG] タブにメッセージ送信 (試行:', retryCount + 1, ')');
        chrome.tabs.sendMessage(tabId, { action: 'getItemDetails' }, (response) => {
          console.log('[みちゃった君 BG] レスポンス:', response);

          if (chrome.runtime.lastError) {
            console.log('[みちゃった君 BG] 通信エラー:', chrome.runtime.lastError.message);
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            reject(new Error('通信エラー'));
            return;
          }

          if (response && response.success) {
            if (response.details.ratings === 0 && retryCount < maxRetries) {
              console.log('[みちゃった君 BG] 評価0のためリトライ');
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            resolve(response.details);
          } else {
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            reject(new Error(response?.error || '取得失敗'));
          }
        });
      };

      const listener = (changedTabId, changeInfo) => {
        if (changedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(tryGetDetails, 4000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// ==============================
// 初期化
// ==============================

async function initialize() {
  try {
    await initDB();
    await migrateFromStorageLocal();
    console.log('[みちゃった君 BG] 初期化完了');
  } catch (error) {
    console.error('[みちゃった君 BG] 初期化エラー:', error);
  }
}

// Service Worker起動時に初期化
initialize();

// みちゃった君 - Storage API（background.jsへのメッセージラッパー）
// content script / popup.js から使用

// background.jsにメッセージを送信
function sendStorageMessage(method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'storage', method, params },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[みちゃった君] 通信エラー:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success !== undefined) {
          resolve(response);
        } else {
          reject(new Error('Invalid response'));
        }
      }
    );
  });
}

// ==============================
// 初期化（互換性のため、実際の初期化はbackground.jsで行う）
// ==============================

function initDB() {
  return Promise.resolve();
}

function migrateFromLegacyStorage() {
  return Promise.resolve();
}

// ==============================
// 閲覧済み商品の操作
// ==============================

async function getViewedItems() {
  try {
    const response = await sendStorageMessage('getViewedItems');
    return response.items || {};
  } catch (error) {
    console.error('[みちゃった君] getViewedItemsエラー:', error);
    return {};
  }
}

async function getViewedItemsBatch(ids) {
  try {
    const response = await sendStorageMessage('getViewedItemsBatch', { ids });
    return response.items || {};
  } catch (error) {
    console.error('[みちゃった君] getViewedItemsBatchエラー:', error);
    return {};
  }
}

async function saveViewedItem(itemId) {
  try {
    const response = await sendStorageMessage('saveViewedItem', { itemId });
    return response.success;
  } catch (error) {
    console.error('[みちゃった君] saveViewedItemエラー:', error);
    return false;
  }
}

async function saveViewedItemsBulk(items) {
  try {
    const response = await sendStorageMessage('saveViewedItemsBulk', { items });
    return response.success;
  } catch (error) {
    console.error('[みちゃった君] saveViewedItemsBulkエラー:', error);
    return false;
  }
}

async function getViewedItemsCount() {
  try {
    const response = await sendStorageMessage('getViewedItemsCount');
    return response.count || 0;
  } catch (error) {
    console.error('[みちゃった君] getViewedItemsCountエラー:', error);
    return 0;
  }
}

async function clearAllViewedItems() {
  try {
    const response = await sendStorageMessage('clearAllViewedItems');
    return response.success;
  } catch (error) {
    console.error('[みちゃった君] clearAllViewedItemsエラー:', error);
    return false;
  }
}

// ==============================
// 設定の操作
// ==============================

async function getAlertSettings() {
  const DEFAULT_ALERT_SETTINGS = {
    ratings: 100,
    badRate: 5,
    listedDays: 180,
    updatedDays: 90,
    shipping47: false,
    shipping8: false
  };

  try {
    const response = await sendStorageMessage('getAlertSettings');
    return response.settings || DEFAULT_ALERT_SETTINGS;
  } catch (error) {
    console.error('[みちゃった君] getAlertSettingsエラー:', error);
    return DEFAULT_ALERT_SETTINGS;
  }
}

async function saveAlertSettings(settings) {
  try {
    const response = await sendStorageMessage('saveAlertSettings', { settings });
    return response.success;
  } catch (error) {
    console.error('[みちゃった君] saveAlertSettingsエラー:', error);
    return false;
  }
}

async function isPremiumUnlocked() {
  try {
    const response = await sendStorageMessage('isPremiumUnlocked');
    return response.unlocked || false;
  } catch (error) {
    console.error('[みちゃった君] isPremiumUnlockedエラー:', error);
    return false;
  }
}

async function unlockPremium() {
  try {
    const response = await sendStorageMessage('unlockPremium');
    return response.success;
  } catch (error) {
    console.error('[みちゃった君] unlockPremiumエラー:', error);
    return false;
  }
}

// ==============================
// グローバルに公開（content.js, popup.jsから使用）
// ==============================

if (typeof window !== 'undefined') {
  window.MichattaStorage = {
    initDB,
    migrateFromLegacyStorage,
    getViewedItems,
    getViewedItemsBatch,
    saveViewedItem,
    saveViewedItemsBulk,
    getViewedItemsCount,
    clearAllViewedItems,
    getAlertSettings,
    saveAlertSettings,
    isPremiumUnlocked,
    unlockPremium
  };
}

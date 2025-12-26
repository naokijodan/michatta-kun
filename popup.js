const STORAGE_KEY = 'mercari_viewed_items';
const ALERT_SETTINGS_KEY = 'mercari_alert_settings';
const PREMIUM_KEY = 'mercari_premium_unlocked';
const PREMIUM_PASS = 'MGOOSE2025';
const MAX_ITEMS = 100000;

// デフォルトのアラート設定
const DEFAULT_ALERT_SETTINGS = {
  ratings: 100,
  badRate: 5,
  listedDays: 180,
  updatedDays: 90,
  shipping47: false,
  shipping8: false
};

// 商品IDをURLまたはIDから抽出
function extractItemId(input) {
  input = input.trim();

  // メルカリ通常: /item/m12345678901（IDのみ）
  const mercariMatch = input.match(/jp\.mercari\.com\/item\/([a-zA-Z0-9]+)/);
  if (mercariMatch) return mercariMatch[1];

  // メルカリショップ: /shops/product/xxxxx（shop_プレフィックス）
  const mercariShopMatch = input.match(/jp\.mercari\.com\/shops\/product\/([a-zA-Z0-9]+)/);
  if (mercariShopMatch) return 'shop_' + mercariShopMatch[1];

  // ラクマ: item.fril.jp/xxxxx（IDのみ）
  const rakumaMatch = input.match(/item\.fril\.jp\/([a-zA-Z0-9]+)/);
  if (rakumaMatch) return rakumaMatch[1];

  // 楽天市場: item.rakuten.co.jp/shop/product/（URLパス全体）
  const rakutenMatch = input.match(/item\.rakuten\.co\.jp\/([^?#]+)/);
  if (rakutenMatch) return 'rakuten_' + rakutenMatch[1].replace(/\/$/, '');

  // IDのみの場合（mで始まるメルカリ商品ID）
  if (/^m[a-zA-Z0-9]+$/.test(input)) {
    return input;
  }

  return null;
}

// 閲覧済み商品を取得
async function getViewedItems() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || {});
    });
  });
}

// 件数を更新
async function updateCount() {
  const viewedItems = await getViewedItems();
  document.getElementById('count').textContent = Object.keys(viewedItems).length;
}

// ステータス表示
function showStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + (isError ? 'error' : 'success');
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}

// 登録処理
async function registerItems() {
  const input = document.getElementById('itemIds').value;
  const lines = input.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    showStatus('IDまたはURLを入力してください', true);
    return;
  }

  const viewedItems = await getViewedItems();
  let addedCount = 0;
  let skippedCount = 0;
  let invalidCount = 0;

  for (const line of lines) {
    const itemId = extractItemId(line);
    if (itemId) {
      if (!viewedItems[itemId]) {
        viewedItems[itemId] = Date.now();
        addedCount++;
      } else {
        skippedCount++;
      }
    } else {
      invalidCount++;
    }
  }

  // 上限チェック
  const keys = Object.keys(viewedItems);
  while (keys.length > MAX_ITEMS) {
    const oldestKey = keys.reduce((oldest, key) =>
      viewedItems[key] < viewedItems[oldest] ? key : oldest
    );
    delete viewedItems[oldestKey];
    keys.splice(keys.indexOf(oldestKey), 1);
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: viewedItems });

  // 結果表示
  let message = `${addedCount}件を登録しました`;
  if (skippedCount > 0) message += `（${skippedCount}件は登録済み）`;
  if (invalidCount > 0) message += `（${invalidCount}件は無効なID）`;

  showStatus(message, invalidCount > 0 && addedCount === 0);
  document.getElementById('itemIds').value = '';
  updateCount();
}

// アラート設定を取得
async function getAlertSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([ALERT_SETTINGS_KEY], (result) => {
      resolve({ ...DEFAULT_ALERT_SETTINGS, ...result[ALERT_SETTINGS_KEY] });
    });
  });
}

// アラート設定を保存
async function saveAlertSettings() {
  const settings = {
    ratings: parseInt(document.getElementById('alertRatings').value) || 0,
    badRate: parseInt(document.getElementById('alertBadRate').value) || 0,
    listedDays: parseInt(document.getElementById('alertListedDays').value) || 0,
    updatedDays: parseInt(document.getElementById('alertUpdatedDays').value) || 0,
    shipping47: document.getElementById('alertShipping47').checked,
    shipping8: document.getElementById('alertShipping8').checked
  };

  await chrome.storage.local.set({ [ALERT_SETTINGS_KEY]: settings });
  showStatus('設定を保存しました');
}

// アラート設定をUIに反映
async function loadAlertSettings() {
  const settings = await getAlertSettings();
  document.getElementById('alertRatings').value = settings.ratings;
  document.getElementById('alertBadRate').value = settings.badRate;
  document.getElementById('alertListedDays').value = settings.listedDays;
  document.getElementById('alertUpdatedDays').value = settings.updatedDays;
  document.getElementById('alertShipping47').checked = settings.shipping47;
  document.getElementById('alertShipping8').checked = settings.shipping8;
}

// 会員機能が解除されているか確認
async function isPremiumUnlocked() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PREMIUM_KEY], (result) => {
      resolve(result[PREMIUM_KEY] === true);
    });
  });
}

// 会員パスで解除
async function unlockPremium() {
  const pass = document.getElementById('premiumPass').value.trim();
  if (pass === PREMIUM_PASS) {
    await chrome.storage.local.set({ [PREMIUM_KEY]: true });
    showStatus('会員機能を解除しました！');
    updatePremiumUI(true);
  } else {
    showStatus('パスワードが違います', true);
  }
}

// 会員機能のUI更新
function updatePremiumUI(isUnlocked) {
  const lockedEl = document.getElementById('premiumLocked');
  const unlockedEl = document.getElementById('premiumUnlocked');
  const alertSettings = document.getElementById('alertSettings');

  if (isUnlocked) {
    lockedEl.style.display = 'none';
    unlockedEl.style.display = 'block';
    alertSettings.classList.remove('locked');
  } else {
    lockedEl.style.display = 'block';
    unlockedEl.style.display = 'none';
    alertSettings.classList.add('locked');
  }
}

// イベント設定
document.getElementById('registerBtn').addEventListener('click', registerItems);
document.getElementById('saveAlertBtn').addEventListener('click', saveAlertSettings);
document.getElementById('unlockBtn').addEventListener('click', unlockPremium);

// 初期化
async function init() {
  updateCount();
  loadAlertSettings();
  const isUnlocked = await isPremiumUnlocked();
  updatePremiumUI(isUnlocked);
}
init();

const STORAGE_KEY = 'mercari_viewed_items';
const MAX_ITEMS = 100000;

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

// イベント設定
document.getElementById('registerBtn').addEventListener('click', registerItems);

// 初期化
updateCount();

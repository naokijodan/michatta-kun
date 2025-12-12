// フリマ閲覧済みチェッカー
(function() {
  'use strict';

  const STORAGE_KEY = 'mercari_viewed_items';
  const MAX_ITEMS = 100000; // 最大保存件数

  // 現在のサイトを判定
  function getCurrentSite() {
    const host = window.location.hostname;
    if (host.includes('mercari.com')) return 'mercari';
    if (host.includes('fril.jp')) return 'rakuma';
    if (host.includes('rakuten.co.jp')) return 'rakuten';
    return null;
  }

  // 商品IDをURLから抽出（各サイト対応）
  function extractItemId(url) {
    // メルカリ通常: /item/m12345678901（IDのみ）
    const mercariMatch = url.match(/jp\.mercari\.com\/item\/([a-zA-Z0-9]+)/);
    if (mercariMatch) return mercariMatch[1];

    // メルカリショップ: /shops/product/xxxxx（shop_プレフィックス）
    const mercariShopMatch = url.match(/jp\.mercari\.com\/shops\/product\/([a-zA-Z0-9]+)/);
    if (mercariShopMatch) return 'shop_' + mercariShopMatch[1];

    // ラクマ: item.fril.jp/xxxxx（IDのみ）
    const rakumaMatch = url.match(/item\.fril\.jp\/([a-zA-Z0-9]+)/);
    if (rakumaMatch) return rakumaMatch[1];

    // 楽天市場: item.rakuten.co.jp/shop/product/（URLパス全体）
    const rakutenMatch = url.match(/item\.rakuten\.co\.jp\/([^?#]+)/);
    if (rakutenMatch) return 'rakuten_' + rakutenMatch[1].replace(/\/$/, '');

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

  // 商品を閲覧済みとして保存
  async function saveViewedItem(itemId) {
    const viewedItems = await getViewedItems();

    // 古いアイテムを削除（上限超過時）
    const keys = Object.keys(viewedItems);
    if (keys.length >= MAX_ITEMS) {
      // 最も古いアイテムを削除
      const oldestKey = keys.reduce((oldest, key) =>
        viewedItems[key] < viewedItems[oldest] ? key : oldest
      );
      delete viewedItems[oldestKey];
    }

    viewedItems[itemId] = Date.now();

    chrome.storage.local.set({ [STORAGE_KEY]: viewedItems });
  }

  // 商品ページの場合、閲覧記録を保存
  async function checkAndSaveCurrentPage() {
    const itemId = extractItemId(window.location.href);
    if (itemId) {
      // 既に閲覧済みかチェックしてバッジを表示
      const viewedItems = await getViewedItems();
      if (viewedItems[itemId]) {
        showBadgeOnProductPage(viewedItems[itemId]);
      }
      // 閲覧記録を保存
      saveViewedItem(itemId);
    }
  }

  // 商品ページでタイトルの上にバッジを表示
  function showBadgeOnProductPage(viewedTimestamp) {
    // 既にバッジがあれば何もしない
    if (document.querySelector('.mercari-viewed-page-badge')) {
      return;
    }

    // 商品タイトルを探す
    const findTitleAndInsert = () => {
      const titleElement = document.querySelector('[data-testid="name"]') ||
                          document.querySelector('h1') ||
                          document.querySelector('[class*="itemName"]');

      if (titleElement && !document.querySelector('.mercari-viewed-page-badge')) {
        const badge = document.createElement('div');
        badge.className = 'mercari-viewed-page-badge';
        badge.textContent = '以前閲覧した商品です';

        const viewedDate = new Date(viewedTimestamp);
        badge.innerHTML = `以前閲覧した商品です<span class="mercari-viewed-date">（${viewedDate.toLocaleDateString('ja-JP')} ${viewedDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}）</span>`;

        titleElement.parentNode.insertBefore(badge, titleElement);
      }
    };

    // すぐに試行し、DOMが準備できていなければ遅延して再試行
    findTitleAndInsert();
    setTimeout(findTitleAndInsert, 500);
    setTimeout(findTitleAndInsert, 1500);
  }

  // 商品ページかどうかを判定
  function isProductPage() {
    const url = window.location.href;
    // メルカリ
    if (/jp\.mercari\.com\/item\//.test(url)) return true;
    if (/jp\.mercari\.com\/shops\/product\//.test(url)) return true;
    // ラクマ
    if (/item\.fril\.jp\/[a-zA-Z0-9]+/.test(url)) return true;
    // 楽天市場
    if (/item\.rakuten\.co\.jp\//.test(url)) return true;
    return false;
  }

  // 検索一覧の商品にマークを付ける（商品ページでは実行しない）
  async function markViewedItemsInList() {
    // 商品ページでは一覧用バッジを表示しない
    if (isProductPage()) {
      return;
    }

    const viewedItems = await getViewedItems();

    // 商品リンクを取得（各サイト対応）
    const productLinks = document.querySelectorAll(
      'a[href*="mercari.com/item/"], a[href*="mercari.com/shops/product/"], ' +
      'a[href*="item.fril.jp/"], a[href*="item.rakuten.co.jp/"]'
    );

    productLinks.forEach((link) => {
      const itemId = extractItemId(link.href);
      if (itemId && viewedItems[itemId]) {
        // 親要素（商品カード）を探す
        const card = link.closest('[data-testid="item-cell"]') ||
                     link.closest('li') ||
                     link.parentElement;

        if (card && !card.classList.contains('mercari-viewed-marked')) {
          card.classList.add('mercari-viewed-marked');

          // バッジを追加
          const badge = document.createElement('div');
          badge.className = 'mercari-viewed-badge';
          badge.textContent = '閲覧済み';

          // 閲覧日時を表示
          const viewedDate = new Date(viewedItems[itemId]);
          badge.title = `閲覧日時: ${viewedDate.toLocaleString('ja-JP')}`;

          // カードの相対位置設定
          if (getComputedStyle(card).position === 'static') {
            card.style.position = 'relative';
          }

          card.appendChild(badge);
        }
      }
    });
  }

  // MutationObserverで動的に追加される商品も監視
  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          shouldCheck = true;
        }
      });
      if (shouldCheck) {
        markViewedItemsInList();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 初期化
  function init() {
    // 商品ページなら閲覧記録を保存
    checkAndSaveCurrentPage();

    // 検索一覧の商品にマークを付ける
    markViewedItemsInList();

    // DOM変更を監視
    observeDOM();
  }

  // DOMContentLoadedで初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

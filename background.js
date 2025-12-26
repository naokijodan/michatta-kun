// みちゃった君 - Background Script
// 商品情報を取得するためのバックグラウンド処理

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchItemDetails') {
    fetchItemDetailsInBackground(request.itemId, request.itemUrl)
      .then(details => sendResponse({ success: true, details }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 非同期レスポンスを使用
  }

  // バックグラウンドで新しいタブを開く（検索ページに留まる）
  if (request.action === 'openInBackground') {
    chrome.tabs.create({ url: request.url, active: false });
  }
});

async function fetchItemDetailsInBackground(itemId, itemUrl) {
  return new Promise((resolve, reject) => {
    // チェック用のパラメータを追加（閲覧済み記録をスキップするため）
    const checkUrl = itemUrl + (itemUrl.includes('?') ? '&' : '?') + '_mcheck=1';

    // 非表示タブを作成
    chrome.tabs.create({
      url: checkUrl,
      active: false // バックグラウンドで開く
    }, (tab) => {
      const tabId = tab.id;
      let timeoutId;
      let retryCount = 0;
      const maxRetries = 2;

      // タイムアウト設定（15秒に延長）
      timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
        reject(new Error('タイムアウト'));
      }, 15000);

      // メッセージ送信してデータ取得を試みる
      const tryGetDetails = () => {
        console.log('[みちゃった君 BG] タブにメッセージ送信 (試行:', retryCount + 1, ')');
        chrome.tabs.sendMessage(tabId, { action: 'getItemDetails' }, (response) => {
          console.log('[みちゃった君 BG] レスポンス:', response);

          if (chrome.runtime.lastError) {
            console.log('[みちゃった君 BG] 通信エラー:', chrome.runtime.lastError.message);
            // リトライ
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
            // 評価件数が0でリトライ可能なら再試行
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
            // リトライ
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

      // タブの読み込み完了を監視
      const listener = (changedTabId, changeInfo) => {
        if (changedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // 少し待ってからDOMを取得（JSの実行を待つ）
          // メルカリはSPAなのでもう少し待つ（4秒に延長）
          setTimeout(tryGetDetails, 4000);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

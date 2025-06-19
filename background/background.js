chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename || 'PinterestMedia',
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, id: downloadId });
      }
    });
    return true;
  }

  if (request.action === 'openTabDownload') {
    console.log("Opening tab to download:", request.url); // <- Moved here
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      setTimeout(() => chrome.tabs.remove(tab.id), 3000);
    });
  }
});

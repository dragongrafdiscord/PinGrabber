// content.js
const dynamicSelectors = {
  pin: [
    '[data-test-id="pin"]', 
    '[data-test-id="pinRepPresentation"]', 
    'div[role="listitem"]',
    '.Pin.zoomable',
    '.pinWrapper'
  ],
  board: [
    '[data-test-id="board-name"]',
    '[data-test-id="boardRepPresentation"]',
    '.boardName',
    '.board-header'
  ]
};

const capturedVideoUrls = new Set();

// Hook into fetch() to extract .mp4 requests
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      if (args[0] && typeof args[0] === 'string' && args[0].includes("v.pinimg.com")) {
        capturedVideoUrls.add(args[0]);
        console.log("[Intercepted MP4]", args[0]);
      }
    } catch (e) {}
    return response;
  };
})();

// Hook into XMLHttpRequest for the same
(function() {
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (url && url.includes("v.pinimg.com")) {
      capturedVideoUrls.add(url);
      console.log("[XHR MP4]", url);
    }
    return originalOpen.apply(this, arguments);
  };
})();

class PinterestDownloader {
  constructor() {
    this.isAutoScrolling = false;
    this.scrollInterval = null;
    this.collectedPins = new Set();
    this.collectedUrls = new Set();
    this.observer = null;
    this.lazyLoadObserver = null;
    this.fetchObserver = null;
    this.cancelRequested = false;
    this.abortController = null;
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'setTheme') {
        document.body.setAttribute('data-theme', request.theme);
      }
    });

    this.initialize();
  }
mergeCapturedVideos() {
  // Inject test MP4 once before merge starts
  capturedVideoUrls.add("https://v.pinimg.com/videos/mc/720p/1a/2f/f9/1a2ff9d5ec3e6d7abdb2d5b9e4f0a4c3.mp4");

  console.log("📹 Captured video URLs before merge:", [...capturedVideoUrls]);

  for (const url of capturedVideoUrls) {
    if (!this.collectedUrls.has(url)) {
      this.collectedUrls.add(url);
      this.updateUrlList(url);
      console.log("[Merged MP4]", url);
    }
  }
}

downloadWithChrome(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.runtime.sendMessage({ action: "download", url, filename });
}

  initialize() {
    this.injectFloatingButton();
    this.setupDOMObservers();
    this.scanExistingContent();
  }

  injectFloatingButton() {
    if (document.getElementById('pinterest-downloader-float-btn')) return;

    const floatBtn = document.createElement('div');
    floatBtn.id = 'pinterest-downloader-float-btn';
    floatBtn.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <div class="control-panel">
        <button class="control-btn scroll-control">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 5v11.17l-4.88-4.88c-.39-.39-1.03-.39-1.42 0-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0l6.59-6.59c.39-.39.39-1.02 0-1.41-.39-.39-1.02-.39-1.41 0L13 16.17V5c0-.55-.45-1-1-1s-1 .45-1 1z"/>
          </svg>
          <span>⬇ Auto Scroll</span>
        </button>
        <progress class="pdl-progress" value="0" max="100"></progress>
        <button class="control-btn download-trigger">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span>💾 Prepare Download</span>
        </button>
      </div>
    `;

    document.body.appendChild(floatBtn);
    this.setupButtonListeners(floatBtn);
  }

  setupButtonListeners(container) {
    container.querySelector('.scroll-control').addEventListener('click', () => this.toggleAutoScroll());
    container.querySelector('.download-trigger').addEventListener('click', () => this.showDownloadModal());
  }

  setupDOMObservers() {
    this.videoObserver = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const pin = node.closest(dynamicSelectors.pin.join(','));
          if (pin) this.processPin(pin);
        });
      });
    });

    this.videoObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    this.observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => this.processNewNode(node));
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src', 'data-test-id']
    });

    this.lazyLoadObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            this.processPin(img.closest(dynamicSelectors.pin.join(',')));
          }
        }
      });
    }, { rootMargin: '500px 0px' });

    this.scanExistingContent();
  }

  scanExistingContent() {
    this.findElements(dynamicSelectors.pin).forEach(pin => this.processPin(pin));
  }

  processNewNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    this.findElements(dynamicSelectors.pin, node).forEach(pin => this.processPin(pin));

    const mediaElements = node.querySelectorAll('img, video');
    mediaElements.forEach(media => {
      const pin = media.closest(dynamicSelectors.pin.join(','));
      if (pin) this.processPin(pin);
    });
  }

  processPin(pin) {
    if (!pin || this.collectedPins.has(pin)) return;

    this.collectedPins.add(pin);
    this.lazyLoadObserver.observe(pin);

    const mediaElements = pin.querySelectorAll(`
      img[src*="pinimg.com"],
      img[data-src*="pinimg.com"],
      video source[src*="v.pinimg.com"],
      video[src*="v.pinimg.com"],
      div[data-test-id="gifContainer"] video,
      source[src^="https://v.pinimg.com/"]
    `);

    mediaElements.forEach(el => {
      const rawUrl = el.getAttribute('src') || el.src;
      if (!rawUrl || rawUrl.startsWith('blob:') || this.collectedUrls.has(rawUrl)) return;

      const isVideo = rawUrl.includes("v.pinimg.com");
      const url = isVideo ? rawUrl : this.getHighQualityUrl(rawUrl);

      if (this.isValidPinUrl(url)) {
        this.collectedUrls.add(url);
        this.updateUrlList(url);
        console.log(`[+] Collected ${isVideo ? "VIDEO" : "IMG"}: ${url}`);
      }
    });
  }

  getHighQualityUrl(url) {
    try {
      if (url.includes("v.pinimg.com")) return url;
      const urlObj = new URL(url);
      urlObj.pathname = urlObj.pathname.replace(/\/\d+x\//, "/originals/");
      return urlObj.toString();
    } catch {
      return url;
    }
  }
  isValidPinUrl(url) {
    return url && typeof url === 'string' && (
      url.includes('pinimg.com/originals/') || 
      url.includes('v.pinimg.com') || 
      url.startsWith('https://v.pinimg.com/')
    ) && !url.includes('thumbnails');
  }

  getFileExtension(url, contentType = '') {
    if (url.includes("v.pinimg.com")) return 'mp4';
    if (contentType.includes("video/mp4")) return 'mp4';
    if (contentType.includes("image/gif")) return 'gif';
    if (contentType.includes("image/png")) return 'png';
    if (contentType.includes("image/jpeg")) return 'jpg';

    const ext = (url.split('.').pop() || 'jpg').split(/[#?]/)[0];
    if (['jpg', 'png', 'gif', 'mp4', 'webm'].includes(ext)) return ext;

    return 'bin';
  }

  showDownloadModal() {
    this.removeExisting('.download-modal');
    this.collectedUrls.clear();
    const modal = document.createElement('div');
    modal.className = 'download-modal';
    modal.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">Download Options</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="fetch-section">
        <button class="control-btn fetch-trigger">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/>
          </svg>
          <span>🔍 Fetch High-Res URLs</span>
        </button>
        <div class="fetch-status">
          <span class="url-counter">0</span> URLs found
        </div>
      </div>
      <div class="urls-container">
        <ul class="fetched-urls-list"></ul>
      </div>
      <div class="download-actions">
        <button class="control-btn confirm-download" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          <span>🚀 Download All</span>
        </button>
      </div>
    `;
    const fetchTrigger = modal.querySelector('.fetch-trigger');
    const confirmBtn = modal.querySelector('.confirm-download');

    fetchTrigger.addEventListener('click', () => {
      this.startLiveFetch(modal);
      fetchTrigger.disabled = true;
    });

    confirmBtn.addEventListener('click', () => {
  this.mergeCapturedVideos();
  setTimeout(() => {
    this.startDownloadProcess();
    modal.remove();
  }, 1500); // ⏱ wait 1.5 seconds to ensure fetch hooks catch MP4s
});


    modal.querySelector('.modal-close').addEventListener('click', () => {
      this.fetchObserver?.disconnect();
      modal.remove();
    });

    document.body.appendChild(modal);
  }

  startLiveFetch(modal) {
    this.fetchObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.processNewNode(node);
          }
        });
      });
    });

    this.fetchObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src']
    });

    this.updateUrlCounter(modal);
  }

  updateUrlList(url) {
    const list = document.querySelector('.fetched-urls-list');
    if (!list) return;

    const li = document.createElement('li');
    li.innerHTML = `
      <span class="url">${url}</span>
      <span class="resolution-badge">${this.getResolutionFromUrl(url)}</span>
    `;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    this.updateUrlCounter();
  }

  getResolutionFromUrl(url) {
    try {
      const match = url.match(/\/(\d+x\d+|originals)\//);
      return match ? match[1] : 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  updateUrlCounter() {
    const counter = document.querySelector('.url-counter');
    if (counter) counter.textContent = this.collectedUrls.size;
    const confirmBtn = document.querySelector('.confirm-download');
    if (confirmBtn) confirmBtn.disabled = this.collectedUrls.size === 0;
  }
  async startDownloadProcess() {
    try {
      if (!window.JSZip) throw new Error("JSZip library not found");

      this.abortController = new AbortController();
      const zip = new JSZip();
      const folder = zip.folder(this.getBoardName());
      const urls = Array.from(this.collectedUrls);
      const progressBar = this.createProgressBar(urls.length);

      for (const [index, url] of urls.entries()) {
        if (this.cancelRequested) break;
if (url.includes("v.pinimg.com")) {
  // fallback to tab download for MP4s
  chrome.runtime.sendMessage({
    action: 'openTabDownload',
    url: url
  });
  continue; // Skip fetch() for these
}

        try {
          const response = await fetch(url, {
  signal: this.abortController.signal,
  headers: {
    'Referer': 'https://www.pinterest.com/',
    'User-Agent': navigator.userAgent
  }
});


          const contentType = response.headers.get("content-type") || '';

          if (!response.ok) {
            console.warn(`Failed to fetch: ${url}`);
            continue;
          }

          console.log(`[TYPE] ${url} → ${contentType}`);
          if (!contentType.includes('image') && !contentType.includes('video')) {
            console.warn(`[⚠] Unknown content-type (${contentType}) for URL: ${url}`);
          }

          const ext = this.getFileExtension(url, contentType);
          const text = await response.clone().text();
console.log(`[MP4-RESPONSE TEST] ${url}`, text.slice(0, 300));

          const blob = await response.blob();

            console.log(`[FETCH] ${url}`);

          if (blob.size < 1000) {
            console.warn(`[SKIP] Small blob for ${url} with content-type ${contentType} and size ${blob.size}`);
            console.warn(`Skipped small file (likely placeholder): ${url}`);
            continue;
          }

          const safeName = `media_${index + 1}_${Date.now().toString(36)}.${ext}`;
          folder.file(safeName, blob);

          progressBar.update(index + 1, urls.length);
        } catch (err) {
          console.warn(`Error fetching URL [${url}]:`, err);
        }
      }

      if (!this.cancelRequested) {
        const content = await zip.generateAsync({ type: 'blob' });
        this.downloadWithChrome(content, `${this.getBoardName()}.zip`);
        this.showDownloadComplete(urls.length);
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.cleanup();
    }
  }
  toggleAutoScroll() {
    this.isAutoScrolling = !this.isAutoScrolling;
    const controlBtn = document.querySelector('.scroll-control');

    if (this.isAutoScrolling) {
      controlBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;">
          <path d="M6 18h12v-2H6v2zM18 6v2H6V6h12z"/>
        </svg>
        <span>⏹ Stop Scroll</span>
      `;
      this.startAutoScroll();
    } else {
      controlBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;">
          <path d="M11 5v11.17l-4.88-4.88c-.39-.39-1.03-.39-1.42 0-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0l6.59-6.59c.39-.39.39-1.02 0-1.41-.39-.39-1.02-.39-1.41 0L13 16.17V5c0-.55-.45-1-1-1s-1 .45-1 1z"/>
        </svg>
        <span>⬇ Auto Scroll</span>
      `;
      this.stopAutoScroll();
      setTimeout(() => this.scanExistingContent(), 1000);
    }
  }

  startAutoScroll() {
    this.scrollInterval = setInterval(() => {
      window.scrollBy(0, 2000); // Larger jump
      this.updateScrollProgress();
    }, 2500); // Slightly slower for Pinterest to load content
  }

  stopAutoScroll() {
    clearInterval(this.scrollInterval);
    this.scrollInterval = null;
    this.isAutoScrolling = false;
  }

  updateScrollProgress() {
    try {
      const pins = this.findElements(dynamicSelectors.pin);
      const progress = Math.min((pins.length / 500) * 100, 100);
      const progressBar = document.querySelector('.pdl-progress');
      if (progressBar) progressBar.value = progress;
    } catch (error) {
      console.error('Progress update error:', error);
    }
  }

  findElements(selectors, node = document) {
    return selectors.flatMap(selector =>
      Array.from(node.querySelectorAll(selector))
    ).filter((v, i, a) => a.indexOf(v) === i);
  }
  findPinByUrl(url) {
    return Array.from(this.collectedPins).find(pin => {
      const media = pin.querySelector('img, video');
      return media && (media.src === url || media.dataset.src === url);
    });
  }

  getBoardName() {
    try {
      const boardElement = this.findElements(dynamicSelectors.board)[0];
      return boardElement.textContent
        .trim()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, '_')
        .substring(0, 50);
    } catch {
      return 'Pinterest_Board';
    }
  }

  createProgressBar(total) {
    const container = document.createElement('div');
    container.className = 'progress-bar-container';
    container.innerHTML = `
      <div class="pdl-progress-header">
        <h4>Downloading ${total} Items</h4>
        <button class="modal-close">&times;</button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
      <div class="pdl-progress-text">0%</div>
      <button class="control-btn cancel-btn">✖ Cancel Download</button>
    `;

    container.querySelector('.modal-close').addEventListener('click', () => container.remove());
    container.querySelector('.cancel-btn').addEventListener('click', () => {
      this.cancelRequested = true;
      this.abortController?.abort();
      container.remove();
    });

    document.body.appendChild(container);
    return {
      update: (current, total) => {
        const percent = Math.round((current / total) * 100);
        container.querySelector('.progress-fill').style.width = `${percent}%`;
        container.querySelector('.pdl-progress-text').textContent = `${percent}%`;
      }
    };
  }
  triggerDownload(content, filename) {
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  showDownloadComplete(count) {
    const modal = document.createElement('div');
    modal.className = 'download-prompt';
    modal.innerHTML = `
      <div class="modal-header">
        <h3>✅ Download Complete!</h3>
        <button class="modal-close">&times;</button>
      </div>
      <p>Successfully downloaded ${count} high-resolution items</p>
      <button class="control-btn close-btn">OK</button>
    `;

    modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>${message}</span>
      <button class="error-close">&times;</button>
    `;

    errorDiv.querySelector('.error-close').addEventListener('click', () => errorDiv.remove());
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
  }

  cleanup() {
    this.observer?.disconnect();
    this.lazyLoadObserver?.disconnect();
    this.fetchObserver?.disconnect();
    this.abortController?.abort();
    this.cancelRequested = false;
    this.removeExisting('.progress-bar-container');
  }

  removeExisting(selector) {
    document.querySelectorAll(selector).forEach(el => el.remove());
  }
}
// Initialize the extension
new PinterestDownloader();


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

  initialize() {
    this.injectFloatingButton();
    this.setupDOMObservers();
    this.scanExistingContent();
  }

  // ==================== UI COMPONENTS ====================
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

  // ==================== DOM OBSERVERS ====================
  setupDOMObservers() {
    // Main Mutation Observer
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

    // Lazy-load Observer
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

    // Initial content scan
    this.scanExistingContent();
  }

  scanExistingContent() {
    this.findElements(dynamicSelectors.pin).forEach(pin => this.processPin(pin));
  }

  processNewNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    // Process pin containers
    this.findElements(dynamicSelectors.pin, node).forEach(pin => this.processPin(pin));

    // Process individual media elements
    const mediaElements = node.querySelectorAll('img, video');
    mediaElements.forEach(media => {
      const pin = media.closest(dynamicSelectors.pin.join(','));
      if (pin) this.processPin(pin);
    });
  }

  updateDownloadProgress(progressBar, current, total) {
    if (progressBar && typeof progressBar.update === 'function') {
      progressBar.update(current, total);
    }
  }

  processPin(pin) {
    if (!pin || this.collectedPins.has(pin)) return;
    
    this.collectedPins.add(pin);
    this.lazyLoadObserver.observe(pin);
    this.processPinMedia(pin); 
  }

  processPinMedia(pin) {
    try {
      if (!pin) return;

      const media = pin.querySelector(`
        img[src*="pinimg.com"], 
        img[data-src*="pinimg.com"], 
        video source[src*="pinimg.com"]
      `);
      
      if (media) {
        const url = media.src || media.dataset.src || media.querySelector('source')?.src;
        if (url && !this.collectedUrls.has(url)) {
          this.collectedUrls.add(url);
          const highResUrl = this.getHighQualityUrl(url);
          this.updateUrlList(highResUrl);
        }
      }
    } catch (error) {
      console.error('Pin media processing error:', error);
    }
  }


  // ==================== MEDIA HANDLING ====================
  async getPinMedia(pin) {
    try {
      const media = pin.querySelector('img[src*="pinimg.com"], img[data-src*="pinimg.com"], video source[src*="pinimg.com"]');
      if (!media) return null;

      const rawUrl = media.src || media.dataset.src || media.querySelector('source')?.src;
      const highResUrl = this.getHighQualityUrl(rawUrl);

      if (!this.isValidPinUrl(highResUrl)) return null;

      const response = await fetch(highResUrl, {
        signal: this.abortController.signal,
        referrerPolicy: 'no-referrer'
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      return {
        blob: await response.blob(),
        ext: this.getFileExtension(highResUrl)
      };
    } catch (error) {
      console.error('Media download failed:', error);
      return null;
    }
  }

  getHighQualityUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const resolutionIndex = pathParts.findIndex(part => /\d+x/.test(part));
      
      if (resolutionIndex !== -1) {
        pathParts[resolutionIndex] = 'originals';
        urlObj.pathname = pathParts.join('/');
      }
      return urlObj.toString();
    } catch (error) {
      console.error('URL upgrade failed:', error);
      return url;
    }
  }

  isValidPinUrl(url) {
    return url && typeof url === 'string' && url.includes('pinimg.com/originals/');
  }

  getFileExtension(url) {
    return (url.split('.').pop() || 'jpg').split(/[#?]/)[0];
  }

  // ==================== DOWNLOAD MODAL ====================
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
      if (this.collectedUrls.size > 0) {
        this.startDownloadProcess();
        modal.remove();
      }
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

  // ==================== DOWNLOAD PROCESS ====================
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
        
        try {
          const pin = this.findPinByUrl(url);
          if (!pin) continue;

          const media = await this.getPinMedia(pin);
          if (media) {
            folder.file(`pin_${index + 1}.${media.ext}`, media.blob);
            this.updateDownloadProgress(progressBar, index + 1, urls.length);
          }
        } catch (error) {
          console.error(`Error processing pin ${index}:`, error);
        }
      }

      if (!this.cancelRequested) {
        const content = await zip.generateAsync({ type: 'blob' });
        this.triggerDownload(content, `${this.getBoardName()}.zip`);
        this.showDownloadComplete(urls.length);
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.cleanup();
    }
  }

  // ==================== AUTO-SCROLL MECHANISM ====================
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
  }
}

startAutoScroll() {
  this.scrollInterval = setInterval(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    this.updateScrollProgress();
  }, 3000);
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

  // ==================== UTILITIES ====================
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
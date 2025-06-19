// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const themeButton = document.getElementById('themeButton');
  let isDark = localStorage.getItem('theme') === 'dark';

  function sendThemeToContent(theme) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0 || !tabs[0].url.includes('pinterest.com')) return;

      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'setTheme',
        theme: theme
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Content script not ready, retrying...");
          setTimeout(() => sendThemeToContent(theme), 500);
        }
      });
    });
  }

  function updateTheme() {
    const theme = isDark ? 'dark' : 'light';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    sendThemeToContent(theme);
  }

  themeButton.addEventListener('click', () => {
    isDark = !isDark;
    updateTheme();
  });

  // Initialize
  updateTheme();
});

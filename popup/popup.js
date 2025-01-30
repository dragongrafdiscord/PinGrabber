document.addEventListener('DOMContentLoaded', () => {
    const themeButton = document.getElementById('themeButton');
    let isDark = localStorage.getItem('theme') === 'dark';
  
    async function sendThemeToContent() {
      try {
        const [tab] = await chrome.tabs.query({ 
          active: true, 
          currentWindow: true 
        });
        
        if (!tab.url.includes('pinterest.com')) {
          console.log('Not a Pinterest page');
          return;
        }
  
        await chrome.tabs.sendMessage(tab.id, {
          action: 'updateTheme',
          theme: isDark ? 'dark' : 'light'
        });
        
      } catch (error) {
        console.log('Content script not ready:', error);
        setTimeout(sendThemeToContent, 500); // Retry after 500ms
      }
    }
  
    function updateTheme() {
        const theme = isDark ? 'dark' : 'light';
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
      
        // Send theme to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'setTheme', theme });
        });
      }
      
    themeButton.addEventListener('click', () => {
      isDark = !isDark;
      updateTheme();
    });
  
    // Initial setup
    updateTheme();
  });

(() => {
  try {
    const savedTheme = localStorage.getItem('theme') || 'auto';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const finalTheme = savedTheme === 'auto' ? (prefersDark ? 'dark' : 'light') : savedTheme;

    if (finalTheme === 'dark') {
      document.documentElement.classList.add('dark-theme');
    }
  } catch (err) {
    console.error('[preload.js] Theme preload error:', err);
  }
})();

const { ipcRenderer } = require('electron');
const si = require('systeminformation');

let connectionTimer = null;
let totalSeconds = 0;
let isConnected = false;
let checkingIP = false;
let currentLang = localStorage.getItem('language') || 'en';

// Sidebar tab switching
const sidebarItems = document.querySelectorAll('.sidebar-item');
const pages = {
  0: document.getElementById('page-connection'),
  1: document.getElementById('page-statistics'),
  2: document.getElementById('page-settings')
};

sidebarItems.forEach((item, index) => {
  item.addEventListener('click', () => {
    sidebarItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    Object.values(pages).forEach(page => page.style.display = 'none');
    pages[index].style.display = 'block';
  });
});

// ------------------- Language Translations -------------------
const translations = {
  en: {
    titlebar: "Xray Desktop Client",
    home: "Connection",
    statistics: "Statistics",
    settings: "Settings",
    connect: "Connect",
    disconnect: "Disconnect",
    connecting: "Connecting...",
    status: "Status",
    location: "Location",
    ipAddress: "IP Address",
    autoSelect: "Auto Select",
    fetching: "Fetching...",
    notConnected: "Disconnected",
    enterUrl: "Enter subscription URL",
    importConfig: "Import",
    upload: "Upload",
    download: "Download",
    themeEmoji: "Theme",
    languageEmoji: "Language",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    checkEmoji: "Check for Updates",
    updatesNote: "Open latest release page",
    clearEmoji: "Clear Cache",
    cacheNote: "Remove saved settings and reload",
    buttonCheck: "Check",
    buttonClear: "Clear"
  },
  zh: {
    titlebar: "Xray 桌面客户端",
    home: "连接",
    statistics: "流量统计",
    settings: "设置",
    connect: "连接",
    disconnect: "断开连接",
    connecting: "正在连接...",
    status: "状态",
    location: "位置",
    ipAddress: "IP 地址",
    autoSelect: "自动选择",
    fetching: "获取中...",
    notConnected: "未连接",
    enterUrl: "请输入订阅链接",
    importConfig: "导入",
    upload: "上传",
    download: "下载",
    themeEmoji: "主题",
    languageEmoji: "语言",
    themeAuto: "自动",
    themeLight: "浅色",
    themeDark: "深色",
    checkEmoji: "检查更新",
    updatesNote: "打开最新版本页面",
    clearEmoji: "清除缓存",
    cacheNote: "移除设置并重新加载",
    buttonCheck: "检查",
    buttonClear: "清除"
  }
};

// ------------------- Apply Translations -------------------
function applyTranslations() {
  const t = translations[currentLang];

  document.querySelector(".titlebar-title").innerText = t.titlebar;

  const sidebarItems = document.querySelectorAll(".sidebar-item");
  sidebarItems[0].querySelector(".sidebar-text").innerText = t.home;
  sidebarItems[1].querySelector(".sidebar-text").innerText = t.statistics;
  sidebarItems[2].querySelector(".sidebar-text").innerText = t.settings;

  document.querySelector(".connection-text").innerText = isConnected ? t.disconnect : t.connect;
  document.querySelector(".status-value").innerText = isConnected ? t.connect : t.notConnected;
  document.querySelector(".location-value").innerText = t.autoSelect;
  document.querySelector(".info-card:nth-child(1) .info-label").innerText = t.status;
  document.querySelector(".info-card:nth-child(2) .info-label").innerText = t.location;
  document.querySelector(".info-card:nth-child(3) .info-label").innerText = t.ipAddress;
  document.querySelector("#url-input").placeholder = t.enterUrl;
  document.querySelector("#submit-btn").innerText = t.importConfig;

  document.querySelector("#page-statistics h2").innerText = t.statistics;
  document.querySelector("#upload-data").previousElementSibling.innerText = t.upload;
  document.querySelector("#download-data").previousElementSibling.innerText = t.download;

  document.querySelector('label[for="theme-select"] span').innerText = t.themeEmoji;
  document.querySelector('label[for="language-select"] span').innerText = t.languageEmoji;

  const themeSelect = document.getElementById("theme-select");
  themeSelect.options[0].text = t.themeAuto;
  themeSelect.options[1].text = t.themeLight;
  themeSelect.options[2].text = t.themeDark;

  // Updates & Cache
  document.querySelector("#check-update-btn").previousElementSibling.children[0].innerText = t.checkEmoji;
  document.querySelector("#check-update-btn").previousElementSibling.children[1].innerText = t.updatesNote;
  document.querySelector("#check-update-btn").innerText = t.buttonCheck;

  document.querySelector("#clear-cache-btn").previousElementSibling.children[0].innerText = t.clearEmoji;
  document.querySelector("#clear-cache-btn").previousElementSibling.children[1].innerText = t.cacheNote;
  document.querySelector("#clear-cache-btn").innerText = t.buttonClear;
}

// ------------------- Load Initialization -------------------
document.addEventListener('DOMContentLoaded', () => {
  const languageSelect = document.getElementById('language-select');

  if (languageSelect) {
    languageSelect.value = currentLang;
    applyTranslations(); // Apply on page load

    languageSelect.addEventListener('change', () => {
      currentLang = languageSelect.value;
      localStorage.setItem('language', currentLang);
      applyTranslations();
      showNotification('Info', `Language set to: ${currentLang}`, 'info');
    });
  }
});

// Apply theme from select
const themeSelect = document.getElementById('theme-select');

const applyTheme = (theme) => {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }

  if (theme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  } else {
    document.documentElement.classList.remove('dark-theme');
  }
};

if (themeSelect) {
  const savedTheme = localStorage.getItem('theme') || 'auto';
  themeSelect.value = savedTheme;
  applyTheme(savedTheme);

  themeSelect.addEventListener('change', () => {
    const selectedTheme = themeSelect.value;
    localStorage.setItem('theme', selectedTheme);
    applyTheme(selectedTheme);
  });
}

// Fetch location
const fetchLocation = async (ip) => {
  try {
    const response = await fetch(`https://ipinfo.io/${ip}/json`);
    const data = await response.json();
    return `${data.city}, ${data.region}, ${data.country}` || 'Unknown Location';
  } catch {
    return 'Unknown Location';
  }
};

// Display IP + Location
const updateIPDisplay = async (ip) => {
  const ipEl = document.querySelector('.ip-value');
  const locEl = document.querySelector('.location-value');

  if (ipEl && locEl) {
    if (ip && ip !== '--.--.--.--') {
      ipEl.textContent = ip;
      locEl.textContent = await fetchLocation(ip);
      checkingIP = false;
    } else {
      ipEl.textContent = 'Checking...';
      locEl.textContent = 'Fetching...';
      checkingIP = true;
    }
  }
};

ipcRenderer.on('update-ip', async (_, ip) => {
  await updateIPDisplay(ip);
});

// Load initialization
document.addEventListener('DOMContentLoaded', () => {
  const languageSelect = document.getElementById('language-select');

  if (languageSelect) {
    const savedLang = localStorage.getItem('language') || 'en';
    languageSelect.value = savedLang;

    let lastLang = currentLang;

    languageSelect.addEventListener('change', () => {
      const selected = languageSelect.value;
      if (selected !== lastLang) {
        currentLang = selected;
        lastLang = selected;
        localStorage.setItem('language', currentLang);
        applyTranslations();
        showNotification('Info', `Language set to: ${currentLang}`, 'info');
      }
    });
  }

  // Check for updates
  document.getElementById('check-update-btn')?.addEventListener('click', () => {
    ipcRenderer.send('check-for-updates');
  });

  // Clear Cache
  document.getElementById('clear-cache-btn')?.addEventListener('click', () => {
    localStorage.clear();
    showNotification('Cache', 'Cleared successfully!', 'success');
    setTimeout(() => location.reload(), 1000);
  });

  // IP display
  updateIPDisplay('--.--.--.--');
  ipcRenderer.send('request-ip');

  const ipCheck = setInterval(() => {
    if (checkingIP && isConnected) {
      ipcRenderer.send('request-ip');
    }
  }, 5000);

  window.addEventListener('beforeunload', () => clearInterval(ipCheck));
});

// Format and update timer
const formatTime = (secs) => {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const updateTimer = () => {
  const timerEl = document.querySelector('.connection-timer');
  if (timerEl) timerEl.textContent = formatTime(totalSeconds);
};

const startTimer = () => {
  clearInterval(connectionTimer);
  totalSeconds = 0;
  updateTimer();
  connectionTimer = setInterval(() => {
    totalSeconds++;
    updateTimer();
  }, 1000);
};

const stopTimer = () => {
  clearInterval(connectionTimer);
  totalSeconds = 0;
  updateTimer();
};

// Update connection UI
const updateStatus = (status) => {
  const statusEl = document.querySelector('.status-value');
  const circle = document.querySelector('.status-circle');
  const btn = document.getElementById('connection-toggle');
  const icon = btn.querySelector('.connection-icon');
  const text = btn.querySelector('.connection-text');
  const locEl = document.querySelector('.location-value');

  statusEl.textContent = status;

  switch (status.toLowerCase()) {
    case 'connected':
      isConnected = true;
      circle.classList.add('connected');
      icon.textContent = '✓';
      text.textContent = 'Disconnect';
      startTimer();
      ipcRenderer.send('request-ip');
      break;
    case 'disconnected':
    case 'error':
    case 'not running':
      isConnected = false;
      circle.classList.remove('connected');
      icon.textContent = '⚡';
      text.textContent = 'Connect';
      stopTimer();
      updateIPDisplay('--.--.--.--');
      if (locEl) locEl.textContent = 'Auto Select';
      break;
    case 'connecting...':
      checkingIP = true;
      updateIPDisplay('--.--.--.--');
      if (locEl) locEl.textContent = 'Fetching...';
      break;
  }

  btn.disabled = status.includes('ing...');
};

// Connection toggle
document.getElementById('connection-toggle')?.addEventListener('click', () => {
  if (!isConnected) {
    updateStatus('Connecting...');
    ipcRenderer.send('start-xray');
  } else {
    updateStatus('Disconnecting...');
    ipcRenderer.send('stop-xray');
  }
});

// Import config
document.getElementById('submit-btn')?.addEventListener('click', () => {
  const url = document.getElementById('url-input').value.trim();

  if (!url) {
    showNotification('Error', 'Please enter a valid URL!', 'error');
    return;
  }

  try {
    const parsedUrl = new URL(url);
    const valid = ['http:', 'https:', 'vmess:', 'vless:', 'trojan:', 'ss:'].includes(parsedUrl.protocol);
    if (!valid) throw new Error();
  } catch {
    showNotification('Error', 'Invalid subscription link format!', 'error');
    return;
  }

  ipcRenderer.send('run-config_gen', url);
  showNotification('Config', 'Generating configuration...', 'info');
});

// IPC Event Listeners
ipcRenderer.on('xray-status', (_, status) => updateStatus(status));
ipcRenderer.on('connection-established', () => {
  updateStatus('Connected');
  showNotification('Success', 'VPN Connected Successfully', 'success');
});
ipcRenderer.on('connection-terminated', () => {
  updateStatus('Disconnected');
  showNotification('Success', 'VPN Disconnected Successfully', 'success');
});
ipcRenderer.on('python-output', (_, output) => {
  const isErr = output.toLowerCase().includes('error');
  showNotification(isErr ? 'Error' : 'Success', output, isErr ? 'error' : 'success');
});

// Notifications
const showNotification = (title, message, type = 'info') => {
  alert(`[${type.toUpperCase()}] ${title}: ${message}`);
};

// Traffic Stats
setInterval(() => {
  if (isConnected) {
    ipcRenderer.send('get-traffic-stats');
  }
}, 3000);

ipcRenderer.on('traffic-stats', (_, data) => {
  document.getElementById('upload-data').textContent = `${(data.tx / 1024).toFixed(2)} KB`;
  document.getElementById('download-data').textContent = `${(data.rx / 1024).toFixed(2)} KB`;
});

// Clean up
window.addEventListener('beforeunload', () => {
  if (isConnected) ipcRenderer.send('stop-xray');
  clearInterval(connectionTimer);
});
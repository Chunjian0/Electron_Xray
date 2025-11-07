const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

let mainWindow;
let xrayProcess = null;
let isConnected = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,     
      contextIsolation: true,     
      sandbox: true,               
      enableRemoteModule: false,
      worldSafeExecuteJavaScript: true
    }
  });
  
  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopXrayAndProxy();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function fetchIPFromConfig() {
  return new Promise((resolve) => {
    const configPath = path.join(__dirname, 'config.json');

    if (!fs.existsSync(configPath)) {
      resolve('--.--.--.--');
      return;
    }

    fs.readFile(configPath, 'utf-8', (err, data) => {
      if (err) {
        resolve('--.--.--.--');
        return;
      }

      try {
        const config = JSON.parse(data);
        let outboundIP = '--.--.--.--';

        if (config.outbounds && config.outbounds[0]) {
          const firstOutbound = config.outbounds[0];
          switch (firstOutbound.protocol) {
            case 'vmess':
            case 'vless':
              outboundIP = firstOutbound.settings?.vnext?.[0]?.address || '--.--.--.--';
              break;
            case 'trojan':
            case 'shadowsocks':
              outboundIP = firstOutbound.settings?.servers?.[0]?.address || '--.--.--.--';
              break;
          }
        }
        resolve(outboundIP);
      } catch {
        resolve('--.--.--.--');
      }
    });
  });
}

function fetchLocation(ip) {
  return new Promise((resolve) => {
    if (ip === '--.--.--.--') {
      resolve('Unknown Location');
      return;
    }

    const apiUrl = `https://ipinfo.io/${ip}/json`;

    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          const location = parsedData.city && parsedData.region && parsedData.country
            ? `${parsedData.city}, ${parsedData.region}, ${parsedData.country}`
            : 'Unknown Location';
          resolve(location);
        } catch {
          resolve('Unknown Location');
        }
      });
    }).on('error', () => {
      resolve('Unknown Location');
    });
  });
}

ipcMain.on('request-ip', async (event) => {
  const outboundIP = await fetchIPFromConfig();
  const location = await fetchLocation(outboundIP);
  event.reply('update-ip', outboundIP);
  event.reply('update-location', location);
});

ipcMain.on('check-for-updates', () => {
  const latestReleaseURL = 'https://github.com/XTLS/Xray-core'
  shell.openExternal(latestReleaseURL);
});

function startXrayWithConfig(configPath, xrayPath) {
  return new Promise((resolve, reject) => {
    console.log('[DEBUG] Starting Xray with config:', configPath);
    console.log('[DEBUG] Xray executable path:', xrayPath);

    if (xrayProcess) {
      reject(new Error('Xray is already running'));
      return;
    }

    // Check if files exist
    if (!fs.existsSync(configPath)) {
      const error = `Config file not found: ${configPath}`;
      console.log('[ERROR]', error);
      mainWindow.webContents.send('debug-log', `[ERROR] ${error}`);
      reject(new Error(error));
      return;
    }

    if (!fs.existsSync(xrayPath)) {
      const error = `Xray executable not found: ${xrayPath}`;
      console.log('[ERROR]', error);
      mainWindow.webContents.send('debug-log', `[ERROR] ${error}`);
      reject(new Error(error));
      return;
    }

    // Validate config.json
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      console.log('[DEBUG] Config validation passed');
      mainWindow.webContents.send('debug-log', '[DEBUG] Config validation passed');
      
      // Log config structure for debugging
      console.log('[DEBUG] Config structure:', JSON.stringify(config, null, 2));
    } catch (err) {
      const error = `Invalid config.json: ${err.message}`;
      console.log('[ERROR]', error);
      mainWindow.webContents.send('debug-log', `[ERROR] ${error}`);
      reject(new Error(error));
      return;
    }

    // Try starting Xray with config file as argument instead of stdin
    console.log('[DEBUG] Spawning Xray process...');
    mainWindow.webContents.send('debug-log', '[DEBUG] Starting Xray process...');
    
    xrayProcess = spawn(xrayPath, ['-config', configPath], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true 
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    xrayProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      console.log('[XRAY STDOUT]', data.toString());
      mainWindow.webContents.send('debug-log', `[XRAY STDOUT] ${data.toString()}`);
    });

    xrayProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      console.log('[XRAY STDERR]', data.toString());
      mainWindow.webContents.send('debug-log', `[XRAY STDERR] ${data.toString()}`);
    });

    xrayProcess.on('spawn', () => {
      console.log('[DEBUG] Xray process spawned successfully');
      mainWindow.webContents.send('debug-log', '[DEBUG] Xray process spawned successfully');
      
      // Wait a bit to see if it starts properly
      setTimeout(() => {
        if (xrayProcess && !xrayProcess.killed) {
          isConnected = true;
          mainWindow.webContents.send('xray-status', 'Connected');
          console.log('[SUCCESS] Xray started successfully');
          mainWindow.webContents.send('debug-log', '[SUCCESS] Xray started successfully');
          resolve();
        }
      }, 2000);
    });

    xrayProcess.on('error', (err) => {
      console.log('[ERROR] Xray process error:', err.message);
      mainWindow.webContents.send('debug-log', `[ERROR] Xray process error: ${err.message}`);
      isConnected = false;
      xrayProcess = null;
      mainWindow.webContents.send('xray-status', 'Error Starting');
      reject(err);
    });

    xrayProcess.on('exit', (code, signal) => {
      console.log(`[DEBUG] Xray process exited with code ${code}, signal ${signal}`);
      mainWindow.webContents.send('debug-log', `[DEBUG] Xray exited with code ${code}, signal ${signal}`);
      
      if (code !== 0) {
        console.log('[ERROR] Xray stderr output:', stderrBuffer);
        console.log('[ERROR] Xray stdout output:', stdoutBuffer);
        mainWindow.webContents.send('debug-log', `[ERROR] Xray stderr: ${stderrBuffer}`);
        mainWindow.webContents.send('debug-log', `[ERROR] Xray stdout: ${stdoutBuffer}`);
      }
      
      isConnected = false;
      xrayProcess = null;
      mainWindow.webContents.send('xray-status', 'Disconnected');
    });

    xrayProcess.on('close', (code) => {
      console.log(`[DEBUG] Xray process closed with code ${code}`);
      mainWindow.webContents.send('debug-log', `[DEBUG] Xray process closed with code ${code}`);
      isConnected = false;
      xrayProcess = null;
      mainWindow.webContents.send('xray-status', 'Disconnected');
    });
  });
}

async function stopXrayAndProxy() {
  return new Promise((resolve) => {
    if (xrayProcess) {
      console.log('[DEBUG] Stopping Xray process...');
      xrayProcess.kill('SIGTERM');
      setTimeout(() => {
        if (xrayProcess && !xrayProcess.killed) {
          console.log('[DEBUG] Force killing Xray process...');
          xrayProcess.kill('SIGKILL');
        }
        xrayProcess = null;
        isConnected = false;
        if (mainWindow) {
          mainWindow.webContents.send('xray-status', 'Disconnected');
        }
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  });
}

function runPowerShellCommand(commands) {
  return new Promise((resolve, reject) => {
    console.log('[DEBUG] Running PowerShell commands:', commands);
    const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '-']);
    let output = '', error = '';

    commands.forEach((cmd) => ps.stdin.write(`${cmd}\n`));
    ps.stdin.end();

    ps.stdout.on('data', (data) => {
      output += data.toString();
      console.log('[POWERSHELL OUTPUT]', data.toString());
      mainWindow.webContents.send('powershell-output', data.toString());
    });

    ps.stderr.on('data', (data) => {
      error += data.toString();
      console.log('[POWERSHELL ERROR]', data.toString());
      mainWindow.webContents.send('powershell-error', data.toString());
    });

    ps.on('close', (code) => {
      console.log(`[DEBUG] PowerShell exited with code ${code}`);
      code === 0 ? resolve(output) : reject(new Error(`PowerShell exited with code ${code}: ${error}`));
    });
  });
}

ipcMain.on('start-xray', async () => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const xrayPath = path.join(__dirname, 'xray', 'xray.exe');

    console.log('[DEBUG] Attempting to start Xray...');
    mainWindow.webContents.send('debug-log', '[DEBUG] Starting Xray connection...');

    await startXrayWithConfig(configPath, xrayPath);
    
    console.log('[DEBUG] Setting up proxy...');
    mainWindow.webContents.send('debug-log', '[DEBUG] Setting up system proxy...');
    
    await runPowerShellCommand([
      `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyServer -Value "127.0.0.1:20809"`,
      `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 1`
    ]);

    mainWindow.webContents.send('connection-established');
    console.log('[SUCCESS] Connection established successfully');
  } catch (error) {
    console.log('[ERROR] Connection failed:', error.message);
    mainWindow.webContents.send('xray-status', 'Connection Failed');
    mainWindow.webContents.send('debug-log', `[ERROR] Connection failed: ${error.message}`);
    mainWindow.webContents.send('notify', {
      title: 'Connection Error',
      message: error.message,
      type: 'error'
    });
  }
});

ipcMain.on('stop-xray', async () => {
  try {
    console.log('[DEBUG] Stopping connection...');
    
    await runPowerShellCommand([
      `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 0`,
      `Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyServer -ErrorAction SilentlyContinue`
    ]);

    await stopXrayAndProxy();
    mainWindow.webContents.send('connection-terminated');
    console.log('[SUCCESS] Connection terminated successfully');
  } catch (error) {
    console.log('[ERROR] Disconnection failed:', error.message);
    mainWindow.webContents.send('notify', {
      title: 'Disconnection Error',
      message: error.message,
      type: 'error'
    });
  }
});

ipcMain.on('run-config_gen', (event, urlInput) => {
  if (!urlInput) {
    event.reply('python-output', 'Error: Invalid URL input');
    return;
  }

  console.log('[DEBUG] Running config_gen with input:', urlInput);
  mainWindow.webContents.send('debug-log', `[DEBUG] Generating config for: ${urlInput}`);

  // Full absolute Python executable path - adjust if needed
  const pythonExe = `"C:\\Users\\Low\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"`;
  // Config_gen.py path with quotes to handle spaces
  const scriptPath = `"C:/Users/Low/Desktop/assignment stock/xray_electron-main/config_gen.py"`;

  exec(`${pythonExe} ${scriptPath} "${urlInput}"`, async (err, stdout, stderr) => {
    if (err) {
      console.log('[ERROR] Python exec error:', err.message);
      event.reply('python-output', `Exec error: ${err.message}`);
      mainWindow.webContents.send('debug-log', `[ERROR] Python exec error: ${err.message}`);
      return;
    }
    if (stderr) {
      console.log('[ERROR] Python stderr:', stderr);
      event.reply('python-output', `Script error: ${stderr}`);
      mainWindow.webContents.send('debug-log', `[ERROR] Python stderr: ${stderr}`);
      return;
    }

    console.log('[SUCCESS] Python output:', stdout);
    event.reply('python-output', stdout);
    mainWindow.webContents.send('debug-log', `[SUCCESS] Config generated: ${stdout}`);

    // Auto-start Xray after script runs
    try {
      const configPath = path.join(__dirname, 'config.json');
      const xrayPath = path.join(__dirname, 'xray.exe');

      console.log('[DEBUG] Auto-starting Xray after config generation...');
      mainWindow.webContents.send('debug-log', '[DEBUG] Auto-starting Xray after config generation...');

      await startXrayWithConfig(configPath, xrayPath);
      await runPowerShellCommand([
        `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyServer -Value "127.0.0.1:20809"`,
        `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 1`
      ]);

      mainWindow.webContents.send('xray-status', 'Connected');
      mainWindow.webContents.send('connection-established');
      console.log('[SUCCESS] Auto-connection established');
    } catch (error) {
      console.log('[ERROR] Auto-connection failed:', error.message);
      mainWindow.webContents.send('xray-status', 'Connection Failed');
      mainWindow.webContents.send('debug-log', `[ERROR] Auto-connection failed: ${error.message}`);
    }
  });
});

// Add debug log handler
ipcMain.on('get-debug-logs', (event) => {
  // This could be expanded to return stored logs
  event.reply('debug-logs', 'Debug logging enabled');
});

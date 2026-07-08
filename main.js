const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const { execSync } = require('child_process');



function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  let winWidth, winHeight;
  let shouldMaximize = false;

  if (width > height) {
    // Landscape display (e.g. laptop): simulate 9:16 kiosk screen
    winHeight = Math.min(height - 100, 960);
    winWidth = Math.round(winHeight * (9 / 16));
  } else {
    // Portrait display (e.g. kiosk screen): take full screen
    winWidth = width;
    winHeight = height;
    shouldMaximize = true;
  }

  const mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Start with menu bar hidden
    autoHideMenuBar: true,
    title: "Neon Ninja Kiosk"
  });

  // Load the hosted production Vercel application directly
  mainWindow.loadURL('https://fruit-ninja-kiosk.vercel.app');

  if (shouldMaximize) {
    mainWindow.maximize();
  } else {
    mainWindow.center();
  }
}

// When a new window is created (like clicking 'Open Game Screen')
app.on('browser-window-created', (event, window) => {
  // Maximize all new windows automatically
  window.maximize();
  // Hide menu bar for all windows
  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit the application and terminate the server when all windows are closed
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up background processes on application close
app.on('will-quit', () => {
  if (global.tunnelProcess) {
    console.log('Terminating cloudflared process...');
    try {
      global.tunnelProcess.kill('SIGINT');
    } catch (e) {
      console.error('Failed to kill tunnel process:', e);
    }
  }
});

// Ignore certificate errors for self-signed localhost HTTPS server
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost:') || url.startsWith('https://127.0.0.1:')) {
    event.preventDefault();
    callback(true); // Trust the self-signed certificate
  } else {
    callback(false);
  }
});

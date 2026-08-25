const { app, BrowserWindow } = require('electron');
const { startAdmin } = require('../admin.js');

let win;
app.whenReady().then(() => {
  startAdmin(4171);
  win = new BrowserWindow({
    width: 1160,
    height: 840,
    title: '流浪猫管理面板',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadURL('http://localhost:4171');
});
app.on('window-all-closed', () => { app.quit(); });

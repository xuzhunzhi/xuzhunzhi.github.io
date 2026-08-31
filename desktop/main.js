const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, shell } = require('electron');

// 管理台是轻量的本地表单应用，关闭 GPU、拼写检查和后台页面活动，减少常驻开销。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter');

let win;
let adminServer;

function reportFailure(error) {
  const message = error && error.stack ? error.stack : String(error);
  try {
    fs.appendFileSync(path.join(app.getPath('logs'), 'straycat-admin.log'), new Date().toISOString() + '\n' + message + '\n\n', 'utf8');
  } catch (_) {}
  dialog.showErrorBox('流浪猫管理台启动失败', message);
  app.quit();
}

function hasWorkspace(root) {
  return !!root && fs.existsSync(path.join(root, 'source', '_posts')) && fs.existsSync(path.join(root, 'app.js'));
}

function copyStarterWorkspace(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
  return true;
}

async function resolveWorkspace() {
  const configured = process.env.ADMIN_ROOT;
  const executableDir = path.dirname(process.execPath);
  const candidates = [
    configured,
    !app.isPackaged ? path.resolve(__dirname, '..') : null,
    process.cwd(),
    path.resolve(executableDir, '..', '..'),
    path.resolve(executableDir, '..', '..', '..'),
    path.join(app.getPath('documents'), '流浪猫的避难所', 'xuzhunzhi.github.io'),
    path.join(app.getPath('documents'), 'xuzhunzhi.github.io')
  ].filter(Boolean);

  const existing = candidates.find(hasWorkspace);
  if (existing) return path.resolve(existing);

  if (app.isPackaged) {
    const starter = path.join(process.resourcesPath, 'app-runtime', 'site');
    const documentWorkspace = path.join(app.getPath('documents'), '流浪猫的避难所', 'xuzhunzhi.github.io');
    try {
      copyStarterWorkspace(starter, documentWorkspace);
      if (hasWorkspace(documentWorkspace)) return documentWorkspace;
    } catch (error) {
      dialog.showErrorBox('初始化网站目录失败', error.message);
    }
  }

  const picked = await dialog.showOpenDialog({
    title: '选择流浪猫网站目录',
    properties: ['openDirectory'],
    buttonLabel: '使用此目录'
  });
  const selected = picked.canceled ? '' : picked.filePaths[0];
  if (hasWorkspace(selected)) return path.resolve(selected);
  if (!picked.canceled) dialog.showErrorBox('目录不完整', '请选择包含 source\\_posts 和 app.js 的网站目录。');
  return null;
}

function openWindow(port) {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    title: '流浪猫管理台',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a08',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
      devTools: !app.isPackaged
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/localhost(?::\d+)?\//.test(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\/localhost(?::\d+)?\//.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.loadURL('http://127.0.0.1:' + port);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    const repoRoot = await resolveWorkspace();
    if (!repoRoot) return app.quit();
    process.env.ADMIN_ROOT = repoRoot;
    const adminPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app-runtime', 'admin.js')
      : path.join(repoRoot, 'admin.js');
    const { startAdmin } = require(adminPath);
    adminServer = startAdmin(0, openWindow);
    adminServer.on('error', reportFailure);
  }).catch(reportFailure);

  app.on('before-quit', () => {
    if (adminServer) adminServer.close();
  });
  app.on('window-all-closed', () => app.quit());
}

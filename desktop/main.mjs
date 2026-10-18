// App de escritorio (Electron): corre el agente local y lo muestra en una ventana propia.
import { app, BrowserWindow, Menu, shell, dialog, clipboard } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { startLocal } from '../src/launcher.js';

const userData = app.getPath('userData');
const settingsFile = join(userData, 'maquina.json');
const dataDir = join(userData, 'datos');

const readSettings = () => {
  try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return {}; }
};
const writeSettings = (s) => { mkdirSync(userData, { recursive: true }); writeFileSync(settingsFile, JSON.stringify(s, null, 2)); };

if (!app.requestSingleInstanceLock()) app.quit();

let local = null;
let mainWin = null;

const base = () => `http://localhost:${local.port}`;
const isOwn = (url) => url.startsWith(base());

function openWindow(path, opts = {}) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 500,
    title: 'Restaurante — modo prueba', autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...opts,
  });
  win.loadURL(base() + path);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) { openWindow(new URL(url).pathname, { width: 520, height: 820 }); } else if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isOwn(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  return win;
}

async function chooseRegister() {
  const cur = readSettings().registerId;
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question', title: 'Esta máquina', message: '¿Qué caja atiende esta PC?',
    detail: `Actual: ${cur === undefined ? 'PB (por defecto)' : cur || 'ninguna'}. La app se reinicia al cambiar.`,
    buttons: ['Planta baja (PB)', 'Primer piso (P1)', 'Sin caja', 'Cancelar'], cancelId: 3,
  });
  if (response === 3) return;
  writeSettings({ ...readSettings(), registerId: ['PB', 'P1', ''][response] });
  app.relaunch(); app.quit();
}

async function resetData() {
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'warning', title: 'Borrar datos de prueba', message: 'Se borran pedidos, caja y precios modificados.',
    detail: 'Al reiniciar se vuelven a cargar los datos de demostración.', buttons: ['Borrar', 'Cancelar'], cancelId: 1, defaultId: 1,
  });
  if (response !== 0) return;
  local.server.close(); local.ctx.db.close();
  rmSync(dataDir, { recursive: true, force: true });
  app.relaunch(); app.quit();
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Restaurante', submenu: [
      { label: 'Panel', accelerator: 'CmdOrCtrl+1', click: () => mainWin?.loadURL(base() + '/') },
      { label: 'Pantalla de cocina (ventana nueva)', accelerator: 'CmdOrCtrl+2', click: () => openWindow('/cocina') },
      { type: 'separator' },
      { label: 'Esta máquina: elegir caja…', click: chooseRegister },
      { label: 'Copiar dirección para celulares', click: () => { clipboard.writeText(local.config.publicBaseUrl); dialog.showMessageBox(mainWin, { message: 'Copiado', detail: `${local.config.publicBaseUrl}\nLos QR de las mesas usan esta dirección (Panel > Admin > QR por mesa). El celular debe estar en la misma Wi-Fi.` }); } },
      { label: 'Abrir carpeta de datos', click: () => shell.openPath(dataDir) },
      { label: 'Borrar datos de prueba…', click: resetData },
      { type: 'separator' },
      { role: 'quit', label: 'Salir' },
    ] },
    { role: 'editMenu', label: 'Edición' },
    { label: 'Ver', submenu: [
      { role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' },
      { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { role: 'resetZoom', label: 'Zoom normal' },
      { type: 'separator' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
    ] },
    { label: 'Ayuda', submenu: [{ label: 'Usuarios de prueba', click: () => dialog.showMessageBox(mainWin, { message: 'Usuarios de prueba', detail: 'Admin 1111\nCajero 2222\nMozo 3333\nCocina 4444\n\nLa facturación ARCA está SIMULADA (CAE falsos).' }) }] },
  ]));
}

app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

app.whenReady().then(async () => {
  const s = readSettings();
  try {
    local = await startLocal({
      port: 3000, dbPath: join(dataDir, 'demo.db'),
      machineId: s.machineId ?? 'demo-pc', registerId: s.registerId === undefined ? 'PB' : s.registerId || null,
    });
  } catch (e) {
    dialog.showErrorBox('No se pudo iniciar', String(e.message ?? e));
    return app.quit();
  }
  buildMenu();
  mainWin = openWindow('/');
  mainWin.on('closed', () => { mainWin = null; });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { local?.server.close(); local?.ctx.db.close(); } catch {} });

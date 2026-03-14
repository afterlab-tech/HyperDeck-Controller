const { app, BrowserWindow } = require('electron');
const path = require('path');

// 既存のサーバー(server.js)をバックグラウンドで起動
require('./server.js');

function createWindow() {
    // アプリのウィンドウ設定
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        autoHideMenuBar: true, // 上部のメニューバーを隠す
        webPreferences: {
            nodeIntegration: false
        }
    });

    // サーバーが立ち上がるのを少し待ってから画面を読み込む
    setTimeout(() => {
        win.loadURL('http://localhost:3000');
    }, 1000);
}

// アプリが起動したらウィンドウを作成
app.whenReady().then(createWindow);

// 全てのウィンドウが閉じられたらアプリを完全に終了する
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
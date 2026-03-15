const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// 既存のサーバー(server.js)をバックグラウンドで起動
require('./server.js');

function startApp() {
    // 1. サーバーを終了させるための「小さな管理ウィンドウ」を作成
    const win = new BrowserWindow({
        width: 450,
        height: 250,
        autoHideMenuBar: true,
        title: "HyperDeck Controller Server"
    });

    // 管理ウィンドウに簡単な案内メッセージを表示（HTML直書き）
    const htmlContent = `
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e2128; color: #e2e8f0; text-align: center; padding: 30px; margin: 0;">
            <h2 style="color: #3b82f6; margin-top: 0;">Server is Running 🟢</h2>
            <p>通常のブラウザ（Chrome等）でコントロール画面を開きました。</p>
            <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 30px;">
                ※このウィンドウの「✖」を閉じるとシステムが完全に終了します。
            </p>
        </body>
    `;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

    // 2. サーバーの起動を少し待ってから、PCの「デフォルトブラウザ」で開く
    setTimeout(() => {
        shell.openExternal('http://localhost:3000');
    }, 1000);
}

// アプリが起動したら実行
app.whenReady().then(startApp);

// 管理ウィンドウが閉じられたらアプリ（裏のNode.jsサーバー含む）を完全に終了する
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
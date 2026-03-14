const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Bonjour } = require('bonjour-service');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const hyperdecks = new Map();
const pollTimers = new Map();
const deviceNames = new Map();
const HYPERDECK_PORT = 9993;

const DATA_FILE = path.join(process.cwd(), 'devices.json');

function saveDevices() {
    const data = Array.from(deviceNames.entries()).map(([ip, name]) => ({ ip, name }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadDevices() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            data.forEach(dev => {
                deviceNames.set(dev.ip, dev.name);
                connectToHyperDeck(dev.ip, dev.name);
            });
            console.log(`Loaded ${data.length} devices from storage.`);
        } catch (err) {
            console.error('Failed to load devices.json:', err);
        }
    }
}

const bonjour = new Bonjour();
const discoveredDevices = new Map();
const searchTypes = ['blackmagic', 'bmd-hyperdeck', 'http'];

searchTypes.forEach(type => {
    bonjour.find({ type: type }, (service) => {
        if (service.name.toLowerCase().includes('hyperdeck') || type !== 'http') {
            const ip = service.addresses.find(a => net.isIPv4(a));
            if (ip && !discoveredDevices.has(ip)) {
                discoveredDevices.set(ip, service.name);
                io.emit('discovered_devices', Array.from(discoveredDevices.entries()).map(([ip, name]) => ({ ip, name })));
            }
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));

function connectToHyperDeck(ip, name) {
    if (hyperdecks.has(ip)) return; 

    const client = new net.Socket();
    hyperdecks.set(ip, client);

    let dataBuffer = '';

    client.connect(HYPERDECK_PORT, ip, () => {
        console.log(`Connected to HyperDeck: ${name} (${ip})`);
        io.emit('device_status', { ip, status: 'Connected', isError: false });

        const timer = setInterval(() => {
            if (!client.destroyed) {
                client.write('transport info\r\n');
                client.write('configuration\r\n');
                client.write('slot info: slot id: 1\r\n');
                client.write('slot info: slot id: 2\r\n');
                client.write('slot info: slot id: 3\r\n');
                client.write('slot info: slot id: 4\r\n');
            }
        }, 1000);
        pollTimers.set(ip, timer);
    });

    client.on('data', (data) => {
        dataBuffer += data.toString();
        let parts = dataBuffer.split('\r\n\r\n');
        dataBuffer = parts.pop(); 

        for (const part of parts) {
            if (part.includes('208 transport info:')) {
                const tcMatch = part.match(/timecode:\s*([\d:]+)/);
                const statusMatch = part.match(/status:\s*([a-zA-Z]+)/);
                const activeSlotMatch = part.match(/slot id:\s*(\d+)/);
                
                if (tcMatch) io.emit('device_tc', { ip, tc: tcMatch[1] });
                if (statusMatch) io.emit('device_state', { ip, state: statusMatch[1] });
                if (activeSlotMatch) io.emit('device_active_slot', { ip, activeSlot: activeSlotMatch[1] });
            }
            if (part.includes('211 configuration:')) {
                const formatMatch = part.match(/file format:\s*([^\r\n]+)/);
                if (formatMatch) io.emit('device_codec', { ip, codec: formatMatch[1] });
            }
            if (part.includes('202 slot info:')) {
                const slotMatch = part.match(/slot id:\s*(\d+)/);
                const statusMatch = part.match(/status:\s*([a-zA-Z]+)/);
                const recTimeMatch = part.match(/recording time:\s*([^\r\n]+)/);
                
                if (slotMatch && statusMatch) {
                    const slot = slotMatch[1];
                    if (statusMatch[1] === 'empty') {
                        io.emit('device_storage', { ip, slot, time: 'No Media' });
                    } else if (recTimeMatch) {
                        let timeVal = recTimeMatch[1];
                        if (/^\d+$/.test(timeVal)) timeVal += 'm'; 
                        io.emit('device_storage', { ip, slot, time: timeVal });
                    }
                }
            }
        }
    });

    client.on('error', (err) => {});

    client.on('close', () => {
        io.emit('device_status', { ip, status: 'Disconnected', isError: true });
        if (pollTimers.has(ip)) {
            clearInterval(pollTimers.get(ip));
            pollTimers.delete(ip);
        }
        hyperdecks.delete(ip);

        if (deviceNames.has(ip)) {
            setTimeout(() => {
                if (deviceNames.has(ip)) { 
                    io.emit('device_status', { ip, status: 'Reconnecting...', isError: true });
                    connectToHyperDeck(ip, deviceNames.get(ip));
                }
            }, 5000);
        }
    });
}

io.on('connection', (socket) => {
    console.log('Web Client connected');

    const existingDevices = Array.from(deviceNames.entries()).map(([ip, name]) => ({ ip, name }));
    socket.emit('init_devices', existingDevices);

    existingDevices.forEach(({ip}) => {
        if (hyperdecks.has(ip)) {
            socket.emit('device_status', { ip, status: 'Connected', isError: false });
        } else {
            socket.emit('device_status', { ip, status: 'Reconnecting...', isError: true });
        }
    });

    socket.emit('discovered_devices', Array.from(discoveredDevices.entries()).map(([ip, name]) => ({ ip, name })));

    socket.on('add_device', ({ ip, name }) => {
        if (deviceNames.has(ip)) {
            socket.emit('error_msg', `${ip} は既に登録されています。`);
            return;
        }
        deviceNames.set(ip, name);
        saveDevices(); 
        io.emit('device_added', { ip, name });
        connectToHyperDeck(ip, name);
    });

    socket.on('remove_device', (ip) => {
        deviceNames.delete(ip);
        saveDevices(); 
        
        if (hyperdecks.has(ip)) {
            if (pollTimers.has(ip)) clearInterval(pollTimers.get(ip));
            hyperdecks.get(ip).destroy();
            hyperdecks.delete(ip);
        }
        io.emit('device_removed', ip);
    });

    // 【新規】設定ファイルのエクスポート要求
    socket.on('request_export', () => {
        const data = Array.from(deviceNames.entries()).map(([ip, name]) => ({ ip, name }));
        socket.emit('export_data', data);
    });

    // 【新規】設定ファイルのインポート要求
    socket.on('import_devices', (newDevices) => {
        try {
            // 現在の接続をすべて安全に切断・クリア
            hyperdecks.forEach((client, ip) => {
                if (pollTimers.has(ip)) clearInterval(pollTimers.get(ip));
                if (!client.destroyed) client.destroy();
            });
            hyperdecks.clear();
            deviceNames.clear();

            // インポートされた新しいデバイスリストを登録・接続
            newDevices.forEach(dev => {
                if (dev.ip && dev.name) {
                    deviceNames.set(dev.ip, dev.name);
                    connectToHyperDeck(dev.ip, dev.name);
                }
            });
            saveDevices(); // サーバーの devices.json も上書き

            // 全クライアントの画面を新しい構成でリセット＆更新
            const updatedDevices = Array.from(deviceNames.entries()).map(([ip, name]) => ({ ip, name }));
            io.emit('config_imported', updatedDevices);
            
        } catch(e) {
            console.error("Import error", e);
        }
    });

    socket.on('single_command', ({ ip, cmd }) => {
        const client = hyperdecks.get(ip);
        if (client && !client.destroyed) client.write(cmd + '\r\n');
    });

    socket.on('global_command', (cmd) => {
        hyperdecks.forEach((client) => {
            if (client && !client.destroyed) client.write(cmd + '\r\n');
        });
    });
});

loadDevices();

const PORT = 3000;
server.listen(PORT, () => console.log(`App running on http://localhost:${PORT}`));
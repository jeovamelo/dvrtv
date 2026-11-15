const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
let defaultDvrHost = '192.168.100.2';
let defaultDvrPort = 80;
let defaultDvrUser = 'admin';
let defaultDvrPass = 'jr130182';

// Detectar IP local primário (preferencialmente rede 192.168.100.x ou rede local não-interna)
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    let preferredIp = null;
    let fallbackIp = '127.0.0.1';

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                if (net.address.startsWith('192.168.100.')) {
                    return net.address;
                }
                if (!preferredIp && (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.'))) {
                    preferredIp = net.address;
                } else if (!fallbackIp || fallbackIp === '127.0.0.1') {
                    fallbackIp = net.address;
                }
            }
        }
    }
    return preferredIp || fallbackIp;
}

const LOCAL_IP = getLocalIpAddress();

// Estado sincronizado entre TV e Celular
let tvState = {
    connected: false,
    dvrStatus: 'connecting',
    currentView: 'grid', // 'grid' ou 'fullscreen'
    selectedChannelId: 1,
    selectedCameraName: 'Camera 01',
    quality: 'fluido',   // 'fluido' ou 'hd'
    gridMode: 'auto',    // 'auto', '1x1', '2x2', '3x3', '4x4', '5x5', '6x6'
    showOffline: true,
    lastUpdate: Date.now(),
    channels: []
};

// Fila de comandos pendentes enviados pelo celular para a TV
let commandQueue = [];

// Sessões autenticadas do celular (token -> { user, createdAt, expiresAt })
const activeSessions = new Map();

function generateSessionToken(username) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    activeSessions.set(token, {
        username: username,
        createdAt: now,
        expiresAt: now + (24 * 60 * 60 * 1000) // 24 horas de validade
    });
    return token;
}

function isValidSession(token) {
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}

// Limpeza periódica de sessões expiradas
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (now > session.expiresAt) {
            activeSessions.delete(token);
        }
    }
}, 3600000);

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, 'http://' + req.headers.host || 'localhost');
    const pathname = parsedUrl.pathname;

    // 1. API: Informações de Rede e QR Code
    if (pathname === '/api/info') {
        const info = {
            serverIp: LOCAL_IP,
            port: PORT,
            mobileUrl: 'http://' + LOCAL_IP + ':' + PORT + '/mobile',
            dvrHost: defaultDvrHost,
            dvrPort: defaultDvrPort
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
        return;
    }

    // 2. API Mobile: Autenticação Segura (sem expor credenciais em URL)
    if (pathname === '/api/mobile/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                const user = (data.username || '').trim();
                const pass = (data.password || '').trim();

                // Aceita usuário/senha cadastrados para acesso ao DVR
                // Permite admin/jr130182 ou credenciais enviadas pelo frontend
                const isUserValid = (user === defaultDvrUser || user === 'admin');
                const isPassValid = (pass === defaultDvrPass || pass === 'jr130182' || (data.dvrPass && pass === data.dvrPass));

                if (isUserValid && isPassValid) {
                    const token = generateSessionToken(user);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        token: token,
                        username: user,
                        message: 'Autenticado com sucesso'
                    }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false,
                        error: 'Usuário ou senha incorretos'
                    }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Requisição inválida' }));
            }
        });
        return;
    }

    // 3. API Mobile: Obter Estado Atual da TV
    if (pathname === '/api/mobile/state' && req.method === 'GET') {
        const token = req.headers['x-session-token'] || parsedUrl.searchParams.get('token');
        if (!isValidSession(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Sessão expirada ou não autenticada' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            state: tvState
        }));
        return;
    }

    // 4. API Mobile: Enviar Comandos de Controle para a TV
    if (pathname === '/api/remote/command' && req.method === 'POST') {
        const token = req.headers['x-session-token'] || parsedUrl.searchParams.get('token');
        if (!isValidSession(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Sessão não autorizada' }));
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const cmdData = JSON.parse(body || '{}');
                const validCommands = [
                    'select_camera', 'open_fullscreen', 'close_fullscreen',
                    'next_camera', 'prev_camera', 'toggle_quality', 'set_quality',
                    'set_grid', 'toggle_offline', 'reconnect', 'open_settings',
                    'close_settings', 'open_drawer', 'close_drawer',
                    'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'dpad_ok', 'dpad_back'
                ];

                if (!cmdData.command || !validCommands.includes(cmdData.command)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Comando inválido ou desconhecido' }));
                    return;
                }

                commandQueue.push({
                    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    command: cmdData.command,
                    channelId: cmdData.channelId || null,
                    value: cmdData.value || null,
                    timestamp: Date.now()
                });

                // Mantém a fila com no máximo 20 comandos
                if (commandQueue.length > 20) {
                    commandQueue = commandQueue.slice(-20);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Comando enfileirado com sucesso' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Erro ao processar comando' }));
            }
        });
        return;
    }

    // 5. API TV: Polling de Comandos Pendentes
    if (pathname === '/api/remote/poll' && req.method === 'GET') {
        const pending = [...commandQueue];
        commandQueue = [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ commands: pending }));
        return;
    }

    // 6. API TV: Atualização de Estado pela TV
    if (pathname === '/api/remote/state' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const newState = JSON.parse(body || '{}');
                tvState = {
                    ...tvState,
                    ...newState,
                    lastUpdate: Date.now()
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Erro ao atualizar estado' }));
            }
        });
        return;
    }

    // 7. Proxy de Snapshots Seguro para o Celular
    if (pathname.startsWith('/api/snapshot/')) {
        const parts = pathname.split('/');
        const chId = parseInt(parts[3], 10);
        const streamType = parts[4] ? parseInt(parts[4], 10) : 2; // sub-stream padrão

        if (!chId || isNaN(chId)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Canal inválido');
            return;
        }

        const snapshotPath = '/ISAPI/Streaming/channels/' + (chId * 100 + streamType) + '/picture';
        const targetHost = req.headers['x-dvr-ip'] || defaultDvrHost;
        const targetPort = parseInt(req.headers['x-dvr-port'] || defaultDvrPort, 10);

        const options = {
            hostname: targetHost,
            port: targetPort,
            path: snapshotPath,
            method: 'GET',
            headers: {
                'Host': targetHost + (targetPort === 80 ? '' : ':' + targetPort),
                'Authorization': 'Basic ' + Buffer.from(defaultDvrUser + ':' + defaultDvrPass).toString('base64')
            }
        };

        const dvrReq = http.request(options, (dvrRes) => {
            res.writeHead(dvrRes.statusCode, {
                'Content-Type': dvrRes.headers['content-type'] || 'image/jpeg',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*'
            });
            dvrRes.pipe(res);
        });

        dvrReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Erro ao obter snapshot do DVR: ' + err.message);
        });

        dvrReq.end();
        return;
    }

    // 8. Proxy Geral para o DVR Hikvision (Compatibilidade total com ISAPI existente)
    if (req.url.startsWith('/dvr/')) {
        const dvrPath = req.url.substring(4);
        
        const targetHost = req.headers['x-dvr-ip'] || defaultDvrHost;
        const targetPort = parseInt(req.headers['x-dvr-port'] || defaultDvrPort, 10);

        const headers = { ...req.headers };
        headers.host = (targetPort === 80) ? targetHost : (targetHost + ':' + targetPort);
        delete headers.origin;
        delete headers.referer;
        delete headers['x-dvr-ip'];
        delete headers['x-dvr-port'];

        const options = {
            hostname: targetHost,
            port: targetPort,
            path: dvrPath,
            method: req.method,
            headers: headers
        };

        const dvrReq = http.request(options, (dvrRes) => {
            const outHeaders = { ...dvrRes.headers };
            outHeaders['Access-Control-Allow-Origin'] = '*';
            outHeaders['Access-Control-Allow-Headers'] = '*';
            res.writeHead(dvrRes.statusCode, outHeaders);
            dvrRes.pipe(res);
        });

        dvrReq.on('error', (err) => {
            console.error(`[DVR Proxy Error] (${targetHost}:${targetPort}):`, err.message);
            res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end(`DVR Gateway Error (${targetHost}:${targetPort}): ` + err.message);
        });

        req.pipe(dvrReq);
        return;
    }

    // 9. Rota /mobile: Servir a Interface Web do Celular
    if (pathname === '/mobile' || pathname === '/mobile/') {
        const mobileHtmlPath = path.join(__dirname, 'mobile', 'index.html');
        fs.readFile(mobileHtmlPath, (err, content) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Interface mobile em construção ou não encontrada.');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            }
        });
        return;
    }

    // 10. Servir arquivos estáticos locais (App da TV, css, js, mobile assets)
    let cleanUrl = pathname;
    let filePath = path.join(__dirname, cleanUrl === '/' ? 'index.html' : cleanUrl);

    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.xml': 'text/xml',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DVR TV] Servidor iniciado com sucesso!`);
    console.log(`[DVR TV] Painel TV / PC: http://localhost:${PORT}/ ou http://${LOCAL_IP}:${PORT}/`);
    console.log(`[DVR TV] Controle Mobile: http://${LOCAL_IP}:${PORT}/mobile`);
});

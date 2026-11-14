const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DEFAULT_DVR_HOST = '192.168.100.2';
const DEFAULT_DVR_PORT = 80;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Proxy para o DVR Hikvision com suporte a múltiplos IPs e Portas
    if (req.url.startsWith('/dvr/')) {
        const dvrPath = req.url.substring(4);
        
        // Permite que o frontend altere o IP e Porta do DVR dinamicamente
        const targetHost = req.headers['x-dvr-ip'] || DEFAULT_DVR_HOST;
        const targetPort = parseInt(req.headers['x-dvr-port'] || DEFAULT_DVR_PORT, 10);

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

    // Servir arquivos estáticos locais
    let cleanUrl = req.url.split('?')[0];
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
        '.xml': 'text/xml'
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
    console.log(`[DVR TV] Servidor rodando com sucesso em http://localhost:${PORT}/ e http://192.168.100.74:${PORT}/`);
});

/**
 * Hikvision ISAPI Client para Samsung Smart TV (Tizen 5.5+)
 * Compatível com Chromium 69+ (sem optional chaining ou recursos ES2020).
 */

function getNodeText(parent, selector, defaultValue) {
    if (!parent) return defaultValue || '';
    var el = parent.querySelector(selector);
    return (el && el.textContent) ? el.textContent : (defaultValue || '');
}

class DvrApiClient {
    constructor(config) {
        config = config || {};
        this.ip = config.ip || '192.168.100.2';
        this.httpPort = config.httpPort || 80;
        this.rtspPort = config.rtspPort || 554;
        this.username = config.username || 'admin';
        this.password = config.password || 'jr130182';

        this.sessionTag = null;
        this.sessionID = null;
        this.isAuthenticated = false;
        this.heartbeatTimer = null;
        this.deviceInfo = null;
        this.channels = [];
    }

    get baseUrl() {
        if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            return window.location.origin + '/dvr';
        }
        var portStr = (this.httpPort === 80) ? '' : (':' + this.httpPort);
        return 'http://' + this.ip + portStr;
    }

    /**
     * Autenticação via ISAPI sessionLogin (SHA-256)
     */
    async login() {
        try {
            console.log('[DVR] Conectando a ' + this.baseUrl);
            
            // Passo 1: Obter capacidades e desafio
            var capUrl = this.baseUrl + '/ISAPI/Security/sessionLogin/capabilities?username=' + encodeURIComponent(this.username) + '&_=' + Date.now();
            var capRes = await fetch(capUrl, {
                method: 'GET',
                credentials: 'include'
            });

            if (!capRes.ok) {
                throw new Error('Falha HTTP ' + capRes.status + ' ao obter capacidades');
            }

            var capXmlText = await capRes.text();
            var parser = new DOMParser();
            var capDoc = parser.parseFromString(capXmlText, 'text/xml');

            this.sessionID = getNodeText(capDoc, 'sessionID', '');
            var challenge = getNodeText(capDoc, 'challenge', '');
            var iterations = parseInt(getNodeText(capDoc, 'iterations', '100'), 10);
            var isIrreversible = (getNodeText(capDoc, 'isIrreversible', 'false') === 'true');
            var salt = getNodeText(capDoc, 'salt', '');

            if (!challenge) {
                throw new Error('Desafio de autenticação não retornado pelo DVR');
            }

            // Passo 2: Calcular Hash SHA-256 da senha
            var passwordHash = '';
            if (isIrreversible) {
                var h = window.SHA256(this.username + salt + this.password);
                h = window.SHA256(h + challenge);
                for (var i = 2; i < iterations; i++) {
                    h = window.SHA256(h);
                }
                passwordHash = h;
            } else {
                var h2 = window.SHA256(this.password) + challenge;
                for (var j = 1; j < iterations; j++) {
                    h2 = window.SHA256(h2);
                }
                passwordHash = h2;
            }

            // Passo 3: Enviar requisição POST com XML de SessionLogin
            var loginPayload = 
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<SessionLogin>' +
                '<userName>' + this.username + '</userName>' +
                '<password>' + passwordHash + '</password>' +
                '<sessionID>' + this.sessionID + '</sessionID>' +
                '</SessionLogin>';

            var loginUrl = this.baseUrl + '/ISAPI/Security/sessionLogin?timeStamp=' + Date.now();
            var loginRes = await fetch(loginUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml',
                    'If-Modified-Since': '0'
                },
                credentials: 'include',
                body: loginPayload
            });

            var loginXmlText = await loginRes.text();
            var loginDoc = parser.parseFromString(loginXmlText, 'text/xml');
            var statusVal = getNodeText(loginDoc, 'statusValue', '');
            var sessionTagVal = getNodeText(loginDoc, 'sessionTag', '');

            if (loginRes.ok && (statusVal === '200' || statusVal === '1')) {
                this.sessionTag = sessionTagVal;
                this.isAuthenticated = true;
                console.log('[DVR] Login realizado com sucesso! SessionTag:', this.sessionTag || 'Cookie ativo');
                this.startHeartbeat();
                return true;
            } else {
                var statusStr = getNodeText(loginDoc, 'statusString', 'Erro de autenticação');
                throw new Error(statusStr + ' (' + statusVal + ')');
            }
        } catch (err) {
            console.error('[DVR] Erro no login:', err);
            this.isAuthenticated = false;
            throw err;
        }
    }

    /**
     * Mantém a sessão do DVR ativa via Heartbeat a cada 30 segundos
     */
    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        var self = this;
        this.heartbeatTimer = setInterval(async function() {
            if (!self.isAuthenticated) return;
            try {
                var headers = { 'If-Modified-Since': '0' };
                if (self.sessionTag) headers['SessionTag'] = self.sessionTag;
                await fetch(self.baseUrl + '/ISAPI/Security/sessionHeartbeat', {
                    method: 'PUT',
                    headers: headers,
                    credentials: 'include'
                });
            } catch (e) {
                console.warn('[DVR] Erro no heartbeat:', e);
            }
        }, 30000);
    }

    /**
     * Consulta informações de hardware do DVR
     */
    async getDeviceInfo() {
        try {
            var headers = { 'If-Modified-Since': '0' };
            if (this.sessionTag) headers['SessionTag'] = this.sessionTag;

            var res = await fetch(this.baseUrl + '/ISAPI/System/deviceInfo', {
                headers: headers,
                credentials: 'include'
            });

            if (!res.ok) return null;
            var xmlText = await res.text();
            var doc = new DOMParser().parseFromString(xmlText, 'text/xml');

            this.deviceInfo = {
                deviceName: getNodeText(doc, 'deviceName', 'DVR'),
                model: getNodeText(doc, 'model', 'iDS-7216HQHI-M1/XT'),
                serialNumber: getNodeText(doc, 'serialNumber', ''),
                firmwareVersion: getNodeText(doc, 'firmwareVersion', ''),
                manufacturer: getNodeText(doc, 'manufacturer', 'Hikvision')
            };
            return this.deviceInfo;
        } catch (e) {
            console.error('[DVR] Erro ao obter deviceInfo:', e);
            return null;
        }
    }

    /**
     * Lista todos os canais de vídeo disponíveis e o status de sinal
     */
    async getChannels() {
        try {
            var headers = { 'If-Modified-Since': '0' };
            if (this.sessionTag) headers['SessionTag'] = this.sessionTag;

            var res = await fetch(this.baseUrl + '/ISAPI/System/Video/inputs/channels', {
                headers: headers,
                credentials: 'include'
            });

            if (!res.ok) throw new Error('HTTP ' + res.status);
            var xmlText = await res.text();
            var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            var nodes = doc.querySelectorAll('VideoInputChannel');

            var channels = [];
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                var id = parseInt(getNodeText(node, 'id', '0'), 10);
                var inputPort = parseInt(getNodeText(node, 'inputPort', '0'), 10);
                var defaultName = 'Camera ' + (id < 10 ? '0' + id : id);
                var name = getNodeText(node, 'name', defaultName);
                var resDesc = getNodeText(node, 'resDesc', '').trim();
                var isOnline = (resDesc.indexOf('NO VIDEO') === -1 && resDesc.length > 0);

                channels.push({
                    id: id,
                    inputPort: inputPort,
                    name: name,
                    resDesc: resDesc,
                    isOnline: isOnline,
                    mainStreamChannelId: id * 100 + 1, // Ex: 101, 201
                    subStreamChannelId: id * 100 + 2   // Ex: 102, 202
                });
            }

            this.channels = channels;
            return channels;
        } catch (e) {
            console.error('[DVR] Erro ao obter canais:', e);
            throw e;
        }
    }

    /**
     * Retorna a URL de Snapshot (JPEG) para um canal
     */
    getSnapshotUrl(channelId, streamType) {
        streamType = streamType || 2;
        var chId = channelId * 100 + streamType;
        return this.baseUrl + '/ISAPI/Streaming/channels/' + chId + '/picture?t=' + Date.now();
    }

    /**
     * Busca o snapshot como Blob com os headers de autenticação
     */
    async fetchSnapshotBlob(channelId, streamType) {
        streamType = streamType || 2;
        var url = this.getSnapshotUrl(channelId, streamType);
        var headers = { 'If-Modified-Since': '0' };
        if (this.sessionTag) headers['SessionTag'] = this.sessionTag;

        var res = await fetch(url, {
            headers: headers,
            credentials: 'include'
        });

        if (!res.ok) throw new Error('Snapshot error HTTP ' + res.status);
        var blob = await res.blob();
        return URL.createObjectURL(blob);
    }

    /**
     * Gera URL RTSP para reprodução via Samsung AVPlay
     */
    getRtspUrl(channelId, streamType) {
        streamType = streamType || 1;
        var chId = channelId * 100 + streamType;
        return 'rtsp://' + encodeURIComponent(this.username) + ':' + encodeURIComponent(this.password) + '@' + this.ip + ':' + this.rtspPort + '/Streaming/Channels/' + chId;
    }
}

window.DvrApiClient = DvrApiClient;

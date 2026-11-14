/**
 * Aplicação Principal DVR TV para Samsung Smart TV e PC
 * Padrão: Grade 4x4 com as 16 câmeras simultâneas na tela
 */
class DvrTvApp {
    constructor() {
        this.dvr = new DvrApiClient({
            ip: localStorage.getItem('dvr_ip') || '192.168.100.2',
            httpPort: parseInt(localStorage.getItem('dvr_http_port') || '80', 10),
            rtspPort: parseInt(localStorage.getItem('dvr_rtsp_port') || '554', 10),
            username: localStorage.getItem('dvr_user') || 'admin',
            password: localStorage.getItem('dvr_pwd') || 'jr130182'
        });

        this.channels = [];
        // Padrão solicitado: Exibir todas as 16 câmeras
        this.activeChannelsOnly = false;
        // Padrão solicitado: Grade 4x4 (16 câmeras na tela)
        this.currentLayout = '4x4';
        localStorage.setItem('dvr_layout', '4x4');
        localStorage.setItem('dvr_filter_active', 'false');

        this.focusedIndex = 0;
        this.isFullScreen = false;
        this.fullScreenChannel = null;
        this.streamQuality = 1; // 1 = HD (1080P), 2 = Fluido

        this.gridRefreshTimer = null;
        this.player = null;
        this.remote = null;

        this.init();
    }

    async init() {
        console.log('[App] Inicializando DVR TV App (Modo 4x4 - 16 Câmeras)...');
        this.startClock();
        this.setupDOM();

        var playerContainer = document.getElementById('fullscreen-player-container');
        this.player = new TvStreamPlayer(playerContainer, this.dvr);

        this.setupRemote();
        await this.connectDvr();
    }

    startClock() {
        var clockEl = document.getElementById('clock-time');
        var dateEl = document.getElementById('clock-date');
        var updateClock = function() {
            var now = new Date();
            if (clockEl) {
                clockEl.textContent = now.toLocaleTimeString('pt-BR');
            }
            if (dateEl) {
                dateEl.textContent = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
            }
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    setupDOM() {
        var self = this;
        window.addEventListener('resize', function() {
            if (self.player) self.player.resize();
        });
    }

    setupRemote() {
        var self = this;
        this.remote = new RemoteControlManager({
            onUp: function() { self.handleNavigation('up'); },
            onDown: function() { self.handleNavigation('down'); },
            onLeft: function() { self.handleNavigation('left'); },
            onRight: function() { self.handleNavigation('right'); },
            onEnter: function() { self.handleEnter(); },
            onBack: function() { self.handleBack(); },
            onRed: function() { self.handleRed(); },
            onGreen: function() { self.handleGreen(); },
            onYellow: function() { self.handleYellow(); },
            onBlue: function() { self.handleBlue(); },
            onChannelUp: function() { self.nextCamera(); },
            onChannelDown: function() { self.prevCamera(); },
            onNumber: function(num) { self.handleNumber(num); }
        });
    }

    async connectDvr() {
        this.showToast('Conectando ao DVR (192.168.100.2)...', 3000);
        this.setConnectionStatus('connecting', 'Conectando...');

        try {
            await this.dvr.login();
            this.setConnectionStatus('connected', 'Conectado');

            var deviceInfo = await this.dvr.getDeviceInfo();
            if (deviceInfo) {
                document.getElementById('dvr-title').textContent = deviceInfo.deviceName + ' (' + deviceInfo.model + ')';
            }

            this.channels = await this.dvr.getChannels();
            console.log('[App] ' + this.channels.length + ' canais carregados.');

            this.renderGrid();
            this.startGridRefresh();
            this.showToast('16 Câmeras Carregadas (Grade 4x4)', 2500);

        } catch (err) {
            console.error('[App] Erro ao conectar ao DVR:', err);
            this.setConnectionStatus('error', 'Erro de Conexão');
            this.showToast('Falha na conexão: ' + err.message, 8000);

            var grid = document.getElementById('camera-grid');
            if (grid) {
                grid.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:22px;gap:14px;text-align:center;padding:40px;">' +
                    '<div>⚠️ Não foi possível carregar os canais do DVR (' + this.dvr.baseUrl + ')</div>' +
                    '<div style="color:#94a3b8;font-size:16px;">Detalhes: ' + err.message + '</div>' +
                    '<div style="color:#38bdf8;font-size:16px;margin-top:16px;">Pressione R no teclado (ou botão VERMELHO) para tentar novamente.</div>' +
                '</div>';
            }
        }
    }

    setConnectionStatus(state, text) {
        var dot = document.getElementById('status-dot');
        var label = document.getElementById('status-label');
        if (dot) {
            dot.className = 'status-dot ' + state;
        }
        if (label) {
            label.textContent = text;
        }
    }

    getVisibleChannels() {
        if (this.activeChannelsOnly) {
            return this.channels.filter(function(ch) { return ch.isOnline; });
        }
        return this.channels;
    }

    renderGrid() {
        var grid = document.getElementById('camera-grid');
        grid.innerHTML = '';
        grid.className = 'camera-grid layout-' + this.currentLayout;

        var visibleChannels = this.getVisibleChannels();

        if (visibleChannels.length === 0) {
            grid.innerHTML = '<div class="no-cameras">Nenhuma câmera disponível</div>';
            return;
        }

        if (this.focusedIndex >= visibleChannels.length) {
            this.focusedIndex = 0;
        }

        var self = this;
        visibleChannels.forEach(function(ch, idx) {
            var card = document.createElement('div');
            card.className = 'camera-card' + (idx === self.focusedIndex ? ' focused' : '');
            card.dataset.index = idx;
            card.dataset.channelId = ch.id;

            var chNumStr = (ch.id < 10 ? '0' + ch.id : ch.id);
            var statusClass = ch.isOnline ? 'online' : 'offline';
            var statusText = ch.isOnline ? 'AO VIVO' : 'SEM SINAL';
            var resText = ch.isOnline ? '1080P' : '--';

            card.innerHTML = 
                '<div class="card-video-wrap">' +
                    '<img id="cam-img-' + ch.id + '" class="camera-img" src="' + self.dvr.getSnapshotUrl(ch.id, 2) + '" alt="' + ch.name + '" />' +
                    '<div class="camera-overlay-top">' +
                        '<span class="cam-badge-id">CH ' + chNumStr + '</span>' +
                        '<span class="cam-name">' + ch.name + '</span>' +
                    '</div>' +
                    '<div class="camera-overlay-bottom">' +
                        '<span class="cam-status ' + statusClass + '">' + statusText + '</span>' +
                        '<span class="cam-res">' + resText + '</span>' +
                    '</div>' +
                '</div>';

            card.addEventListener('click', function() {
                self.focusedIndex = idx;
                self.updateCardFocus();
                self.openFullScreen(ch);
            });

            grid.appendChild(card);
        });

        this.updateCardFocus();
    }

    updateCardFocus() {
        var cards = document.querySelectorAll('.camera-card');
        var self = this;
        cards.forEach(function(card, idx) {
            if (idx === self.focusedIndex) {
                card.classList.add('focused');
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                card.classList.remove('focused');
            }
        });
    }

    startGridRefresh() {
        if (this.gridRefreshTimer) clearInterval(this.gridRefreshTimer);

        var self = this;
        this.gridRefreshTimer = setInterval(function() {
            if (self.isFullScreen || !self.dvr.isAuthenticated) return;

            var visibleChannels = self.getVisibleChannels();
            for (var i = 0; i < visibleChannels.length; i++) {
                var ch = visibleChannels[i];
                if (!ch.isOnline) continue;
                var imgEl = document.getElementById('cam-img-' + ch.id);
                if (imgEl) {
                    imgEl.src = self.dvr.getSnapshotUrl(ch.id, 2);
                }
            }
        }, 1500);
    }

    handleNavigation(direction) {
        if (this.isFullScreen) {
            if (direction === 'left' || direction === 'up') {
                this.prevCamera();
            } else if (direction === 'right' || direction === 'down') {
                this.nextCamera();
            }
            return;
        }

        var visibleChannels = this.getVisibleChannels();
        var total = visibleChannels.length;
        if (total === 0) return;

        var cols = 4;
        if (this.currentLayout === '1x1') cols = 1;
        else if (this.currentLayout === '2x2') cols = 2;
        else if (this.currentLayout === '3x3') cols = 3;
        else if (this.currentLayout === '4x4') cols = 4;

        var newIndex = this.focusedIndex;

        switch (direction) {
            case 'left':
                newIndex = (this.focusedIndex > 0) ? this.focusedIndex - 1 : total - 1;
                break;
            case 'right':
                newIndex = (this.focusedIndex < total - 1) ? this.focusedIndex + 1 : 0;
                break;
            case 'up':
                if (this.focusedIndex - cols >= 0) {
                    newIndex = this.focusedIndex - cols;
                }
                break;
            case 'down':
                if (this.focusedIndex + cols < total) {
                    newIndex = this.focusedIndex + cols;
                }
                break;
        }

        this.focusedIndex = newIndex;
        this.updateCardFocus();
    }

    handleEnter() {
        if (this.isFullScreen) {
            this.closeFullScreen();
        } else {
            var visibleChannels = this.getVisibleChannels();
            var selected = visibleChannels[this.focusedIndex];
            if (selected) {
                this.openFullScreen(selected);
            }
        }
    }

    handleBack() {
        if (this.isFullScreen) {
            this.closeFullScreen();
        } else {
            if (typeof window.tizen !== 'undefined') {
                try {
                    window.tizen.application.getCurrentApplication().exit();
                } catch (e) {
                    console.log('Saindo do app...');
                }
            }
        }
    }

    openFullScreen(channel) {
        console.log('[App] Abrindo câmera em tela cheia:', channel.name);
        this.isFullScreen = true;
        this.fullScreenChannel = channel;

        var fsView = document.getElementById('fullscreen-view');
        fsView.style.display = 'block';

        document.getElementById('fs-cam-title').textContent = channel.name + ' (Canal ' + channel.id + ')';
        document.getElementById('fs-cam-badge').textContent = (this.streamQuality === 1) ? 'STREAM HD 1080P' : 'SUB-STREAM FLUIDO';

        this.player.play(channel.id, this.streamQuality);
        this.showToast(channel.name + ' em Tela Cheia', 2000);
    }

    closeFullScreen() {
        if (!this.isFullScreen) return;
        console.log('[App] Fechando tela cheia, voltando para a grade...');
        this.isFullScreen = false;
        this.fullScreenChannel = null;

        var fsView = document.getElementById('fullscreen-view');
        fsView.style.display = 'none';

        this.player.stop();
        this.renderGrid();
    }

    nextCamera() {
        var visibleChannels = this.getVisibleChannels();
        if (visibleChannels.length === 0) return;

        this.focusedIndex = (this.focusedIndex + 1) % visibleChannels.length;
        this.updateCardFocus();

        if (this.isFullScreen) {
            this.openFullScreen(visibleChannels[this.focusedIndex]);
        }
    }

    prevCamera() {
        var visibleChannels = this.getVisibleChannels();
        if (visibleChannels.length === 0) return;

        this.focusedIndex = (this.focusedIndex - 1 + visibleChannels.length) % visibleChannels.length;
        this.updateCardFocus();

        if (this.isFullScreen) {
            this.openFullScreen(visibleChannels[this.focusedIndex]);
        }
    }

    handleNumber(num) {
        if (num === 0) num = 10;
        var target = null;
        for (var i = 0; i < this.channels.length; i++) {
            if (this.channels[i].id === num) {
                target = this.channels[i];
                break;
            }
        }
        if (target) {
            var visibleChannels = this.getVisibleChannels();
            var idx = visibleChannels.indexOf(target);
            if (idx !== -1) {
                this.focusedIndex = idx;
                this.updateCardFocus();
            }
            this.openFullScreen(target);
        }
    }

    handleRed() {
        this.showToast('Atualizando conexão com o DVR...', 2000);
        this.connectDvr();
    }

    handleGreen() {
        if (this.isFullScreen) {
            this.closeFullScreen();
        }

        var layouts = ['4x4', '3x3', '2x2', '1x1'];
        var nextIdx = (layouts.indexOf(this.currentLayout) + 1) % layouts.length;
        this.currentLayout = layouts[nextIdx];
        localStorage.setItem('dvr_layout', this.currentLayout);

        this.showToast('Modo de Exibição: Grade ' + this.currentLayout, 2000);
        this.renderGrid();
    }

    handleYellow() {
        this.streamQuality = (this.streamQuality === 1) ? 2 : 1;
        var qualityName = (this.streamQuality === 1) ? 'Stream Principal (HD 1080P)' : 'Sub-stream (Rápido/Fluido)';
        this.showToast('Qualidade: ' + qualityName, 2500);

        if (this.isFullScreen && this.fullScreenChannel) {
            document.getElementById('fs-cam-badge').textContent = (this.streamQuality === 1) ? 'STREAM HD 1080P' : 'SUB-STREAM FLUIDO';
            this.player.play(this.fullScreenChannel.id, this.streamQuality);
        }
    }

    handleBlue() {
        this.activeChannelsOnly = !this.activeChannelsOnly;
        localStorage.setItem('dvr_filter_active', this.activeChannelsOnly.toString());

        var modeStr = this.activeChannelsOnly ? 'Exibindo: Câmeras Ativas (13)' : 'Exibindo: Todas as 16 Câmeras';
        this.showToast(modeStr, 2500);

        this.focusedIndex = 0;
        this.renderGrid();
    }

    showToast(msg, duration) {
        duration = duration || 3000;
        var toast = document.getElementById('toast-notification');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(function() {
            toast.classList.remove('show');
        }, duration);
    }
}

window.addEventListener('DOMContentLoaded', function() {
    window.app = new DvrTvApp();
});

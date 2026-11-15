/**
 * DVR TV - Aplicação para Samsung Smart TV (Tizen 5.5+) e Navegadores
 * Usabilidade Estilo Netflix: Navegação 100% via Setas e OK,
 * Menus Translúcidos com Fade-Out Automático, 1x1 Proporcional 16:9,
 * Monitor de Banda (KB/s), Botão Voltar Duplo para Sair e Sincronização Mobile.
 *
 * NOTA CRÍTICA DE COMPATIBILIDADE:
 * NUNCA utilizar operadores ES2020 (optional chaining ou nullish coalescing)
 * para garantir suporte pleno ao Chromium 69/76 do Tizen 5.5.
 */

class DvrTvApp {
    constructor() {
        var DvrClass = window.DvrApiClient || (typeof DvrApiClient !== 'undefined' ? DvrApiClient : null);
        this.dvr = new DvrClass({
            ip: localStorage.getItem('dvr_ip') || '192.168.100.2',
            httpPort: parseInt(localStorage.getItem('dvr_http_port') || '80', 10),
            rtspPort: parseInt(localStorage.getItem('dvr_rtsp_port') || '554', 10),
            username: localStorage.getItem('dvr_user') || 'admin',
            password: localStorage.getItem('dvr_pwd') || localStorage.getItem('dvr_pass') || 'jr130182'
        });

        this.channels = [];
        this.currentLayout = '4x4';
        this.currentGridCols = 4;
        this.currentGridCapacity = 16;
        this.focusedIndex = 0;
        this.fullScreenChannel = null;
        this.isFullScreen = false;
        this.isModalOpen = false;
        this.isDrawerOpen = false;
        this.isQrModalOpen = false;
        this.isHelpModalOpen = false;

        // Zonas de Foco: 'grid', 'bottom-bar', 'drawer', 'modal', 'qrcode', 'help', 'fullscreen'
        this.currentFocusZone = 'grid';
        this.bottomBarFocusIndex = 0;
        this.drawerFocusIndex = 0;

        // Preferências persistidas no localStorage
        this.showOfflineCameras = (localStorage.getItem('dvr_show_offline') !== 'false');
        this.gridMode = localStorage.getItem('dvr_grid_mode') || 'auto'; // 'auto', '1x1', '2x2', '3x3', '4x4', '5x5', '6x6'
        this.streamQuality = localStorage.getItem('dvr_stream_quality') || 'sub'; // 'sub' = Fluido, 'main' = HD
        this.serverUrl = localStorage.getItem('dvr_server_url') || '';

        this.gridRefreshTimer = null;
        this.chromeHideTimer = null;
        this.syncPollTimer = null;
        this.backPressTimer = null;
        this.qrCodeInstance = null;

        this.modalFocusableElements = [];
        this.modalFocusIndex = 0;
        this.isAdvancedOpen = false;

        this.init();
    }

    async init() {
        console.log('[App] Inicializando DVR TV Estilo Netflix...');
        this.startClock();
        this.setupDOM();
        this.setupRemote();
        this.updateBarLabels();
        this.wakeChrome();

        // Inicializar player de vídeo para a TV
        var container = document.getElementById('fullscreen-player-container');
        var PlayerClass = window.TvStreamPlayer || (typeof TvStreamPlayer !== 'undefined' ? TvStreamPlayer : null);
        if (PlayerClass && container) {
            this.player = new PlayerClass(container, this.dvr);
        }

        // Iniciar monitor de velocidade de banda (KB/s)
        var self = this;
        this.dvr.startBandwidthMonitor(function(formatted) {
            var bwEl = document.getElementById('bandwidth-label');
            if (bwEl) {
                bwEl.textContent = '• ' + formatted;
            }
        });

        // Detectar URL do servidor de sync / mobile
        await this.detectServerInfo();

        // Conectar ao DVR e carregar canais
        await this.connectDvr();

        // Iniciar polling de sincronização com o celular / controle remoto
        this.startSyncPolling();
    }

    /* ==========================================================================
       RELÓGIO E CABEÇALHO
       ========================================================================== */
    startClock() {
        function updateClock() {
            var now = new Date();
            var hours = String(now.getHours()).padStart(2, '0');
            var minutes = String(now.getMinutes()).padStart(2, '0');
            var seconds = String(now.getSeconds()).padStart(2, '0');
            var clockEl = document.getElementById('clock-time');
            if (clockEl) clockEl.textContent = hours + ':' + minutes + ':' + seconds;

            var day = String(now.getDate()).padStart(2, '0');
            var month = String(now.getMonth() + 1).padStart(2, '0');
            var year = now.getFullYear();
            var dateEl = document.getElementById('clock-date');
            if (dateEl) dateEl.textContent = day + '/' + month + '/' + year;
        }
        updateClock();
        setInterval(updateClock, 1000);
    }

    setConnectionStatus(status, text) {
        var dot = document.getElementById('status-dot');
        var label = document.getElementById('status-label');
        if (dot) dot.className = 'status-dot ' + status;
        if (label) label.textContent = text;
        this.syncStateToServer();
    }

    /* ==========================================================================
       AUTO-FADE DO CABEÇALHO E RODAPÉ ESTILO NETFLIX (TRANSLÚCIDO)
       ========================================================================== */
    wakeChrome() {
        var header = document.getElementById('app-header');
        var bottomBar = document.getElementById('bottom-menu-bar');

        // Em tela cheia dedicada, menus permanecem ocultos
        if (this.isFullScreen) {
            if (header) header.classList.remove('visible');
            if (bottomBar) bottomBar.classList.remove('visible');
            return;
        }

        if (header) header.classList.add('visible');
        if (bottomBar) bottomBar.classList.add('visible');

        if (this.chromeHideTimer) {
            clearTimeout(this.chromeHideTimer);
        }

        // Se o foco estiver no menu inferior ou se houver modal/drawer aberto, não esmaece
        if (this.currentFocusZone === 'bottom-bar' || this.isModalOpen || this.isDrawerOpen || this.isQrModalOpen || this.isHelpModalOpen) {
            return;
        }

        var self = this;
        this.chromeHideTimer = setTimeout(function() {
            if (self.currentFocusZone !== 'bottom-bar' && !self.isModalOpen && !self.isDrawerOpen && !self.isQrModalOpen && !self.isHelpModalOpen) {
                if (header) header.classList.remove('visible');
                if (bottomBar) bottomBar.classList.remove('visible');
            }
        }, 4000);
    }

    /* ==========================================================================
       DETECTAR SERVIDOR DE SINCRONIZAÇÃO / QR CODE
       ========================================================================== */
    async detectServerInfo() {
        var self = this;
        var defaultHost = (window.location && window.location.hostname && window.location.hostname !== '') 
            ? window.location.hostname 
            : '192.168.100.74';
        var defaultPort = (window.location && window.location.port && window.location.port !== '')
            ? window.location.port
            : '8080';

        var baseApi = 'http://' + defaultHost + ':' + defaultPort;
        if (this.serverUrl && this.serverUrl.indexOf(':') !== -1) {
            baseApi = (this.serverUrl.indexOf('http') === 0) ? this.serverUrl : ('http://' + this.serverUrl);
        }

        try {
            var res = await fetch(baseApi + '/api/info');
            if (res.ok) {
                var data = await res.json();
                if (data && data.mobileUrl) {
                    self.mobileWebUrl = data.mobileUrl;
                    self.detectedServerIp = data.serverIp;
                    self.detectedServerPort = data.port;
                    return;
                }
            }
        } catch (e) {
            // Silencioso em caso de servidor indisponível
        }

        self.mobileWebUrl = 'http://' + defaultHost + ':' + defaultPort + '/mobile';
        self.detectedServerIp = defaultHost;
        self.detectedServerPort = defaultPort;
    }

    updateBarLabels() {
        var qLabel = document.getElementById('bar-label-quality');
        if (qLabel) {
            qLabel.textContent = (this.streamQuality === 'main') ? 'HD 1080p' : 'Fluido';
        }

        var gLabel = document.getElementById('bar-label-grid');
        if (gLabel) {
            gLabel.textContent = 'Grade: ' + (this.gridMode === 'auto' ? 'Auto' : this.gridMode.toUpperCase());
        }

        var drawerFilterBadge = document.getElementById('drawer-filter-badge');
        var drawerFilterDesc = document.getElementById('drawer-filter-desc');
        if (drawerFilterBadge) {
            drawerFilterBadge.textContent = this.showOfflineCameras ? 'Sim' : 'Não';
        }
        if (drawerFilterDesc) {
            drawerFilterDesc.textContent = this.showOfflineCameras ? 'Mostrando todas as câmeras' : 'Ocultando câmeras sem vídeo';
        }

        var drawerGridBadge = document.getElementById('drawer-grid-badge');
        if (drawerGridBadge) {
            drawerGridBadge.textContent = (this.gridMode === 'auto' ? 'Auto' : this.gridMode.toUpperCase());
        }
    }

    /* ==========================================================================
       SETUP DE ELEMENTOS DOM E EVENTOS
       ========================================================================== */
    setupDOM() {
        var self = this;

        window.addEventListener('resize', function() {
            if (self.isFullScreen && self.player && self.player.resize) {
                self.player.resize();
            }
        });

        // Eventos do mouse / movimento acordam o cabeçalho e rodapé
        window.addEventListener('mousemove', function() {
            self.wakeChrome();
        });

        // Botões do Menu Inferior
        var btnBarMenu = document.getElementById('btn-bar-menu');
        if (btnBarMenu) btnBarMenu.addEventListener('click', function() { self.openDrawer(); });

        var btnBarSettings = document.getElementById('btn-bar-settings');
        if (btnBarSettings) btnBarSettings.addEventListener('click', function() { self.openSettingsModal(); });

        var btnBarGrid = document.getElementById('btn-bar-grid');
        if (btnBarGrid) btnBarGrid.addEventListener('click', function() { self.cycleGridMode(); });

        var btnBarQuality = document.getElementById('btn-bar-quality');
        if (btnBarQuality) btnBarQuality.addEventListener('click', function() { self.toggleStreamQuality(); });

        var btnBarMobile = document.getElementById('btn-bar-mobile');
        if (btnBarMobile) btnBarMobile.addEventListener('click', function() { self.openQrModal(); });

        var btnBarReconnect = document.getElementById('btn-bar-reconnect');
        if (btnBarReconnect) btnBarReconnect.addEventListener('click', function() { self.connectDvr(); });

        var btnBarHelp = document.getElementById('btn-bar-help');
        if (btnBarHelp) btnBarHelp.addEventListener('click', function() { self.openHelpModal(); });

        // Itens do Menu Netflix (Drawer)
        var drawerItemCameras = document.getElementById('drawer-item-cameras');
        if (drawerItemCameras) drawerItemCameras.addEventListener('click', function() { self.closeDrawer(); });

        var drawerItemSettings = document.getElementById('drawer-item-settings');
        if (drawerItemSettings) {
            drawerItemSettings.addEventListener('click', function() {
                self.closeDrawer();
                self.openSettingsModal();
            });
        }

        var drawerItemFilter = document.getElementById('drawer-item-filter');
        if (drawerItemFilter) drawerItemFilter.addEventListener('click', function() { self.toggleOfflineFilter(); });

        var drawerItemGrid = document.getElementById('drawer-item-grid');
        if (drawerItemGrid) drawerItemGrid.addEventListener('click', function() { self.cycleGridMode(); });

        var drawerItemMobile = document.getElementById('drawer-item-mobile');
        if (drawerItemMobile) {
            drawerItemMobile.addEventListener('click', function() {
                self.closeDrawer();
                self.openQrModal();
            });
        }

        var drawerItemHelp = document.getElementById('drawer-item-help');
        if (drawerItemHelp) {
            drawerItemHelp.addEventListener('click', function() {
                self.closeDrawer();
                self.openHelpModal();
            });
        }

        var drawerItemExit = document.getElementById('drawer-item-exit');
        if (drawerItemExit) drawerItemExit.addEventListener('click', function() { self.exitApp(); });

        var drawerBackdrop = document.getElementById('drawer-backdrop');
        if (drawerBackdrop) drawerBackdrop.addEventListener('click', function() { self.closeDrawer(); });

        // Modais (QR Code, Ajuda, Configurações)
        var btnCloseQr = document.getElementById('btn-close-qrcode');
        var btnDismissQr = document.getElementById('btn-dismiss-qrcode');
        var qrBackdrop = document.getElementById('qrcode-backdrop');
        if (btnCloseQr) btnCloseQr.addEventListener('click', function() { self.closeQrModal(); });
        if (btnDismissQr) btnDismissQr.addEventListener('click', function() { self.closeQrModal(); });
        if (qrBackdrop) qrBackdrop.addEventListener('click', function() { self.closeQrModal(); });

        var btnCloseHelp = document.getElementById('btn-close-help');
        var btnDismissHelp = document.getElementById('btn-dismiss-help');
        var helpBackdrop = document.getElementById('help-backdrop');
        if (btnCloseHelp) btnCloseHelp.addEventListener('click', function() { self.closeHelpModal(); });
        if (btnDismissHelp) btnDismissHelp.addEventListener('click', function() { self.closeHelpModal(); });
        if (helpBackdrop) helpBackdrop.addEventListener('click', function() { self.closeHelpModal(); });

        var btnCloseModal = document.getElementById('btn-close-modal');
        var btnCancelModal = document.getElementById('btn-cancel-settings');
        var settingsBackdrop = document.getElementById('settings-backdrop');
        if (btnCloseModal) btnCloseModal.addEventListener('click', function() { self.closeSettingsModal(); });
        if (btnCancelModal) btnCancelModal.addEventListener('click', function() { self.closeSettingsModal(); });
        if (settingsBackdrop) settingsBackdrop.addEventListener('click', function() { self.closeSettingsModal(); });

        var btnToggleAdv = document.getElementById('btn-toggle-advanced');
        if (btnToggleAdv) btnToggleAdv.addEventListener('click', function() { self.toggleAdvancedSection(); });

        var btnSave = document.getElementById('btn-save-settings');
        if (btnSave) btnSave.addEventListener('click', function() { self.saveSettings(); });

        var btnDefault = document.getElementById('btn-default-settings');
        if (btnDefault) btnDefault.addEventListener('click', function() { self.restoreDefaultSettings(); });
    }

    /* ==========================================================================
       CONEXÃO COM CONTROLE REMOTO
       ========================================================================== */
    setupRemote() {
        var self = this;
        var RemoteClass = window.RemoteControlManager || (typeof RemoteControlManager !== 'undefined' ? RemoteControlManager : null);
        if (RemoteClass) {
            this.remote = new RemoteClass({
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
    }

    /* ==========================================================================
       CÁLCULO E RENDERIZAÇÃO DA GRADE (ESTRITAMENTE QUADRADAS NxN)
       ========================================================================== */
    getVisibleChannels() {
        if (!this.channels || this.channels.length === 0) return [];
        if (!this.showOfflineCameras) {
            return this.channels.filter(function(ch) { return ch.isOnline; });
        }
        return this.channels;
    }

    /**
     * Calcula a menor grade quadrada NxN cuja capacidade seja >= visíveis
     * 1: 1x1 | 2-4: 2x2 | 5-9: 3x3 | 10-16: 4x4 | 17-25: 5x5 | 26-36: 6x6
     */
    calculateOptimalGrid(visibleCount) {
        if (visibleCount <= 1) return { layout: '1x1', cols: 1, capacity: 1 };
        if (visibleCount <= 4) return { layout: '2x2', cols: 2, capacity: 4 };
        if (visibleCount <= 9) return { layout: '3x3', cols: 3, capacity: 9 };
        if (visibleCount <= 16) return { layout: '4x4', cols: 4, capacity: 16 };
        if (visibleCount <= 25) return { layout: '5x5', cols: 5, capacity: 25 };
        return { layout: '6x6', cols: 6, capacity: 36 };
    }

    renderGrid() {
        var self = this;
        var grid = document.getElementById('camera-grid');
        if (!grid) return;

        var visibleChannels = this.getVisibleChannels();
        var gridSpec;

        // Permite somente grades estritamente quadradas
        var validSquareGrids = ['1x1', '2x2', '3x3', '4x4', '5x5', '6x6'];
        if (this.gridMode === 'auto' || validSquareGrids.indexOf(this.gridMode) === -1) {
            gridSpec = this.calculateOptimalGrid(visibleChannels.length);
        } else {
            var cols = parseInt(this.gridMode.charAt(0), 10);
            gridSpec = { layout: this.gridMode, cols: cols, capacity: cols * cols };
        }

        this.currentLayout = gridSpec.layout;
        this.currentGridCols = gridSpec.cols;
        this.currentGridCapacity = gridSpec.capacity;

        grid.className = 'camera-grid layout-' + this.currentLayout;
        grid.innerHTML = '';

        if (visibleChannels.length === 0) {
            grid.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:22px;grid-column:1/-1;">Nenhuma câmera ativa encontrada.</div>';
            return;
        }

        if (this.focusedIndex >= visibleChannels.length) {
            this.focusedIndex = 0;
        }

        // Renderiza canais visíveis
        visibleChannels.forEach(function(channel, index) {
            var card = document.createElement('div');
            var isFocused = (self.currentFocusZone === 'grid' && index === self.focusedIndex);
            var isOffline = !channel.isOnline;

            card.className = 'camera-card' + (isFocused ? ' focused' : '') + (isOffline ? ' offline-card' : '');
            card.dataset.channelId = channel.id;
            card.dataset.index = index;
            card.tabIndex = 0;

            var statusClass = channel.isOnline ? 'online' : 'offline';
            var statusText = channel.isOnline ? 'AO VIVO' : 'SEM SINAL';
            var resBadge = channel.resDesc || (channel.isOnline ? '1080P' : 'OFF');

            if (channel.isOnline) {
                var initialSrc = self.dvr.getSnapshotUrl(channel.id, 2);
                card.innerHTML = 
                    '<div class="card-video-wrap">' +
                        '<img class="camera-img" src="' + initialSrc + '" alt="' + channel.name + '" loading="lazy" />' +
                        '<div class="camera-overlay-top">' +
                            '<span class="cam-badge-id">CH ' + channel.id + '</span>' +
                            '<span class="cam-name">' + channel.name + '</span>' +
                        '</div>' +
                        '<div class="camera-overlay-bottom">' +
                            '<span class="cam-status ' + statusClass + '">' + statusText + '</span>' +
                            '<span class="cam-res">' + resBadge + '</span>' +
                        '</div>' +
                    '</div>';
            } else {
                card.innerHTML = 
                    '<div class="card-video-wrap" style="background:#000;">' +
                        '<div class="camera-overlay-top">' +
                            '<span class="cam-badge-id">CH ' + channel.id + '</span>' +
                            '<span class="cam-name">' + channel.name + '</span>' +
                        '</div>' +
                        '<div class="camera-overlay-bottom">' +
                            '<span class="cam-status ' + statusClass + '">' + statusText + '</span>' +
                            '<span class="cam-res">' + resBadge + '</span>' +
                        '</div>' +
                    '</div>';
            }

            card.addEventListener('click', function() {
                self.currentFocusZone = 'grid';
                self.focusedIndex = index;
                self.updateCardFocus();
                self.openFullScreen(channel);
            });

            grid.appendChild(card);
        });

        // Preenche slots vazios restantes com fundo estritamente preto
        var emptyCount = gridSpec.capacity - visibleChannels.length;
        for (var k = 0; k < emptyCount; k++) {
            var emptySlot = document.createElement('div');
            emptySlot.className = 'camera-card empty-slot';
            grid.appendChild(emptySlot);
        }

        this.updateCardFocus();
        this.updateBarLabels();
        this.syncStateToServer();
    }

    updateCardFocus() {
        var cards = document.querySelectorAll('.camera-card:not(.empty-slot)');
        for (var i = 0; i < cards.length; i++) {
            if (this.currentFocusZone === 'grid' && i === this.focusedIndex) {
                cards[i].classList.add('focused');
            } else {
                cards[i].classList.remove('focused');
            }
        }
    }

    startGridRefresh() {
        var self = this;
        if (this.gridRefreshTimer) clearInterval(this.gridRefreshTimer);

        this.gridRefreshTimer = setInterval(function() {
            if (self.isFullScreen || self.isModalOpen || self.isDrawerOpen || self.isQrModalOpen || self.isHelpModalOpen) return;

            var cards = document.querySelectorAll('.camera-card:not(.offline-card):not(.empty-slot)');
            cards.forEach(function(card) {
                var chId = card.dataset.channelId;
                var img = card.querySelector('.camera-img');
                if (img && chId) {
                    var newImg = new Image();
                    var nextUrl = self.dvr.getSnapshotUrl(chId, 2);
                    newImg.onload = function() {
                        img.src = nextUrl;
                        if (self.dvr && self.dvr.recordBytes) {
                            self.dvr.recordBytes(22000); // ~22KB por quadro de sub-stream
                        }
                    };
                    newImg.src = nextUrl;
                }
            });
        }, 1200);
    }

    /* ==========================================================================
       CONEXÃO COM O DVR
       ========================================================================== */
    async connectDvr() {
        this.setConnectionStatus('connecting', 'Conectando...');
        try {
            await this.dvr.login();
            this.setConnectionStatus('online', 'Conectado');

            try {
                var deviceInfo = await this.dvr.getDeviceInfo();
                if (deviceInfo) {
                    var titleEl = document.getElementById('dvr-title');
                    if (titleEl) {
                        titleEl.textContent = deviceInfo.deviceName + ' • ' + deviceInfo.model;
                    }
                }
            } catch (errDev) {
                console.warn('[DVR] deviceInfo omitido:', errDev);
            }

            var channels = await this.dvr.getChannels();
            this.channels = channels;
            this.renderGrid();
            this.startGridRefresh();
            this.showToast('DVR conectado: ' + channels.length + ' canais identificados');
        } catch (e) {
            console.error('[App] Erro na conexão com o DVR:', e);
            this.setConnectionStatus('offline', 'Falha na Conexão');
            this.showToast('Erro ao conectar ao DVR: ' + e.message, 5000);
        }
    }

    /* ==========================================================================
       MENU NETFLIX (DRAWER LATERAL)
       ========================================================================== */
    openDrawer() {
        if (this.isFullScreen) return;
        this.isDrawerOpen = true;
        this.currentFocusZone = 'drawer';
        this.drawerFocusIndex = 0;

        var wrap = document.getElementById('netflix-drawer-wrap');
        if (wrap) wrap.style.display = 'flex';

        this.updateBarLabels();
        this.updateDrawerFocus();
        this.syncStateToServer();
    }

    closeDrawer() {
        this.isDrawerOpen = false;
        var wrap = document.getElementById('netflix-drawer-wrap');
        if (wrap) wrap.style.display = 'none';

        this.currentFocusZone = 'grid';
        this.updateCardFocus();
        this.wakeChrome();
        this.syncStateToServer();
    }

    getDrawerItems() {
        return [
            document.getElementById('drawer-item-cameras'),
            document.getElementById('drawer-item-settings'),
            document.getElementById('drawer-item-filter'),
            document.getElementById('drawer-item-grid'),
            document.getElementById('drawer-item-mobile'),
            document.getElementById('drawer-item-help'),
            document.getElementById('drawer-item-exit')
        ].filter(function(el) { return el !== null; });
    }

    updateDrawerFocus() {
        var items = this.getDrawerItems();
        for (var i = 0; i < items.length; i++) {
            if (i === this.drawerFocusIndex) {
                items[i].classList.add('focused');
                items[i].focus();
            } else {
                items[i].classList.remove('focused');
            }
        }
    }

    toggleOfflineFilter() {
        this.showOfflineCameras = !this.showOfflineCameras;
        localStorage.setItem('dvr_show_offline', this.showOfflineCameras ? 'true' : 'false');
        this.renderGrid();
        this.updateBarLabels();
        this.showToast(this.showOfflineCameras ? 'Mostrando todas as câmeras' : 'Ocultando câmeras sem sinal');
    }

    cycleGridMode() {
        var squareModes = ['auto', '1x1', '2x2', '3x3', '4x4', '5x5', '6x6'];
        var idx = squareModes.indexOf(this.gridMode);
        var nextIdx = (idx + 1) % squareModes.length;
        this.gridMode = squareModes[nextIdx];
        localStorage.setItem('dvr_grid_mode', this.gridMode);
        this.renderGrid();
        this.updateBarLabels();
        this.showToast('Grade: ' + (this.gridMode === 'auto' ? 'Automática' : this.gridMode.toUpperCase()));
    }

    toggleStreamQuality() {
        this.streamQuality = (this.streamQuality === 'sub') ? 'main' : 'sub';
        localStorage.setItem('dvr_stream_quality', this.streamQuality);
        this.updateBarLabels();

        if (this.isFullScreen && this.fullScreenChannel) {
            this.openFullScreen(this.fullScreenChannel);
        }

        this.showToast('Qualidade: ' + (this.streamQuality === 'main' ? 'HD 1080p' : 'Fluido (Sub-Stream)'));
        this.syncStateToServer();
    }

    /* ==========================================================================
       MODAL QR CODE
       ========================================================================== */
    openQrModal() {
        this.isQrModalOpen = true;
        this.currentFocusZone = 'qrcode';

        var modal = document.getElementById('qrcode-modal');
        if (modal) modal.style.display = 'flex';

        var targetUrl = this.mobileWebUrl || ('http://' + (this.detectedServerIp || '192.168.100.74') + ':8080/mobile');
        var addrEl = document.getElementById('qr-address-url');
        if (addrEl) addrEl.textContent = targetUrl;

        var qrContainer = document.getElementById('qrcode-container');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            try {
                if (typeof QRCode !== 'undefined') {
                    this.qrCodeInstance = new QRCode(qrContainer, {
                        text: targetUrl,
                        width: 200,
                        height: 200,
                        colorDark: '#000000',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.M
                    });
                } else {
                    qrContainer.innerHTML = '<div style="color:#000;font-weight:700;padding:20px;">' + targetUrl + '</div>';
                }
            } catch (errQr) {
                qrContainer.innerHTML = '<div style="color:#000;font-weight:700;padding:20px;">' + targetUrl + '</div>';
            }
        }

        var btn = document.getElementById('btn-dismiss-qrcode');
        if (btn) btn.focus();
    }

    closeQrModal() {
        this.isQrModalOpen = false;
        var modal = document.getElementById('qrcode-modal');
        if (modal) modal.style.display = 'none';

        this.currentFocusZone = 'grid';
        this.updateCardFocus();
        this.wakeChrome();
    }

    /* ==========================================================================
       MODAL AJUDA
       ========================================================================== */
    openHelpModal() {
        this.isHelpModalOpen = true;
        this.currentFocusZone = 'help';

        var modal = document.getElementById('help-modal');
        if (modal) modal.style.display = 'flex';

        var btn = document.getElementById('btn-dismiss-help');
        if (btn) btn.focus();
    }

    closeHelpModal() {
        this.isHelpModalOpen = false;
        var modal = document.getElementById('help-modal');
        if (modal) modal.style.display = 'none';

        this.currentFocusZone = 'grid';
        this.updateCardFocus();
        this.wakeChrome();
    }

    /* ==========================================================================
       MODAL CONFIGURAÇÕES
       ========================================================================== */
    openSettingsModal() {
        this.isModalOpen = true;
        this.currentFocusZone = 'modal';

        var modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'flex';

        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var showOfflineSelect = document.getElementById('cfg-show-offline');
        var gridModeSelect = document.getElementById('cfg-grid-mode');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');
        var serverUrlInput = document.getElementById('cfg-server-url');

        if (ipInput) ipInput.value = localStorage.getItem('dvr_ip') || this.dvr.ip || '192.168.100.2';
        if (userInput) userInput.value = localStorage.getItem('dvr_user') || this.dvr.username || 'admin';
        if (pwdInput) {
            pwdInput.value = '';
            pwdInput.placeholder = '•••••••• (Salva internamente)';
        }
        if (showOfflineSelect) showOfflineSelect.value = this.showOfflineCameras ? 'true' : 'false';
        if (gridModeSelect) gridModeSelect.value = this.gridMode;
        if (httpPortInput) httpPortInput.value = localStorage.getItem('dvr_http_port') || this.dvr.httpPort || 80;
        if (rtspPortInput) rtspPortInput.value = localStorage.getItem('dvr_rtsp_port') || this.dvr.rtspPort || 554;
        if (serverUrlInput) serverUrlInput.value = this.serverUrl || (this.detectedServerIp ? (this.detectedServerIp + ':8080') : '192.168.100.74:8080');

        this.refreshModalFocusList();
        this.modalFocusIndex = 0;
        this.updateModalFocus();
    }

    closeSettingsModal() {
        this.isModalOpen = false;
        var modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'none';

        this.currentFocusZone = 'grid';
        this.updateCardFocus();
        this.wakeChrome();
    }

    toggleAdvancedSection() {
        var advFields = document.getElementById('advanced-fields');
        var advArrow = document.getElementById('advanced-arrow');
        if (!advFields) return;

        this.isAdvancedOpen = !this.isAdvancedOpen;
        advFields.style.display = this.isAdvancedOpen ? 'block' : 'none';
        if (advArrow) {
            advArrow.className = 'advanced-arrow' + (this.isAdvancedOpen ? ' open' : '');
        }
        this.refreshModalFocusList();
    }

    refreshModalFocusList() {
        var elements = [
            document.getElementById('cfg-ip'),
            document.getElementById('cfg-user'),
            document.getElementById('cfg-pwd'),
            document.getElementById('cfg-show-offline'),
            document.getElementById('cfg-grid-mode'),
            document.getElementById('btn-toggle-advanced')
        ];

        if (this.isAdvancedOpen) {
            elements.push(document.getElementById('cfg-http-port'));
            elements.push(document.getElementById('cfg-rtsp-port'));
            elements.push(document.getElementById('cfg-server-url'));
        }

        elements.push(document.getElementById('btn-save-settings'));
        elements.push(document.getElementById('btn-default-settings'));
        elements.push(document.getElementById('btn-cancel-settings'));

        this.modalFocusableElements = elements.filter(function(el) { return el !== null; });
    }

    updateModalFocus() {
        if (!this.modalFocusableElements || this.modalFocusableElements.length === 0) return;
        for (var i = 0; i < this.modalFocusableElements.length; i++) {
            var el = this.modalFocusableElements[i];
            if (i === this.modalFocusIndex) {
                el.classList.add('focused');
                el.focus();
            } else {
                el.classList.remove('focused');
            }
        }
    }

    saveSettings() {
        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var showOfflineSelect = document.getElementById('cfg-show-offline');
        var gridModeSelect = document.getElementById('cfg-grid-mode');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');
        var serverUrlInput = document.getElementById('cfg-server-url');

        var newIp = ipInput ? ipInput.value.trim() : '';
        var newUser = userInput ? userInput.value.trim() : '';
        var newPwd = pwdInput ? pwdInput.value : '';

        if (!newIp || !newUser) {
            this.showToast('IP e Usuário são obrigatórios!');
            return;
        }

        localStorage.setItem('dvr_ip', newIp);
        localStorage.setItem('dvr_user', newUser);

        if (newPwd && newPwd.length > 0) {
            localStorage.setItem('dvr_pass', newPwd);
            this.dvr.password = newPwd;
        }

        if (showOfflineSelect) {
            this.showOfflineCameras = (showOfflineSelect.value === 'true');
            localStorage.setItem('dvr_show_offline', this.showOfflineCameras ? 'true' : 'false');
        }

        if (gridModeSelect) {
            this.gridMode = gridModeSelect.value;
            localStorage.setItem('dvr_grid_mode', this.gridMode);
        }

        if (httpPortInput) {
            var httpPort = parseInt(httpPortInput.value, 10) || 80;
            localStorage.setItem('dvr_http_port', httpPort);
            this.dvr.httpPort = httpPort;
        }

        if (rtspPortInput) {
            var rtspPort = parseInt(rtspPortInput.value, 10) || 554;
            localStorage.setItem('dvr_rtsp_port', rtspPort);
            this.dvr.rtspPort = rtspPort;
        }

        if (serverUrlInput) {
            this.serverUrl = serverUrlInput.value.trim();
            localStorage.setItem('dvr_server_url', this.serverUrl);
        }

        this.dvr.ip = newIp;
        this.dvr.username = newUser;

        this.closeSettingsModal();
        this.renderGrid();
        this.connectDvr();
        this.showToast('Configurações salvas! Reconectando...');
    }

    restoreDefaultSettings() {
        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var showOfflineSelect = document.getElementById('cfg-show-offline');
        var gridModeSelect = document.getElementById('cfg-grid-mode');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');

        if (ipInput) ipInput.value = '192.168.100.2';
        if (userInput) userInput.value = 'admin';
        if (pwdInput) {
            pwdInput.value = 'jr130182';
            pwdInput.placeholder = '••••••••';
        }
        if (showOfflineSelect) showOfflineSelect.value = 'true';
        if (gridModeSelect) gridModeSelect.value = 'auto';
        if (httpPortInput) httpPortInput.value = '80';
        if (rtspPortInput) rtspPortInput.value = '554';

        this.showToast('Padrões restaurados na tela. Salve para aplicar.');
    }

    /* ==========================================================================
       TELA CHEIA DEDICADA / CÂMERA ÚNICA
       ========================================================================== */
    openFullScreen(channel) {
        if (!channel) return;
        this.isFullScreen = true;
        this.fullScreenChannel = channel;
        this.currentFocusZone = 'fullscreen';

        var fsView = document.getElementById('fullscreen-view');
        var appHeader = document.getElementById('app-header');
        var bottomBar = document.getElementById('bottom-menu-bar');

        if (fsView) fsView.style.display = 'flex';
        if (appHeader) appHeader.classList.remove('visible');
        if (bottomBar) bottomBar.classList.remove('visible');

        var toastBadge = document.getElementById('fs-toast-badge');
        var badgeTitle = document.getElementById('fs-badge-title');
        var badgeQuality = document.getElementById('fs-badge-quality');

        if (badgeTitle) badgeTitle.textContent = channel.name + ' (CH ' + channel.id + ')';
        if (badgeQuality) {
            if (this.streamQuality === 'main') {
                badgeQuality.className = 'fs-tag-hd';
                badgeQuality.textContent = '● HD 1080p';
            } else {
                badgeQuality.className = 'fs-tag-fluido';
                badgeQuality.textContent = '● Fluido';
            }
        }

        if (toastBadge) {
            toastBadge.classList.add('show');
            if (this.fsToastTimer) clearTimeout(this.fsToastTimer);
            this.fsToastTimer = setTimeout(function() {
                toastBadge.classList.remove('show');
            }, 2500);
        }

        var streamType = (this.streamQuality === 'main') ? 1 : 2;
        if (this.player) {
            this.player.play(channel.id, streamType);
        }

        this.syncStateToServer();
    }

    closeFullScreen() {
        if (!this.isFullScreen) return;
        this.isFullScreen = false;
        this.fullScreenChannel = null;

        var fsView = document.getElementById('fullscreen-view');
        if (fsView) fsView.style.display = 'none';

        if (this.player) {
            this.player.stop();
        }

        this.currentFocusZone = 'grid';
        this.updateCardFocus();
        this.wakeChrome();
        this.syncStateToServer();
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

    /* ==========================================================================
       GESTÃO DE FOCO E NAVEGAÇÃO 100% VIA SETAS E OK
       ========================================================================== */
    handleNavigation(direction) {
        this.wakeChrome();

        // 1. Modal de Configurações
        if (this.currentFocusZone === 'modal' && this.isModalOpen) {
            var len = this.modalFocusableElements.length;
            if (len === 0) return;

            if (direction === 'up') {
                this.modalFocusIndex = (this.modalFocusIndex - 1 + len) % len;
                this.updateModalFocus();
            } else if (direction === 'down') {
                this.modalFocusIndex = (this.modalFocusIndex + 1) % len;
                this.updateModalFocus();
            }
            return;
        }

        // 2. Menu Netflix (Drawer)
        if (this.currentFocusZone === 'drawer' && this.isDrawerOpen) {
            var items = this.getDrawerItems();
            var dLen = items.length;
            if (dLen === 0) return;

            if (direction === 'up') {
                this.drawerFocusIndex = (this.drawerFocusIndex - 1 + dLen) % dLen;
                this.updateDrawerFocus();
            } else if (direction === 'down') {
                this.drawerFocusIndex = (this.drawerFocusIndex + 1) % dLen;
                this.updateDrawerFocus();
            } else if (direction === 'right') {
                this.closeDrawer();
            }
            return;
        }

        // 3. Em Tela Cheia
        if (this.currentFocusZone === 'fullscreen' && this.isFullScreen) {
            if (direction === 'up' || direction === 'right') {
                this.nextCamera();
            } else if (direction === 'down' || direction === 'left') {
                this.prevCamera();
            }
            return;
        }

        // 4. Menu Inferior
        if (this.currentFocusZone === 'bottom-bar') {
            var barButtons = [
                document.getElementById('btn-bar-menu'),
                document.getElementById('btn-bar-settings'),
                document.getElementById('btn-bar-grid'),
                document.getElementById('btn-bar-quality'),
                document.getElementById('btn-bar-mobile'),
                document.getElementById('btn-bar-reconnect'),
                document.getElementById('btn-bar-help')
            ].filter(function(el) { return el !== null; });

            if (direction === 'up') {
                this.currentFocusZone = 'grid';
                this.updateBottomBarFocus(barButtons, -1);
                this.updateCardFocus();
                return;
            } else if (direction === 'left') {
                this.bottomBarFocusIndex = (this.bottomBarFocusIndex - 1 + barButtons.length) % barButtons.length;
                this.updateBottomBarFocus(barButtons, this.bottomBarFocusIndex);
                return;
            } else if (direction === 'right') {
                this.bottomBarFocusIndex = (this.bottomBarFocusIndex + 1) % barButtons.length;
                this.updateBottomBarFocus(barButtons, this.bottomBarFocusIndex);
                return;
            }
            return;
        }

        // 5. Grade de Câmeras
        if (this.currentFocusZone === 'grid') {
            var visibleChannels = this.getVisibleChannels();
            if (visibleChannels.length === 0) return;

            var cols = this.currentGridCols || 4;
            var total = visibleChannels.length;

            switch (direction) {
                case 'up':
                    if (this.focusedIndex - cols >= 0) {
                        this.focusedIndex -= cols;
                    }
                    break;

                case 'down':
                    if (this.focusedIndex + cols < total) {
                        this.focusedIndex += cols;
                    } else {
                        // Descer da última fileira passa o foco para a barra inferior
                        this.currentFocusZone = 'bottom-bar';
                        this.bottomBarFocusIndex = 0;
                        var barBtns = [
                            document.getElementById('btn-bar-menu'),
                            document.getElementById('btn-bar-settings'),
                            document.getElementById('btn-bar-grid'),
                            document.getElementById('btn-bar-quality'),
                            document.getElementById('btn-bar-mobile'),
                            document.getElementById('btn-bar-reconnect'),
                            document.getElementById('btn-bar-help')
                        ].filter(function(el) { return el !== null; });
                        this.updateBottomBarFocus(barBtns, 0);
                        this.updateCardFocus();
                        return;
                    }
                    break;

                case 'left':
                    if (this.focusedIndex > 0) {
                        this.focusedIndex--;
                    }
                    break;

                case 'right':
                    if (this.focusedIndex < total - 1) {
                        this.focusedIndex++;
                    }
                    break;
            }

            this.updateCardFocus();
        }
    }

    updateBottomBarFocus(buttons, activeIndex) {
        for (var i = 0; i < buttons.length; i++) {
            if (i === activeIndex) {
                buttons[i].classList.add('focused');
                buttons[i].focus();
            } else {
                buttons[i].classList.remove('focused');
            }
        }
    }

    /* ==========================================================================
       ENTER / OK
       ========================================================================== */
    handleEnter() {
        this.wakeChrome();

        if (this.currentFocusZone === 'modal' && this.isModalOpen) {
            var el = this.modalFocusableElements[this.modalFocusIndex];
            if (el) {
                if (el.tagName === 'BUTTON') {
                    el.click();
                } else if (el.tagName === 'SELECT') {
                    if (el.selectedIndex < el.options.length - 1) {
                        el.selectedIndex++;
                    } else {
                        el.selectedIndex = 0;
                    }
                } else if (el.tagName === 'INPUT') {
                    el.focus();
                }
            }
            return;
        }

        if (this.currentFocusZone === 'drawer' && this.isDrawerOpen) {
            var items = this.getDrawerItems();
            var item = items[this.drawerFocusIndex];
            if (item) item.click();
            return;
        }

        if (this.isQrModalOpen) {
            this.closeQrModal();
            return;
        }
        if (this.isHelpModalOpen) {
            this.closeHelpModal();
            return;
        }

        if (this.currentFocusZone === 'bottom-bar') {
            var barBtns = [
                document.getElementById('btn-bar-menu'),
                document.getElementById('btn-bar-settings'),
                document.getElementById('btn-bar-grid'),
                document.getElementById('btn-bar-quality'),
                document.getElementById('btn-bar-mobile'),
                document.getElementById('btn-bar-reconnect'),
                document.getElementById('btn-bar-help')
            ].filter(function(b) { return b !== null; });

            if (barBtns[this.bottomBarFocusIndex]) {
                barBtns[this.bottomBarFocusIndex].click();
            }
            return;
        }

        if (this.isFullScreen) {
            this.toggleStreamQuality();
            return;
        }

        var visibleChannels = this.getVisibleChannels();
        if (visibleChannels.length > 0 && this.focusedIndex < visibleChannels.length) {
            this.openFullScreen(visibleChannels[this.focusedIndex]);
        }
    }

    /* ==========================================================================
       BOTÃO VOLTAR: 1 CLIQUE ABRE MENU LATERAL | 2 CLIQUES SAI DO APP
       ========================================================================== */
    handleBack() {
        var self = this;

        if (this.isFullScreen) {
            this.closeFullScreen();
            return;
        }

        if (this.isModalOpen) {
            this.closeSettingsModal();
            return;
        }

        if (this.isQrModalOpen) {
            this.closeQrModal();
            return;
        }

        if (this.isHelpModalOpen) {
            this.closeHelpModal();
            return;
        }

        // Se o drawer já estiver aberto, fecha
        if (this.isDrawerOpen) {
            // Se clicar de novo enquanto o drawer está aberto, confirma saída
            if (this.backPressTimer) {
                clearTimeout(this.backPressTimer);
                this.backPressTimer = null;
                this.exitApp();
                return;
            }
            this.closeDrawer();
            return;
        }

        // Na grade principal:
        if (this.backPressTimer) {
            // Segundo clique dentro da janela de 1.5s -> SAI DO APP
            clearTimeout(this.backPressTimer);
            this.backPressTimer = null;
            this.exitApp();
            return;
        }

        // Primeiro clique: abre menu lateral e arma o timer de 1.5s
        this.openDrawer();
        this.showToast('Pressione VOLTAR novamente para sair do aplicativo', 1500);
        this.backPressTimer = setTimeout(function() {
            self.backPressTimer = null;
        }, 1500);
    }

    /* ==========================================================================
       ATALHOS OPCIONAIS DO CONTROLE REMOTO
       ========================================================================== */
    handleRed() {
        if (this.isModalOpen || this.isDrawerOpen || this.isQrModalOpen || this.isHelpModalOpen) return;
        this.connectDvr();
    }

    handleGreen() {
        if (this.isModalOpen || this.isDrawerOpen || this.isQrModalOpen || this.isHelpModalOpen) return;
        this.cycleGridMode();
    }

    handleYellow() {
        if (this.isModalOpen || this.isDrawerOpen || this.isQrModalOpen || this.isHelpModalOpen) return;
        this.toggleStreamQuality();
    }

    handleBlue() {
        if (this.isModalOpen) {
            this.closeSettingsModal();
            return;
        }
        if (this.isDrawerOpen) {
            this.closeDrawer();
        }
        this.openSettingsModal();
    }

    handleNumber(num) {
        if (this.isModalOpen || this.isDrawerOpen || this.isQrModalOpen || this.isHelpModalOpen) return;
        if (num === 0) num = 10;

        var visibleChannels = this.getVisibleChannels();
        for (var i = 0; i < visibleChannels.length; i++) {
            if (visibleChannels[i].id === num) {
                this.focusedIndex = i;
                this.updateCardFocus();
                this.openFullScreen(visibleChannels[i]);
                return;
            }
        }
        this.showToast('Câmera CH ' + num + ' não encontrada ou offline');
    }

    exitApp() {
        console.log('[App] Encerrando aplicativo DVR TV...');
        if (typeof window.tizen !== 'undefined' && typeof window.tizen.application !== 'undefined') {
            try {
                window.tizen.application.getCurrentApplication().exit();
            } catch (e) {
                window.close();
            }
        } else {
            window.close();
        }
    }

    /* ==========================================================================
       SINCRONIZAÇÃO COM O CONTROLE MOBILE
       ========================================================================== */
    syncStateToServer() {
        var baseApi = (this.serverUrl && this.serverUrl.indexOf(':') !== -1)
            ? ((this.serverUrl.indexOf('http') === 0) ? this.serverUrl : ('http://' + this.serverUrl))
            : ((window.location && window.location.origin && window.location.origin !== 'null' && window.location.origin.indexOf('http') === 0) 
                ? window.location.origin 
                : 'http://192.168.100.74:8080');

        var visibleChannels = this.getVisibleChannels();
        var selectedCh = (this.isFullScreen && this.fullScreenChannel) 
            ? this.fullScreenChannel 
            : (visibleChannels[this.focusedIndex] || null);

        var statePayload = {
            connected: (this.channels && this.channels.length > 0),
            dvrStatus: this.dvr ? (this.dvr.isAuthenticated ? 'online' : 'connecting') : 'offline',
            currentView: this.isFullScreen ? 'fullscreen' : 'grid',
            selectedChannelId: selectedCh ? selectedCh.id : 1,
            selectedCameraName: selectedCh ? selectedCh.name : 'Camera 01',
            quality: this.streamQuality,
            gridMode: this.gridMode,
            showOffline: this.showOfflineCameras,
            bandwidth: this.dvr ? (this.dvr.bandwidthFormatted || '0 KB/s') : '0 KB/s',
            channels: (this.channels || []).map(function(c) {
                return { id: c.id, name: c.name, isOnline: c.isOnline };
            })
        };

        fetch(baseApi + '/api/remote/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(statePayload)
        }).catch(function() {});
    }

    startSyncPolling() {
        var self = this;
        if (this.syncPollTimer) clearInterval(this.syncPollTimer);

        this.syncPollTimer = setInterval(async function() {
            var baseApi = (self.serverUrl && self.serverUrl.indexOf(':') !== -1)
                ? ((self.serverUrl.indexOf('http') === 0) ? self.serverUrl : ('http://' + self.serverUrl))
                : ((window.location && window.location.origin && window.location.origin !== 'null' && window.location.origin.indexOf('http') === 0) 
                    ? window.location.origin 
                    : 'http://192.168.100.74:8080');

            try {
                var res = await fetch(baseApi + '/api/remote/poll');
                if (res.ok) {
                    var data = await res.json();
                    if (data && data.commands && data.commands.length > 0) {
                        data.commands.forEach(function(cmdObj) {
                            self.executeRemoteCommand(cmdObj);
                        });
                    }
                }
            } catch (e) {}
        }, 500);
    }

    executeRemoteCommand(cmdObj) {
        var cmd = cmdObj.command;
        var chId = cmdObj.channelId;
        var val = cmdObj.value;

        console.log('[Remote Sync] Comando recebido:', cmd, chId, val);

        switch (cmd) {
            case 'select_camera':
                if (chId) {
                    var vChs = this.getVisibleChannels();
                    for (var i = 0; i < vChs.length; i++) {
                        if (vChs[i].id === chId) {
                            this.focusedIndex = i;
                            this.updateCardFocus();
                            break;
                        }
                    }
                }
                break;

            case 'open_fullscreen':
                if (chId) {
                    var targetCh = null;
                    for (var j = 0; j < this.channels.length; j++) {
                        if (this.channels[j].id === chId) {
                            targetCh = this.channels[j];
                            break;
                        }
                    }
                    if (targetCh) this.openFullScreen(targetCh);
                } else if (this.channels && this.channels[this.focusedIndex]) {
                    this.openFullScreen(this.channels[this.focusedIndex]);
                }
                break;

            case 'close_fullscreen':
                this.closeFullScreen();
                break;

            case 'next_camera':
                this.nextCamera();
                break;

            case 'prev_camera':
                this.prevCamera();
                break;

            case 'toggle_quality':
                this.toggleStreamQuality();
                break;

            case 'set_quality':
                if (val && (val === 'main' || val === 'sub')) {
                    this.streamQuality = val;
                    localStorage.setItem('dvr_stream_quality', this.streamQuality);
                    this.updateBarLabels();
                    if (this.isFullScreen && this.fullScreenChannel) {
                        this.openFullScreen(this.fullScreenChannel);
                    }
                }
                break;

            case 'set_grid':
                if (val) {
                    this.gridMode = val;
                    localStorage.setItem('dvr_grid_mode', this.gridMode);
                    this.renderGrid();
                    this.updateBarLabels();
                }
                break;

            case 'toggle_offline':
                this.toggleOfflineFilter();
                break;

            case 'reconnect':
                this.connectDvr();
                break;

            case 'open_settings':
                this.openSettingsModal();
                break;

            case 'close_settings':
                this.closeSettingsModal();
                break;

            case 'open_drawer':
                this.openDrawer();
                break;

            case 'close_drawer':
                this.closeDrawer();
                break;

            case 'dpad_up':
                this.handleNavigation('up');
                break;
            case 'dpad_down':
                this.handleNavigation('down');
                break;
            case 'dpad_left':
                this.handleNavigation('left');
                break;
            case 'dpad_right':
                this.handleNavigation('right');
                break;
            case 'dpad_ok':
                this.handleEnter();
                break;
            case 'dpad_back':
                this.handleBack();
                break;
        }

        this.syncStateToServer();
    }

    showToast(msg, duration) {
        duration = duration || 3000;
        var toast = document.getElementById('toast-notification');
        if (!toast) return;

        toast.textContent = msg;
        toast.className = 'toast-notification show';

        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(function() {
            toast.className = 'toast-notification';
        }, duration);
    }
}

window.addEventListener('DOMContentLoaded', function() {
    window.app = new DvrTvApp();
});

/**
 * Aplicação Principal DVR TV para Samsung Smart TV e PC
 * Padrão: Grade 4x4 com 16 câmeras simultâneas na tela
 * Suporte a Modal de Configurações Seguro (Senha protegida e salva internamente)
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
        this.activeChannelsOnly = (localStorage.getItem('dvr_filter_active') === 'true');
        this.currentLayout = localStorage.getItem('dvr_layout') || '4x4';

        this.focusedIndex = 0;
        this.isFullScreen = false;
        this.fullScreenChannel = null;
        this.streamQuality = 2; // 2 = Sub-stream Fluido (padrão 15-25 FPS), 1 = HD (1080P)
        this.currentFocusZone = 'grid'; // 'grid' ou 'header'

        // Estado do Modal de Configurações
        this.isModalOpen = false;
        this.isAdvancedOpen = false;
        this._restoreDefaultPwdRequested = false;
        this.modalFocusIndex = 0;
        this.modalFocusableElements = [];

        this.gridRefreshTimer = null;
        this.player = null;
        this.remote = null;

        this.init();
    }

    async init() {
        console.log('[App] Inicializando DVR TV App (Modo Grade 4x4)...');
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
            if (self.isFullScreen) {
                self.adjustFullScreenDimensions();
            }
            if (self.player) self.player.resize();
        });

        // Botão de abrir configurações no cabeçalho
        var btnSettings = document.getElementById('btn-settings');
        if (btnSettings) {
            btnSettings.addEventListener('click', function() {
                self.currentFocusZone = 'header';
                self.openSettingsModal();
            });
        }

        // Botões do Modal
        var btnClose = document.getElementById('btn-close-modal');
        if (btnClose) {
            btnClose.addEventListener('click', function() {
                self.closeSettingsModal();
            });
        }

        var btnCancel = document.getElementById('btn-cancel-settings');
        if (btnCancel) {
            btnCancel.addEventListener('click', function() {
                self.closeSettingsModal();
            });
        }

        var backdrop = document.getElementById('settings-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', function() {
                self.closeSettingsModal();
            });
        }

        var btnToggleAdv = document.getElementById('btn-toggle-advanced');
        if (btnToggleAdv) {
            btnToggleAdv.addEventListener('click', function() {
                self.toggleAdvancedSection();
            });
        }

        var btnSave = document.getElementById('btn-save-settings');
        if (btnSave) {
            btnSave.addEventListener('click', function() {
                self.saveSettings();
            });
        }

        var btnDefault = document.getElementById('btn-default-settings');
        if (btnDefault) {
            btnDefault.addEventListener('click', function() {
                self.restoreDefaultSettings();
            });
        }
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
        var ip = this.dvr.ip;
        this.showToast('Conectando ao DVR (' + ip + ')...', 3000);
        this.setConnectionStatus('connecting', 'Conectando...');

        try {
            await this.dvr.login();
            this.setConnectionStatus('connected', 'Conectado');

            var deviceInfo = await this.dvr.getDeviceInfo();
            if (deviceInfo) {
                document.getElementById('dvr-title').textContent = deviceInfo.deviceName + ' • ' + deviceInfo.model;
            }

            this.channels = await this.dvr.getChannels();
            console.log('[App] ' + this.channels.length + ' canais carregados.');

            this.renderGrid();
            this.startGridRefresh();
            this.showToast('Conectado! 16 Câmeras carregadas', 2500);

        } catch (err) {
            console.error('[App] Erro ao conectar ao DVR:', err);
            this.setConnectionStatus('error', 'Erro de Conexão');
            this.showToast('Falha na conexão: ' + err.message, 8000);

            var grid = document.getElementById('camera-grid');
            if (grid) {
                grid.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:22px;gap:14px;text-align:center;padding:40px;">' +
                    '<div>⚠️ Não foi possível carregar os canais do DVR (' + this.dvr.baseUrl + ')</div>' +
                    '<div style="color:#94a3b8;font-size:16px;">Detalhes: ' + err.message + '</div>' +
                    '<div style="color:#38bdf8;font-size:16px;margin-top:10px;">Pressione a <b style="color:#60a5fa">Tecla Azul</b> ou clique em <b>⚙️ Configurações</b> para ajustar os dados.</div>' +
                    '</div>';
            }
        }
    }

    setConnectionStatus(status, text) {
        var dot = document.getElementById('status-dot');
        var label = document.getElementById('status-label');
        if (dot) dot.className = 'status-dot ' + status;
        if (label) label.textContent = text;
    }

    getVisibleChannels() {
        if (!this.channels || this.channels.length === 0) return [];
        if (this.activeChannelsOnly) {
            return this.channels.filter(function(ch) { return ch.isOnline; });
        }
        return this.channels;
    }

    renderGrid() {
        var self = this;
        var grid = document.getElementById('camera-grid');
        if (!grid) return;

        grid.className = 'camera-grid layout-' + this.currentLayout;
        grid.innerHTML = '';

        var visibleChannels = this.getVisibleChannels();

        if (visibleChannels.length === 0) {
            grid.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:20px;">Nenhuma câmera encontrada.</div>';
            return;
        }

        if (this.focusedIndex >= visibleChannels.length) {
            this.focusedIndex = 0;
        }

        visibleChannels.forEach(function(channel, index) {
            var card = document.createElement('div');
            card.className = 'camera-card' + (index === self.focusedIndex ? ' focused' : '');
            card.dataset.channelId = channel.id;
            card.dataset.index = index;
            card.tabIndex = 0;

            var statusClass = channel.isOnline ? 'online' : 'offline';
            var statusText = channel.isOnline ? 'AO VIVO' : 'SEM SINAL';
            var resBadge = channel.resDesc || (channel.isOnline ? '1080P' : 'OFF');

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

            card.addEventListener('click', function() {
                self.currentFocusZone = 'grid';
                self.focusedIndex = index;
                self.updateCardFocus();
                self.openFullScreen(channel);
            });

            grid.appendChild(card);
        });
    }

    updateCardFocus() {
        var btnSettings = document.getElementById('btn-settings');
        var cards = document.querySelectorAll('.camera-card');

        if (this.currentFocusZone === 'header') {
            if (btnSettings) {
                btnSettings.classList.add('focused');
                try { btnSettings.focus(); } catch (e) {}
            }
            for (var i = 0; i < cards.length; i++) {
                cards[i].classList.remove('focused');
            }
            return;
        }

        if (btnSettings) {
            btnSettings.classList.remove('focused');
            try { btnSettings.blur(); } catch (e) {}
        }

        for (var j = 0; j < cards.length; j++) {
            if (j === this.focusedIndex) {
                cards[j].classList.add('focused');
                cards[j].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                cards[j].classList.remove('focused');
            }
        }
    }

    startGridRefresh() {
        var self = this;
        if (this.gridRefreshTimer) clearInterval(this.gridRefreshTimer);

        this.gridRefreshTimer = setInterval(function() {
            if (self.isFullScreen || self.isModalOpen) return;

            var cards = document.querySelectorAll('.camera-card');
            cards.forEach(function(card) {
                var chId = card.dataset.channelId;
                var img = card.querySelector('.camera-img');
                if (img && chId) {
                    var newImg = new Image();
                    var nextUrl = self.dvr.getSnapshotUrl(chId, 2);
                    newImg.onload = function() {
                        img.src = nextUrl;
                    };
                    newImg.src = nextUrl;
                }
            });
        }, 1200); // Grade dinâmica atualizada a cada 1.2s
    }

    /* ==========================================================================
       GESTÃO DO MODAL DE CONFIGURAÇÕES (SEGURA: SENHA SALVA INTERNAMENTE)
       ========================================================================== */
    openSettingsModal() {
        console.log('[App] Abrindo modal de configurações seguro...');
        this.isModalOpen = true;
        this._restoreDefaultPwdRequested = false;

        var modal = document.getElementById('settings-modal');
        if (!modal) return;

        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');

        if (ipInput) ipInput.value = localStorage.getItem('dvr_ip') || this.dvr.ip || '192.168.100.2';
        if (userInput) userInput.value = localStorage.getItem('dvr_user') || this.dvr.username || 'admin';
        
        // Segurança: NUNCA exibe a senha salva. Campo permanece vazio com máscara de proteção.
        if (pwdInput) {
            pwdInput.value = '';
            pwdInput.type = 'password';
            pwdInput.placeholder = '•••••••• (Salva internamente)';
        }

        if (httpPortInput) httpPortInput.value = localStorage.getItem('dvr_http_port') || this.dvr.httpPort || 80;
        if (rtspPortInput) rtspPortInput.value = localStorage.getItem('dvr_rtsp_port') || this.dvr.rtspPort || 554;

        // Fecha a área avançada inicialmente
        this.isAdvancedOpen = false;
        var advFields = document.getElementById('advanced-fields');
        var advArrow = document.getElementById('advanced-arrow');
        if (advFields) advFields.style.display = 'none';
        if (advArrow) advArrow.className = 'advanced-arrow';

        modal.style.display = 'flex';

        this.refreshModalFocusList();
        this.modalFocusIndex = 0;
        this.updateModalFocus();
    }

    closeSettingsModal() {
        console.log('[App] Fechando modal de configurações...');
        this.isModalOpen = false;

        var modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'none';

        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }

        this.updateCardFocus();
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
        var list = [
            document.getElementById('cfg-ip'),
            document.getElementById('cfg-user'),
            document.getElementById('cfg-pwd'),
            document.getElementById('btn-toggle-advanced')
        ];

        if (this.isAdvancedOpen) {
            list.push(document.getElementById('cfg-http-port'));
            list.push(document.getElementById('cfg-rtsp-port'));
        }

        list.push(document.getElementById('btn-save-settings'));
        list.push(document.getElementById('btn-default-settings'));
        list.push(document.getElementById('btn-cancel-settings'));
        list.push(document.getElementById('btn-close-modal'));

        this.modalFocusableElements = list.filter(function(el) { return el !== null; });
    }

    updateModalFocus() {
        if (!this.modalFocusableElements || this.modalFocusableElements.length === 0) return;

        for (var i = 0; i < this.modalFocusableElements.length; i++) {
            var el = this.modalFocusableElements[i];
            if (i === this.modalFocusIndex) {
                el.classList.add('focused');
                try {
                    el.focus();
                } catch (e) {}
            } else {
                el.classList.remove('focused');
            }
        }
    }

    saveSettings() {
        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');

        var newIp = ipInput ? ipInput.value.trim() : '192.168.100.2';
        var newUser = userInput ? userInput.value.trim() : 'admin';
        
        // Senha: se digitou algo novo, salva o novo. Se deixou em branco, mantém a salva internamente.
        var currentSavedPwd = localStorage.getItem('dvr_pwd') || this.dvr.password || 'jr130182';
        var newPwd = currentSavedPwd;
        if (this._restoreDefaultPwdRequested) {
            newPwd = 'jr130182';
        } else if (pwdInput && pwdInput.value && pwdInput.value.length > 0) {
            newPwd = pwdInput.value;
        }

        var newHttpPort = httpPortInput ? parseInt(httpPortInput.value || '80', 10) : 80;
        var newRtspPort = rtspPortInput ? parseInt(rtspPortInput.value || '554', 10) : 554;

        if (!newIp) {
            this.showToast('Por favor, informe o IP do DVR', 3000);
            return;
        }
        if (!newUser) {
            this.showToast('Por favor, informe o Usuário', 3000);
            return;
        }

        localStorage.setItem('dvr_ip', newIp);
        localStorage.setItem('dvr_user', newUser);
        localStorage.setItem('dvr_pwd', newPwd);
        localStorage.setItem('dvr_http_port', String(newHttpPort));
        localStorage.setItem('dvr_rtsp_port', String(newRtspPort));

        this.dvr.updateConfig({
            ip: newIp,
            username: newUser,
            password: newPwd,
            httpPort: newHttpPort,
            rtspPort: newRtspPort
        });

        this.closeSettingsModal();
        this.showToast('Configurações salvas internamente! Reconectando...', 3000);
        this.connectDvr();
    }

    restoreDefaultSettings() {
        var ipInput = document.getElementById('cfg-ip');
        var userInput = document.getElementById('cfg-user');
        var pwdInput = document.getElementById('cfg-pwd');
        var httpPortInput = document.getElementById('cfg-http-port');
        var rtspPortInput = document.getElementById('cfg-rtsp-port');

        if (ipInput) ipInput.value = '192.168.100.2';
        if (userInput) userInput.value = 'admin';
        if (pwdInput) {
            pwdInput.value = '';
            pwdInput.placeholder = '•••••••• (Padrão: será restaurada ao salvar)';
        }
        this._restoreDefaultPwdRequested = true;
        if (httpPortInput) httpPortInput.value = '80';
        if (rtspPortInput) rtspPortInput.value = '554';

        this.showToast('Valores padrão carregados. Clique em Salvar para aplicar.', 3500);
    }

    /* ==========================================================================
       NAVEGAÇÃO POR CONTROLE REMOTO E TECLADO
       ========================================================================== */
    handleNavigation(direction) {
        if (this.isModalOpen) {
            var len = this.modalFocusableElements.length;
            if (len === 0) return;

            if (direction === 'up') {
                this.modalFocusIndex = (this.modalFocusIndex - 1 + len) % len;
            } else if (direction === 'down') {
                this.modalFocusIndex = (this.modalFocusIndex + 1) % len;
            } else if (direction === 'left' || direction === 'right') {
                var currentEl = this.modalFocusableElements[this.modalFocusIndex];
                if (currentEl) {
                    var id = currentEl.id;
                    if (id === 'btn-save-settings' || id === 'btn-default-settings' || id === 'btn-cancel-settings') {
                        if (direction === 'right') {
                            this.modalFocusIndex = (this.modalFocusIndex + 1) % len;
                        } else {
                            this.modalFocusIndex = (this.modalFocusIndex - 1 + len) % len;
                        }
                    }
                }
            }
            this.updateModalFocus();
            return;
        }

        if (this.isFullScreen) {
            if (direction === 'up' || direction === 'right') {
                this.nextCamera();
            } else if (direction === 'down' || direction === 'left') {
                this.prevCamera();
            }
            return;
        }

        // Se o foco já estiver no botão Configurações no topo:
        if (this.currentFocusZone === 'header') {
            if (direction === 'down') {
                this.currentFocusZone = 'grid';
                this.updateCardFocus();
            }
            return;
        }

        var visibleChannels = this.getVisibleChannels();
        if (visibleChannels.length === 0) return;

        var cols = 4;
        if (this.currentLayout === '1x1') cols = 1;
        else if (this.currentLayout === '2x2') cols = 2;
        else if (this.currentLayout === '3x3') cols = 3;
        else if (this.currentLayout === '4x4') cols = 4;

        var total = visibleChannels.length;

        switch (direction) {
            case 'up':
                if (this.focusedIndex - cols >= 0) {
                    this.focusedIndex -= cols;
                } else {
                    // Ao subir além da primeira fileira, seleciona o botão Configurações no cabeçalho
                    this.currentFocusZone = 'header';
                }
                break;
            case 'down':
                if (this.focusedIndex + cols < total) {
                    this.focusedIndex += cols;
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

    handleEnter() {
        if (this.isModalOpen) {
            var el = this.modalFocusableElements[this.modalFocusIndex];
            if (el) {
                if (el.tagName === 'BUTTON') {
                    el.click();
                } else if (el.tagName === 'INPUT') {
                    el.focus();
                }
            }
            return;
        }

        // Se o foco estiver no botão de Configurações no topo:
        if (this.currentFocusZone === 'header') {
            this.openSettingsModal();
            return;
        }

        if (this.isFullScreen) {
            this.closeFullScreen();
            return;
        }

        var visibleChannels = this.getVisibleChannels();
        var selected = visibleChannels[this.focusedIndex];
        if (selected) {
            this.openFullScreen(selected);
        }
    }

    handleBack() {
        if (this.isModalOpen) {
            this.closeSettingsModal();
            return;
        }

        if (this.isFullScreen) {
            this.closeFullScreen();
            return;
        }

        if (typeof window.tizen !== 'undefined') {
            try {
                window.tizen.application.getCurrentApplication().exit();
            } catch (e) {
                console.log('Saindo do app...');
            }
        }
    }

    adjustFullScreenDimensions() {
        var wrapper = document.querySelector('.fullscreen-video-wrapper');
        var container = document.getElementById('fullscreen-player-container');
        if (!wrapper || !container) return;

        var availW = wrapper.clientWidth;
        var availH = wrapper.clientHeight;
        if (availW <= 0 || availH <= 0) return;

        // Mantém a imagem proporcional 16:9 paisagem sem distorção e sem cobrir nada
        var targetW = availW;
        var targetH = Math.round(availW * 9 / 16);

        if (targetH > availH) {
            targetH = availH;
            targetW = Math.round(availH * 16 / 9);
        }

        container.style.width = targetW + 'px';
        container.style.height = targetH + 'px';

        if (this.player && this.player.resize) {
            this.player.resize();
        }
    }

    updateQualityBadge() {
        var isHd = (this.streamQuality === 1);
        var badge = document.getElementById('fs-cam-badge');
        var text = document.getElementById('fs-quality-text');
        if (badge && text) {
            badge.className = 'fs-quality-tag ' + (isHd ? 'quality-hd' : 'quality-fluido');
            text.textContent = isHd ? 'HD' : 'Fluido';
        }
    }

    openFullScreen(channel) {
        console.log('[App] Abrindo câmera individualizada:', channel.name);
        this.isFullScreen = true;
        this.fullScreenChannel = channel;

        var fsView = document.getElementById('fullscreen-view');
        if (fsView) {
            fsView.style.display = 'flex';
            this.adjustFullScreenDimensions();
        }

        var titleEl = document.getElementById('fs-cam-title');
        if (titleEl) {
            titleEl.textContent = channel.name + ' (CH ' + channel.id + ')';
        }

        this.updateQualityBadge();

        this.player.play(channel.id, this.streamQuality);
        this.showToast(channel.name + ' (CH ' + channel.id + ')', 2000);
    }

    closeFullScreen() {
        if (!this.isFullScreen) return;
        console.log('[App] Fechando tela cheia, voltando para a grade...');
        this.isFullScreen = false;
        this.fullScreenChannel = null;

        var fsView = document.getElementById('fullscreen-view');
        if (fsView) fsView.style.display = 'none';

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
        if (this.isModalOpen) return;
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
        if (this.isModalOpen) return;
        this.showToast('Reconectando ao DVR...', 2000);
        this.connectDvr();
    }

    handleGreen() {
        if (this.isModalOpen) return;
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
        if (this.isModalOpen) return;
        this.streamQuality = (this.streamQuality === 1) ? 2 : 1;
        var isHd = (this.streamQuality === 1);
        var qualityName = isHd ? 'Stream Principal (HD)' : 'Sub-stream Fluido';
        this.showToast('Qualidade: ' + qualityName, 2000);

        if (this.isFullScreen && this.fullScreenChannel) {
            this.updateQualityBadge();
            this.player.play(this.fullScreenChannel.id, this.streamQuality);
        }
    }

    handleBlue() {
        if (this.isModalOpen) {
            this.closeSettingsModal();
        } else {
            if (this.isFullScreen) {
                this.closeFullScreen();
            }
            this.openSettingsModal();
        }
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

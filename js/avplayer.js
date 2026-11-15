/**
 * Player de Vídeo Tizen AVPlay com Fallback
 * Suporta streaming nativo de hardware RTSP (H.264 / H.265) via webapis.avplay
 * nas TVs Samsung Smart TV, e fallback automático para streaming JPEG em navegadores de teste.
 */
class TvStreamPlayer {
    constructor(containerElement, dvrClient) {
        this.container = containerElement;
        this.dvrClient = dvrClient;
        this.isAvPlayAvailable = (typeof window.webapis !== 'undefined' && typeof window.webapis.avplay !== 'undefined');
        this.currentChannelId = null;
        this.currentStreamType = 2; // 2 = Sub-stream Fluido (padrão 15-25 FPS), 1 = Main (1080P)
        this.isPlaying = false;
        this.fallbackTimer = null;
        this.fallbackImg = null;
        // O snapshot JPEG é o caminho comprovadamente compatível com a grade
        // nas TVs Samsung deste projeto. Mantemos AVPlay disponível para uma
        // futura opção, mas não o usamos por padrão na câmera única enquanto
        // o DVR/firmware não confirmar o RTSP.
        this.preferDirectSnapshot = true;

        console.log('[Player] Samsung AVPlay disponível?', this.isAvPlayAvailable ? 'SIM' : 'NÃO (Modo Fallback Snapshot)');
        this.initDOM();
    }

    initDOM() {
        this.fallbackImg = document.createElement('img');
        this.fallbackImg.className = 'avplay-fallback-img';
        this.fallbackImg.style.display = 'none';
        this.fallbackImg.alt = 'Stream Fallback';
        this.container.appendChild(this.fallbackImg);
    }

    /**
     * Inicia a reprodução de um canal
     */
    async play(channelId, streamType = 2) {
        this.stop();
        this.currentChannelId = channelId;
        this.currentStreamType = streamType;
        this.isPlaying = true;

        if (this.isAvPlayAvailable && !this.preferDirectSnapshot) {
            this.playAvPlay(channelId, streamType);
        } else {
            // A grade usa sub-stream e é o caminho validado no DVR. A tela
            // individual também começa nele, mesmo quando o badge está em HD;
            // isso evita falha do stream principal 101/201/... no firmware.
            this.playFallback(channelId, 2);
        }
    }

    /**
     * Reprodução nativa via Samsung AVPlay (Hardware RTSP)
     */
    playAvPlay(channelId, streamType) {
        try {
            const rtspUrl = this.dvrClient.getRtspUrl(channelId, streamType);
            console.log('[AVPlay] Abrindo stream RTSP:', rtspUrl);

            window.webapis.avplay.open(rtspUrl);

            // Ajusta o retângulo de exibição para preencher o contêiner na resolução 1920x1080
            const rect = this.container.getBoundingClientRect();
            const x = Math.round(rect.left);
            const y = Math.round(rect.top);
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);

            window.webapis.avplay.setDisplayRect(x, y, w, h);
            try {
                window.webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            } catch (dmErr) {
                console.warn('[AVPlay] setDisplayMethod:', dmErr);
            }

            window.webapis.avplay.setListener({
                onbufferingstart: () => {
                    console.log('[AVPlay] Buffering iniciado...');
                    this.onBuffering(true);
                },
                onbufferingcomplete: () => {
                    console.log('[AVPlay] Buffering completo.');
                    this.onBuffering(false);
                },
                onerror: (err) => {
                    console.error('[AVPlay] Erro no player:', err);
                    this.onBuffering(false);
                    // Em caso de falha de codec ou rede, tenta o fallback
                    this.playFallback(channelId, streamType);
                }
            });

            window.webapis.avplay.prepareAsync(() => {
                console.log('[AVPlay] PrepareAsync pronto. Iniciando playback...');
                window.webapis.avplay.play();
                this.onBuffering(false);
            }, (prepareErr) => {
                console.warn('[AVPlay] Falha no prepareAsync:', prepareErr);
                this.playFallback(channelId, streamType);
            });

        } catch (e) {
            console.error('[AVPlay] Exceção ao iniciar AVPlay:', e);
            this.playFallback(channelId, streamType);
        }
    }

    /**
     * Fallback compatível com Samsung TV: usa a mesma imagem JPEG direta que
     * já funciona na grade. Evitamos fetch/blob porque requisições cross-origin
     * com headers de autenticação podem ser bloqueadas pelo WebView da TV.
     * Atualização moderada para não saturar o DVR nem a rede.
     */
    playFallback(channelId, streamType) {
        console.log('[Player] Fallback JPEG direto do sub-stream');
        // Libera qualquer sessão AVPlay parcialmente aberta antes de exibir
        // o fallback, evitando tela preta ou disputa pelo decodificador.
        if (this.isAvPlayAvailable) {
            try {
                var state = window.webapis.avplay.getState();
                if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY' || state === 'IDLE') {
                    window.webapis.avplay.stop();
                }
                window.webapis.avplay.close();
            } catch (cleanupErr) {}
        }
        this.fallbackImg.style.display = 'block';
        this.fallbackImg.onerror = () => {
            console.warn('[Player] Snapshot individual indisponível:', channelId, streamType);
            if (streamType !== 2 && this.isPlaying && this.currentChannelId === channelId) {
                this.fallbackImg.src = this.dvrClient.getSnapshotUrl(channelId, 2);
            }
        };

        const updateFrame = () => {
            if (!this.isPlaying || this.currentChannelId !== channelId) return;
            // A URL nova evita cache sem fazer uma requisição fetch sujeita a CORS.
            this.fallbackImg.src = this.dvrClient.getSnapshotUrl(channelId, streamType);
            if (this.isPlaying && this.currentChannelId === channelId) {
                // Aproximadamente 2 quadros/s: boa resposta, baixo consumo.
                this.fallbackTimer = setTimeout(updateFrame, 500);
            }
        };

        updateFrame();
    }

    /**
     * Interrompe a reprodução atual
     */
    stop() {
        this.isPlaying = false;
        if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
        }

        if (this.fallbackImg) {
            this.fallbackImg.style.display = 'none';
            this.fallbackImg.src = '';
        }

        if (this.isAvPlayAvailable) {
            try {
                const state = window.webapis.avplay.getState();
                if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY') {
                    window.webapis.avplay.stop();
                }
                window.webapis.avplay.close();
            } catch (e) {
                console.warn('[AVPlay] Erro ao parar AVPlay:', e);
            }
        }
    }

    onBuffering(isBuffering) {
        const loader = document.getElementById('player-loader');
        if (loader) {
            loader.style.display = isBuffering ? 'flex' : 'none';
        }
    }

    /**
     * Redimensiona o retângulo de exibição do AVPlay quando a tela muda
     */
    resize() {
        if (!this.isPlaying || !this.isAvPlayAvailable) return;
        try {
            const rect = this.container.getBoundingClientRect();
            window.webapis.avplay.setDisplayRect(
                Math.round(rect.left),
                Math.round(rect.top),
                Math.round(rect.width),
                Math.round(rect.height)
            );
            try {
                window.webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            } catch (e2) {}
        } catch (e) {
            console.warn('[AVPlay] Erro ao redimensionar:', e);
        }
    }
}

window.TvStreamPlayer = TvStreamPlayer;

window.VideoPlayerManager = TvStreamPlayer;

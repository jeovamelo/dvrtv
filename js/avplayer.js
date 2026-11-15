/**
 * Player de Vídeo Tizen AVPlay com Fallback
 * Suporta streaming nativo de hardware RTSP (H.264 / H.265) via webapis.avplay
 * nas TVs Samsung Smart TV, e fallback automático com snapshots autenticados (Blob).
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
        this.fallbackRequest = null;
        this.currentBlobUrl = null;

        console.log('[Player] Samsung AVPlay disponível?', this.isAvPlayAvailable ? 'SIM (Aceleração por Hardware)' : 'NÃO (Modo Snapshot Autenticado)');
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
    async play(channelId, streamType, initialSrc) {
        streamType = streamType || 2;
        this.stop();
        this.currentChannelId = channelId;
        this.currentStreamType = streamType;
        this.isPlaying = true;

        if (this.isAvPlayAvailable) {
            this.playAvPlay(channelId, streamType, initialSrc);
        } else {
            this.playFallback(channelId, streamType, initialSrc);
        }
    }

    /**
     * Reprodução nativa via Samsung AVPlay (Hardware RTSP)
     */
    playAvPlay(channelId, streamType, initialSrc) {
        try {
            const rtspUrl = this.dvrClient.getRtspUrl(channelId, streamType);
            console.log('[AVPlay] Abrindo stream RTSP nativo:', rtspUrl);

            window.webapis.avplay.open(rtspUrl);

            // Preenchimento 100% da tela em widescreen 16:9
            const rect = this.container.getBoundingClientRect();
            const x = Math.round(rect.left || 0);
            const y = Math.round(rect.top || 0);
            const w = Math.round(rect.width || window.innerWidth || 1920);
            const h = Math.round(rect.height || window.innerHeight || 1080);

            window.webapis.avplay.setDisplayRect(x, y, w, h);
            try {
                window.webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            } catch (dmErr) {
                console.warn('[AVPlay] setDisplayMethod:', dmErr);
            }

            window.webapis.avplay.setListener({
                onbufferingstart: () => {
                    this.onBuffering(true);
                },
                onbufferingcomplete: () => {
                    this.onBuffering(false);
                },
                onerror: (err) => {
                    console.error('[AVPlay] Erro no player RTSP:', err);
                    this.onBuffering(false);
                    this.playFallback(channelId, streamType, initialSrc);
                }
            });

            window.webapis.avplay.prepareAsync(() => {
                console.log('[AVPlay] PrepareAsync pronto. Iniciando playback...');
                window.webapis.avplay.play();
                this.onBuffering(false);
            }, (prepareErr) => {
                console.warn('[AVPlay] Falha no prepareAsync RTSP:', prepareErr);
                this.playFallback(channelId, streamType, initialSrc);
            });

        } catch (e) {
            console.error('[AVPlay] Exceção ao iniciar AVPlay:', e);
            this.playFallback(channelId, streamType, initialSrc);
        }
    }

    /**
     * Fallback contínuo via snapshots autenticados (Blob URL).
     * Envia o SessionTag nos cabeçalhos HTTP para evitar o erro 401 Unauthorized na TV.
     */
    async playFallback(channelId, streamType, initialSrc) {
        console.log('[Player] Fallback de snapshot com autenticação ativa');
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
        if (initialSrc) {
            this.fallbackImg.src = initialSrc;
        }

        var isFetching = false;
        var self = this;

        var updateFrame = async () => {
            if (!self.isPlaying || self.currentChannelId !== channelId || isFetching) return;
            isFetching = true;

            try {
                var blobUrl = await self.dvrClient.fetchSnapshotBlob(channelId, streamType);
                if (self.isPlaying && self.currentChannelId === channelId) {
                    var oldBlob = self.currentBlobUrl;
                    self.currentBlobUrl = blobUrl;
                    self.fallbackImg.src = blobUrl;
                    if (oldBlob) {
                        setTimeout(function() {
                            try { URL.revokeObjectURL(oldBlob); } catch(e) {}
                        }, 600);
                    }
                } else {
                    try { URL.revokeObjectURL(blobUrl); } catch(e) {}
                }
            } catch (err) {
                if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                    self.fallbackImg.src = self.dvrClient.getSnapshotUrl(channelId, streamType);
                }
            } finally {
                isFetching = false;
            }

            if (self.isPlaying && self.currentChannelId === channelId) {
                self.fallbackTimer = setTimeout(updateFrame, 400);
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
        if (this.currentBlobUrl) {
            try { URL.revokeObjectURL(this.currentBlobUrl); } catch(e) {}
            this.currentBlobUrl = null;
        }
        this.fallbackRequest = null;

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
                Math.round(rect.left || 0),
                Math.round(rect.top || 0),
                Math.round(rect.width || window.innerWidth || 1920),
                Math.round(rect.height || window.innerHeight || 1080)
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

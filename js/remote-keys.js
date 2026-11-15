/**
 * Gerenciador de Controle Remoto Samsung Smart TV (Tizen) e Teclado de PC
 * Permite digitação completa em campos de input no PC sem conflitos.
 */
class RemoteControlManager {
    constructor(appCallbacks) {
        this.callbacks = appCallbacks || {};
        this.registerTizenKeys();
        this.bindEvents();
    }

    registerTizenKeys() {
        if (typeof window.tizen !== 'undefined' && typeof window.tizen.tvinputdevice !== 'undefined') {
            var keysToRegister = [
                'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
                'ChannelUp', 'ChannelDown', 'MediaPlay', 'MediaPause', 'MediaStop',
                '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
            ];

            keysToRegister.forEach(function(keyName) {
                try {
                    window.tizen.tvinputdevice.registerKey(keyName);
                } catch (e) {
                    // ignorar em navegadores comuns
                }
            });
        }
    }

    bindEvents() {
        var self = this;
        window.addEventListener('keydown', function(e) {
            var keyCode = e.keyCode;
            var target = e.target || document.activeElement;
            var isTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
            var isSelect = target && target.tagName === 'SELECT';

            // No formulário Tizen, as setas pertencem ao gerenciador de foco,
            // mesmo quando um input está ativo. Isso evita prender o usuário
            // no campo IP por causa do cursor de texto.
            if (self.callbacks.isFormNavigation && self.callbacks.isFormNavigation()) {
                if (keyCode === 38 && self.callbacks.onUp) { self.callbacks.onUp(); e.preventDefault(); return; }
                if (keyCode === 40 && self.callbacks.onDown) { self.callbacks.onDown(); e.preventDefault(); return; }
                if (keyCode === 37 && self.callbacks.onLeft) { self.callbacks.onLeft(); e.preventDefault(); return; }
                if (keyCode === 39 && self.callbacks.onRight) { self.callbacks.onRight(); e.preventDefault(); return; }
            }

            // ==================================================================
            // REGRA CRÍTICA PARA DIGITAÇÃO EM CAMPOS DE TEXTO NO PC:
            // Quando o usuário está com foco em um <input>, permite TODAS as teclas:
            // letras (incluindo R, G, Y, B), números 0-9, pontos, símbolos, Backspace,
            // Delete e setas para mover o cursor, SEM BLOQUEIOS OU ATALHOS DA TV!
            // ==================================================================
            if (isTextInput) {
                if (keyCode === 27) { // Esc fecha a tela
                    if (self.callbacks.onBack) self.callbacks.onBack();
                    e.preventDefault();
                    return;
                }
                if (keyCode === 13) { // Enter salva
                    if (self.callbacks.onEnter) self.callbacks.onEnter();
                    e.preventDefault();
                    return;
                }
                // No formulário da TV, ↑/↓ trocam de campo; ←/→ continuam
                // disponíveis para mover o cursor dentro do texto.
                if (keyCode === 38 && self.callbacks.onUp) {
                    self.callbacks.onUp();
                    e.preventDefault();
                    return;
                }
                if (keyCode === 40 && self.callbacks.onDown) {
                    self.callbacks.onDown();
                    e.preventDefault();
                    return;
                }
                // Permite letras, números, pontos, símbolos, Backspace e Delete.
                return;
            }

            if (isSelect) {
                if (keyCode === 27) { // Esc fecha
                    if (self.callbacks.onBack) self.callbacks.onBack();
                    e.preventDefault();
                    return;
                }
                // ↑/↓ mudam de campo; ←/→ alteram a opção selecionada.
                if (keyCode === 38 || keyCode === 40) {
                    if (keyCode === 38 && self.callbacks.onUp) self.callbacks.onUp();
                    if (keyCode === 40 && self.callbacks.onDown) self.callbacks.onDown();
                    e.preventDefault();
                    return;
                }
            }

            // ==================================================================
            // CONTROLE REMOTO SAMSUNG / NAVEGAÇÃO POR SETAS NO SISTEMA
            // ==================================================================
            switch (keyCode) {
                case 38: // Seta Cima
                    if (self.callbacks.onUp) self.callbacks.onUp();
                    e.preventDefault();
                    break;
                case 40: // Seta Baixo
                    if (self.callbacks.onDown) self.callbacks.onDown();
                    e.preventDefault();
                    break;
                case 37: // Seta Esquerda
                    if (self.callbacks.onLeft) self.callbacks.onLeft();
                    e.preventDefault();
                    break;
                case 39: // Seta Direita
                    if (self.callbacks.onRight) self.callbacks.onRight();
                    e.preventDefault();
                    break;

                case 13: // Enter / OK
                    if (self.callbacks.onEnter) self.callbacks.onEnter();
                    e.preventDefault();
                    break;

                case 10009: // Return (Tizen)
                case 8:     // Backspace no app
                case 27:    // Esc
                    if (self.callbacks.onBack) self.callbacks.onBack();
                    e.preventDefault();
                    break;

                // Tecla Vermelha / Tecla R no PC
                case 403:
                case 82:
                    if (self.callbacks.onRed) self.callbacks.onRed();
                    e.preventDefault();
                    break;

                // Tecla Verde / Tecla G no PC
                case 404:
                case 71:
                    if (self.callbacks.onGreen) self.callbacks.onGreen();
                    e.preventDefault();
                    break;

                // Tecla Amarela / Tecla Y no PC
                case 405:
                case 89:
                    if (self.callbacks.onYellow) self.callbacks.onYellow();
                    e.preventDefault();
                    break;

                // Tecla Azul / Tecla B no PC
                case 406:
                case 66:
                    if (self.callbacks.onBlue) self.callbacks.onBlue();
                    e.preventDefault();
                    break;

                case 427: // Channel Up / Page Up
                case 33:
                    if (self.callbacks.onChannelUp) self.callbacks.onChannelUp();
                    e.preventDefault();
                    break;
                case 428: // Channel Down / Page Down
                case 34:
                    if (self.callbacks.onChannelDown) self.callbacks.onChannelDown();
                    e.preventDefault();
                    break;

                default:
                    // Números 0-9 apenas fora de inputs de texto
                    if (keyCode >= 48 && keyCode <= 57) {
                        var num = keyCode - 48;
                        if (self.callbacks.onNumber) self.callbacks.onNumber(num);
                    }
                    break;
            }
        });
    }
}

window.RemoteControlManager = RemoteControlManager;

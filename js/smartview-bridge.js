/* Smart View direto com fallback para a fila da VPS. */
(function (global) {
    var CHANNEL = 'com.dvr.tv.control';
    var APP_ID = 'dvr01casa0.Dvrtv';
    var receiverChannel = null;
    var senderApplication = null;

    global.DvrSmartView = {
        connected: false,
        initReceiver: function (onCommand) {
            if (!global.msf || typeof global.msf.local !== 'function') return false;
            try {
                global.msf.local(function (err, service) {
                    if (err || !service || typeof service.channel !== 'function') return;
                    receiverChannel = service.channel(CHANNEL);
                    receiverChannel.connect(function (connectErr) {
                        if (connectErr) return;
                        global.DvrSmartView.connected = true;
                        if (receiverChannel.on) receiverChannel.on('command', function (payload) {
                            if (onCommand) onCommand(payload);
                        });
                    });
                });
                return true;
            } catch (e) { return false; }
        },
        initSender: function (onStatus) {
            if (!global.msf || typeof global.msf.search !== 'function') return false;
            try {
                var search = global.msf.search();
                search.on('found', function (services) {
                    if (!services || !services.length) return;
                    var service = services[0];
                    if (!service.application) return;
                    senderApplication = service.application(APP_ID, CHANNEL);
                    senderApplication.connect({ displayName: 'DVR TV Controle' }, function (err) {
                        global.DvrSmartView.connected = !err;
                        if (onStatus) onStatus(!err, err);
                    });
                });
                search.start();
                return true;
            } catch (e) { return false; }
        },
        send: function (payload) {
            if (!senderApplication || !global.DvrSmartView.connected) return false;
            try { senderApplication.publish('command', payload); return true; } catch (e) { return false; }
        }
    };
}(window));

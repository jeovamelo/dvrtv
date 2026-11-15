@echo off
setlocal
title DVR TV - Servidor
echo ========================================================
echo  Iniciando Servidor DVR TV
echo  O servidor Node fornece a TV, QR Code e configuracao.
echo  Acesse: http://localhost:8081/
echo ========================================================
where node >nul 2>&1
if errorlevel 1 (
    echo ERRO: Node.js nao foi encontrado no PATH.
    pause
    exit /b 1
)
set PORT=8081
node server.js
pause

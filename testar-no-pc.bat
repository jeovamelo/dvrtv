@echo off
setlocal
title Servidor DVR TV - Teste no PC
echo ========================================================
echo  Iniciando Servidor DVR TV com Node.js
echo  Porta de teste: 8081
echo ========================================================
where node >nul 2>&1
if errorlevel 1 (
    echo ERRO: Node.js nao foi encontrado no PATH.
    pause
    exit /b 1
)
start "DVR TV" http://localhost:8081/
set PORT=8081
node "%~dp0server.js"
pause

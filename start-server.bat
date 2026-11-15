@echo off
setlocal enabledelayedexpansion
title DVR TV - Servidor Local
cd /d "%~dp0"

echo ========================================================
echo            DVR TV - SERVIDOR LOCAL COMPANION
echo ========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado no sistema!
    echo Por favor, instale o Node.js em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

set PORT=8080
netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set PORT=8081
    echo [AVISO] Porta 8080 em uso. Usando porta alternativa 8081.
)

echo [OK] Servidor iniciado na porta %PORT%!
echo.
node server.js
pause

@echo off
setlocal enabledelayedexpansion
title DVR TV - Ambiente de Teste no PC
cd /d "%~dp0"

echo ========================================================
echo            DVR TV - AMBIENTE DE TESTE NO PC
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

:: Verifica se a porta 8080 esta em uso; se estiver, utiliza 8081
set PORT=8080
netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    set PORT=8081
    echo [AVISO] Porta 8080 em uso. Usando porta alternativa 8081.
)

echo [OK] Iniciando servidor na porta %PORT%...
echo [OK] Painel TV / PC:        http://localhost:%PORT%/
echo [OK] Configuracao Mobile:   http://localhost:%PORT%/mobile
echo.
echo ========================================================
echo  Pressione Ctrl+C nesta janela para parar o servidor.
echo ========================================================
echo.

:: Abre o navegador apos 2 segundos (tempo para o Node subir o socket)
start /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/"

:: Inicia o servidor Node
node server.js
pause

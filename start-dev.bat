@echo off
echo ========================================
echo   股票監控系統 - 開發環境啟動腳本
echo ========================================
echo.

echo [1/2] 啟動後端伺服器...
start "Stock Monitor - Backend" cmd /k "cd server && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] 啟動前端伺服器...
start "Stock Monitor - Frontend" cmd /k "cd client && npm run dev"

echo.
echo ========================================
echo   系統啟動中...
echo ========================================
echo.
echo   後端: http://localhost:3001
echo   前端: http://localhost:5173
echo.
echo   請稍候幾秒讓伺服器完全啟動
echo ========================================
pause

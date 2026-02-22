@echo off
echo ========================================
echo   系統測試腳本
echo ========================================
echo.

echo [1/3] 測試後端 API...
curl -s http://localhost:3001/health
echo.
echo.

echo [2/3] 測試自選股 API...
curl -s http://localhost:3001/api/watchlist
echo.
echo.

echo [3/3] 測試前端伺服器...
curl -s http://localhost:5173 | findstr "html" >nul
if %errorlevel% == 0 (
    echo 前端: OK
) else (
    echo 前端: 錯誤
)
echo.

echo ========================================
echo   測試完成
echo ========================================
echo.
echo 請開啟瀏覽器訪問: http://localhost:5173
echo.
pause

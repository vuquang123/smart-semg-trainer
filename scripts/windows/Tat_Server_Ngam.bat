@echo off
chcp 65001 >nul
echo Dang kiem tra va tat server ngam tren cong 8787...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8787" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo Da tat tien trinh server (PID: %%a).
)
timeout /t 2 >nul

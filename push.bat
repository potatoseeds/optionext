@echo off
cd /d "%~dp0"
git add -A
git commit -m "update %date:~0,10% %time:~0,8%"
git pull --rebase origin main
git push origin main
pause

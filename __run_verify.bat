@echo off
cd /d "C:\Users\kvdes\OneDrive\Desktop\Audit\caflow-core-ui-main"
echo === Verifying Excel export ===
python __verify_export.py
echo.
echo === DONE - Press any key ===
pause

@echo off
cd /d "C:\Users\kvdes\OneDrive\Desktop\Audit\caflow-core-ui-main"
echo === Running Excel export test ===
echo.
bun test_export.mjs
if %errorlevel% neq 0 (
  echo Bun failed, trying node...
  node test_export.mjs
)
echo.
echo === DONE - Press any key ===
pause

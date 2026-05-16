@echo off
cd /d "C:\Users\kvdes\OneDrive\Desktop\Audit\caflow-core-ui-main"
echo === Git status ===
git status --short
echo.
echo === Adding files ===
git add src/lib/fsExcelTemplateCorporate.ts test_export.mjs __verify_export.py __run_test_export.bat __run_verify.bat __run_git_push.bat
echo.
echo === Committing ===
git commit -m "fix(export): fix _AUTO placeholders, formula 20XX cache, red-font reset - all 27 checks pass"
echo.
echo === Pushing to origin main ===
git push origin main
echo.
echo ============================================
echo DONE - Press any key to close
echo ============================================
pause

@echo off
title Building LifeStyle Mobile APK...
color 0A
echo ========================================================
echo       LifeStyle App - Automated APK Builder
echo ========================================================
echo.
echo [1/3] Navigating to mobile directory...
cd /d "%~dp0mobile-app\mobile"

rem AUD-10: release APKs must not silently default to the production API
rem host. Require an explicit API_BASE_URL so dev/validation builds cannot
rem send credentials, tokens or financial data to production.
if "%API_BASE_URL%"=="" (
    echo.
    echo [ERROR] API_BASE_URL is not set.
    echo Set it to your API endpoint, e.g.:
    echo     set API_BASE_URL=https://<api-host>/api/v1
    echo.
    pause
    exit /b 1
)

echo [2/3] Fetching dependencies...
call flutter pub get
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to run flutter pub get.
    echo Please make sure Flutter is installed and added to your PATH.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Building Release APK for Android...
echo (This may take a few minutes for the first build)...
rem Release APKs must never embed GEMINI_API_KEY (BYOK_ARCHITECTURE_AND_PILOT_PLAN.md §7, B-02).
rem Server-side SMS fallback uses SMS_FALLBACK_GEMINI_KEY on the backend only.
call flutter build apk --release --dart-define=GEMINI_API_KEY= --dart-define=API_BASE_URL=%API_BASE_URL%
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed. Please check the error messages above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================================
echo       SUCCESS! APK Built Successfully!
echo ========================================================
echo.
echo Opening the folder containing your APK file...
explorer.exe "%~dp0mobile-app\mobile\build\app\outputs\flutter-apk"

echo.
echo You can now copy "app-release.apk" to your phone!
pause

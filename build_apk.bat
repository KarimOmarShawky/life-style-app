@echo off
title Building LifeStyle Mobile APK...
color 0A
echo ========================================================
echo       LifeStyle App - Automated APK Builder
echo ========================================================
echo.
echo [1/3] Navigating to mobile directory...
cd /d "%~dp0mobile-app\mobile"

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
call flutter build apk --release --dart-define=GEMINI_API_KEY=
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

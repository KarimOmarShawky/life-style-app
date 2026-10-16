#!/usr/bin/env python3
"""Run only the Android-free archive staging implementation on a scratch JVM.
No Android SDK, provider, Flutter, application service or user directory is used.
Tooling is outside the repository. Temporary encrypted test files/JAR are removed.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
JAVA_HOME = Path(os.environ.get('ARCHIVE_JAVA_HOME', '/home/user/.venv/lib/python3.11/site-packages/jdk4py/java-runtime'))
COMPILER = Path(os.environ.get('ARCHIVE_KOTLIN_COMPILER', '/home/user/tooling/node_modules/kotlin-compiler/bin/kotlinc'))
if not (JAVA_HOME / 'bin/java').is_file() or not COMPILER.is_file():
    raise SystemExit('BLOCKED: scratch JVM/Kotlin tools absent; Android/Flutter verification is separate')
with tempfile.TemporaryDirectory(prefix='lifestyle-archive-jvm-') as temporary:
    scratch = Path(temporary)
    (scratch / 'data').mkdir()
    env = {**os.environ, 'JAVA_HOME': str(JAVA_HOME)}
    commands = [
        ['bash', str(COMPILER), '-jvm-target', '17',
         str(ROOT / 'mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/AccountArchiveStage.kt'),
         str(ROOT / 'scripts/kotlin/AccountArchiveStageHarness.kt'), '-include-runtime', '-d', str(scratch / 'stage.jar')],
        [str(JAVA_HOME / 'bin/java'), '-jar', str(scratch / 'stage.jar'), str(scratch / 'data')]
    ]
    for command in commands:
        result = subprocess.run(command, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
        print(result.stdout, end='')
        if result.returncode:
            raise SystemExit(result.returncode)

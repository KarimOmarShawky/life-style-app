import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const secureStorageChannel = MethodChannel(
    'plugins.it_nomads.com/flutter_secure_storage',
  );
  final secureMemory = <String, String>{};

  setUp(() {
    secureMemory.clear();
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (call) async {
          final args =
              (call.arguments as Map<Object?, Object?>?) ??
              <Object?, Object?>{};
          final key = args['key'] as String?;
          switch (call.method) {
            case 'read':
              return key == null ? null : secureMemory[key];
            case 'write':
              final value = args['value'] as String?;
              if (key != null && value != null) {
                secureMemory[key] = value;
              }
              return null;
            case 'delete':
              if (key != null) {
                secureMemory.remove(key);
              }
              return null;
            case 'deleteAll':
              secureMemory.clear();
              return null;
            default:
              return null;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  group('SecureTokenStore (B-01)', () {
    test(
      'persists tokens in FlutterSecureStorage and scrubs legacy SharedPreferences',
      () async {
        SharedPreferences.setMockInitialValues({
          SecureTokenStore.storageKey: 'legacy-plaintext-session',
        });
        final store = SecureTokenStore(storage: const FlutterSecureStorage());
        final tokens = SessionTokens(
          accessToken: 'access-secure-1',
          refreshToken: 'refresh-secure-1',
          accessTokenExpiresAt: DateTime.utc(2030, 1, 1),
          refreshTokenExpiresAt: DateTime.utc(2030, 2, 1),
        );

        await store.write(tokens);

        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString(SecureTokenStore.storageKey), isNull);
        expect(secureMemory[SecureTokenStore.storageKey], isNotNull);

        final restored = await store.read();
        expect(restored?.accessToken, 'access-secure-1');
        expect(restored?.refreshToken, 'refresh-secure-1');

        await store.clear();
        expect(await store.read(), isNull);
        expect(secureMemory.containsKey(SecureTokenStore.storageKey), isFalse);
      },
    );

    test('clears corrupt secure-storage payload and returns null', () async {
      secureMemory[SecureTokenStore.storageKey] = '{not-valid-json';
      final store = SecureTokenStore(storage: const FlutterSecureStorage());

      expect(await store.read(), isNull);
      expect(secureMemory.containsKey(SecureTokenStore.storageKey), isFalse);
    });
  });

  group('AppConfig secret safety (B-02)', () {
    test('defaults geminiApiKey to empty string when unset', () {
      expect(AppConfig.geminiApiKey, isEmpty);
    });
  });
}

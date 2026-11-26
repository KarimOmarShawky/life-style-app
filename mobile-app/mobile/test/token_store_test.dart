import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
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
          (call.arguments as Map<Object?, Object?>?) ?? <Object?, Object?>{};
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

  group('session-bound storage races', () {
    SessionTokens tokens(String account) => SessionTokens(
      accessToken: 'access-$account', refreshToken: 'refresh-$account',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2031),
    );

    Future<void> race(String delayedMethod, {bool corrupt = false}) async {
      secureMemory[SecureTokenStore.storageKey] =
          corrupt ? '{bad' : tokens('a').encode();
      final started = Completer<void>();
      final release = Completer<void>();
      var delayed = false;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(secureStorageChannel, (call) async {
        final args = call.arguments as Map<Object?, Object?>;
        final key = args['key'] as String?;
        // A read captures the old value before the barrier.
        final observed = secureMemory[key];
        if (!delayed && call.method == delayedMethod) {
          delayed = true;
          started.complete();
          await release.future;
        }
        switch (call.method) {
          case 'read': return observed;
          case 'write': secureMemory[key!] = args['value'] as String; return null;
          case 'delete': secureMemory.remove(key); return null;
          default: return null;
        }
      });
      final storeA = SecureTokenStore(storage: const FlutterSecureStorage());
      final storeB = SecureTokenStore(storage: const FlutterSecureStorage());
      var generation = 1;
      bool currentA() => generation == 1;
      final Future<void> old;
      switch (delayedMethod) {
        case 'read': old = storeA.readForSession(currentA).then((_) {}); break;
        case 'write': old = storeA.writeForSession(tokens('a-rotated'), currentA); break;
        default: old = storeA.clearForSession(currentA);
      }
      final rejected = expectLater(old, throwsA(isA<StaleCredentialOperation>()));
      await started.future;
      generation = 2; // B begins while A owns the store slot.
      final newWrite = storeB.writeForSession(tokens('b'), () => generation == 2);
      release.complete();
      await rejected;
      await newWrite;
      expect((await storeB.read())?.accessToken, 'access-b');
    }

    test('delayed A read and B write are ordered', () => race('read'));
    test('delayed A write cannot overwrite B', () => race('write'));
    test('delayed A clear cannot delete B', () => race('delete'));
    test('malformed A cleanup cannot delete B', () => race('read', corrupt: true));

    test('logout queues behind pending refresh persistence', () async {
      final started = Completer<void>();
      final release = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(secureStorageChannel, (call) async {
        final args = call.arguments as Map<Object?, Object?>;
        final key = args['key'] as String?;
        if (call.method == 'write' && !started.isCompleted) {
          started.complete();
          await release.future;
        }
        switch (call.method) {
          case 'read': return secureMemory[key];
          case 'write': secureMemory[key!] = args['value'] as String; return null;
          case 'delete': secureMemory.remove(key); return null;
          default: return null;
        }
      });
      final store = SecureTokenStore(storage: const FlutterSecureStorage());
      var generation = 1;
      final refresh = store.writeForSession(tokens('a-rotated'), () => generation == 1);
      final rejected = expectLater(refresh, throwsA(isA<StaleCredentialOperation>()));
      await started.future;
      generation = 2;
      final logout = store.clearForSession(() => generation == 2);
      release.complete();
      await rejected;
      await logout;
      expect(await store.read(), isNull);
    });

    test('conditional cleanup and replacement preserve a newer token pair', () async {
      final store = SecureTokenStore(storage: const FlutterSecureStorage());
      final a = tokens('a');
      final b = tokens('b');
      await store.writeForSession(a, () => true);
      expect((await store.readForSession(() => true))?.accessToken, a.accessToken);
      await store.writeForSession(b, () => true);
      expect(await store.clearIfMatches(a, () => true), isFalse);
      expect(await store.replaceIfMatches(a, tokens('a-rotated'), () => true), isFalse);
      expect((await store.read())?.accessToken, b.accessToken);
      expect(await store.clearIfMatches(b, () => true), isTrue);
      expect(await store.read(), isNull);
    });

    test('stale conditional cleanup fails without deleting current credentials', () async {
      final store = SecureTokenStore(storage: const FlutterSecureStorage());
      final a = tokens('a');
      await store.write(a);
      await expectLater(store.clearIfMatches(a, () => false),
          throwsA(isA<StaleCredentialOperation>()));
      expect((await store.read())?.accessToken, a.accessToken);
    });

    test('A to B to A never revives the original generation', () async {
      final store = SecureTokenStore(storage: const FlutterSecureStorage());
      var generation = 1;
      bool oldA() => generation == 1;
      await store.writeForSession(tokens('a'), oldA);
      generation = 2;
      await store.writeForSession(tokens('b'), () => generation == 2);
      generation = 3;
      await store.writeForSession(tokens('a-new'), () => generation == 3);
      await expectLater(store.clearForSession(oldA), throwsA(isA<StaleCredentialOperation>()));
      expect((await store.read())?.accessToken, 'access-a-new');
    });

    test('valid concurrent operations preserve submission order', () async {
      final store = SecureTokenStore(storage: const FlutterSecureStorage());
      final first = store.writeForSession(tokens('a'), () => true);
      final second = store.writeForSession(tokens('b'), () => true);
      final read = store.readForSession(() => true);
      await Future.wait([first, second]);
      expect((await read)?.accessToken, 'access-b');
      await store.clearForSession(() => true);
      expect(await store.read(), isNull);
    });
  });

  // B-02 note: AppConfig previously exposed a compile-time Gemini key for
  // the retired BYOK design. The backend-proxy contract (no provider key
  // anywhere in the app) is pinned by scripts/ai-service-contract.test.mjs.
}

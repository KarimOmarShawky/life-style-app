import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/presentation/gemini_key_dialog.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

import 'support/fake_secure_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeSecureStorage storage;
  final ai = AiService.instance;

  setUp(() async {
    storage = FakeSecureStorage()..install();
    await ai.setUserApiKey(null);
  });

  test('failed writes report failure and do not enable the unsaved key',
      () async {
    storage.failWrite = true;
    await expectLater(ai.setUserApiKey('test-secret'),
        throwsA(isA<AiSecureStorageException>()));
    expect(await ai.getUserApiKey(), isEmpty);
    expect(storage.values, isEmpty);
  });

  test('failed deletion reports failure and removes key from active cache',
      () async {
    await ai.setUserApiKey('test-secret');
    storage.failDelete = true;
    await expectLater(
        ai.setUserApiKey(null), throwsA(isA<AiSecureStorageException>()));
    expect(await ai.getUserApiKey(), isEmpty);
    // The disk copy is not claimed deleted until a later successful retry.
    expect(storage.values.values, contains('test-secret'));
    storage.failDelete = false;
    await ai.setUserApiKey(null);
    expect(storage.values, isEmpty);
  });

  test('a pending write cannot restore the cache after clear starts', () async {
    storage.writeStarted = Completer<void>();
    storage.finishWrite = Completer<void>();
    final write = ai.setUserApiKey('test-secret');
    await storage.writeStarted!.future;
    final clear = ai.setUserApiKey(null);
    expect(await ai.getUserApiKey(), isEmpty);
    storage.finishWrite!.complete();
    await write;
    await clear;
    expect(await ai.getUserApiKey(), isEmpty);
    expect(storage.values, isEmpty);
  });

  test('unavailable secure storage prevents provider egress on read', () async {
    storage.failRead = true;
    final uncached = AiService.forTesting();
    var requests = 0;
    final client = MockClient((_) async {
      requests++;
      return http.Response('{}', 200);
    });
    addTearDown(client.close);
    await expectLater(
      uncached.streamMessage(
        conversationHistory: const [],
        newMessage: 'test',
        httpClient: client,
      ).toList(),
      throwsA(isA<AiSecureStorageException>()),
    );
    expect(requests, 0);
  });

  testWidgets('failed key save stays in dialog and shows error',
      (tester) async {
    storage.failWrite = true;
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(
          body: Builder(
              builder: (context) => FilledButton(
                    onPressed: () => showGeminiApiKeyDialog(context),
                    child: const Text('Open'),
                  ))),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'test-secret');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(
        find.text(
            'Secure key storage is unavailable. The change could not be confirmed.'),
        findsOneWidget);
    expect(await ai.getUserApiKey(), isEmpty);
  });
}

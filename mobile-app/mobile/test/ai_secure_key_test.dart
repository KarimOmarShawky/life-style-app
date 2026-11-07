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
    storage.writeStarted = Completer<void>();
    // The singleton may carry a Future created in another test's async zone.
    // Keep this widget's real storage behavior isolated to its own service.
    final widgetAi = AiService.forTesting();
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
                    onPressed: () =>
                        showGeminiApiKeyDialog(context, service: widgetAi),
                    child: const Text('Open'),
                  ))),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'test-secret');
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'test-secret');
    final save = find.widgetWithText(FilledButton, 'Save');
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    expect(save.hitTestable(), findsOneWidget,
        reason: 'The dialog save control must be reachable before tapping.');
    await tester.tap(save);
    // pumpAndSettle only observes scheduled frames, not a pending platform call.
    // Pump until the fake secure store observes the request, then render its
    // failure state. Keep a bounded wait so a broken callback fails clearly.
    for (var i = 0; i < 30 && !storage.writeStarted!.isCompleted; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(storage.writeStarted!.isCompleted, isTrue,
        reason: 'Save did not reach the mocked secure storage write.');
    await tester.pumpAndSettle();
    expect(storage.writeAttempts, 1);
    expect(find.byType(AlertDialog), findsOneWidget);
    final error = find.text(
        'Secure key storage is unavailable. The change could not be confirmed.');
    final dialogTexts = tester
        .widgetList<Text>(find.descendant(
            of: find.byType(AlertDialog), matching: find.byType(Text)))
        .map((widget) => widget.data)
        .whereType<String>()
        .toList();
    expect(error, findsOneWidget,
        reason:
            'The failed save must show the localized error; dialog text: $dialogTexts');
    expect(await widgetAi.getUserApiKey(), isEmpty);
  });

  testWidgets('successful key save closes dialog with no framework error',
      (tester) async {
    final widgetAi = AiService.forTesting();
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
                    onPressed: () =>
                        showGeminiApiKeyDialog(context, service: widgetAi),
                    child: const Text('Open'),
                  ))),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'test-secret');
    final save = find.widgetWithText(FilledButton, 'Save');
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    await tester.tap(save);
    // The dialog pops only after the secure-storage write completes; pump a
    // bounded number of frames until the route has fully closed. Closing the
    // route must not dispose the text controller early (device regression:
    // framework '_dependents.isEmpty' assertion right after saving a key).
    var dialogClosed = false;
    for (var i = 0; i < 50 && !dialogClosed; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      dialogClosed = find.byType(AlertDialog).evaluate().isEmpty;
    }
    expect(find.byType(AlertDialog), findsNothing,
        reason: 'A successful save must close the key dialog.');
    expect(storage.writeAttempts, 1);
    expect(await widgetAi.getUserApiKey(), 'test-secret');
    expect(tester.takeException(), isNull,
        reason: 'Closing the dialog after save must not raise.');
  });
}

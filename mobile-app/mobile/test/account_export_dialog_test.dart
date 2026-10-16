import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/auth/presentation/account_export_dialog.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const payload = '{"profile":{"id":"u-1"},"categories":[{"name":"Food"}]}';
  final writes = <MethodCall>[];
  var fail = false;

  setUp(() {
    writes.clear();
    fail = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        writes.add(call);
        if (fail) {
          throw PlatformException(code: 'PRIVATE', message: 'provider-secret');
        }
      }
      return null;
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Builder(
      builder: (context) => Scaffold(
          body: TextButton(
        onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => const AccountExportDialog(jsonText: payload)),
        child: const Text('Open'),
      )),
    )));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
  }

  Future<void> acknowledge(WidgetTester tester) async {
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
  }

  testWidgets('open and close never copy without explicit consent',
      (tester) async {
    await open(tester);
    expect(writes, isEmpty);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(writes, isEmpty);
  });

  testWidgets(
      'acknowledgement alone does not copy; explicit action copies exact JSON',
      (tester) async {
    await open(tester);
    await acknowledge(tester);
    expect(writes, isEmpty);
    await tester.tap(find.text('Copy metadata export'));
    await tester.pumpAndSettle();
    expect(writes, hasLength(1));
    expect(writes.single.arguments, {'text': payload});
    expect(find.text('Copied to clipboard. Close this screen when finished.'),
        findsOneWidget);
  });

  testWidgets('revoking acknowledgement prevents a copy', (tester) async {
    await open(tester);
    await acknowledge(tester);
    await acknowledge(tester);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
    expect(writes, isEmpty);
  });

  testWidgets(
      'platform failure shows no false success or provider details and permits retry',
      (tester) async {
    await open(tester);
    await acknowledge(tester);
    fail = true;
    await tester.tap(find.text('Copy metadata export'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Copied to clipboard.'), findsNothing);
    expect(find.textContaining('Could not copy the export.'), findsOneWidget);
    expect(find.textContaining('provider-secret'), findsNothing);
    fail = false;
    await tester.tap(find.text('Copy metadata export'));
    await tester.pumpAndSettle();
    expect(writes, hasLength(2));
    expect(find.text('Copied to clipboard. Close this screen when finished.'),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/auth/presentation/current_password_dialog.dart';

void main() {
  Future<void> open(WidgetTester tester, ValueChanged<String?> onResult) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(builder: (context) => Scaffold(
        body: TextButton(
          onPressed: () async => onResult(await showDialog<String>(
            context: context,
            builder: (_) => const CurrentPasswordDialog(),
          )),
          child: const Text('Open'),
        ),
      )),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
  }

  testWidgets('empty proof stays open; valid proof preserves whitespace', (tester) async {
    String? proof;
    await open(tester, (value) => proof = value);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.obscureText, isTrue);
    expect(field.enableSuggestions, isFalse);
    expect(field.enableIMEPersonalizedLearning, isFalse);
    await tester.tap(find.text('Verify and continue'));
    await tester.pumpAndSettle();
    expect(find.byType(CurrentPasswordDialog), findsOneWidget);
    await tester.enterText(find.byType(TextField), ' Password with spaces ');
    await tester.tap(find.text('Verify and continue'));
    await tester.pumpAndSettle();
    expect(proof, ' Password with spaces ');
    expect(find.byType(CurrentPasswordDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancel discards proof and reopening starts empty', (tester) async {
    String? proof = 'not submitted';
    await open(tester, (value) => proof = value);
    await tester.enterText(find.byType(TextField), 'discard me');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(proof, isNull);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
  });
}

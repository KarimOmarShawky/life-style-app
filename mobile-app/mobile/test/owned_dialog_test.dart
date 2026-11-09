import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/core/widgets/owned_dialog.dart';

void main() {
  testWidgets(
      'cancelling a dialog with a text field does not crash during exit',
      (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (dialogContext) => OwnedDialog(
                    controllers: [controller],
                    child: AlertDialog(
                      title: const Text('Add task'),
                      content: TextField(controller: controller),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(dialogContext).pop(),
                          child: const Text('Cancel'),
                        ),
                      ],
                    ),
                  ),
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Add task'), findsOneWidget);

    // The regression: pressing Cancel used to dispose the controller while
    // the dialog route was still animating out, throwing the Flutter
    // assertion '_dependents.isEmpty'.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Add task'), findsNothing);
  });
}

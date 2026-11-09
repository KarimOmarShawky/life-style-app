import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_app_picker_screen.dart';

void main() {
  testWidgets('app picker searches, selects and returns chosen apps',
      (tester) async {
    Map<String, String>? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  result =
                      await Navigator.of(context).push<Map<String, String>>(
                    MaterialPageRoute<Map<String, String>>(
                      builder: (_) => DetoxAppPickerScreen(
                        loadApps: () async => const [
                          {
                            'label': 'Instagram',
                            'packageName': 'com.instagram.android',
                          },
                          {
                            'label': 'YouTube',
                            'packageName': 'com.google.android.youtube',
                          },
                        ],
                        initialSelected: const {},
                      ),
                    ),
                  );
                },
                child: const Text('Open picker'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open picker'));
    await tester.pumpAndSettle();
    expect(find.text('Instagram'), findsOneWidget);
    expect(find.text('YouTube'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'you');
    await tester.pump();
    expect(find.text('Instagram'), findsNothing);
    expect(find.text('YouTube'), findsOneWidget);

    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    expect(find.text('Use 1 selected app'), findsOneWidget);

    await tester.tap(find.text('Use 1 selected app'));
    await tester.pumpAndSettle();
    expect(result, {'com.google.android.youtube': 'YouTube'});
  });

  testWidgets('app picker explains an unavailable list and can retry',
      (tester) async {
    var attempts = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: DetoxAppPickerScreen(
          loadApps: () async {
            attempts++;
            if (attempts == 1) throw StateError('native list unavailable');
            return const [
              {'label': 'Instagram', 'packageName': 'com.instagram.android'},
            ];
          },
          initialSelected: const {},
        ),
      ),
    );

    await tester.pump();
    await tester.pump();
    expect(find.text('Application selection is unavailable'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Instagram'), findsOneWidget);
    expect(attempts, 2);
  });
}

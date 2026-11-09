import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_provider.dart';
import 'package:lifestyle_mobile/features/focus/presentation/focus_home_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';

class _FakeFocusShieldController extends FocusShieldController {
  @override
  Future<FocusData> build() async => FocusData(enabled: false);
}

void main() {
  testWidgets(
      'Focus home leads with app selection, then timer, shield and history',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          detoxProvider.overrideWith((ref) => DetoxController(null)),
          focusShieldProvider.overrideWith(() => _FakeFocusShieldController()),
        ],
        child: const MaterialApp(home: FocusHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    // Digital Detox (pick your own apps + session length) comes first.
    expect(
        find.text('Choose apps. Focus without the clutter.'), findsOneWidget);
    expect(find.text('Choose applications'), findsOneWidget);
    // Nothing is pre-filled or suggested.
    expect(find.text('No applications selected yet.'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Focus history'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Focus Timer'), findsOneWidget);
    expect(find.text('Focus Shield'), findsOneWidget);
    expect(find.text('Focus history'), findsOneWidget);
  });
}

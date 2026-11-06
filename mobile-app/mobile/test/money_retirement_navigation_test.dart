import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/money/presentation/subscriptions_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/features/more/presentation/more_screen.dart';

void main() {
  testWidgets('subscriptions remain reachable from More without the money section',
      (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [subscriptionsProvider.overrideWith((ref) async => [])],
      child: const MaterialApp(home: MoreScreen()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Subscriptions & Bills'));
    await tester.pumpAndSettle();
    expect(find.byType(SubscriptionsScreen), findsOneWidget);
    expect(find.text('No active subscriptions found.'), findsOneWidget);
    expect(find.byTooltip('Remind before renewal'), findsNothing);
  });
}

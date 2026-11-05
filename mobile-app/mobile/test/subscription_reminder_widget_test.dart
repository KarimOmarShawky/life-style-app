import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';
import 'package:lifestyle_mobile/features/money/presentation/subscriptions_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class _SignedOutAuth extends AuthController {
  @override
  Future<AppUser?> build() async => null;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const subscription = Subscription(
    id: '6f1c2d3e-0000-4000-8000-000000000001',
    name: 'Sample',
    amount: '10.00',
    currency: 'USD',
    billingUnit: 'month',
    billingInterval: 1,
    anchorDate: '2099-01-31',
    nextBillingDate: '2099-01-31',
    status: 'active',
    monthlyEquivalent: '10.0000',
    daysUntilNextBilling: 30,
    version: 1,
  );
  testWidgets('subscription reminders have no manual action', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        subscriptionsProvider.overrideWith((ref) async => [subscription]),
      ],
      child: const MaterialApp(home: SubscriptionsScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Sample'), findsOneWidget);
    expect(find.byTooltip('Remind before renewal'), findsNothing);
    expect(find.byIcon(Icons.alarm_on_outlined), findsNothing);
    expect(find.text('Renewal reminder set!'), findsNothing);
  });

  testWidgets('failed automatic sync is reported, not shown as success',
      (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith(_SignedOutAuth.new),
        subscriptionsProvider.overrideWith((ref) async => [subscription]),
      ],
      child: const MaterialApp(home: SubscriptionsScreen()),
    ));
    await tester.pumpAndSettle();
    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;
    expect(
      find.text(
          const AppLocalizations(Locale('en')).subscriptionReminderUnavailable),
      findsOneWidget,
    );
    expect(find.text('Renewal reminder set!'), findsNothing);
  });
}

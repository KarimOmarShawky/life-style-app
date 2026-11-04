import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';
import 'package:lifestyle_mobile/features/money/presentation/subscriptions_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const notificationChannel =
      MethodChannel('dexterous.com/flutter/local_notifications');
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
  final calls = <String>[];

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(notificationChannel, (call) async {
      calls.add(call.method);
      throw PlatformException(code: 'notifications_unavailable');
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(notificationChannel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('a failed notification attempt cannot report a reminder was set',
      (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        subscriptionsProvider.overrideWith((ref) async => [subscription]),
      ],
      child: const MaterialApp(home: SubscriptionsScreen()),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Remind before renewal'));
    await tester.pumpAndSettle();

    expect(calls, isNotEmpty);
    expect(find.text('Renewal reminder set!'), findsNothing);
  });
}

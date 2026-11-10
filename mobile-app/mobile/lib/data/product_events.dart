import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

/// Closed list of content-free usage events (feature guide G5). Mirrors
/// `backend/src/features/product-events/product-events.types.ts`; a new name
/// needs a backend migration and an owner privacy review.
enum ProductEvent {
  appOpened('app_opened'),
  onboardingStarted('onboarding_started'),
  onboardingCompleted('onboarding_completed'),
  onboardingSkipped('onboarding_skipped'),
  taskCompleted('task_completed'),
  habitCheckedIn('habit_checked_in');

  const ProductEvent(this.wireName);

  final String wireName;
}

/// Version reported with events. `test/product_events_test.dart` keeps it
/// equal to the `version:` line of pubspec.yaml.
const String appVersion = '1.0.1+1';

typedef ProductEventSender = Future<void> Function(Map<String, Object> body);

/// Fire-and-forget recorder. It never throws or blocks a user flow, sends at
/// most one request per account, event and day, and sends nothing for an
/// account that opted out or whose server does not support usage statistics
/// yet ([AppUser.productEventsEnabled] is null). Bodies carry only the event
/// name, platform and app version: no titles, ids or timestamps.
class ProductEventsClient {
  ProductEventsClient({
    required ProductEventSender send,
    DateTime Function()? clock,
    TargetPlatform? platform,
  })  : _send = send,
        _clock = clock ?? DateTime.now,
        _platform = platform;

  final ProductEventSender _send;
  final DateTime Function() _clock;
  final TargetPlatform? _platform;
  final Set<String> _sent = <String>{};

  void record(AppUser? user, ProductEvent event) {
    if (user == null || user.productEventsEnabled != true) return;
    final now = _clock();
    final key =
        '${user.id}|${event.wireName}|${now.year}-${now.month}-${now.day}';
    if (!_sent.add(key)) return;
    unawaited(_deliver(key, event));
  }

  Future<void> _deliver(String key, ProductEvent event) async {
    try {
      await _send(<String, Object>{
        'event': event.wireName,
        'platform': _platformName(_platform ?? defaultTargetPlatform),
        'appVersion': appVersion,
      });
    } catch (_) {
      // Usage statistics never surface errors; allow a later retry.
      _sent.remove(key);
    }
  }

  static String _platformName(TargetPlatform platform) => switch (platform) {
        TargetPlatform.android => 'android',
        TargetPlatform.iOS => 'ios',
        _ => 'unknown',
      };
}

final productEventsClientProvider = Provider<ProductEventsClient>((ref) {
  final api = ref.watch(apiClientProvider);
  return ProductEventsClient(
    send: (body) async {
      await api.post('product-events', body: body);
    },
  );
});

extension ProductEventsRecording on WidgetRef {
  /// Records [event] for the signed-in account; see [ProductEventsClient].
  /// Never throws: usage statistics must not break the flow that calls it.
  void recordProductEvent(ProductEvent event) {
    try {
      final user = read(authProvider).valueOrNull;
      if (user == null || user.productEventsEnabled != true) return;
      read(productEventsClientProvider).record(user, event);
    } catch (_) {
      // For example an unconfigured API client; nothing is recorded.
    }
  }
}

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';

import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.instance.init();
  final initialLocation =
      WidgetsBinding.instance.platformDispatcher.defaultRouteName;
  runApp(ProviderScope(child: LifeStyleApp(initialLocation: initialLocation)));
}

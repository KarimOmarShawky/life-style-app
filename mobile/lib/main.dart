import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final initialLocation =
      WidgetsBinding.instance.platformDispatcher.defaultRouteName;
  runApp(ProviderScope(child: LifeStyleApp(initialLocation: initialLocation)));
}

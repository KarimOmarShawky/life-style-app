import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/home/presentation/home_shell.dart';

Widget _barWith(NavigationDestinationLabelBehavior behavior) {
  return MaterialApp(
    home: Scaffold(
      bottomNavigationBar: NavigationBar(
        labelBehavior: behavior,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.task_alt), label: 'Tasks'),
          NavigationDestination(icon: Icon(Icons.repeat), label: 'Habits'),
          NavigationDestination(
              icon: Icon(Icons.auto_awesome), label: 'AI Assistant'),
          NavigationDestination(icon: Icon(Icons.note_alt), label: 'Notes'),
          NavigationDestination(
              icon: Icon(Icons.timer_outlined), label: 'Focus'),
          NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    ),
  );
}

void main() {
  group('labelBehaviorForTextScale', () {
    test('shows all labels at normal sizes', () {
      expect(labelBehaviorForTextScale(1.0),
          NavigationDestinationLabelBehavior.alwaysShow);
      expect(labelBehaviorForTextScale(1.4),
          NavigationDestinationLabelBehavior.alwaysShow);
    });

    test('keeps only the selected label when text is large', () {
      expect(labelBehaviorForTextScale(1.41),
          NavigationDestinationLabelBehavior.onlyShowSelected);
      expect(labelBehaviorForTextScale(2.5),
          NavigationDestinationLabelBehavior.onlyShowSelected);
    });
  });

  testWidgets('six tabs stay laid out at 2x text on a narrow screen',
      (tester) async {
    tester.view.physicalSize = const Size(320 * 2, 640 * 2);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_barWith(labelBehaviorForTextScale(2.0)));
    expect(tester.takeException(), isNull);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Tasks'), findsOneWidget);
  });
}

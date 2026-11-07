import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_markdown.dart';

/// Recursively collects the visible text of every [Text] / [RichText]
/// under [root].
String _visibleText(WidgetTester tester, Finder root) {
  final buffer = StringBuffer();
  final elements = find
      .descendant(of: root, matching: find.byType(Text))
      .evaluate()
      .toList();
  for (final element in elements) {
    final widget = element.widget as Text;
    final data = widget.data;
    if (data != null) {
      buffer.writeln(data);
    } else if (widget.textSpan != null) {
      buffer.writeln(widget.textSpan!.toPlainText());
    }
  }
  return buffer.toString();
}

Future<void> _pump(WidgetTester tester, String markdown) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: AiMarkdownText(markdown),
      ),
    ),
  );
}

void main() {
  testWidgets('strips bold markers and renders bold text', (tester) async {
    await _pump(tester, 'This is **important** today.');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('important'));
    expect(text, isNot(contains('**')));
  });

  testWidgets('renders headings without the hash markers', (tester) async {
    await _pump(tester, '## Your plan');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('Your plan'));
    expect(text, isNot(contains('##')));
  });

  testWidgets('renders unordered list items as separate lines', (tester) async {
    await _pump(tester, '- First step\n- Second step');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('First step'));
    expect(text, contains('Second step'));
    expect(text, contains('•'));
    expect(text, isNot(contains('- First')));
  });

  testWidgets('renders ordered list with numbers', (tester) async {
    await _pump(tester, '1. Wake up\n2. Exercise');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('1.'));
    expect(text, contains('Wake up'));
    expect(text, contains('2.'));
    expect(text, contains('Exercise'));
  });

  testWidgets('shows link label without the URL syntax', (tester) async {
    await _pump(tester, 'Read [the guide](https://example.com) now.');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('the guide'));
    expect(text, isNot(contains('https://example.com')));
    expect(text, isNot(contains('](')));
  });

  testWidgets('renders inline code without backticks', (tester) async {
    await _pump(tester, 'Run `npm test` first.');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('npm test'));
    expect(text, isNot(contains('`')));
  });

  testWidgets('plain text passes through unchanged', (tester) async {
    await _pump(tester, 'Just a normal sentence.');
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('Just a normal sentence.'));
  });

  testWidgets('empty input renders nothing and does not crash', (tester) async {
    await _pump(tester, '');
    expect(find.byType(AiMarkdownText), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unmatched markers degrade gracefully', (tester) async {
    await _pump(tester, 'A stray ** marker here');
    expect(find.byType(AiMarkdownText), findsOneWidget);
    expect(tester.takeException(), isNull);
    final text = _visibleText(tester, find.byType(AiMarkdownText));
    expect(text, contains('stray'));
  });
}

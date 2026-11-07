import 'package:flutter/material.dart';

/// Minimal, dependency-free Markdown renderer for AI assistant replies.
///
/// Gemini answers arrive as Markdown (`**bold**`, `## headings`, `- lists`)
/// and were previously shown through a plain [Text], so users saw the raw
/// asterisks and hashes. This renders the small subset the assistant
/// actually produces — headings, bold/italic, inline code, links (label
/// only), unordered/ordered lists and paragraphs — with the ambient text
/// style, and degrades gracefully on unmatched markers by keeping them
/// readable instead of crashing or hiding text.
class AiMarkdownText extends StatelessWidget {
  const AiMarkdownText(this.text, {super.key, this.style});

  final String text;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final base = style ?? DefaultTextStyle.of(context).style;
    final blocks = _parseBlocks(text);
    if (blocks.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < blocks.length; i++) ...[
          if (i > 0) const SizedBox(height: 6),
          blocks[i].build(base),
        ],
      ],
    );
  }
}

abstract class _Block {
  Widget build(TextStyle base);
}

class _Paragraph extends _Block {
  _Paragraph(this.text);
  final String text;
  @override
  Widget build(TextStyle base) => Text.rich(_inline(text, base), style: base);
}

class _Heading extends _Block {
  _Heading(this.text, this.level);
  final String text;
  final int level;
  @override
  Widget build(TextStyle base) {
    final scale = switch (level) {
      1 => 1.3,
      2 => 1.18,
      _ => 1.08,
    };
    final headingStyle = base.copyWith(
      fontSize: (base.fontSize ?? 14) * scale,
      fontWeight: FontWeight.bold,
    );
    return Text.rich(_inline(text, headingStyle), style: headingStyle);
  }
}

class _ListBlock extends _Block {
  _ListBlock(this.items, {required this.ordered});
  final List<String> items;
  final bool ordered;
  @override
  Widget build(TextStyle base) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < items.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: ordered ? 20 : 14,
                  child: Text(ordered ? '${i + 1}.' : '•', style: base),
                ),
                Expanded(
                  child: Text.rich(_inline(items[i], base), style: base),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

final _headingRe = RegExp(r'^(#{1,6})\s+(.*)$');
final _bulletRe = RegExp(r'^\s*[-*•]\s+(.*)$');
final _orderedRe = RegExp(r'^\s*\d+[.)]\s+(.*)$');

List<_Block> _parseBlocks(String source) {
  final blocks = <_Block>[];
  final paragraph = <String>[];
  List<String>? listItems;
  var listOrdered = false;

  void flushParagraph() {
    if (paragraph.isNotEmpty) {
      blocks.add(_Paragraph(paragraph.join(' ')));
      paragraph.clear();
    }
  }

  void flushList() {
    if (listItems != null && listItems!.isNotEmpty) {
      blocks.add(_ListBlock(List.of(listItems!), ordered: listOrdered));
    }
    listItems = null;
  }

  for (final rawLine in source.split('\n')) {
    final line = rawLine.trimRight();
    final trimmed = line.trim();
    if (trimmed.isEmpty) {
      flushParagraph();
      flushList();
      continue;
    }
    final heading = _headingRe.firstMatch(trimmed);
    if (heading != null) {
      flushParagraph();
      flushList();
      blocks.add(_Heading(heading.group(2)!.trim(), heading.group(1)!.length));
      continue;
    }
    final bullet = _bulletRe.firstMatch(line);
    if (bullet != null) {
      flushParagraph();
      if (listItems == null || listOrdered) {
        flushList();
        listItems = <String>[];
        listOrdered = false;
      }
      listItems!.add(bullet.group(1)!.trim());
      continue;
    }
    final ordered = _orderedRe.firstMatch(line);
    if (ordered != null) {
      flushParagraph();
      if (listItems == null || !listOrdered) {
        flushList();
        listItems = <String>[];
        listOrdered = true;
      }
      listItems!.add(ordered.group(1)!.trim());
      continue;
    }
    flushList();
    paragraph.add(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

final _inlineRe = RegExp(
  r'(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]*\))',
);

TextSpan _inline(String text, TextStyle base) {
  final spans = <InlineSpan>[];
  var last = 0;
  for (final match in _inlineRe.allMatches(text)) {
    if (match.start > last) {
      spans.add(TextSpan(text: text.substring(last, match.start)));
    }
    final token = match.group(0)!;
    if (token.startsWith('**') && token.endsWith('**')) {
      spans.add(TextSpan(
        text: token.substring(2, token.length - 2),
        style: const TextStyle(fontWeight: FontWeight.bold),
      ));
    } else if (token.startsWith('__') && token.endsWith('__')) {
      spans.add(TextSpan(
        text: token.substring(2, token.length - 2),
        style: const TextStyle(fontWeight: FontWeight.bold),
      ));
    } else if (token.startsWith('`') && token.endsWith('`')) {
      spans.add(TextSpan(
        text: token.substring(1, token.length - 1),
        style: const TextStyle(fontFamily: 'monospace'),
      ));
    } else if (token.startsWith('[')) {
      final close = token.indexOf(']');
      spans.add(TextSpan(
        text: token.substring(1, close),
        style: const TextStyle(decoration: TextDecoration.underline),
      ));
    } else {
      spans.add(TextSpan(
        text: token.substring(1, token.length - 1),
        style: const TextStyle(fontStyle: FontStyle.italic),
      ));
    }
    last = match.end;
  }
  if (last < text.length) {
    spans.add(TextSpan(text: text.substring(last)));
  }
  if (spans.isEmpty) {
    spans.add(TextSpan(text: text));
  }
  return TextSpan(style: base, children: spans);
}

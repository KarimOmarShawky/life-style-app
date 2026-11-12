/// Cuts [text] to at most [maxUnits] UTF-16 code units without splitting a
/// surrogate pair, so the backend (which counts the same units) accepts it.
String clampUtf16(String text, int maxUnits) {
  if (text.length <= maxUnits) return text;
  final buffer = StringBuffer();
  var used = 0;
  for (final rune in text.runes) {
    final units = rune > 0xFFFF ? 2 : 1;
    if (used + units > maxUnits) break;
    buffer.writeCharCode(rune);
    used += units;
  }
  return buffer.toString();
}

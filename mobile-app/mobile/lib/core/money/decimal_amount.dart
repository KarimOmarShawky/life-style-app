/// Exact signed fixed-scale arithmetic matching PostgreSQL numeric(...,4).
/// Floating point is used only for bounded UI progress, never monetary values.
class DecimalAmount implements Comparable<DecimalAmount> {
  const DecimalAmount._(this.units);
  final BigInt units;
  static final zero = DecimalAmount._(BigInt.zero);

  factory DecimalAmount.parse(String text) {
    final match =
        RegExp(r'^(-?)(\d+)(?:\.(\d{1,4}))?$').firstMatch(text.trim());
    if (match == null)
      throw const FormatException('Invalid decimal monetary amount');
    final absolute =
        BigInt.parse('${match[2]}${(match[3] ?? '').padRight(4, '0')}');
    return DecimalAmount._(match[1] == '-' ? -absolute : absolute);
  }
  static DecimalAmount? tryParse(String text) {
    try {
      return DecimalAmount.parse(text);
    } on FormatException {
      return null;
    }
  }

  bool get isPositive => units > BigInt.zero;
  DecimalAmount operator +(DecimalAmount other) =>
      DecimalAmount._(units + other.units);
  DecimalAmount operator -(DecimalAmount other) =>
      DecimalAmount._(units - other.units);
  @override
  int compareTo(DecimalAmount other) => units.compareTo(other.units);

  /// HALF_UP, including negative ties, using only integer quotient/remainder.
  String format(String currency) {
    final exponent = currencyExponent(currency);
    final divisor = BigInt.from(10).pow(4 - exponent);
    final absolute = units.abs();
    var minor = absolute ~/ divisor;
    if ((absolute % divisor) * BigInt.from(2) >= divisor) minor += BigInt.one;
    final digits = minor.toString().padLeft(exponent + 1, '0');
    final sign = units.isNegative && minor != BigInt.zero ? '-' : '';
    if (exponent == 0) return '$sign$digits';
    final split = digits.length - exponent;
    return '$sign${digits.substring(0, split)}.${digits.substring(split)}';
  }

  double progressAgainst(DecimalAmount limit) {
    if (!limit.isPositive || units <= BigInt.zero) return 0;
    if (units >= limit.units) return 1;
    // This conversion is bounded and represents a dimensionless progress ratio.
    return ((units * BigInt.from(10000)) ~/ limit.units).toInt() / 10000;
  }

  String percentAgainst(DecimalAmount limit) {
    if (!limit.isPositive) return '0.0';
    final tenths = (units.abs() * BigInt.from(1000)) ~/ limit.units;
    return '${units.isNegative ? '-' : ''}${tenths ~/ BigInt.from(10)}.${tenths % BigInt.from(10)}';
  }
}

// Kept aligned with backend money.dto.ts; four decimals remain storage precision.
int currencyExponent(String currency) {
  const zero = {
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'UYI',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF'
  };
  const three = {'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'};
  if (zero.contains(currency)) return 0;
  if (three.contains(currency)) return 3;
  if (currency == 'CLF' || currency == 'UYW') return 4;
  return 2;
}

Map<String, DecimalAmount> sumAmountsByCurrency(
    Iterable<({String currency, String amount})> values) {
  final totals = <String, DecimalAmount>{};
  for (final value in values) {
    totals[value.currency] = (totals[value.currency] ?? DecimalAmount.zero) +
        DecimalAmount.parse(value.amount);
  }
  return totals;
}

import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/core/money/decimal_amount.dart';

void main() {
  test('exact arithmetic never passes through double', () {
    final result = DecimalAmount.parse('0.10') + DecimalAmount.parse('0.20');
    expect(result.format('USD'), '0.30');
    expect((DecimalAmount.parse('1.00') - result).format('USD'), '0.70');
    expect(
        (DecimalAmount.parse('999999999999999.9999') +
                DecimalAmount.parse('0.0001'))
            .format('KWD'),
        '1000000000000000.000');
  });
  test('currency-specific HALF_UP formatting handles ties and negatives', () {
    expect(DecimalAmount.parse('1.005').format('USD'), '1.01');
    expect(DecimalAmount.parse('-1.005').format('USD'), '-1.01');
    expect(DecimalAmount.parse('500').format('JPY'), '500');
    expect(DecimalAmount.parse('12.345').format('KWD'), '12.345');
    expect(DecimalAmount.parse('0.0005').format('KWD'), '0.001');
    expect(DecimalAmount.parse('0.0001').format('CLF'), '0.0001');
  });
  test('currency grouping does not invent exchange rates or relabel sums', () {
    final totals = sumAmountsByCurrency([
      (currency: 'USD', amount: '0.10'),
      (currency: 'USD', amount: '0.20'),
      (currency: 'JPY', amount: '500'),
      (currency: 'KWD', amount: '12.345')
    ]);
    expect(totals.length, 3);
    expect(totals['USD']!.format('USD'), '0.30');
    expect(totals['JPY']!.format('JPY'), '500');
    expect(totals['KWD']!.format('KWD'), '12.345');
  });
  test(
      'progress only converts bounded dimensionless ratios; zero limits are safe',
      () {
    expect(
        DecimalAmount.parse('2').progressAgainst(DecimalAmount.parse('1')), 1);
    expect(
        DecimalAmount.parse('0.25').progressAgainst(DecimalAmount.parse('1')),
        0.25);
    expect(DecimalAmount.parse('1').progressAgainst(DecimalAmount.zero), 0);
    expect(DecimalAmount.parse('1').percentAgainst(DecimalAmount.parse('3')),
        '33.3');
  });
  test(
      'malformed/over-precision input is rejected instead of silently becoming zero',
      () {
    for (final value in ['NaN', '1e3', '1.00001', '', '1,000']) {
      expect(DecimalAmount.tryParse(value), isNull);
    }
  });
}

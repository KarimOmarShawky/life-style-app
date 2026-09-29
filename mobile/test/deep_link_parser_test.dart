import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/navigation/deep_link_parser.dart';

void main() {
  group('DeepLinkParser', () {
    test('routes only known application destinations', () {
      expect(DeepLinkParser.routeFor('lifestyle://tasks'), '/tasks');
      expect(DeepLinkParser.routeFor('lifestyle://habits'), '/habits');
      expect(DeepLinkParser.routeFor('lifestyle://money'), '/money');
      expect(DeepLinkParser.routeFor('lifestyle://notes'), '/notes');
      expect(DeepLinkParser.routeFor('lifestyle://profile'), '/profile');
      expect(DeepLinkParser.routeFor('/tasks'), '/tasks');
    });

    test(
      'drops query and fragment data and rejects unknown routes/schemes',
      () {
        expect(
          DeepLinkParser.routeFor('lifestyle://profile?access_token=secret'),
          '/profile',
        );
        expect(DeepLinkParser.routeFor('lifestyle://admin'), '/tasks');
        expect(DeepLinkParser.routeFor('javascript:alert(1)'), '/tasks');
        expect(
          DeepLinkParser.routeFor('https://untrusted.example/profile'),
          '/tasks',
        );
        expect(DeepLinkParser.routeFor(null), '/tasks');
      },
    );
  });
}

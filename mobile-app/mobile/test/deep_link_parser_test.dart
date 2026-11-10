import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/navigation/deep_link_parser.dart';

void main() {
  group('DeepLinkParser', () {
    test('routes only known application destinations', () {
      expect(DeepLinkParser.routeFor('lifestyle://tasks'), '/tasks');
      expect(DeepLinkParser.routeFor('lifestyle://habits'), '/habits');
      expect(DeepLinkParser.routeFor('lifestyle://money'), '/tasks');
      expect(DeepLinkParser.routeFor('lifestyle://notes'), '/notes');
      expect(DeepLinkParser.routeFor('lifestyle://profile'), '/profile');
      expect(DeepLinkParser.routeFor('/tasks'), '/tasks');
    });

    test('accepts the path form used by the widget and notifications (G3)', () {
      expect(DeepLinkParser.routeFor('lifestyle:///focus'), '/focus');
      expect(DeepLinkParser.routeFor('lifestyle:///daily-plan'), '/daily-plan');
      expect(DeepLinkParser.routeFor('lifestyle:///focus/'), '/focus');
      expect(DeepLinkParser.routeFor('/daily-plan?ref=widget'), '/daily-plan');
      expect(DeepLinkParser.routeFor('lifestyle:///admin'), '/tasks');
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

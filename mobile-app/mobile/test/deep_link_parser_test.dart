import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/navigation/deep_link_parser.dart';

void main() {
  group('DeepLinkParser', () {
    test('routes only known application destinations and valid §10.3 entity UUID deep links', () {
      expect(DeepLinkParser.routeFor('lifestyle://tasks'), '/tasks');
      expect(DeepLinkParser.routeFor('lifestyle://habits'), '/habits');
      expect(DeepLinkParser.routeFor('lifestyle://money'), '/money');
      expect(DeepLinkParser.routeFor('lifestyle://notes'), '/notes');
      expect(DeepLinkParser.routeFor('lifestyle://profile'), '/profile');
      expect(DeepLinkParser.routeFor('lifestyle://ai'), '/ai');
      expect(DeepLinkParser.routeFor('/tasks'), '/tasks');
      expect(
        DeepLinkParser.routeFor(
          'lifestyle://habits/6f0c2d3e-0000-4000-8000-000000000001',
        ),
        '/habits',
      );
      expect(
        DeepLinkParser.routeFor(
          'lifestyle://notes/6f0c2d3e-0000-4000-8000-000000000001',
        ),
        '/notes',
      );
      expect(
        DeepLinkParser.routeFor(
          'lifestyle://money/transactions/6f0c2d3e-0000-4000-8000-000000000001',
        ),
        '/money',
      );
      expect(
        DeepLinkParser.routeFor(
          'lifestyle://money/subscriptions/6f0c2d3e-0000-4000-8000-000000000001',
        ),
        '/money',
      );
    });

    test(
      'drops query and fragment data and rejects unknown routes/schemes or non-UUID entity IDs',
      () {
        expect(
          DeepLinkParser.routeFor('lifestyle://profile?access_token=secret'),
          '/profile',
        );
        expect(
          DeepLinkParser.routeFor('lifestyle://notes/not-a-uuid'),
          '/tasks',
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

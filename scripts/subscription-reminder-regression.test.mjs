import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const screen = readFileSync('mobile-app/mobile/lib/features/money/presentation/subscriptions_screen.dart', 'utf8');
const card = readFileSync('mobile-app/mobile/lib/features/money/presentation/widgets/subscription_card.dart', 'utf8');

test('subscription reminder controls do not claim scheduling after an immediate notification', () => {
  for (const source of [screen, card]) {
    assert.doesNotMatch(source, /showInstantNotification\(/,
      'an immediate notification is not a scheduled renewal reminder');
  }
});

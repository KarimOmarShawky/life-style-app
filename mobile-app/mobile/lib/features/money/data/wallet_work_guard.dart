/// A process-local check for an observed wallet identity transition.
/// This is not proof that a queued message belongs to the active account.
class WalletWorkEnded implements Exception {
  const WalletWorkEnded();
}

class WalletWorkGuard {
  const WalletWorkGuard(this._stillCurrent);

  final bool Function()? _stillCurrent;

  void check() {
    final current = _stillCurrent;
    if (current != null && !current()) {
      throw const WalletWorkEnded();
    }
  }
}

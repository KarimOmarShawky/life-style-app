import 'dart:async';
import 'archive_verifier.dart';

/// Scoped to one export, never closes the shared API client/session.
class ArchiveCancellation {
  final _cancelled = Completer<void>();
  bool get isCancelled => _cancelled.isCompleted;
  Future<void> get whenCancelled => _cancelled.future;
  void cancel() {
    if (!isCancelled) _cancelled.complete();
  }

  void check() {
    if (isCancelled) {
      throw const ArchiveException();
    }
  }

  Future<T> bind<T>(Future<T> operation) => Future.any<T>([
        operation,
        whenCancelled.then<T>((_) => throw const ArchiveException()),
      ]);
}

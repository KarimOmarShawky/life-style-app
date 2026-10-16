// Authored widget tests; actual Flutter/device execution remains a separate gate.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/features/auth/presentation/account_archive_dialog.dart';
import 'account_archive_test.dart' show FakeStaging, userId, fixture;

void main() {
  testWidgets(
      'consent and proof precede download; verifying alone never opens a document picker',
      (tester) async {
    final stage = FakeStaging(), cancel = ArchiveCancellation();
    var downloads = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: AccountArchiveDialog(
                userId: userId,
                cancel: cancel,
                staging: stage,
                download: (proof, _) {
                  downloads++;
                  expect(proof, 'proof');
                  return Stream.value(fixture());
                }))));
    expect(stage.begins, 0);
    expect(downloads, 0);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Download and verify'))
            .onPressed,
        isNull);
    await tester.enterText(find.byType(TextField), 'proof');
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download and verify'));
    await tester.pumpAndSettle();
    expect(downloads, 1);
    expect(stage.sealed, true);
    expect(stage.saves, 0);
    expect(find.byType(TextField), findsNothing);
    expect(find.textContaining('Verified archive records: 3'), findsOneWidget);
    stage.saveResult = false;
    await tester.tap(find.text('Choose destination and save'));
    await tester.pumpAndSettle();
    expect(stage.saves, 1);
    expect(find.textContaining('File chooser cancelled'), findsOneWidget);
    stage.saveResult = true;
    await tester.tap(find.text('Choose destination and save'));
    await tester.pumpAndSettle();
    expect(stage.saves, 2);
    expect(find.textContaining('readback verified'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(cancel.isCancelled, true);
  });
  testWidgets('partial stream never enables save or claims verified/saved',
      (tester) async {
    final stage = FakeStaging(), cancel = ArchiveCancellation();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: AccountArchiveDialog(
                userId: userId,
                cancel: cancel,
                staging: stage,
                download: (_, __) =>
                    Stream.value(fixture().sublist(0, 100))))));
    await tester.enterText(find.byType(TextField), 'proof');
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download and verify'));
    await tester.pumpAndSettle();
    expect(stage.discards, 1);
    expect(stage.saves, 0);
    expect(find.text('Choose destination and save'), findsNothing);
    expect(find.textContaining('No save is confirmed'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });
  testWidgets(
      'disposing a verified screen cancels and discards its encrypted stage',
      (tester) async {
    final stage = FakeStaging(), cancel = ArchiveCancellation();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: AccountArchiveDialog(
                userId: userId,
                cancel: cancel,
                staging: stage,
                download: (_, __) => Stream.value(fixture())))));
    await tester.enterText(find.byType(TextField), 'proof');
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download and verify'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(cancel.isCancelled, true);
    expect(stage.discards, 1);
    expect(stage.saves, 0);
  });
}

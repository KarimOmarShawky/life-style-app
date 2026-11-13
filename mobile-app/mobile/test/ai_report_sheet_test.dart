import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_report_sheet.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Slice AI-P: report AI output in the app (Google Play AI-Generated Content
/// policy) and the once-per-account 18+ confirmation (AI0-F11, D9).

const _reply = 'Drink a glass of water every hour.';
const _useAiLabel = 'use-ai';

class _Auth extends AuthController {
  _Auth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

class _SentReport {
  const _SentReport(
    this.surface,
    this.category,
    this.locale,
    this.reply,
    this.note,
  );

  final AiReportSurface surface;
  final AiReportCategory category;
  final String locale;
  final String? reply;
  final String? note;
}

class _FakeReports implements AiReportsClient {
  final sent = <_SentReport>[];
  Object? error;

  @override
  Future<void> submit({
    required AiReportSurface surface,
    required AiReportCategory category,
    required String locale,
    String? replyText,
    String? note,
  }) async {
    final failure = error;
    if (failure != null) throw failure;
    sent.add(_SentReport(surface, category, locale, replyText, note));
  }
}

AppUser _user(String id) => AppUser.fromJson({
      'id': id,
      'email': '$id@example.test',
      'displayName': 'Mona',
      'timezone': 'Africa/Cairo',
      'locale': 'en',
      'defaultCurrency': 'EGP',
      'status': 'active',
    });

/// A screen with one AI reply (and its report button) plus a button that
/// asks for the 18+ confirmation like the AI features do.
class _Host extends ConsumerWidget {
  const _Host({required this.ageResults});

  final List<bool> ageResults;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            const Row(
              children: [
                Expanded(child: Text(_reply)),
                AiReportButton(
                  surface: AiReportSurface.assistant,
                  replyText: _reply,
                ),
              ],
            ),
            TextButton(
              onPressed: () async {
                ageResults.add(await ensureAiAgeConfirmed(context, ref));
              },
              child: const Text(_useAiLabel),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeReports reports,
  required List<bool> ageResults,
  String userId = 'user-1',
  String locale = 'en',
  double textScale = 1,
}) async {
  // A small phone: 320 x 640 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 1280);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    // A fresh container and screen state for every pump.
    key: UniqueKey(),
    overrides: [
      authProvider.overrideWith(() => _Auth(_user(userId))),
      aiReportsClientProvider.overrideWithValue(reports),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      locale: Locale(locale),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: _Host(ageResults: ageResults),
    ),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

Future<void> _openSheet(WidgetTester tester, AppLocalizations l10n) async {
  await tester.tap(find.byTooltip(l10n.aiReportReplyTooltip));
  await tester.pumpAndSettle();
  expect(find.text(l10n.aiReportTitle), findsOneWidget);
}

Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

FilledButton _sendButton(WidgetTester tester, AppLocalizations l10n) =>
    tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, l10n.aiReportSend),
    );

void main() {
  const en = AppLocalizations(Locale('en'));
  const ar = AppLocalizations(Locale('ar'));

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('Report sheet in Arabic at 200% on a narrow screen (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      reports: _FakeReports(),
      ageResults: [],
      locale: 'ar',
      textScale: 2,
    );
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

    await _openSheet(tester, ar);
    final title = find.text(ar.aiReportTitle);
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
    for (final label in [
      ar.aiReportCategoryOffensive,
      ar.aiReportCategoryHarmful,
      ar.aiReportCategoryInaccurate,
      ar.aiReportCategorySpam,
      ar.aiReportCategoryOther,
      ar.aiReportIncludeReply,
      ar.aiReportNoteLabel,
      ar.aiReportSend,
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));

    // At 200 % text the buttons are below the fold of the sheet. After
    // scrolling, the chips are clipped by the scroll view, which the tap
    // target guideline would misread, so the buttons are measured directly.
    await tester.ensureVisible(find.text(ar.aiReportSend));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final button in [
      find.widgetWithText(TextButton, ar.cancel),
      find.widgetWithText(FilledButton, ar.aiReportSend),
    ]) {
      final size = tester.getSize(button);
      expect(size.height, greaterThanOrEqualTo(48));
      expect(size.width, greaterThanOrEqualTo(48));
    }
    semantics.dispose();
  });

  testWidgets('Sends the reason, the reply and the note; the reply is optional',
      (tester) async {
    final reports = _FakeReports();
    await _pump(tester, reports: reports, ageResults: []);

    await _openSheet(tester, en);
    // Nothing can be sent before a reason is chosen.
    expect(_sendButton(tester, en).onPressed, isNull);
    await _tapVisible(tester, find.text(en.aiReportCategoryInaccurate));
    expect(_sendButton(tester, en).onPressed, isNotNull);
    await tester.enterText(find.byType(TextField), 'The numbers are wrong');
    await _tapVisible(tester, find.text(en.aiReportSend));

    final first = reports.sent.single;
    expect(first.surface, AiReportSurface.assistant);
    expect(first.category, AiReportCategory.inaccurate);
    expect(first.locale, 'en');
    expect(first.reply, _reply);
    expect(first.note, 'The numbers are wrong');
    expect(find.text(en.aiReportTitle), findsNothing);
    expect(find.text(en.aiReportSent), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 5));

    // Second report without the reply text.
    await _openSheet(tester, en);
    await _tapVisible(tester, find.text(en.aiReportCategorySpam));
    await _tapVisible(tester, find.text(en.aiReportIncludeReply));
    await _tapVisible(tester, find.text(en.aiReportSend));
    expect(reports.sent, hasLength(2));
    expect(reports.sent.last.category, AiReportCategory.spam);
    expect(reports.sent.last.reply, isNull);
    expect(reports.sent.last.note, isEmpty);
  });

  testWidgets('A refused report keeps the sheet open with a message',
      (tester) async {
    final reports = _FakeReports()
      ..error = const ApiException(
        statusCode: 503,
        code: 'AI_REPORTS_UNAVAILABLE',
        message: 'later',
      );
    await _pump(tester, reports: reports, ageResults: []);

    await _openSheet(tester, en);
    await _tapVisible(tester, find.text(en.aiReportCategoryHarmful));
    await _tapVisible(tester, find.text(en.aiReportSend));
    expect(reports.sent, isEmpty);
    expect(find.text(en.aiReportTitle), findsOneWidget);
    expect(find.text(en.aiReportFailed), findsOneWidget);

    // Cancel closes the sheet without sending anything.
    await _tapVisible(tester, find.widgetWithText(TextButton, en.cancel));
    expect(find.text(en.aiReportTitle), findsNothing);
    expect(reports.sent, isEmpty);
  });

  testWidgets('18+ is asked once per account; declining stores nothing',
      (tester) async {
    final results = <bool>[];
    await _pump(tester, reports: _FakeReports(), ageResults: results);
    final prefs = await SharedPreferences.getInstance();

    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    expect(find.text(en.aiAgeTitle), findsOneWidget);
    await tester.tap(find.text(en.aiAgeDecline));
    await tester.pumpAndSettle();
    expect(results, [false]);
    expect(find.text(en.aiAgeDeclined), findsOneWidget);
    expect(prefs.getBool('ai_age_confirmed.v1.user-1'), isNull);
    await tester.pumpAndSettle(const Duration(seconds: 5));

    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    expect(find.text(en.aiAgeTitle), findsOneWidget);
    await tester.tap(find.text(en.aiAgeConfirm));
    await tester.pumpAndSettle();
    expect(results, [false, true]);
    expect(prefs.getBool('ai_age_confirmed.v1.user-1'), isTrue);

    // Confirmed: no question the next time, also after a restart.
    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    expect(find.text(en.aiAgeTitle), findsNothing);
    expect(results, [false, true, true]);

    await _pump(tester, reports: _FakeReports(), ageResults: results);
    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    expect(find.text(en.aiAgeTitle), findsNothing);
    expect(results, [false, true, true, true]);

    // Another account on the same device is asked again.
    await _pump(
      tester,
      reports: _FakeReports(),
      ageResults: results,
      userId: 'user-2',
    );
    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    expect(find.text(en.aiAgeTitle), findsOneWidget);
  });

  testWidgets('18+ question in Arabic at 200% on a narrow screen (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      reports: _FakeReports(),
      ageResults: [],
      locale: 'ar',
      textScale: 2,
    );
    await tester.tap(find.text(_useAiLabel));
    await tester.pumpAndSettle();
    final title = find.text(ar.aiAgeTitle);
    expect(title, findsOneWidget);
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
    expect(find.text(ar.aiAgeConfirm), findsOneWidget);
    expect(find.text(ar.aiAgeDecline), findsOneWidget);
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    semantics.dispose();
  });
}

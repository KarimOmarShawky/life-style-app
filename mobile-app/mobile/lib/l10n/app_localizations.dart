import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'catalog_ar.dart';
import 'catalog_de.dart';
import 'catalog_en.dart';
import 'catalog_es.dart';
import 'catalog_fr.dart';
import 'catalog_tr.dart';

/// Data-driven localizations for the LifeStyle mobile client.
///
/// Every UI string lives in a per-locale catalog (`catalog_<lang>.dart`).
/// Adding a new language is therefore a two-step, zero-risk operation:
///   1. drop in a new `catalog_xx.dart` map,
///   2. register it in [_catalogs] and [supportedLocales].
///
/// Missing keys always fall back to English, so a partially translated
/// catalog can never crash or render a raw key.
class AppLocalizations {
  const AppLocalizations(this.locale);

  final Locale locale;

  static const Map<String, Map<String, String>> _catalogs = <String, Map<String, String>>{
    'ar': arCatalog,
    'en': enCatalog,
    'fr': frCatalog,
    'es': esCatalog,
    'de': deCatalog,
    'tr': trCatalog,
  };

  /// Locales shipped with the app, in picker order.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
    Locale('fr'),
    Locale('es'),
    Locale('de'),
    Locale('tr'),
  ];

  /// Native name of each supported language, used by the language picker.
  static const Map<String, String> endonyms = <String, String>{
    'ar': 'العربية',
    'en': 'English',
    'fr': 'Français',
    'es': 'Español',
    'de': 'Deutsch',
    'tr': 'Türkçe',
  };

  /// English name of each supported language, used inside AI prompts.
  static const Map<String, String> promptNames = <String, String>{
    'ar': 'Arabic',
    'en': 'English',
    'fr': 'French',
    'es': 'Spanish',
    'de': 'German',
    'tr': 'Turkish',
  };

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations) ??
      const AppLocalizations(Locale('en'));

  static bool isLocaleSupported(Locale locale) =>
      _catalogs.containsKey(locale.languageCode);

  bool get isArabic => locale.languageCode == 'ar';

  /// Right-to-left script (drives chat-bubble alignment and similar layout).
  bool get isRTL =>
      TextDirection.rtl == direction;

  TextDirection get direction =>
      (locale.languageCode == 'ar') ? TextDirection.rtl : TextDirection.ltr;

  /// Name of the current language for AI system prompts.
  String get promptLanguageName =>
      promptNames[locale.languageCode] ?? 'English';

  String _s(String key) {
    final Map<String, String> table =
        _catalogs[locale.languageCode] ?? enCatalog;
    return table[key] ?? enCatalog[key] ?? key;
  }

  String _f(String key, Map<String, Object> params) {
    var out = _s(key);
    params.forEach((String name, Object value) {
      out = out.replaceAll('{$name}', '$value');
    });
    return out;
  }

  String get appTitle => _s('appTitle');
  String get signIn => _s('signIn');
  String get createAccount => _s('createAccount');
  String get email => _s('email');
  String get password => _s('password');
  String get displayName => _s('displayName');
  String get tasks => _s('tasks');
  String get habits => _s('habits');
  String get money => _s('money');
  String get notes => _s('notes');
  String get profile => _s('profile');
  String get addTask => _s('addTask');
  String get taskTitle => _s('taskTitle');
  String get noTasks => _s('noTasks');
  String get retry => _s('retry');
  String get fieldRequired => _s('fieldRequired');
  String get signOut => _s('signOut');
  String get forgotPassword => _s('forgotPassword');
  String get back => _s('back');
  String get dueDate => _s('dueDate');
  String get resetPassword => _s('resetPassword');
  String get sendResetCode => _s('sendResetCode');
  String get resetCodeSent => _s('resetCodeSent');
  String get enterResetCode => _s('enterResetCode');
  String get newPassword => _s('newPassword');
  String get confirmNewPassword => _s('confirmNewPassword');
  String get passwordResetSuccess => _s('passwordResetSuccess');
  String get passwordsDoNotMatch => _s('passwordsDoNotMatch');
  String get selectAll => _s('selectAll');
  String get deleteSelected => _s('deleteSelected');
  String get deleteSelectedConfirm => _s('deleteSelectedConfirm');
  String get selectedCount => _s('selectedCount');
  String get aiAssistant => _s('aiAssistant');
  String get aiDailyBriefing => _s('aiDailyBriefing');
  String get voiceMicPrompt => _s('voiceMicPrompt');
  String get searchPlaceholder => _s('searchPlaceholder');
  String get userLevel => _s('userLevel');
  String get xpPoints => _s('xpPoints');
  String get resetCode => _s('resetCode');
  String get cancel => _s('cancel');
  String get save => _s('save');
  String get delete => _s('delete');
  String get errorTitle => _s('errorTitle');
  String get apiConfigError => _s('apiConfigError');
  String get networkError => _s('networkError');
  String get passwordLengthError => _s('passwordLengthError');
  String get dailyHabits => _s('dailyHabits');
  String get noHabits => _s('noHabits');
  String get addHabit => _s('addHabit');
  String get habitName => _s('habitName');
  String get description => _s('description');
  String get currentStreakText => _s('currentStreakText');
  String get bestStreakText => _s('bestStreakText');
  String get days => _s('days');
  String get completedToday => _s('completedToday');
  String get markComplete => _s('markComplete');
  String get moneyBudgets => _s('moneyBudgets');
  String get monthlyBudgets => _s('monthlyBudgets');
  String get activeSubscriptions => _s('activeSubscriptions');
  String get noBudgets => _s('noBudgets');
  String get noSubscriptions => _s('noSubscriptions');
  String get addTransaction => _s('addTransaction');
  String get addBudget => _s('addBudget');
  String get budgetLimit => _s('budgetLimit');
  String get transactions => _s('transactions');
  String get expense => _s('expense');
  String get income => _s('income');
  String get amount => _s('amount');
  String get currency => _s('currency');
  String get merchant => _s('merchant');
  String get transactionSaved => _s('transactionSaved');
  String get enterAmount => _s('enterAmount');
  String get amountMustBePositive => _s('amountMustBePositive');
  String get descHint => _s('descHint');
  String get merchantHint => _s('merchantHint');
  String get financialOverview => _s('financialOverview');
  String get totalBudget => _s('totalBudget');
  String get totalSpent => _s('totalSpent');
  String get remaining => _s('remaining');
  String get budgetWarning => _s('budgetWarning');
  String get budgetExceeded => _s('budgetExceeded');
  String get remindSubscription => _s('remindSubscription');
  String get subscriptionReminderSet => _s('subscriptionReminderSet');
  String get renewalSoon => _s('renewalSoon');
  String get subscriptionsTitle => _s('subscriptionsTitle');
  String get addSubscription => _s('addSubscription');
  String get subscriptionName => _s('subscriptionName');
  String get subscriptionNameHint => _s('subscriptionNameHint');
  String get billingCycle => _s('billingCycle');
  String get monthly => _s('monthly');
  String get yearly => _s('yearly');
  String get weekly => _s('weekly');
  String get firstBillingDate => _s('firstBillingDate');
  String get deleteSubscription => _s('deleteSubscription');
  String get deleteConfirm => _s('deleteConfirm');
  String get totalMonthlySubscriptions => _s('totalMonthlySubscriptions');
  String get notesTitle => _s('notesTitle');
  String get noNotes => _s('noNotes');
  String get addNote => _s('addNote');
  String get noteTitle => _s('noteTitle');
  String get noteContent => _s('noteContent');
  String get tags => _s('tags');
  String get setAlarm => _s('setAlarm');
  String get alarmDate => _s('alarmDate');
  String get alarmTime => _s('alarmTime');
  String get testAlarm => _s('testAlarm');
  String get testAlarmSent => _s('testAlarmSent');
  String get alarmScheduled => _s('alarmScheduled');
  String get pickDate => _s('pickDate');
  String get pickTime => _s('pickTime');
  String get noAlarm => _s('noAlarm');
  String get smartAdd => _s('smartAdd');
  String get smartAddHint => _s('smartAddHint');
  String get detectedTitle => _s('detectedTitle');
  String get detectedDate => _s('detectedDate');
  String get detectedAlarm => _s('detectedAlarm');
  String get saveAndSetAlarm => _s('saveAndSetAlarm');
  String get smartAlarmSuccess => _s('smartAlarmSuccess');
  String get allTasks => _s('allTasks');
  String get today => _s('today');
  String get tomorrow => _s('tomorrow');
  String get yesterday => _s('yesterday');
  String get calendarView => _s('calendarView');
  String get noTasksForDay => _s('noTasksForDay');
  String get jumpToDate => _s('jumpToDate');
  String get focusTimer => _s('focusTimer');
  String get focusSession => _s('focusSession');
  String get breakSession => _s('breakSession');
  String get start => _s('start');
  String get pause => _s('pause');
  String get reset => _s('reset');
  String get timerFinished => _s('timerFinished');
  String get breakFinished => _s('breakFinished');
  String get selectTask => _s('selectTask');
  String get noTaskSelected => _s('noTaskSelected');
  String get minutes => _s('minutes');
  String get projects => _s('projects');
  String get addProject => _s('addProject');
  String get projectProgress => _s('projectProgress');
  String get language => _s('language');
  String get themeMode => _s('themeMode');
  String get themeDark => _s('themeDark');
  String get themeLight => _s('themeLight');
  String get themeSystem => _s('themeSystem');
  String get defaultCurrency => _s('defaultCurrency');
  String get timeZone => _s('timeZone');
  String get accountStatus => _s('accountStatus');
  String get activeStatus => _s('activeStatus');
  String get enterNamePrompt => _s('enterNamePrompt');
  String get enterValidEmailPrompt => _s('enterValidEmailPrompt');
  String get enterPasswordPrompt => _s('enterPasswordPrompt');
  String get alreadyHaveAccount => _s('alreadyHaveAccount');
  String get newToApp => _s('newToApp');
  String get passwordMinLengthError => _s('passwordMinLengthError');
  String get currencyUpdated => _s('currencyUpdated');
  String get currencyUpdateFailed => _s('currencyUpdateFailed');
  String get accountRank => _s('accountRank');
  String get levelXpBadge => _s('levelXpBadge');
  String get xpRemainingText => _s('xpRemainingText');
  String get achievementBadges => _s('achievementBadges');
  String get badgeStrongStart => _s('badgeStrongStart');
  String get badgeFirstTask => _s('badgeFirstTask');
  String get badgeFocusHero => _s('badgeFocusHero');
  String get badgePomodoro => _s('badgePomodoro');
  String get badgeDiscipline => _s('badgeDiscipline');
  String get badgeStreak7 => _s('badgeStreak7');
  String get globalSearchTooltip => _s('globalSearchTooltip');
  String get testAlarmTitleText => _s('testAlarmTitleText');
  String get testAlarmBodyText => _s('testAlarmBodyText');
  String get briefingMorning => _s('briefingMorning');
  String get briefingEvening => _s('briefingEvening');
  String get briefingEmptyText => _s('briefingEmptyText');
  String get taskDueNowText => _s('taskDueNowText');
  String get quickClip30MinLabel => _s('quickClip30MinLabel');
  String get quickClip30MinText => _s('quickClip30MinText');
  String get quickClipTomorrow7PMLabel => _s('quickClipTomorrow7PMLabel');
  String get quickClipTomorrow7PMText => _s('quickClipTomorrow7PMText');
  String get quickClip2HoursLabel => _s('quickClip2HoursLabel');
  String get quickClip2HoursText => _s('quickClip2HoursText');
  String get statusTodo => _s('statusTodo');
  String get statusDone => _s('statusDone');
  String get priorityHigh => _s('priorityHigh');
  String get priorityMedium => _s('priorityMedium');
  String get priorityLow => _s('priorityLow');
  String get duePrefix => _s('duePrefix');
  String get exportReportTooltip => _s('exportReportTooltip');
  String get budgetBreakdownTitle => _s('budgetBreakdownTitle');
  String get generalBudget => _s('generalBudget');
  String get reportCopied => _s('reportCopied');
  String get reportHeader => _s('reportHeader');
  String get reportDateLabel => _s('reportDateLabel');
  String get reportTotalBudgetLabel => _s('reportTotalBudgetLabel');
  String get reportTotalSpentLabel => _s('reportTotalSpentLabel');
  String get reportRemainingLabel => _s('reportRemainingLabel');
  String get reportUtilizationLabel => _s('reportUtilizationLabel');
  String get reportActiveSubsLabel => _s('reportActiveSubsLabel');
  String get reportTotalSubsLabel => _s('reportTotalSubsLabel');
  String get reportMonthlySuffix => _s('reportMonthlySuffix');
  String get reportFooter => _s('reportFooter');
  String get aiWelcomeMessage => _s('aiWelcomeMessage');
  String get aiSuggestion1 => _s('aiSuggestion1');
  String get aiSuggestion2 => _s('aiSuggestion2');
  String get aiSuggestion3 => _s('aiSuggestion3');
  String get aiSuggestion4 => _s('aiSuggestion4');
  String get aiClearChatTooltip => _s('aiClearChatTooltip');
  String get aiClearedResetMessage => _s('aiClearedResetMessage');
  String get aiThinkingMessage => _s('aiThinkingMessage');
  String get aiInputHint => _s('aiInputHint');
  String get searchFieldPlaceholder => _s('searchFieldPlaceholder');
  String get searchPromptEmpty => _s('searchPromptEmpty');

  String get noSpeechDetected => _s('noSpeechDetected');
  String get smsSyncTitle => _s('smsSyncTitle');
  String get smsSyncDesc => _s('smsSyncDesc');
  String get smsPermissionDenied => _s('smsPermissionDenied');

  // ---- Parameterized strings -------------------------------------------

  String briefingSummaryText(int total, int completed) =>
      _f('briefingSummaryText', <String, Object>{'total': total, 'completed': completed});

  String billingUnitLabel(String unit) {
    switch (unit) {
      case 'month':
      case 'monthly':
        return _s('billingUnit.month');
      case 'year':
      case 'yearly':
        return _s('billingUnit.year');
      case 'week':
      case 'weekly':
        return _s('billingUnit.week');
      default:
        return '/$unit';
    }
  }

  String ambientLabel(String key) {
    final String translated = _s('ambient.$key');
    return translated == 'ambient.$key' ? key : translated;
  }

  String searchNoResultsFor(String q) =>
      _f('searchNoResultsFor', <String, Object>{'q': q});

  /// Generic catalog lookup for keys without a dedicated getter.
  String tr(String key) => _s(key);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) =>
      AppLocalizations.isLocaleSupported(locale);

  @override
  Future<AppLocalizations> load(Locale locale) =>
      SynchronousFuture<AppLocalizations>(AppLocalizations(locale));

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

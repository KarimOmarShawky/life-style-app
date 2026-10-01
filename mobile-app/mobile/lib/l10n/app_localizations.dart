import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

class AppLocalizations {
  const AppLocalizations(this.locale);

  final Locale locale;

  static const supportedLocales = <Locale>[
    Locale('en'),
    Locale('ar'),
  ];

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations) ??
      const AppLocalizations(Locale('en'));

  bool get isArabic => locale.languageCode == 'ar';

  String get appTitle => isArabic ? 'لايف ستايل' : 'LifeStyle';
  String get signIn => isArabic ? 'تسجيل الدخول' : 'Sign in';
  String get createAccount => isArabic ? 'إنشاء حساب جديد' : 'Create account';
  String get email => isArabic ? 'البريد الإلكتروني' : 'Email';
  String get password => isArabic ? 'كلمة المرور' : 'Password';
  String get displayName => isArabic ? 'الاسم' : 'Display name';
  String get tasks => isArabic ? 'المهام' : 'Tasks';
  String get habits => isArabic ? 'العادات' : 'Habits';
  String get money => isArabic ? 'المصاريف' : 'Money';
  String get notes => isArabic ? 'الملاحظات' : 'Notes';
  String get profile => isArabic ? 'الملف الشخصي' : 'Profile';
  String get addTask => isArabic ? 'إضافة مهمة' : 'Add task';
  String get taskTitle => isArabic ? 'ما الذي تريد إنجازه؟' : 'What needs to get done?';
  String get noTasks => isArabic ? 'لا توجد مهام حالياً' : 'No tasks yet';
  String get retry => isArabic ? 'إعادة المحاولة' : 'Try again';
  String get signOut => isArabic ? 'تسجيل الخروج' : 'Sign out';
  String get forgotPassword => isArabic ? 'نسيت كلمة المرور؟' : 'Forgot password?';
  String get sendResetCode => isArabic ? 'إرسال كود الاستعادة' : 'Send reset code';
  String get resetCode => isArabic ? 'رمز الاستعادة (6 أرقام)' : 'Six-digit reset code';
  String get newPassword => isArabic ? 'كلمة المرور الجديدة' : 'New password';
  String get cancel => isArabic ? 'إلغاء' : 'Cancel';
  String get save => isArabic ? 'حفظ' : 'Save';
  String get errorTitle => isArabic ? 'حدث خطأ ما' : 'Something went wrong';
  String get apiConfigError => isArabic
      ? 'عنوان الخادم غير مضبوط بشكل صحيح.'
      : 'The API address is not configured. Start the app with an API_BASE_URL build setting.';
  String get networkError => isArabic
      ? 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.'
      : 'Could not connect. Check your connection and try again.';
  String get passwordLengthError => isArabic
      ? 'كلمة المرور يجب أن لا تقل عن 10 أحرف.'
      : 'Use a password with at least 10 characters.';

  // Habits
  String get dailyHabits => isArabic ? 'العادات اليومية' : 'Daily Habits';
  String get noHabits => isArabic
      ? 'لا توجد عادات بعد.\nابدأ ببناء روتينك اليومي!'
      : 'No habits created yet.\nBuild a daily routine!';
  String get addHabit => isArabic ? 'عادة جديدة' : 'New Habit';
  String get habitName => isArabic ? 'اسم العادة' : 'Habit Name';
  String get description => isArabic ? 'الوصف (اختياري)' : 'Description (optional)';

  // Money & Budgets
  String get moneyBudgets => isArabic ? 'المصاريف والميزانية' : 'Money & Budgets';
  String get monthlyBudgets => isArabic ? 'الميزانيات الشهرية' : 'Monthly Budgets';
  String get activeSubscriptions => isArabic ? 'الاشتراكات النشطة' : 'Active Subscriptions';
  String get noBudgets => isArabic ? 'لا توجد ميزانيات محددة لهذا الشهر.' : 'No active budgets set for this month.';
  String get noSubscriptions => isArabic ? 'لا توجد اشتراكات نشطة حالياً.' : 'No active subscriptions found.';
  String get addTransaction => isArabic ? 'إضافة معاملة' : 'Transaction';
  String get expense => isArabic ? 'مصروف' : 'Expense';
  String get income => isArabic ? 'دخل' : 'Income';
  String get amount => isArabic ? 'المبلغ' : 'Amount';
  String get currency => isArabic ? 'العملة' : 'Currency';
  String get merchant => isArabic ? 'المتجر / الجهة' : 'Merchant (optional)';
  String get transactionSaved => isArabic ? 'تم حفظ المعاملة بنجاح!' : 'Transaction saved successfully!';
  String get enterAmount => isArabic ? 'يرجى إدخال المبلغ' : 'Enter amount';
  String get amountMustBePositive => isArabic ? 'يجب أن يكون المبلغ أكبر من 0' : 'Must be > 0';
  String get descHint => isArabic ? 'مثال: بقالة، قهوة' : 'e.g. Groceries, Coffee';
  String get merchantHint => isArabic ? 'مثال: كارفور، ستارباكس' : 'e.g. Carrefour, Starbucks';

  // Notes
  String get notesTitle => isArabic ? 'الملاحظات' : 'Notes';
  String get noNotes => isArabic
      ? 'لا توجد ملاحظات بعد.\nسجّل أفكارك هنا!'
      : 'No notes yet.\nJot down your thoughts!';
  String get addNote => isArabic ? 'ملاحظة جديدة' : 'New Note';
  String get noteTitle => isArabic ? 'العنوان' : 'Title';
  String get noteContent => isArabic ? 'المحتوى' : 'Content';
  String get tags => isArabic ? 'الوسوم (مفصولة بفواصل)' : 'Tags (comma separated)';

  // Settings
  String get language => isArabic ? 'اللغة' : 'Language';
  String get themeMode => isArabic ? 'المظهر' : 'Theme mode';
  String get themeDark => isArabic ? 'داكن 🌙' : 'Dark 🌙';
  String get themeLight => isArabic ? 'فاتح ☀️' : 'Light ☀️';
  String get themeSystem => isArabic ? 'حسب النظام 📱' : 'System default 📱';
  String get defaultCurrency => isArabic ? 'العملة الافتراضية' : 'Default currency';
  String get timeZone => isArabic ? 'المنطقة الزمنية' : 'Time zone';
  String get accountStatus => isArabic ? 'حالة الحساب' : 'Account status';
  String get activeStatus => isArabic ? 'نشط' : 'active';
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) =>
      ['en', 'ar'].contains(locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) =>
      SynchronousFuture<AppLocalizations>(AppLocalizations(locale));

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
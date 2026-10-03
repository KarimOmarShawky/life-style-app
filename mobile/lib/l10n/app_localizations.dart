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
  String get fieldRequired => isArabic ? 'هذا الحقل مطلوب' : 'This field is required';
  String get signOut => isArabic ? 'تسجيل الخروج' : 'Sign out';
  String get forgotPassword => isArabic ? 'نسيت كلمة المرور؟' : 'Forgot password?';
  String get back => isArabic ? 'رجوع' : 'Back';
  String get dueDate => isArabic ? 'تاريخ الاستحقاق' : 'Due date';
  String get resetPassword => isArabic ? 'إعادة تعيين كلمة المرور' : 'Reset Password';
  String get sendResetCode => isArabic ? 'إرسال رمز التحقق' : 'Send Reset Code';
  String get resetCodeSent => isArabic ? 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' : 'Reset code sent to your email';
  String get enterResetCode => isArabic ? 'أدخل الرمز المكون من 6 أرقام' : 'Enter 6-digit code';
  String get newPassword => isArabic ? 'كلمة المرور الجديدة' : 'New Password';
  String get confirmNewPassword => isArabic ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password';
  String get passwordResetSuccess => isArabic ? 'تم تغيير كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن' : 'Password reset successfully! You can now login';
  String get passwordsDoNotMatch => isArabic ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match';
  String get selectAll => isArabic ? 'تحديد الكل' : 'Select All';
  String get deleteSelected => isArabic ? 'حذف المحدد' : 'Delete Selected';
  String get deleteSelectedConfirm => isArabic ? 'هل أنت متأكد من حذف العناصر المحددة؟' : 'Are you sure you want to delete selected items?';
  String get selectedCount => isArabic ? 'محدد' : 'selected';
  String get aiAssistant => isArabic ? 'المساعد الذكي' : 'AI Assistant';
  String get aiDailyBriefing => isArabic ? 'ملخص اليوم الذكي' : 'Daily Smart Briefing';
  String get voiceMicPrompt => isArabic ? 'تحدث الآن، أستمع إليك...' : 'Listening, speak now...';
  String get searchPlaceholder => isArabic ? 'بحث في المهام والملاحظات...' : 'Search tasks & notes...';
  String get userLevel => isArabic ? 'المستوى' : 'Level';
  String get xpPoints => isArabic ? 'نقطة خبرة' : 'XP';
  String get resetCode => isArabic ? 'رمز الاستعادة (6 أرقام)' : 'Six-digit reset code';
  String get cancel => isArabic ? 'إلغاء' : 'Cancel';
  String get save => isArabic ? 'حفظ' : 'Save';
  String get delete => isArabic ? 'حذف' : 'Delete';
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
  String get currentStreakText => isArabic ? 'سلسلة الحماس الحالية' : 'Current streak';
  String get bestStreakText => isArabic ? 'أفضل رقم' : 'Best streak';
  String get days => isArabic ? 'أيام' : 'days';
  String get completedToday => isArabic ? 'تم إنجاز عادة اليوم!' : 'Done for today!';
  String get markComplete => isArabic ? 'تسجيل إنجاز اليوم' : 'Mark done today';

  // Money & Budgets
  String get moneyBudgets => isArabic ? 'المصاريف والميزانية' : 'Money & Budgets';
  String get monthlyBudgets => isArabic ? 'الميزانيات الشهرية' : 'Monthly Budgets';
  String get activeSubscriptions => isArabic ? 'الاشتراكات النشطة' : 'Active Subscriptions';
  String get noBudgets => isArabic ? 'لا توجد ميزانيات محددة لهذا الشهر.' : 'No active budgets set for this month.';
  String get noSubscriptions => isArabic ? 'لا توجد اشتراكات نشطة حالياً.' : 'No active subscriptions found.';
  String get addTransaction => isArabic ? 'إضافة معاملة' : 'Transaction';
  String get addBudget => isArabic ? 'إضافة ميزانية' : 'Add budget';
  String get budgetLimit => isArabic ? 'حد الميزانية الشهري' : 'Monthly budget limit';
  String get transactions => isArabic ? 'المعاملات' : 'Transactions';
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
  String get financialOverview => isArabic ? 'الملخص المالي' : 'Financial Overview';
  String get totalBudget => isArabic ? 'الميزانية' : 'Budget';
  String get totalSpent => isArabic ? 'المصروف' : 'Spent';
  String get remaining => isArabic ? 'المتبقي' : 'Remaining';
  String get budgetWarning => isArabic ? 'تنبيه: اقتربت من الحد الأقصى للميزانية!' : 'Warning: approaching budget limit!';
  String get budgetExceeded => isArabic ? 'تنبيه: لقد تجاوزت الميزانية المحددة!' : 'Warning: budget exceeded!';
  String get remindSubscription => isArabic ? 'تذكير قبل التجديد' : 'Remind before renewal';
  String get subscriptionReminderSet => isArabic ? 'تم ضبط تذكير قبل التجديد بنجاح!' : 'Renewal reminder set!';
  String get renewalSoon => isArabic ? 'تجديد قريب!' : 'Renewal soon!';

  // Subscriptions Dedicated Section
  String get subscriptionsTitle => isArabic ? 'الاشتراكات والفواتير' : 'Subscriptions & Bills';
  String get addSubscription => isArabic ? 'إضافة اشتراك' : 'Add subscription';
  String get subscriptionName => isArabic ? 'اسم الاشتراك' : 'Subscription name';
  String get subscriptionNameHint => isArabic ? 'مثال: نتفليكس، سبوتيفاي، الجيم' : 'e.g. Netflix, Spotify, Gym';
  String get billingCycle => isArabic ? 'دورة الدفع' : 'Billing cycle';
  String get monthly => isArabic ? 'شهرياً' : 'Monthly';
  String get yearly => isArabic ? 'سنوياً' : 'Yearly';
  String get weekly => isArabic ? 'أسبوعياً' : 'Weekly';
  String get firstBillingDate => isArabic ? 'تاريخ التجديد القادم' : 'Next billing date';
  String get deleteSubscription => isArabic ? 'حذف الاشتراك' : 'Delete subscription';
  String get deleteConfirm => isArabic ? 'هل تريد بالتأكيد حذف هذا الاشتراك؟' : 'Are you sure you want to delete this subscription?';
  String get totalMonthlySubscriptions => isArabic ? 'إجمالي الاشتراكات الشهرية' : 'Total monthly subscriptions';

  // Notes
  String get notesTitle => isArabic ? 'الملاحظات' : 'Notes';
  String get noNotes => isArabic
      ? 'لا توجد ملاحظات بعد.\nسجّل أفكارك هنا!'
      : 'No notes yet.\nJot down your thoughts!';
  String get addNote => isArabic ? 'ملاحظة جديدة' : 'New Note';
  String get noteTitle => isArabic ? 'العنوان' : 'Title';
  String get noteContent => isArabic ? 'المحتوى' : 'Content';
  String get tags => isArabic ? 'الوسوم (مفصولة بفواصل)' : 'Tags (comma separated)';

  // Alarms & Reminders
  String get setAlarm => isArabic ? 'ضبط منبه / تذكير' : 'Set alarm / reminder';
  String get alarmDate => isArabic ? 'تاريخ التنبيه' : 'Reminder date';
  String get alarmTime => isArabic ? 'وقت التنبيه' : 'Reminder time';
  String get testAlarm => isArabic ? 'منبه تجريبي' : 'Test Alarm';
  String get testAlarmSent => isArabic ? 'تم تشغيل المنبه التجريبي!' : 'Test alarm triggered!';
  String get alarmScheduled => isArabic ? 'تم ضبط المنبه بنجاح!' : 'Alarm scheduled successfully!';
  String get pickDate => isArabic ? 'اختر التاريخ' : 'Pick date';
  String get pickTime => isArabic ? 'اختر الوقت' : 'Pick time';
  String get noAlarm => isArabic ? 'بدون تنبيه' : 'No alarm';

  // Smart Parser / Magic Add
  String get smartAdd => isArabic ? 'إضافة ذكية وسريعة' : 'Smart Quick Add';
  String get smartAddHint => isArabic
      ? 'اكتب مثلاً: كشف الدكتور بكرة الساعة 7 بليل، أو مشوار بعد نص ساعة'
      : 'e.g. Doctor visit tomorrow at 7 pm, or grocery in 30 minutes';
  String get detectedTitle => isArabic ? 'المهمة' : 'Task';
  String get detectedDate => isArabic ? 'التاريخ' : 'Date';
  String get detectedAlarm => isArabic ? 'المنبه' : 'Alarm';
  String get saveAndSetAlarm => isArabic ? 'حفظ وضبط المنبه' : 'Save & Set Alarm';
  String get smartAlarmSuccess => isArabic ? 'تم حفظ المهمة وضبط المنبه بنجاح!' : 'Task saved & alarm scheduled successfully!';

  // Calendar & Planning
  String get allTasks => isArabic ? 'الكل' : 'All';
  String get today => isArabic ? 'اليوم' : 'Today';
  String get tomorrow => isArabic ? 'غداً' : 'Tomorrow';
  String get yesterday => isArabic ? 'أمس' : 'Yesterday';
  String get calendarView => isArabic ? 'التقويم' : 'Calendar';
  String get noTasksForDay => isArabic ? 'لا توجد مهام مجدولة في هذا اليوم' : 'No tasks scheduled for this day';
  String get jumpToDate => isArabic ? 'الانتقال لتاريخ معين' : 'Jump to date';

  // Focus Timer / Pomodoro
  String get focusTimer => isArabic ? 'مؤقت التركيز' : 'Focus Timer';
  String get focusSession => isArabic ? 'جلسة تركيز' : 'Focus Session';
  String get breakSession => isArabic ? 'استراحة' : 'Break';
  String get start => isArabic ? 'بدء' : 'Start';
  String get pause => isArabic ? 'إيقاف مؤقت' : 'Pause';
  String get reset => isArabic ? 'إعادة تعيين' : 'Reset';
  String get timerFinished => isArabic ? 'انتهت جلسة التركيز بنجاح' : 'Focus session complete';
  String get breakFinished => isArabic ? 'انتهت الاستراحة، جاهز للمتابعة' : 'Break over, ready to continue';
  String get selectTask => isArabic ? 'اختر مهمة للتركيز عليها' : 'Select task to focus on';
  String get noTaskSelected => isArabic ? 'تركيز عام (بدون مهمة)' : 'General Focus';
  String get minutes => isArabic ? 'دقيقة' : 'min';

  // Projects & Goals
  String get projects => isArabic ? 'المشاريع' : 'Projects';
  String get addProject => isArabic ? 'مشروع جديد' : 'New Project';
  String get projectProgress => isArabic ? 'نسبة التقدم' : 'Progress';

  // Settings
  String get language => isArabic ? 'اللغة' : 'Language';
  String get themeMode => isArabic ? 'المظهر' : 'Theme mode';
  String get themeDark => isArabic ? 'داكن' : 'Dark';
  String get themeLight => isArabic ? 'فاتح' : 'Light';
  String get themeSystem => isArabic ? 'حسب النظام' : 'System default';
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

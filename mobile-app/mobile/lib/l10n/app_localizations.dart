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

  // Auth & Validation
  String get enterNamePrompt => isArabic ? 'أدخل اسمك.' : 'Enter your name.';
  String get enterValidEmailPrompt => isArabic ? 'أدخل بريداً إلكترونياً صحيحاً.' : 'Enter a valid email address.';
  String get enterPasswordPrompt => isArabic ? 'أدخل كلمة المرور.' : 'Enter your password.';
  String get alreadyHaveAccount => isArabic ? 'لديك حساب بالفعل؟' : 'Already have an account?';
  String get newToApp => isArabic ? 'مستخدم جديد؟' : 'New to LifeStyle?';
  String get passwordMinLengthError => isArabic ? 'كلمة المرور يجب أن لا تقل عن 8 أحرف.' : 'Password must be at least 8 characters.';

  // Profile & Gamification
  String get currencyUpdated => isArabic ? 'تم تحديث العملة إلى' : 'Currency updated to';
  String get currencyUpdateFailed => isArabic ? 'فشل تحديث العملة' : 'Failed to update currency';
  String get accountRank => isArabic ? 'رتبة الحساب: منجز نشط' : 'Rank: Active Achiever';
  String get levelXpBadge => isArabic ? 'المستوى 2 • 140 XP' : 'Level 2 • 140 XP';
  String get xpRemainingText => isArabic ? 'متبقي 60 XP للترقية إلى المستوى 3 (محترف)' : '60 XP remaining to Level 3 (Pro)';
  String get achievementBadges => isArabic ? 'أوسمة الإنجاز' : 'Achievement Badges';
  String get badgeStrongStart => isArabic ? 'البداية القوية' : 'Strong Start';
  String get badgeFirstTask => isArabic ? 'أول مهمة منجزة' : 'First task done';
  String get badgeFocusHero => isArabic ? 'بطل التركيز' : 'Focus Hero';
  String get badgePomodoro => isArabic ? 'جلسة بومودورو' : 'Pomodoro session';
  String get badgeDiscipline => isArabic ? 'الانضباط' : 'Discipline';
  String get badgeStreak7 => isArabic ? 'سلسلة 7 أيام' : '7-day streak';

  // Tasks & Briefing
  String get globalSearchTooltip => isArabic ? 'بحث شامل' : 'Global Search';
  String get testAlarmTitleText => isArabic ? 'لايف ستايل: تذكير بموعد مهم!' : 'LifeStyle: Important Reminder!';
  String get testAlarmBodyText => isArabic ? 'اضغط إيقاف لإيقاف رنين المنبه، أو غفوة للتأجيل' : 'Press dismiss to stop alarm, or snooze to delay';
  String get briefingMorning => isArabic ? 'صباح الخير' : 'Good morning';
  String get briefingEvening => isArabic ? 'مساء الخير' : 'Good evening';
  String get briefingEmptyText => isArabic ? 'لا توجد مهام حتى الآن. اضغط على علامة + لإضافة أول مهمة في يومك!' : 'No tasks yet. Tap the + icon to add your first task for today!';
  String briefingSummaryText(int total, int completed) => isArabic
      ? 'لديك $total مهام مجدولة، تم إنجاز $completed منها بنجاح. استمر في التركيز!'
      : 'You have $total scheduled tasks, $completed completed successfully. Keep up the momentum!';
  String get taskDueNowText => isArabic ? 'موعد مهمتك المجدولة الآن' : 'Your scheduled task is due now';
  String get quickClip30MinLabel => isArabic ? 'بعد نص ساعة' : 'In 30 minutes';
  String get quickClip30MinText => isArabic ? 'تذكير بعد نص ساعة' : 'Reminder in 30 minutes';
  String get quickClipTomorrow7PMLabel => isArabic ? 'بكرة 7 مساء' : 'Tomorrow 7 PM';
  String get quickClipTomorrow7PMText => isArabic ? 'مشوار بكرة الساعة 7 بليل' : 'Appointment tomorrow at 7 pm';
  String get quickClip2HoursLabel => isArabic ? 'بعد ساعتين' : 'In 2 hours';
  String get quickClip2HoursText => isArabic ? 'مهمة بعد ساعتين' : 'Task in 2 hours';

  // Task Item Status & Priority
  String get statusTodo => isArabic ? 'قيد الإنجاز' : 'To do';
  String get statusDone => isArabic ? 'مكتمل' : 'Done';
  String get priorityHigh => isArabic ? 'أولوية قصوى' : 'High';
  String get priorityMedium => isArabic ? 'أولوية متوسطة' : 'Medium';
  String get priorityLow => isArabic ? 'أولوية عادية' : 'Low';
  String get duePrefix => isArabic ? 'الاستحقاق:' : 'Due';

  // Money & Subscriptions
  String get exportReportTooltip => isArabic ? 'تصدير التقرير المالي' : 'Export Financial Report';
  String get budgetBreakdownTitle => isArabic ? 'تحليل بنود الميزانية' : 'Budget Breakdown';
  String get generalBudget => isArabic ? 'ميزانية عامة' : 'General Budget';
  String get reportCopied => isArabic ? 'تم نسخ التقرير المالي إلى الحافظة بنجاح! يمكنك لصقه أو مشاركته الآن.' : 'Financial report copied to clipboard successfully! You can paste or share it now.';
  String get reportHeader => isArabic ? 'تقرير لايف ستايل المالي الشهري' : 'LifeStyle Monthly Financial Report';
  String get reportDateLabel => isArabic ? 'تاريخ التقرير:' : 'Report Date:';
  String get reportTotalBudgetLabel => isArabic ? '- إجمالي الميزانية:' : '- Total Budget:';
  String get reportTotalSpentLabel => isArabic ? '- إجمالي المصروف:' : '- Total Spent:';
  String get reportRemainingLabel => isArabic ? '- المتبقي الصافي:' : '- Net Remaining:';
  String get reportUtilizationLabel => isArabic ? '- نسبة استهلاك الميزانية:' : '- Budget Utilization:';
  String get reportActiveSubsLabel => isArabic ? '- الاشتراكات النشطة:' : '- Active Subscriptions:';
  String get reportTotalSubsLabel => isArabic ? '- إجمالي الاشتراكات:' : '- Total Subscriptions:';
  String get reportMonthlySuffix => isArabic ? 'شهرياً' : 'monthly';
  String get reportFooter => isArabic ? 'تم إنشاء التقرير بواسطة تطبيق LifeStyle' : 'Report generated by LifeStyle App';
  String billingUnitLabel(String unit) {
    if (isArabic) {
      if (unit == 'month' || unit == 'monthly') return '/شهرياً';
      if (unit == 'year' || unit == 'yearly') return '/سنوياً';
      if (unit == 'week' || unit == 'weekly') return '/أسبوعياً';
      return '/$unit';
    } else {
      if (unit == 'month' || unit == 'monthly') return '/mo';
      if (unit == 'year' || unit == 'yearly') return '/yr';
      if (unit == 'week' || unit == 'weekly') return '/wk';
      return '/$unit';
    }
  }

  // Focus Timer Ambients
  String ambientLabel(String key) {
    if (isArabic) {
      switch (key) {
        case 'quiet': return 'هدوء';
        case 'rain': return 'مطر هادئ';
        case 'cafe': return 'مقهى';
        case 'waves': return 'أمواج البحر';
        case 'white_noise': return 'ضوضاء بيضاء';
        default: return key;
      }
    } else {
      switch (key) {
        case 'quiet': return 'Silence';
        case 'rain': return 'Soft Rain';
        case 'cafe': return 'Coffee Shop';
        case 'waves': return 'Ocean Waves';
        case 'white_noise': return 'White Noise';
        default: return key;
      }
    }
  }

  // AI Assistant Screen
  String get aiWelcomeMessage => isArabic
      ? 'مرحباً بك! أنا مساعدك الذكي في لايف ستايل. كيف يمكنني مساعدتك اليوم؟ يمكنك أن تطلب مني تنظيم جدولك، اقتراح عادات مفيدة، أو تقديم أفكار لزيادة إنتاجيتك.'
      : 'Welcome! I am your LifeStyle AI Assistant. How can I help you today? You can ask me to organize your schedule, suggest healthy habits, or provide productivity tips.';
  String get aiSuggestion1 => isArabic ? 'خطط لي يومي اليوم' : 'Plan my day today';
  String get aiSuggestion2 => isArabic ? 'كيف أنظم وقتي بين الشغل والمذاكرة؟' : 'How do I balance work and study?';
  String get aiSuggestion3 => isArabic ? 'اقترح علي عادات صحية صباحية' : 'Suggest healthy morning habits';
  String get aiSuggestion4 => isArabic ? 'نصائح لتقليل المصاريف الشهرية' : 'Tips to reduce monthly expenses';
  String get aiClearChatTooltip => isArabic ? 'مسح المحادثة' : 'Clear conversation';
  String get aiClearedResetMessage => isArabic
      ? 'مرحباً بك مجدداً! كيف يمكنني مساعدتك في تنظيم يومك الآن؟'
      : 'Welcome back! How can I help you organize your day now?';
  String get aiThinkingMessage => isArabic ? 'جاري التفكير وصياغة الإجابة...' : 'Thinking and drafting answer...';
  String get aiInputHint => isArabic ? 'اطلب من المساعد الذكي أي شيء...' : 'Ask the AI Assistant anything...';

  // Global Search
  String get searchFieldPlaceholder => isArabic ? 'بحث شامل في المهام، الملاحظات، والاشتراكات...' : 'Search tasks, notes, subscriptions...';
  String get searchPromptEmpty => isArabic ? 'اكتب أي كلمة للبحث في كل بياناتك' : 'Type any keyword to search across all data';
  String searchNoResultsFor(String q) => isArabic ? 'لا توجد نتائج مطابقة لـ "$q"' : 'No matching results for "$q"';
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

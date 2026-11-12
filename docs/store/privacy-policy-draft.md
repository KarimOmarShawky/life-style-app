# LifeStyle — privacy policy (DRAFT, not published)

> **Draft for the owner, 2026-11-12.** Written from the code on branch
> `arena/04c63949-life-style-app` (PR #32). It is not legal advice and not yet in force.
> Before publishing: fill every `[…]` placeholder, choose one of the two Gemini paragraphs
> in section 4, have it reviewed, and host it at a public, non-PDF URL. The same URL goes into
> Play Console (App content → Privacy policy) and should be linked from the app later.
> Keep personal details out of this public repository; fill them in only in the published copy.

Effective date: [date] · Developer: [developer name] · Contact: [contact email]

## English

### 1. Who we are
LifeStyle ("the app") is a personal productivity app for tasks, habits, focus sessions, notes,
goals, a calendar and AI help. It is published on Google Play by [developer name]. Questions
about this policy or your data: [contact email].

### 2. What we collect and why
- **Account:** email address, display name, time zone, language and your password. The
  password is stored only as a bcrypt hash. Used to create and secure your account.
- **What you add to the app:** tasks, projects, habits and check-ins, goals, calendar events,
  notes, reminders, focus/timer sessions, daily plans, routines and subscription reminders
  (name, price, renewal date). Stored on our server so your account works on your phones and
  can be exported.
- **Signed-in devices and security:** for each sign-in: the platform (Android/iOS), app version
  and device name when available, sign-in and last-use times, and the IP address at sign-in.
  Security events (for example sign-in, password change, failed attempts) are logged with the
  IP address and app/browser identifier. Used to show "Signed-in devices", to let you sign
  other devices out and to protect accounts.
- **Password reset:** the email address, the request's IP address and app/browser identifier.
  The reset code is sent by email through [email provider].
- **Usage statistics (optional):** content-free events: app opened, onboarding started,
  completed or skipped, task completed, habit checked in, each with a time and app version.
  They never contain the text of your tasks, notes or AI messages. Used to understand whether
  the app helps (for example how many people return after a week). You can turn them off in
  Profile at any time.
- **AI features (optional, 18+):** see section 4.
- **Reports of AI replies:** see section 5.

We do **not** collect your location, contacts, photos, files, microphone audio, SMS or call
logs. There are no ads, no advertising IDs and no third-party analytics or crash-reporting
tools in the app.

### 3. What stays on your phone
- The AI chat history (up to 100 messages) is stored only on your phone until you clear the
  chat or uninstall the app.
- Reminders and alarms are scheduled on your phone. Lock-screen notifications show generic
  text, not the content of your tasks.
- **Focus Shield** (optional) uses an Android accessibility service that you turn on yourself
  in Android settings, to send you back from apps you chose to block during a focus session you
  start. It does not read screen content and sends nothing to our server. The optional message
  shield reads notifications of supported messaging apps in memory only, never SMS, and never
  sends or stores their content.
- Your settings (language, AI and usage-statistics choices, the 18+ confirmation).

### 4. AI features (Google Gemini)
AI features are optional and only for people aged 18 or older (the app asks once per account).
When you use the AI assistant, weekly coaching, analytics insights or AI help for Smart Quick
Add, the app sends your request to our server, which sends it to **Google Gemini** (Google LLC)
to create the reply:
- the assistant: your message and recent messages from the same chat (at most 20 earlier
  messages);
- weekly coaching and analytics insights: the summary numbers that the app shows you before
  you agree to send them;
- Smart Quick Add, if you turn AI help on in Profile: the text you typed for the task.

Our server does not store your AI messages or replies and does not write them to logs. It keeps
counts of AI requests per account for daily limits. Do not type passwords or sensitive
information into AI features. AI replies can be wrong; they are not medical, legal or financial
advice.

*[Choose one paragraph and delete the other before publishing.]*

- *[Paid Gemini API]* Google processes these requests under the Gemini API terms for paid
  services. Google does not use them to improve its products. Google may keep them for a
  limited time to detect abuse, as described in its terms.
- *[Unpaid Gemini API, closed test only]* During this test the app uses the unpaid Gemini API.
  Under Google's terms, Google may use what is sent to improve its products, and human
  reviewers may read it. Do not send anything private.

Google's terms: https://ai.google.dev/gemini-api/terms · Google privacy policy:
https://policies.google.com/privacy

### 5. Reporting an AI reply
Every AI reply has a report button. A report contains the reason you chose, where the reply was
shown, the app language and an optional note. It also contains the text of the reply unless you
untick "Include the reply". Reports are used only to review AI safety and quality. They are
kept for 90 days and then deleted automatically, and they are deleted with your account.

### 6. Who processes your data
- [Railway] runs our server; [Neon] hosts the PostgreSQL database; [Redis provider] holds
  short-lived rate-limit counters. Region(s): [region].
- Google (Gemini API) creates AI replies when you use an AI feature (section 4).
- [Email provider] sends password-reset emails.

We do not sell your data and do not share it for advertising. All traffic between the app and
our server is encrypted with HTTPS.

### 7. How long we keep data
- Account data and what you add to the app: while your account exists. Items you delete can be
  restored for 30 days and are then removed.
- Deleting your account (Profile → Delete account): you have 14 days to change your mind. After
  that, your account and its data are deleted.
- Usage statistics: 400 days. Reports of AI replies: 90 days. Security logs: 12 months.
  Expired sign-in sessions are removed automatically.
- Copies you exported yourself are under your control.

### 8. Your choices and rights
- Export your data as a JSON file: Profile → Export.
- Delete your account in the app (Profile → Delete account) or by writing to [contact email]
  from the account's email address. Web page for deletion requests: [deletion page URL].
- Correct your name, language and time zone in Profile.
- Turn off usage statistics or AI help in Profile, or simply do not use the AI features.
- Sign out other devices: Profile → Signed-in devices.
Depending on where you live you may have further rights, for example to object or to complain
to a data protection authority. Contact us at [contact email].

### 9. Age
LifeStyle is intended for people aged 18 and over. We do not knowingly collect data from
children. If you believe a child has created an account, contact [contact email] and we will
delete it.

### 10. Changes
We will update this page and the date above when this policy changes, and tell you in the app
when a change is important.

## العربية

> مسودة — الترجمة الملزمة يحددها المالك بعد المراجعة.

تاريخ السريان: [التاريخ] · المطوّر: [اسم المطوّر] · التواصل: [البريد]

### ١. من نحن
LifeStyle تطبيق للإنتاجية الشخصية: مهام، عادات، جلسات تركيز، ملاحظات، أهداف، تقويم، ومساعدة
بالذكاء الاصطناعي. للأسئلة عن بياناتك: [البريد].

### ٢. ما نجمعه ولماذا
- **الحساب:** البريد الإلكتروني، الاسم الظاهر، المنطقة الزمنية، اللغة، وكلمة المرور (تُحفظ
  مشفّرة بـ bcrypt فقط). لإنشاء حسابك وحمايته.
- **ما تضيفه للتطبيق:** المهام والمشاريع والعادات وتسجيلاتها والأهداف وأحداث التقويم
  والملاحظات والتذكيرات وجلسات التركيز والخطط اليومية والروتين وتذكيرات الاشتراكات (الاسم
  والسعر وموعد التجديد). تُحفظ على خادمنا ليعمل حسابك على أجهزتك ويمكنك تصديرها.
- **الأجهزة والأمان:** لكل تسجيل دخول: نوع النظام وإصدار التطبيق واسم الجهاز إن وُجد،
  وأوقات الدخول وآخر استخدام، وعنوان IP عند الدخول. وتُسجَّل أحداث الأمان (مثل الدخول وتغيير
  كلمة المرور والمحاولات الفاشلة) مع عنوان IP ومعرّف التطبيق/المتصفح. لعرض "الأجهزة المسجّل
  دخولها" وحماية الحسابات.
- **استعادة كلمة المرور:** البريد وعنوان IP ومعرّف التطبيق للطلب. يُرسل الرمز بالبريد عبر
  [مزوّد البريد].
- **إحصاءات الاستخدام (اختيارية):** أحداث بلا محتوى: فتح التطبيق، بدء/إكمال/تخطي التعريف،
  إكمال مهمة، تسجيل عادة، مع الوقت وإصدار التطبيق. لا تحتوي أبدًا على نص مهامك أو ملاحظاتك أو
  رسائل الذكاء الاصطناعي. يمكنك إيقافها من الملف الشخصي في أي وقت.

لا نجمع موقعك أو جهات اتصالك أو صورك أو ملفاتك أو صوت الميكروفون أو الرسائل النصية أو سجل
المكالمات. لا إعلانات، ولا معرّفات إعلانية، ولا أدوات تحليلات أو تقارير أعطال من أطراف ثالثة.

### ٣. ما يبقى على هاتفك فقط
- سجل محادثة المساعد (حتى ١٠٠ رسالة) حتى تمسحه أو تحذف التطبيق.
- التذكيرات والمنبهات تُجدول على هاتفك، وإشعارات شاشة القفل نصها عام.
- **درع التركيز** (اختياري) يستخدم خدمة إمكانية الوصول في أندرويد التي تفعّلها بنفسك، ليعيدك
  من التطبيقات التي اخترت حظرها أثناء جلسة تركيز تبدأها أنت. لا يقرأ محتوى الشاشة ولا يرسل
  شيئًا لخادمنا. ودرع الرسائل الاختياري يقرأ إشعارات تطبيقات المراسلة المدعومة في الذاكرة فقط،
  وليس الرسائل النصية SMS أبدًا، ولا يرسل محتواها أو يحفظه.
- إعداداتك (اللغة، واختيارات الذكاء الاصطناعي والإحصاءات، وتأكيد السن).

### ٤. الذكاء الاصطناعي (Google Gemini)
ميزات الذكاء الاصطناعي اختيارية ولمن عمرهم ١٨ سنة أو أكثر فقط (يسأل التطبيق مرة لكل حساب).
عند استخدام المساعد أو التدريب الأسبوعي أو رؤى التحليلات أو مساعدة الإضافة السريعة، يرسل
التطبيق طلبك إلى خادمنا، الذي يرسله إلى **Google Gemini** (شركة Google LLC) لإنشاء الرد:
رسالتك وآخر رسائل المحادثة نفسها (٢٠ رسالة سابقة كحد أقصى)، أو الأرقام الملخّصة التي يعرضها
التطبيق عليك قبل موافقتك على الإرسال، أو نص المهمة إن فعّلت مساعدة الذكاء الاصطناعي من الملف
الشخصي.

خادمنا لا يحفظ رسائلك أو الردود ولا يكتبها في السجلات، ويحتفظ فقط بعدد الطلبات لكل حساب من
أجل الحد اليومي. لا تكتب كلمات مرور أو معلومات حساسة. قد تخطئ ردود الذكاء الاصطناعي، وهي ليست
نصيحة طبية أو قانونية أو مالية.

*[اختر فقرة واحدة واحذف الأخرى قبل النشر.]*
- *[واجهة Gemini المدفوعة]* تعالج Google هذه الطلبات وفق شروط الخدمات المدفوعة، ولا تستخدمها
  لتحسين منتجاتها، وقد تحتفظ بها لفترة محدودة لاكتشاف إساءة الاستخدام كما في شروطها.
- *[واجهة Gemini المجانية — للاختبار المغلق فقط]* أثناء هذا الاختبار يستخدم التطبيق الواجهة
  المجانية. وفق شروط Google، قد تستخدم Google ما يُرسل لتحسين منتجاتها وقد يقرؤه مراجعون بشريون.
  لا ترسل أي شيء خاص.

### ٥. الإبلاغ عن رد
لكل رد من الذكاء الاصطناعي زر إبلاغ. يحتوي البلاغ على السبب الذي اخترته ومكان ظهور الرد ولغة
التطبيق وملاحظة اختيارية، ونص الرد إلا إذا ألغيت "إرفاق نص الرد". تُستخدم البلاغات فقط لمراجعة
أمان الذكاء الاصطناعي وجودته، وتُحذف تلقائيًا بعد ٩٠ يومًا، وتُحذف مع حسابك.

### ٦. من يعالج بياناتك
[Railway] لتشغيل الخادم، و[Neon] لقاعدة البيانات، و[مزوّد Redis] لعدادات قصيرة العمر، في
[المنطقة]. وGoogle (واجهة Gemini) لردود الذكاء الاصطناعي، و[مزوّد البريد] لرسائل استعادة كلمة
المرور. لا نبيع بياناتك ولا نشاركها للإعلانات، وكل الاتصال بين التطبيق والخادم مشفّر بـ HTTPS.

### ٧. مدة الاحتفاظ
بيانات الحساب وما تضيفه: طوال وجود الحساب، وما تحذفه يمكن استعادته ٣٠ يومًا ثم يُزال. عند حذف
الحساب لديك ١٤ يومًا للتراجع ثم يُحذف الحساب وبياناته. إحصاءات الاستخدام ٤٠٠ يوم، وبلاغات
الردود ٩٠ يومًا، وسجلات الأمان ١٢ شهرًا، والجلسات المنتهية تُزال تلقائيًا.

### ٨. اختياراتك وحقوقك
تصدير بياناتك (الملف الشخصي ← تصدير)، وحذف الحساب من التطبيق أو بمراسلة [البريد] من بريد
الحساب، وصفحة طلب الحذف: [رابط صفحة الحذف]. وتعديل الاسم واللغة والمنطقة الزمنية، وإيقاف
الإحصاءات أو مساعدة الذكاء الاصطناعي، وتسجيل خروج الأجهزة الأخرى.

### ٩. السن
التطبيق موجّه لمن عمرهم ١٨ سنة أو أكثر. إذا كنت تعتقد أن طفلًا أنشأ حسابًا، راسلنا على [البريد]
وسنحذفه.

### ١٠. التغييرات
سنحدّث هذه الصفحة والتاريخ أعلاه عند أي تغيير، ونخبرك داخل التطبيق إذا كان التغيير مهمًا.

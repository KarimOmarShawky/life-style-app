# LifeStyle — closed test guide for testers (DRAFT)

> **Draft for the owner, 2026-11-12.** Send the Arabic or English part to testers, after
> filling in the `[…]` placeholders privately (never in this public repository). Google Play
> rule for personal developer accounts: at least **12 testers must stay opted in for 14 days in
> a row** before production access can be requested. Recruit 16–20 adults so that drop-outs
> don't reset the count. Device checks for the owner: `docs/mobile/manual-test-checklist.md`.

## العربية

### قبل ما تبدأ
- لازم يكون عندك **١٨ سنة أو أكثر** (شروط Google Gemini اللي بيستخدمها المساعد الذكي).
- موبايل أندرويد، وحساب Google هو نفسه اللي اتبعت للمطوّر.
- افتح رابط الانضمام: [رابط الانضمام]، واضغط "Become a tester"، وبعدين نزّل التطبيق من
  Google Play من نفس الرابط.
- **متخرجش من الاختبار ومتمسحش التطبيق لمدة ١٤ يوم.** لو خرجت، العد بيبدأ من الأول لكل الناس.
  افتح التطبيق مرة في اليوم على الأقل، حتى لو دقيقة.

### الخصوصية
- رسائل المساعد الذكي بتتبعت لـ Google Gemini علشان يرد. **متكتبش كلمات سر أو أرقام بطاقات أو
  أي حاجة خاصة.**
- [احذف السطر ده لو الفوترة مفعّلة] أثناء الاختبار بنستخدم نسخة Gemini المجانية: Google ممكن
  تستخدم اللي بيتبعت لتحسين منتجاتها وممكن يقرأه مراجعين.
- سجل المحادثة بيفضل على موبايلك بس. سياسة الخصوصية: [رابط سياسة الخصوصية].

### المطلوب منك (كل يوم شوية)
1. **سجّل حساب** بالإيميل، واعمل أول مهمة وخلّصها.
2. **المهام:** ضيف مهام بالإضافة السريعة، مثلًا "اجتماع بكرة الساعة ٥"، واتأكد إن الميعاد اتفهم.
3. **العادات:** اعمل عادة وسجّلها كام يوم.
4. **التركيز:** شغّل جلسة تركيز قصيرة (٥ دقايق مثلًا).
5. **التذكيرات:** حط تذكير لمهمة بعد ١٠ دقايق واتأكد إنه وصل.

### سيناريوهات الذكاء الاصطناعي (مهمة جدًا)
- **ذ-١ أول مرة:** افتح تبويب "المساعد الذكي" وابعت سؤال. هيسألك "هل عمرك ١٨ سنة أو أكثر؟"،
  وبعدها موافقة الإرسال لـ Google Gemini. وافق واتأكد إن الرد وصل.
- **ذ-٢ اللغة:** اسأل بالعربي (مثلًا "إزاي أنظّم أسبوعي؟") والرد يكون بالعربي، وبعدين بالإنجليزي.
- **ذ-٣ محادثة طويلة:** كمّل نفس المحادثة لحد ١٥ رسالة أو أكتر. كل الردود لازم توصل. لو ظهرت
  رسالة إن المساعد مش متاح، اكتب الساعة كام وكام رسالة كانت في المحادثة.
- **ذ-٤ الإبلاغ عن رد:** جنب كل رد فيه زر علم 🏳. اضغطه، واختار سبب، وسيب "إرفاق نص الرد"
  متعلّم، وابعت. لازم يظهر "شكرًا، وصلنا بلاغك". جرّب مرة كمان وشيل العلامة.
- **ذ-٥ التدريب الأسبوعي:** المزيد ← تقرير الدماغ الأسبوعي ← إنشاء خطة تدريب أسبوعية بالذكاء
  الاصطناعي. اقرأ الأرقام اللي هتتبعت ووافق. على الرد زر إبلاغ.
- **ذ-٦ التحليلات:** المزيد ← التحليلات والرؤى ← "تحليل تراكمي" أو "داش بورد الأداء".
- **ذ-٧ الإضافة السريعة بالذكاء الاصطناعي:** الملف الشخصي (أيقونة الشخص في تبويب المهام) ←
  فعّل مساعدة الذكاء الاصطناعي للإضافة السريعة، وجرّب جمل معقدة شوية.
- **ذ-٨ الحدود:** لو ظهر إنك وصلت للحد اليومي أو الدقيقة، ده طبيعي. اكتب لنا لو حصل بسرعة.
- لو رد غلط أو مش لايق: **بلّغ عنه من زر العلم**، وده بيساعدنا جدًا.

### إمكانية الوصول (لو تقدر)
- كبّر الخط لأقصى حد من إعدادات الموبايل وشوف لو فيه كلام مقصوص.
- جرّب TalkBack على شاشة الإبلاغ وسؤال السن.

### إزاي تبلّغ عن مشكلة
ابعت على [قناة الملاحظات: جروب/فورم/إيميل] أو من صفحة التطبيق في Google Play
("ملاحظات خاصة للمطوّر"). اكتب:
- نوع الموبايل وإصدار أندرويد، وإصدار التطبيق (إعدادات أندرويد ← التطبيقات ← LifeStyle)؛
- عملت إيه بالترتيب، وكنت متوقع إيه، وحصل إيه؛
- الساعة واليوم، وصورة شاشة لو أمكن (من غير بيانات خاصة).

### معروف ومش محتاج بلاغ
- التطبيق محتاج إنترنت؛ مفيش وضع أوفلاين كامل.
- الذكاء الاصطناعي ممكن يغلط. مش نصيحة طبية.
- مستوى الـ XP والشارات بيتحسبوا على الموبايل ده بس.

## English

### Before you start
- You must be **18 or older** (Google Gemini terms; the AI assistant uses it).
- An Android phone and the Google account you gave the developer.
- Open the opt-in link [opt-in link], tap "Become a tester", then install from Google Play.
- **Stay opted in and keep the app installed for 14 days.** Opening it once a day helps.

### Privacy
- AI messages are sent to Google Gemini to create replies. **Never type passwords, card numbers
  or anything private.**
- [Delete if billing is on] During the test the unpaid Gemini API is used: Google may use what is
  sent to improve its products and human reviewers may read it.
- Chat history stays on your phone. Privacy policy: [privacy policy URL].

### Daily basics
Sign up; create and complete tasks (try Quick Add like "meeting tomorrow at 5"); check in a
habit; run a short focus session; set a reminder 10 minutes ahead and confirm it arrives.

### AI scenarios (most important)
- **AI-1 First use:** AI tab → send a question. You are asked "Are you 18 or older?", then the
  consent to send to Google Gemini. Agree; a reply arrives.
- **AI-2 Language:** ask in Arabic → Arabic reply; ask in English → English reply.
- **AI-3 Long chat:** continue one conversation to 15+ messages. Every reply must arrive; if you
  see "unavailable", note the time and how many messages the chat had.
- **AI-4 Report a reply:** tap the flag next to a reply, choose a reason, keep "Include the
  reply", send → "Thanks, we received your report." Try once more with it unticked.
- **AI-5 Weekly coaching:** More → Weekly Brain Report → Generate AI Weekly Coaching Plan.
- **AI-6 Analytics:** More → Analytics & Insights → Cumulative analysis / Performance dashboard.
- **AI-7 Smart Quick Add with AI:** Profile (person icon on the Tasks tab) → AI help for Smart
  Quick Add → try longer sentences.
- **AI-8 Limits:** a daily or per-minute limit message is expected; tell us if it comes quickly.
- A wrong or inappropriate reply: **report it with the flag**.

### Accessibility (if you can)
Largest system font: look for cut-off text. TalkBack on the report sheet and the age question.

### Reporting a problem
Send to [feedback channel] or use "Private feedback to the developer" on the app's Play page.
Include phone model, Android version, app version (Android Settings → Apps → LifeStyle), the steps, what you expected, what
happened, the time, and a screenshot without private data.

### Known and expected
Needs internet (no full offline mode). AI can be wrong and is not medical advice. XP and badges
are counted on this phone only.

# ملف تسليم مشروع Entertainment

آخر تحديث: 21 أكتوبر 2026 · صاحب المشروع: محمد (GitHub: `vetmohamed-arch`)

## 1. المشروع ده إيه

مشروع للتسلية ("Time joy"): ترشيحات قراية ومشاهدة، وأدوات بتخلي محمد يقرا الروايات الصيني والمانهوا مترجمة عربي ومن غير نت. الشغل الأساسي طلع تطبيق أندرويد اسمه **LNReader عربي** (نسخة معدّلة من LNReader)، ومعاه إضافة Edge، ونسخة عربي من Mihon للمانهوا.

**عن محمد:**
- بيكتب ويحب الرد بالعامية المصرية، ومن الموبايل غالباً. بيحب الحلول البسيطة (يكتب أرقام الفصول بدل شاشات اختيار كتير).
- بيحب روايات الزراعة الصيني (Xianxia)، ومفضلته **Nine Star Hegemon Body Art** على fictionzone.net. وكمان روايات معجبين ون بيس وناروتو (البطل جوه العالم أو معاه نظام/مساعد)، وإعادة الإحياء والعودة بالزمن والقوى القديمة. بيحب الأنمي والدونغوا والمانهوا.
- بيفضّل جودة ترجمة Microsoft/Edge، ودلوقتي عنده Gemini كمان.

## 2. الوضع باختصار (فين وصلنا)

| الحاجة | الحالة |
|---|---|
| تطبيق LNReader عربي | شغال. آخر نسخة **r20** (`build-4196376`، commit `c6bf576`)، فيها مترجم Gemini وتسريع التحميل وAPK أصغر (49 ميجا) |
| إضافة فيكشن زون في التطبيق | v2.2.0: الكتالوج كله + Omniportal (الصيني) + قواميس الموقع |
| إضافة Edge "LNReader Web" | v1.1.1 متسلّمة كـ zip، بس **PR #6 لسه مفتوح** ومحمد قال إن v1.1.0 مكانتش شغالة مع فيكشن زون، ولسه مستنيين تجربته لـ 1.1.1 |
| Mihon عربي (TachiyomiATVibe) | APK اتبنى 19 أكتوبر، مفيش رد من محمد على التجربة |
| قايمة البرامج المفتوحة المصدر | خلصت |
| ترشيحات وكلاش أوف كلانس | خلصوا |

## 3. الريبوهات

### `vetmohamed-arch/lnreader-arabic` (الأساسي، Public)
- ريبو مستقل (مش Fork) عشان GitHub Actions كانت مقفولة على الـ Fork. الفرع الأساسي **`master`** (أما `main` فده "Initial commit" ملوش علاقة، متدمجش فيه).
- **البناء:** `.github/workflows/build.yml` بيشتغل لوحده مع أي push على `master` (وكل يوم 00:30، ويدوي). بيطلع APK **arm64-v8a بس** (~49 ميجا) وبينشر Release باسم `build-<versionCode>` (مثلاً `build-4196376` = r20).
- **التحديث جوه التطبيق:** التطبيق بيشيّك على `/releases/latest` للريبو كل 10 دقايق ويعرض التحديث، ومعاه زرار "نسخ الرابط" عشان برنامج تحميل زي ADM/1DM.
- اسم الباكدج `com.rajarsheechatterjee.LNReader.preRelease` فبيتسطّب جنب LNReader الأصلي. التوقيع بمفتاح Expo debug ثابت، فالتحديثات بتتسطب فوق بعض.
- **إضافة فيكشن زون:** `plugins/fictionzone.js` + `plugins/plugins.min.json`. التطبيق بيقرا الريبو ده آخر واحد (`BUNDLED_REPOSITORY_URL`) فإضافتنا بتغطي على `fictionzone` الأصلية.
- **إضافة Edge:** فولدر `browser-extension/`، وليها workflow لوحدها `browser-extension.yml` بتنشر zip على Release `browser-extension` (مش latest عشان التطبيق ميفتكرهاش تحديث). `build.yml` بيتجاهل الفولدر ده.
- فيه فرع `apk` فيه نسخة من الـ APK للتحميل عن طريق raw.githubusercontent.com.

**الـ PRs المدموجة (بالترتيب):**
1. #1 إضافة فيكشن زون الجديدة (الكتالوج كله)
2. #2 فتح الروايات اللي لسه ملهاش فصول
3. #3 إضافة Edge "LNReader Web" v1.0.0
4. #4 التحميل مبقاش يقف + فيكشن زون بيحمّل 4 فصول مع بعض
5. #5 إضافة Edge v1.1.0 (متابعة الجديد، قاموس لكل رواية، نسخة احتياطية)
6. #7 زرار تحميل جوه الـ WebView
7. #8 الـ WebView بيحفظ تسجيل دخول الموقع (`__site_authorization`) وزرار "Share site requests"
8. #9 قراءة فصول Omniportal
9. #10 تحميل "من الفصل ده وبعده/قبله" بالضغط المطوّل
10. #11 تحميل بمدى فصول تكتبه (من-إلى) + قواميس فيكشن زون
11. #12 تسريع التحميل (الخانات مبتقفش، والترجمة في الخلفية)
12. #13 مترجم Gemini بيعلّم القاموس
13. #14 APK أصغر (arm64 بس) وزرار نسخ الرابط

**مفتوح:** #6 `fix(browser-extension)`: تسجيل دخول فيكشن زون من الكوكيز المخفية + الرجوع لصفحة الموقع لو مفيش فهرس (فرع `claude/project-thread-thkoq4`). الكود اتسلّم لمحمد كـ zip، بس محتاج يتدمج بعد ما يأكد إنه شغال.

- **إضافة Fiction Empire (روايات محمد الأصلية):** `plugins/fictionempire.js` (PR #15). المحتوى على فرع **`fiction-empire`** وبيتنشر بـ `python3 /mnt/project-files/novel/fiction-empire/sync.py`. التفاصيل في `novel/fiction-empire/README.md`.

### `vetmohamed-arch/lnreader` (Fork قديم)
- أول مكان اتعمل فيه زرار الترجمة (PR #1 من فرع `arabic-translation`، اتدمج). الـ Actions مقفولة عليه، **ومبقاش بيتشتغل عليه**. أي شغل جديد يروح على `lnreader-arabic`.

### `vetmohamed-arch/TachiyomiATVibe` (Mihon للمانهوا)
- Fork من TachiyomiAT. الفرع الأساسي `main`. PR #1 (`arabic-edition`) اتدمج: مترجم Microsoft (كوري ← عربي افتراضي) + بيسطّب كل مصادر Keiyoushi (~1400) جوه التطبيق أول ما يفتح؛ العربي والإنجليزي ظاهرين، والـ +18 مخفي.
- البناء: `build_push.yml`. آخر APK: [Run 39262166202](https://github.com/vetmohamed-arch/TachiyomiATVibe/actions/runs/39262166202) (artifact `arm64-v8a`، ~200 ميجا عشان موديلات قراءة النص).
- التوقيع: سر `SIGNING_KEY` أو مفتاح مؤقت في CI. **متحطش keystore في الريبو** (نظام الأمان بيمنعه).

## 4. تفاصيل تقنية مهمة

### الترجمة في التطبيق
- **Edge:** `POST https://edge.microsoft.com/translate/translatetext?from=&to=ar&isEnterpriseClient=false`، الـ body مصفوفة نصوص (≤1000 عنصر، ≤50 ألف حرف). الرد `[{translations:[{text}]}]`. من غير توكن. ده endpoint مش موثّق، ومايكروسوفت قفلت القديم (`/translate/auth`) قبل كده، فممكن يتغيّر تاني.
- **Google** احتياطي. لو الفصل أكتر من 80% حروف لاتيني بيتبعت `sl=en` (عشان كلمات القاموس العربي متخليش جوجل يرجّع الفقرة من غير ترجمة).
- **Gemini:** من تبويب الترجمة في إعدادات القارئ، بمفتاح محمد من aistudio.google.com (المفتاح على موبايله بس، **متطلبوش في الشات**). الأسامي اللي Gemini يطلعها بتتحفظ في `translationLearnedGlossary` (قايمة "Learned terms")، وEdge وجوجل بيستخدموها. لو Gemini وقع بيرجع لـ Edge ويظهر السبب. **لسه متجربش على الحقيقة**؛ أول تجربة هتبقى على موبايل محمد.
- الترجمات بتتخزن في كاش تحت `Translations/ar`.

### Fiction Zone API
- كل حاجة عن طريق `POST https://fictionzone.net/api/__api_party/fictionzone` بـ `{path, headers:[[k,v]], method}`. صفحات الموقع نفسها ورا Cloudflare، **متحاولش تحل الكابتشا آلياً**.
- `/platform/browse`: فلاتر genre/tag (وexclude)، ترتيب created_at/updated_at/rating/views_all/chapter_count/bookmark_count/chapter_last_created_at، أقصى 20 في الصفحة. status 1=مستمرة، 2=مكتملة.
- **Omniportal (الصيني fq-/qimao-):** `/omniportal/novels/details`, `/omniportal/novels/chapters`, `/omniportal/chapters/content` بـ `source_id=fq&source_key=<id>&translate=en|ar|none&engine=google-trans-v2`. قايمة الفصول محتاجة تسجيل دخول؛ المحتوى من غير دخول بيرجع معاينة بس.
- تسجيل الدخول لازم يتعمل من الـ WebView جوه التطبيق (عشان الكابتشا). الإضافة بتدوّر على JWT في الـ storage/cookies أو `__site_authorization` أو إعداد "token".
- إعداد **omniLanguage**: `en` (افتراضي، والتطبيق يترجم بـ Edge)، `ar` (ترجمة جوجل بتاعة الموقع)، `zh` (الصيني الخام + قواميس الموقع، والتطبيق يترجم صيني ← عربي).
- **القواميس:** `/glossary/collections` (15 باقة) و`/glossary/collections/<id>/terms` (من غير دخول). الافتراضي باقة 7 (BTTH، أسامي ووشيا) + 12. متخزنة 7 أيام.
- لو فصول Omniportal مش ظاهرة: اطلب من محمد "Share site requests" من قايمة الـ WebView.

### إضافة Edge "LNReader Web"
- MV3. النافذة بتحقن `content/grabber.js` في تاب الموقع، والتحميل بيتم من الصفحة نفسها (كوكيز وCloudflare بتاعة محمد)، والتخزين في IndexedDB.
- v1.1.0: متابعة الجديد كل 6 ساعات في نافذة مصغّرة، ترجمة تلقائية، قاموس لكل رواية، "كمّل من آخر فصل"، نسخة احتياطية gzip.
- v1.1.1: بتقرا تسجيل الدخول من الكوكيز المخفية وحالة Nuxt/Pinia (صلاحية `cookies`)، ولو مفيش فصول من الـ API بتقرا من الصفحة.
- التثبيت: فك الـ zip ← `edge://extensions` ← Developer mode ← Load unpacked (الفولدر اللي فيه manifest.json).
- خطة التطوير: [مستند الخطة](https://claude.ai/code/artifact/3aa7f056-50b0-4f8f-b4e5-670e122dc149) (المرحلة 2: قراءة بصوت، وضع صفحات، تصنيفات، صور، parsers للمواقع. المرحلة 3: ترجمة AI، ترجمة EPUB، بحث في كذا موقع، مزامنة مع التطبيق).

## 5. مشكلة التحميل البطيء (مهمة)

النت عند محمد من سيرفرات GitHub بطيء جداً (~8 كيلو/ث). الحلول اللي اتعملت:
1. الـ APK بقى 49 ميجا بدل 130 (arm64 بس).
2. زرار "نسخ الرابط" في رسالة التحديث، عشان ADM/1DM بـ 16 خط.
3. لينك raw: `https://raw.githubusercontent.com/vetmohamed-arch/lnreader-arabic/apk/LNReader.apk`.
4. **اللي اشتغل فعلاً:** نحمّل الـ APK من السيرفر (`api.github.com/repos/.../releases/assets/<id>` مع `Accept: application/octet-stream`) ونحطه في `/mnt/project-files/app-updates/`، ونرفقه في الرد أو نعرضه في [صفحة التحميل](https://claude.ai/artifact/USRz3fA1m4yDkspmESEaM8) (فيها زرار APK وزرار ZIP احتياطي). محمد قال "تمام" بعدها.

**لكل تحديث جديد:** كرر خطوة 4 بالـ APK الجديد، وحدّث صفحة التحميل.

## 6. الملفات المشتركة (`/mnt/project-files/`)

| الملف | إيه ده |
|---|---|
| `app-updates/LNReader-r20-arm64-v8a.apk` و`.zip` | آخر نسخة من التطبيق (r20)، للتحميل من سيرفرات Claude |
| `edge-novel-reader/LNReader-Web-1.0.0/1.1.0/1.1.1.zip` | نسخ إضافة Edge (الأحدث 1.1.1) |
| `edge-novel-reader/README.md` | شرح تثبيت واستخدام الإضافة بالعربي |
| `novel-translator/novel_ar.py`, `probe.py`, `README.md` | أداة Python قديمة (تنزيل من فيكشن زون + ترجمة لـ EPUB). **اتسابت** لصالح التطبيق، بس `probe.py` فيه طريقة الـ API |
| `open-source-list/open-source-apps.md` | ~70 برنامج مفتوح المصدر في 8 مجالات |
| `HANDOFF.md` | الملف ده |

## 7. قيود بيئة العمل

- السيرفر **مش بيقدر يبني APK** (dl.google.com مقفول)، فالبناء على GitHub Actions بس.
- السيرفر ساعات مش بيوصل لـ fictionzone.net وedge.microsoft.com وgenerativelanguage.googleapis.com (بيختلف من جلسة للتانية). التجارب الحقيقية بتتعمل على موبايل محمد.
- تحميل artifacts الـ Actions مقفول من السيرفر، بس assets بتاعة الـ Releases بتتحمّل عادي عن طريق الـ API.
- أول run على الريبو أحياناً بيفشل في ثانيتين؛ إعادة التشغيل بتحلها.

## 8. الثريدات

| الثريد | الخلاصة |
|---|---|
| ترشيحات روايات وفانتازيا | ترشيحات Xianxia وإعادة إحياء؛ اختيار LNReader وMihon؛ بداية زرار الترجمة وإصلاح الترجمة مع القاموس (r9) |
| تطبيق ميهون | TachiyomiATVibe عربي، APK اتبنى، مستني تجربة محمد |
| موارد كلاش أوف كلانس | روتين 5 دقايق يومي. **رفضنا** نلعب بداله أو نعمل بوت (بند من Supercell) |
| إضافة Edge لتحميل الروايات | ترشيح WebToEpub + Calibre |
| إضافة Edge مستوحاة من LNReader | LNReader Web لحد 1.1.1، **مستني رد محمد** وPR #6 مفتوح |
| إضافة فيكشن زون الجديدة | الشغل الأكبر: الإضافة، Omniportal، تحميل بالمدى، Gemini، APK أصغر، التحميل من سيرفرات Claude |
| أفضل برامج مفتوحة المصدر | القايمة + أهم 5 (Obtainium، Aniyomi، uBlock Origin، PowerToys، Stirling-PDF) |

## 9. الخطوات الجاية

1. **اسأل محمد عن Gemini:** اشتغل ولا لأ، والترجمة طلعت إزاي.
2. **إضافة Edge 1.1.1:** اتأكد إنها شغالة مع فيكشن زون، وبعدين ادمج PR #6. لو لأ، اطلب صورة النافذة ولينك الرواية.
3. **Mihon عربي:** اسأل محمد جرّبه ولا لأ (المصادر والترجمة).
4. أي تحديث جديد للتطبيق: ابعته من سيرفرات Claude (القسم 5).
5. أفكار مطروحة: زرار "بلّغ عن مشكلة" جوه التطبيق، المرحلة 2 و3 من خطة إضافة Edge، وممكن نلاقي مكان رفع تاني أسرع من GitHub للتحديثات.
6. ملحوظة: `Obtainium` ممكن يتابع تحديثات `lnreader-arabic` كبديل للمحدّث الداخلي.

## 10. قواعد للي هيكمل

- رد بالعامية المصرية، قصير وواضح.
- متطلبش مفاتيح API أو كلمات سر في الشات.
- متحطش keystore أو أسرار في الريبوهات.
- متأتمتش كابتشا Cloudflare، ومتعملش بوتات ألعاب.
- اشتغل على `master` في `lnreader-arabic` عن طريق PR، والبناء والنشر بيحصلوا لوحدهم بعد الدمج.

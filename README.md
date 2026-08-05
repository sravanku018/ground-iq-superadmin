# Election Survey App

Mobile app for Telangana election field surveys.

- **API:** Deno Deploy → Neon PostgreSQL  
- **UI:** React + Capacitor Android  

API is fixed in the app (no URL settings):

```
https://jazzy-crocodile-7790.sravanku018.deno.net
```

## Install APK

```
/home/sravan/Downloads/ElectionSurvey-release.apk
```

1. Uninstall any old build  
2. Install the APK  
3. Login  

## Who uses what

| Who | Access | How |
|-----|--------|-----|
| **Surveyor** | **Android app only** (no browser needed) | Install APK below |
| **Client Admin** | **Web portal only** | Browser → `/admin` |

Surveyors do **not** use the website. The React field UI is packaged into the APK with Capacitor.

### Surveyor Android app

```bash
npm run build:apk:release
# APK:
#   android/app/build/outputs/apk/release/app-release.apk
# Install latest APK (always rebuild after code changes):
#   npm run build:apk:release
#   Install: ElectionSurvey-v1.8.0.apk  (or latest ElectionSurvey-release.apk)
#   or ElectionSurvey-surveyor-app.apk in project root
```

| Username | Password |
|----------|----------|
| `s001` | `survey123` |

(Accounts created in Client Admin portal → app login only.)

Collect: GPS → photo → Q/A + audio → offline queue → sync. Pull to refresh questions.

### Client Admin (web portal — desktop browser)

| Username | Password |
|----------|----------|
| `admin` | `admin123` |

http://localhost:5173/admin — users, questions, analyze, review/confirm, report, upload.

## Rebuild APK

```bash
npm run build:apk:release
```

## Local web (optional)

```bash
npm install
npm run dev
```

Uses the same Deno API by default.

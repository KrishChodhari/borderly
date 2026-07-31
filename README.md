# borderly — Travel Ledger

A small site that tracks how many days each person has spent in each
country, based on arrival/departure "stamps" you log yourself — like
reading them straight out of a passport.

- Defaults to the current **Financial Year** (1 April → today, rolling
  back a year automatically if today is before 1 April)
- Filter by traveler and by period (this FY, last FY, calendar year,
  all time, or a custom range)
- **+ Add stamp** button (top right) logs an arrival or departure:
  person, type, Country, date as DD/MM/YYYY
- Data is stored in **Firebase Firestore** so everyone who opens the
  page sees the same live data — no backend of your own to run
- Deployable for free on **GitHub Pages**

This is plain HTML/CSS/JS — no build step, no npm install needed.

---

## 1. Create a free Firebase project (~5 minutes)

1. Go to <https://console.firebase.google.com> and sign in with any
   Google account.
2. Click **Add project**, give it a name (e.g. `borderly`), and
   finish the wizard (you can decline Google Analytics — not needed).
3. Once inside the project, click the **`</>`** (web) icon to register
   a web app. Give it any nickname. You do **not** need Firebase
   Hosting — you're using GitHub Pages instead.
4. Firebase will show you a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "borderly.firebaseapp.com",
     projectId: "borderly",
     storageBucket: "borderly.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```
   Copy those values into **`firebase-config.js`** in this project,
   replacing the `REPLACE_ME` placeholders.

5. In the left sidebar, go to **Build → Firestore Database → Create
   database**. Choose **Start in test mode** (fine for a small
   private tracker) and pick any region close to you.

6. Still in Firestore, open the **Rules** tab and set:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /stamps/{stampId} {
         allow read, write: if true;
       }
     }
   }
   ```
   This keeps things simple since it's just for you and a few people
   you trust with the link. **Anyone with the site URL (and therefore
   the embedded config) can read and write the data** — that's the
   tradeoff for a zero-backend setup with a public repo. If that ever
   stops being acceptable, add Firebase Authentication and tighten
   these rules to `if request.auth != null`.

That's it — no server, no API keys to keep secret beyond what's
already visible in a public GitHub Pages site.

---

## 2. Run it locally (optional, to check it works)

Any static file server works, e.g. from this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Try adding a stamp — it should
appear instantly, and reloading the page should keep it (proving it's
actually hitting Firestore, not just local memory).

---

## 3. Deploy to GitHub Pages

1. Create a new GitHub repository (public or private, either works
   with GitHub Pages on a paid/free plan as applicable) and push these
   files (`index.html`, `style.css`, `app.js`, `firebase-config.js`,
   `README.md`) to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a
   branch`, pick your default branch (e.g. `main`) and `/ (root)`,
   then **Save**.
4. After a minute, GitHub will show you the live URL, typically:
   `https://<your-username>.github.io/<repo-name>/`
5. Share that link with whoever you want to have access — everyone
   who opens it reads and writes the same Firestore data in real time.

---

## Notes on how days are counted

- Each traveler's arrivals/departures are matched up in date order to
  form "stays" in a country. If someone departs a country without an
  explicit arrival stamp on record, the stay is treated as having
  started at the beginning of whatever range you're viewing. If
  someone has an arrival with no departure yet, they're treated as
  still there (through "today" for the current period).
- Day counts are **inclusive** of both the arrival and departure date
  (a same-day round trip counts as 1 day).
- If you log an arrival somewhere new without a departure stamp from
  the previous place, the app assumes the previous stay ended the day
  before the new arrival.

## Editing / deleting entries

Every row in the **Stamp ledger** table has a **Delete** button.
There's no in-place edit yet — delete the stamp and re-add it with
the correct details.

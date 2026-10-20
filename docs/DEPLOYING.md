# Set up YS Connection for your location

Last checked: 2026-10-20.

This guide takes you from nothing to a working app. You do not need to write code. You use web pages only.

## 0. Before you start (5 min)

You need:

- An email address.
- About 1 hour.
- A payment card, only if you want Bus Ministry (see [GOOGLE-SETUP.md](GOOGLE-SETUP.md)).

Cost: GitHub, Supabase and Vercel have free plans.

WARNING: The Supabase Free plan has no backups. It also pauses your project after about 1 week with no use. A paused app shows errors until you restore it (see section 12).

NOTE: The Vercel Hobby plan is for non-commercial use. Check which Vercel plan fits your church before step 3.

Developer contact: DEVELOPER_CONTACT

### Glossary

- **Fork**: your own copy of the app code on GitHub.
- **Repository**: a folder of code on GitHub.
- **Environment variable**: a named setting for the app, kept in Vercel. Vercel shows it as a name and a value.
- **Session pooler**: the kind of database connection string this app needs. Supabase lists it under **Connect**.
- **Redeploy**: tell Vercel to build the app again with your newest settings.
- **Service account**: a robot login that Google makes for the app.

### Save these values

Keep these in a password manager that two staff can open:

- The database password (step 2).
- `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` and `SETUP_CODE` (step 4).
- The admin password (step 4).

WARNING: If you lose `FIELD_ENCRYPTION_KEY`, the app cannot read phone numbers.

## 1. GitHub (5 min)

1. Make a GitHub account at [github.com](https://github.com). Skip this step if you have one.
2. Open the app [repository](#glossary): `https://github.com/citipointe-youth/ys-connection`
3. Select **Fork** at the top right. This makes your own [fork](#glossary).

[Screenshot: 01 github-fork-button — the Fork button]

4. Select **Create fork**.

Expected result: GitHub shows your own copy, with your name in the page title.

[Screenshot: 02 github-create-fork — the Create fork button]

## 2. Supabase (10 min)

Supabase stores your data.

1. Make an account at [supabase.com](https://supabase.com).
2. Select **New project**.
3. Type a name for the project.
4. Create a database password. Use only letters and numbers. Do not use symbols such as `#`, `/`, `?` or `@`. Copy it to your password manager now.
5. Select the region closest to your church.
6. Select **Create new project**.

Expected result: after about 2 minutes, the project page opens.

[Screenshot: 03 supabase-new-project — the new project form with the password hidden]

7. Select **Connect** at the top of the page.
8. Select **Session pooler**. Copy the string. See [Session pooler](#glossary).
9. Paste the string in a new Notepad or TextEdit file. Replace the text `[YOUR-PASSWORD]`, with its brackets, by your database password. Type the password. Do not copy it.

The string must contain `:5432`.

NOTE: Do not use the Direct connection string or the Transaction pooler string. The Direct connection string does not work on Vercel. The Transaction pooler string uses port `6543` and drops connections.

[Screenshot: 04 supabase-connect-session-pooler — the Session pooler string]

You can stop here for now. Come back when you are ready for step 3.

## 3. Vercel (10 min)

Vercel runs the app.

1. Make a Vercel account at [vercel.com](https://vercel.com). Select **Continue with GitHub**.
2. Select the plan that fits your church.
3. Select **Add New** > **Project**.
4. Find your fork in the list. Select **Import**.

[Screenshot: 05 vercel-import — the Import button next to your fork]

5. Open [**Environment Variables**](#glossary) on the import page.
6. Add these three values. Keep **Production** ticked for each one.

| Name | Value |
|---|---|
| `PERSISTENCE` | `supabase` |
| `DATABASE_URL` | The Session pooler string from step 2, with your password |
| `APP_ORIGIN` | `https://your-project.vercel.app` (you can fix this after the first deploy) |

CAUTION: Do not add `NODE_ENV`. The build fails with it.

Do not add `CORS_ORIGINS`.

[Screenshot: 06 vercel-env-vars-import — the Environment Variables box with dummy values]

7. Select **Deploy**.

Expected result: after about 2 minutes, Vercel shows "Congratulations".

[Screenshot: 09 vercel-deploy-success — the Congratulations page]

8. Copy the domain Vercel shows.
9. Compare it with `APP_ORIGIN`. If they differ, open **Settings** > **Environment Variables**. Edit `APP_ORIGIN`. Select **Save**.
10. Open **Deployments**. Select the three dots on the top row. Select [**Redeploy**](#glossary).

Expected result: the top row shows **Ready** after about 2 minutes.

[Screenshot: 08 vercel-redeploy — the Redeploy item in the menu]

### If the build fails

1. Open the failed deployment in **Deployments**.
2. Select **Build Logs**.
3. Copy the last 20 lines. Send them to the developer (see section 0).

[Screenshot: 13 vercel-build-log — the end of the Build Logs]

You can stop here. The app is online but not yet ready to use.

## 4. Open the app and make the admin (15 min)

1. Open your Vercel domain in a browser.

Expected result: the page "Set up the app" shows a list of checks.

[Screenshot: 10 app-setup-checklist — the checklist with fake values]

WARNING: The app shows each generated value only until you reload the page. Copy each value to your password manager and to Vercel. If the app already has data, do not replace `FIELD_ENCRYPTION_KEY`.

2. Find the row `SESSION_SECRET`. Select **Generate**. Select **Copy**.
3. In Vercel, open **Settings** > **Environment Variables**. Select **Add**.
4. Type `SESSION_SECRET` as the name. Paste the value. Keep **Production** ticked. Select **Save**.
5. Do steps 2 to 4 again for `FIELD_ENCRYPTION_KEY`.
6. Do steps 2 to 4 again for `SETUP_CODE`.

[Screenshot: 07 vercel-env-vars-settings — the Environment Variables list with dummy values]

7. Open **Deployments**. Select the three dots on the top row. Select **Redeploy**.

Expected result: the top row shows **Ready**.

8. Open your app again. Select **Check again**.

Expected result: every row except the Google row shows a tick. The form "Create your admin" appears.

9. Copy `SETUP_CODE` from Vercel: **Settings** > **Environment Variables**. Also save it in your password manager. Paste it in **Setup code**.
10. Type a name in **Display name**. Type a password of 8 or more characters in **Password**. Type it again in **Type the password again**.
11. Select **Create admin**.

Expected result: the app opens and you are signed in as `admin`.

[Screenshot: 11 app-create-admin — the Create your admin form]

WARNING: Save the admin password in a password manager that two staff can open. The app has no password recovery.

After you create the admin, you can delete `SETUP_CODE` in Vercel.

You can stop here. Your app works.

## 5. Set up your ministry (10 min)

1. Open **Admin** > **Youth Setup**.
2. Under **Pre-set Configurations**, select **Complex Ministry** or **Simple Ministry**.
3. If you have a settings file from another location, find the card **Use this setup at another location**. Select **Load settings file**. Select the file.
4. You must change these. A settings file from another location brings that location's names.
   - In the card **Branding**, set **Ministry name**, **App name** and **Logo**.
   - In the card **Terminology**, set **Group-name prefixes to strip** to the prefixes of your group names.
   - In the card **Structure & Roles**, check **Time zone** and **Consent closes at**. **Time zone** must be the time zone of your Elvanto account.
5. Select **Save Youth Setup** at the bottom of the page. Select **Save** in the box.
6. Select **Apply account layout for Complex** or **Apply account layout for Simple**. The button name ends with your preset.
7. Read the list of accounts. Type `APPLY`. Select **Apply**.

WARNING: The box "Account layout applied" shows each new password once. Copy each one to your password manager before you select **Done**.

Complex Ministry makes a girls login and a boys login for each grade, and four quad logins. Simple Ministry makes six grade logins. Add or remove logins in **Admin** > **Accounts**.

Expected result: the accounts list shows the new logins.

8. Open the [leader guide](leader-handout.md). Fill in the two blanks: the web address of the app and the phone number of the admin. Give a copy to each leader with their login after you complete section 8 (Elvanto link).

## 6. Change the app icon (required, 5 min)

The app icon on a phone Home Screen comes from your fork. It shows the Brisbane icon until you change it.

1. Open your fork on GitHub.
2. In `public/icons/`, replace `icon-180.png`, `icon-192.png`, `icon-512.png` and `icon.svg` with your own icon. Keep the same names and sizes.

If you cannot make an SVG file, ask the developer.
3. Commit the change on GitHub.

Expected result: Vercel deploys it by itself. The app name and colours come from **Youth Setup**.

## 7. Elvanto for this location (10 min)

The app sends new people to Elvanto with two public Elvanto forms: a student form and a parent form.

1. Open **Admin** > **Youth Setup**. Find the card **Elvanto for this location**.
2. Paste the public link of each form in **Student form link** and **Parent form link**.
3. Fill in **Location to tick**, **New People flow name starts with**, **Parent Consent flow name starts with** and **Default state**.
4. Select **Check forms**.
5. Read each line. A line "Not found" has two fixes. Change the question in Elvanto so it matches, then select **Check forms** again. Or type its id in the box under the line.
6. A line "This form asks something the app doesn't fill" names a question the app does not send. Remove it from the Elvanto form, or make it not required. Then select **Check forms** again.
7. Select **Save Youth Setup**. Select **Save** in the box.

WARNING: Keep **New person** set to **Off** until each "Not found" line is fixed or has an id, and no line says the form asks something the app doesn't fill.

## 8. Elvanto link (15 min)

The Elvanto link connects the app to the console on the location PC. The console does the Elvanto work.

1. In your password manager, make a new password of 40 letters and numbers. This is `LINK_SYNC_TOKEN`.
2. In Vercel, open **Settings** > **Environment Variables**. Select **Add**.
3. Type `LINK_SYNC_TOKEN` as the name. Paste the value. Keep **Production** ticked. Select **Save**.
4. Open **Deployments**. Select the three dots on the top row. Select **Redeploy**.
5. On the location PC, open the console. Open **Sync** > **Advanced** > **Setup**.
6. On the row **YS link token**, select **Set**. Paste the same value. Save it.
7. On the row **YS link**, select **Turn on**.
8. In the app, open **Admin** > **Elvanto link**.

Expected result: within 2 minutes, the **Console** row says **Online**.

9. Open **Admin** > **Youth Setup**. Find the card **Modules & Import**.
10. Set **New person**, **Check-in**, **Lifegroup report** and **Flow steps** to **On** or **Admin only**.
11. Set **New youth & consent (Elvanto)** to **On**.
12. Select **Save Youth Setup**. Select **Save** in the box.
13. Open **Admin** > **Elvanto link**. Find **Matching**.
14. Open the tabs **Unmatched** and **Several possible**.
15. Pair each Elvanto student with the correct YS student. Select **Match**, or select **Not in YS**.

The tab **Set by hand** shows what you did. Use **Clear** or **Undo** there to change it.

WARNING: Do not contact is not fully active until Matching is done. Until then the app shows a banner about it.

New youth & consent in the app is the main place to add new people and send parent consents. The console tab is the backup for when the link is down.

## 9. Updates (5 min)

The developer improves the app. Get the new version like this:

1. Open your fork on GitHub.
2. Look for the text "This branch is N commits behind". Select **Sync fork**.
3. Select **Update branch**.
4. Wait about 2 minutes. Vercel builds the new version by itself.

Expected result: the newest deployment in Vercel shows **Ready**.

The build also updates the database. It never deletes your data.

WARNING: All locations use one codebase. Your settings are in **Youth Setup**, not in the code. Never change code in your fork. The icon files (section 6) are pictures, not code. They are the only files your fork changes. Get every other change with **Sync fork** only.

After your icon change, GitHub says your fork is ahead and behind. If **Sync fork** asks you to discard your commits, select **Discard commits**. Then do section 6 again.

[Screenshot: 12 github-sync-fork — the Sync fork button]

## 10. Bus Ministry (optional, 30 min)

Bus needs a Google account. Follow [GOOGLE-SETUP.md](GOOGLE-SETUP.md). It takes about 30 minutes.

NOTE: The app uses the **Time zone** in **Youth Setup** for every date and time, Bus too.

## 11. Phone alerts for Notices (optional, 10 min)

Alerts tell a phone when a new notice arrives. They need three VAPID values in Vercel. Without them, the app works, but it says alerts are not set up yet.

1. Ask the developer for a VAPID key pair.

Technical: make a pair with `npx web-push generate-vapid-keys`.

2. In Vercel, add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` with the two keys. Keep **Production** ticked.
3. Add `VAPID_SUBJECT` with `mailto:` and the email address of your admin, for example `mailto:admin@example.org`.
4. Open **Deployments**. Select **Redeploy** on the top row.

Expected result: when **Notices** is **On** in **Modules & Import**, **More** > **Notices** shows the button **Turn on alerts**.

NOTE: Notices go only to admin, director and quad logins. Simple Ministry has no quad logins.

## 12. Troubleshooting (as needed)

| What you see | What to do |
|---|---|
| The page says "The app cannot start" | Read the page text. It names the missing setting. Add it in Vercel. Then redeploy. |
| A row in the checklist shows a fix | Do what the text says. Then select **Check again**. |
| The **Database connection** row shows a fix | Copy the Session pooler string from Supabase again. Paste it as `DATABASE_URL`. Then redeploy. |
| The **Database connection** row still shows a fix after you copied a new string | Check the password in `DATABASE_URL`. Check that the string is the Session pooler string. |
| The **Storage** row shows a fix | `PERSISTENCE` is missing or wrong. In Vercel, set `PERSISTENCE` to `supabase`. Then redeploy. |
| The **Database port** row shows a fix | The string uses port `6543`. That is the Transaction pooler. It drops connections under load. Use the Session pooler string with port `5432`. |
| The **Database version** row shows a fix | Open **Deployments** in Vercel. Select **Redeploy** on the top row. |
| The Build Logs say `password authentication failed` | The password in `DATABASE_URL` is wrong, or still reads `[YOUR-PASSWORD]`. Type the database password in `DATABASE_URL` again, without the brackets. Then redeploy. |
| The Build Logs say `ENETUNREACH`, `ENOTFOUND`, `ETIMEDOUT` or `Tenant or user not found` | You used the Direct connection string, or a wrong one. Copy the Session pooler string from Supabase. Paste it as `DATABASE_URL`. Then redeploy. |
| The Build Logs say `DATABASE_URL is not a valid connection string` | The database password has symbols. In Supabase, reset the database password to letters and numbers only. Copy the Session pooler string again. Then redeploy. |
| The Build Logs say `canceling statement due to lock timeout` | Another build was changing the database. Wait 2 minutes. Then redeploy. |
| The Build Logs say `uses port 6543` | You used the Transaction pooler string. Copy the Session pooler string, which uses port `5432`. Then redeploy. |
| The build fails | Copy the last 20 lines of the **Build Logs**. Send them to the developer (see section 0). |
| The build fails and the log names `tsx` | You set `NODE_ENV`. Delete it in Vercel. Then redeploy. |
| Sign-in says "Can't reach the server", and your internet works | `APP_ORIGIN` is wrong or missing. The app then uses the YS Brisbane address. Set `APP_ORIGIN` to your domain. Then redeploy. |
| "The setup code is wrong" | Copy `SETUP_CODE` again from Vercel: **Settings** > **Environment Variables**. Paste it. |
| "An admin already exists. Log in." | Someone made the admin already. Use the admin password. |
| "SETUP_CODE is missing or too short" | Add a `SETUP_CODE` of 16 or more characters in Vercel. Then redeploy. |
| The app was fine and now shows errors | Check whether Supabase paused the project. Open Supabase. Select **Restore project**. Wait 2 minutes. |
| A new version has a bug | Open **Deployments** in Vercel. Find an older deployment marked **Ready**. Select the three dots, then **Instant Rollback**. This does not touch the database. |
| Phone numbers show as unreadable | `FIELD_ENCRYPTION_KEY` changed. Put the saved key back in Vercel. Then redeploy. |
| Your change in Vercel has no effect | Vercel uses new settings only after a redeploy. Select **Redeploy**. |
| The Vercel value is not used | Check that **Production** is ticked for that value. |
| You forgot the admin password | The app has no recovery. Contact the developer. |

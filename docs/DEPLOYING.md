# Set up YS Connection for your location

Last checked: 2026-10-10.

This guide takes you from nothing to a working app. You do not need to write code. You use web pages only.

## 0. Before you start (5 min)

You need:

- An email address.
- About 45 minutes.
- A payment card, only if you want Bus Ministry (see [GOOGLE-SETUP.md](GOOGLE-SETUP.md)).

Cost: GitHub, Supabase and Vercel have free plans. NOTE: Vercel Hobby is for non-commercial use. Check which Vercel plan fits your church.

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
2. Open the app repository: `https://github.com/citipointe-youth/ys-connection`.
3. Select **Fork** at the top right.

[Screenshot: 01 github-fork-button — the Fork button]

4. Select **Create fork**.

Expected result: GitHub shows your own copy, with your name in the page title.

[Screenshot: 02 github-create-fork — the Create fork button]

## 2. Supabase (10 min)

Supabase stores your data.

1. Make an account at [supabase.com](https://supabase.com).
2. Select **New project**.
3. Type a name for the project.
4. Create a database password. Copy it to your password manager now.
5. Select the region closest to your church.
6. Select **Create new project**.

Expected result: after about 2 minutes, the project page opens.

[Screenshot: 03 supabase-new-project — the new project form with the password hidden]

7. Select **Connect** at the top of the page.
8. Select **Session pooler**. Copy the string.
9. Paste the string in a text file. Replace `[YOUR-PASSWORD]` with your database password. Type it by hand.

The string must show port `5432`. NOTE: Do not use the Transaction pooler string. It uses port `6543` and the app fails with it.

[Screenshot: 04 supabase-connect-session-pooler — the Session pooler string]

You can stop here for now. Come back when you are ready for step 3.

## 3. Vercel (10 min)

Vercel runs the app.

1. Make a Vercel account at [vercel.com](https://vercel.com). Select **Continue with GitHub**.
2. Select the free plan that fits your church.
3. Select **Add New** > **Project**.
4. Find your fork in the list. Select **Import**.

[Screenshot: 05 vercel-import — the Import button next to your fork]

5. Open **Environment Variables** on the import page.
6. Add these three values. Keep **Production** ticked for each one.

| Name | Value |
|---|---|
| `PERSISTENCE` | `supabase` |
| `DATABASE_URL` | The Session pooler string from step 2, with your password |
| `APP_ORIGIN` | `https://your-project.vercel.app` (you can fix this after the first deploy) |

CAUTION: Do not add `NODE_ENV`. The build fails with it.

Leave `CORS_ORIGINS` empty.

[Screenshot: 06 vercel-env-vars-import — the Environment Variables box with dummy values]

7. Select **Deploy**.

Expected result: after about 2 minutes, Vercel shows "Congratulations".

[Screenshot: 09 vercel-deploy-success — the Congratulations page]

8. Copy the domain Vercel shows.
9. Compare it with `APP_ORIGIN`. If they differ, open **Settings** > **Environment Variables**. Edit `APP_ORIGIN`. Select **Save**.
10. Open **Deployments**. Select the three dots on the top row. Select **Redeploy**.

Expected result: the top row shows **Ready** after about 2 minutes.

[Screenshot: 08 vercel-redeploy — the Redeploy item in the menu]

### If the build fails

1. Open the failed deployment in **Deployments**.
2. Select **Build Logs**.
3. Copy the last 20 lines. Send them to the developer.

[Screenshot: 13 vercel-build-log — the end of the Build Logs]

You can stop here. The app is online but not yet ready to use.

## 4. Open the app and make the admin (15 min)

1. Open your Vercel domain in a browser.

Expected result: the page "Set up the app" shows a list of checks.

[Screenshot: 10 app-setup-checklist — the checklist with fake values]

2. Find the row `SESSION_SECRET`. Select **Generate**. Select **Copy**.
3. In Vercel, open **Settings** > **Environment Variables**. Select **Add**.
4. Type `SESSION_SECRET` as the name. Paste the value. Keep **Production** ticked. Select **Save**.
5. Do steps 2 to 4 again for `FIELD_ENCRYPTION_KEY`.
6. Do steps 2 to 4 again for `SETUP_CODE`.

WARNING: Save the `FIELD_ENCRYPTION_KEY` value in your password manager. If the app already has data, do not replace it.

[Screenshot: 07 vercel-env-vars-settings — the Environment Variables list with dummy values]

7. Open **Deployments**. Select the three dots on the top row. Select **Redeploy**.

Expected result: the top row shows **Ready**.

8. Open your app again. Select **Check again**.

Expected result: every row shows a tick. The form "Create your admin" appears.

9. Copy `SETUP_CODE` from Vercel: **Settings** > **Environment Variables**. Paste it in the **Setup code** field.
10. Type a display name. Type a password of 8 or more characters. Type it again.
11. Select **Create admin**.

Expected result: the app opens and you are signed in as `admin`.

[Screenshot: 11 app-create-admin — the Create your admin form]

WARNING: Save the admin password in a password manager that two staff can open. The app has no password recovery.

After you create the admin, you can delete `SETUP_CODE` in Vercel.

You can stop here. Your app works.

## 5. Set up your ministry (10 min)

1. Open **Admin** > **Youth Setup**.
2. If you have a settings file from another location, select **Load settings file**. Select the file. Then select **Save Youth Setup**.
3. Select the preset that fits your ministry. Change the names and colours if you want.
4. Select **Apply account layout**. The app makes the logins for your team.

CAUTION: Do this once. Check the list of accounts before you select it.

Role presets: a large ministry gets grade and quad logins. A small ministry gets Admin and Grade logins only. Add or remove accounts in **Admin** > **Accounts**.

Expected result: the accounts list shows the new logins. Each new login has its own password.

## 6. Updates (5 min)

The developer improves the app. Take the changes like this:

1. Open your fork on GitHub.
2. Look for the text "This branch is N commits behind". Select **Sync fork**.
3. Select **Update branch**.
4. Wait about 2 minutes. Vercel builds the new version by itself.

Expected result: the newest deployment in Vercel shows **Ready**.

The build also updates the database. It never deletes your data.

[Screenshot: 12 github-sync-fork — the Sync fork button]

## 7. Bus Ministry (optional)

Bus needs a Google account. Follow [GOOGLE-SETUP.md](GOOGLE-SETUP.md). It takes about 30 minutes.

NOTE: The app uses Queensland time. A state with daylight saving sees Bus times 1 hour off in summer.

## 8. Change the app icon (optional)

Replace the files in `public/icons/` in your fork. Commit the change on GitHub. Vercel deploys it by itself. The app name and colours come from **Youth Setup**.

## 9. Troubleshooting

| What you see | What to do |
|---|---|
| The page says "The app cannot start" | Open the page text. It names the missing setting. Add it in Vercel. Then redeploy. |
| A row in the checklist shows a fix text | Do what the text says. Then select **Check again**. |
| The database row stays red | Copy the Session pooler string from Supabase again. Paste it as `DATABASE_URL`. Then redeploy. |
| The port row is red | The string uses port `6543`. That is the Transaction pooler. It drops connections under load. Use the Session pooler string with port `5432`. |
| The schema row is red | Open **Deployments** in Vercel. Select **Redeploy** on the top row. |
| The build fails | Copy the last 20 lines of the **Build Logs**. Send them to the developer. |
| The build fails and the log names `tsx` | You set `NODE_ENV`. Delete it in Vercel. Then redeploy. |
| The app loads but login fails with a CORS error | `APP_ORIGIN` is wrong or missing. The app then uses the YS Brisbane address. Set `APP_ORIGIN` to your domain. Then redeploy. |
| "The setup code is wrong" | Copy `SETUP_CODE` again from Vercel: **Settings** > **Environment Variables**. Paste it. |
| "An admin already exists. Log in." | Someone made the admin already. Use the admin password. |
| "SETUP_CODE is missing or too short" | Add a `SETUP_CODE` of 16 or more characters in Vercel. Then redeploy. |
| The app was fine and now shows errors | Check whether Supabase paused the project. Open Supabase. Select **Restore project**. Wait 2 minutes. |
| A new version has a bug | Open **Deployments** in Vercel. Find an older deployment marked **Ready**. Select the three dots, then **Instant Rollback**. This does not touch the database. |
| Phone numbers show as unreadable | `FIELD_ENCRYPTION_KEY` changed. Put the saved key back in Vercel. Then redeploy. |
| Your change in Vercel has no effect | Vercel uses new settings only after a redeploy. Select **Redeploy**. |
| The Vercel value is not used | Check that **Production** is ticked for that value. |
| You forgot the admin password | The app has no recovery. Contact the developer. |

# Set up Google for Bus Ministry

Last checked: 2026-10-10.
Bus Ministry uses Google to plan routes. You paste one line in a command window inside your browser. Do [DEPLOYING.md](DEPLOYING.md) first.

## 0. Before you start (2 min)

You need:

- A Google account.
- A payment card. Google asks for it, but it rarely charges.
- About 30 minutes.

Cost: usually AUD 0 a month. Heavy use costs about AUD 30 a month. Step 8 sets an alert.

## 1. Create the project (5 min)

1. Open [console.cloud.google.com](https://console.cloud.google.com). Sign in.
2. Select the project list at the top. Select **New project**.
3. Type a name, for example `youth-bus`. Select **Create**.
4. Copy the **Project ID** from the project list. It looks like `youth-bus-123456`.

Expected result: the project name shows at the top of the page.
[Screenshot: 14 gcp-new-project — the New project form]

## 2. Turn on billing (5 min)

1. Open the menu. Select **Billing**.
2. Select **Link a billing account**. Follow the steps. Add your card.

Expected result: the page shows your billing account as linked.
[Screenshot: 15 gcp-billing — the linked billing account, with IDs cropped]

## 3. Open Cloud Shell (2 min)

Cloud Shell is a command window inside your browser.
1. Select the **>_** icon at the top right.
2. Select **Continue** if Google asks.

Expected result: a dark panel opens at the bottom of the page.
[Screenshot: 16 cloudshell-button — the Cloud Shell icon]

## 4. Run the setup line (5 min)

1. Paste this line in Cloud Shell:
```
bash <(curl -sL https://raw.githubusercontent.com/citipointe-youth/ys-connection/COMMIT_SHA/scripts/google-setup.sh)
```
2. Use the **Enter** key.
3. Select **Authorize** if Google asks.
4. If the script asks for a Project ID, paste the ID from step 1. Use the **Enter** key.

Expected result: after about 2 minutes, two values show between marker lines.
[Screenshot: 17 cloudshell-output — the two values between the lines, values blurred]

## 5. If the script stops

Find your message. Do the fix. Then run the line again.

| Message | Fix |
|---|---|
| No Project ID was typed. Run this command again. | Run the line again. Paste the Project ID when asked. |
| Cannot use that project. Check the Project ID. Then run this command again. | Check the Project ID. Copy it from step 1. |
| Billing is off. Open https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT. Turn on billing. Then run this command again. | Do step 2. Then run the line again. |
| Cannot turn on the Google services. Run this command again. | Wait 1 minute. Run the line again. |
| Cannot make the service account. Run this command again. | Run the line again. |
| Cannot give the service account its role. Run this command again. | Run the line again. |
| Your organisation blocks key files. Ask an organisation admin to allow key files for this project, or create the project under a personal Gmail account. Then run this command again. | Show this message to your organisation admin. The script prints a Technical line for them. |
| Cannot make a key file. Run this command again. | Run the line again. |
| Cannot make the API key. Run this command again. | Run the line again. |
NOTE: The script can print "Cannot check billing". It then goes on. Confirm billing in step 2.

## 6. Copy the two values (2 min)

1. Select the text of `GOOGLE_SA_JSON` under its name. It is one long line that starts with `{`.
2. Copy it. Paste it in your password manager.
3. Do the same for `GOOGLE_MAPS_API_KEY`.

WARNING: Cloud Shell shows the key file only now. If you lose it, run the line again to make a new one.

## 7. Add the values in Vercel (5 min)

1. Open your project in Vercel. Select **Settings** > **Environment Variables**.
2. Add `GOOGLE_SA_JSON`. Paste the whole line, with the `{ }`.
3. Add `GOOGLE_MAPS_API_KEY`. Paste the key.
4. Keep **Production** ticked for both. Select **Save**.
5. Open **Deployments**. Select the three dots on the top row. Select **Redeploy**.

Expected result: the top row shows **Ready** after about 2 minutes.

You can stop here. Steps 8 and 9 check your work.

## 8. Set a budget alert (3 min)

1. In Google Cloud, open **Billing** > **Budgets & alerts**.
2. Select **Create budget**.
3. Type a name. Type the amount: AUD 20. Select **Finish**.

Expected result: the budget shows in the list.
[Screenshot: 18 gcp-budget — the budget form, IDs cropped]

## 9. Test the connection (2 min)

1. Open your app. Sign in as `admin`.
2. Open **Bus**. Open **Bus settings**.
3. Select **Test Google connection**.

Expected result: five rows show OK. The rows are Sign-in, Route Optimization, Places, Routes and Static Maps.

A row that says **Fix needed** shows its own fix text. Do what it says. Then select the button again.
[Screenshot: 19 bus-test-google — the five rows]

## 10. Remove the access (when a person leaves)

1. In Google Cloud, open **IAM & Admin** > **Service Accounts**.
2. Select `ys-bus`. Open **Keys**.
3. Delete each old key. Keep the newest key.

Each run of the script makes a new key. Delete the old keys after you update Vercel.

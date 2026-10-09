#!/usr/bin/env bash
# YS Connection — Google setup for Bus Ministry. Run in Google Cloud Shell.
# Safe to run twice: reuses the service account and the API key; makes a NEW key file each run.
# Sources checked 2026-10-10:
#   IAM role roles/routeoptimization.editor: https://docs.cloud.google.com/iam/docs/roles-permissions/routeoptimization
#   gcloud services api-keys create (--display-name, --api-target=service=...): https://docs.cloud.google.com/sdk/gcloud/reference/services/api-keys/create
#   org policy override (set-policy YAML, enforce: false): https://docs.cloud.google.com/resource-manager/docs/organization-policy/using-constraints
#   gcloud org-policies set-policy / delete: https://docs.cloud.google.com/sdk/gcloud/reference/org-policies/set-policy
#   key-creation constraints: https://docs.cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts
# Not confirmed word-for-word in the docs: the YAML for the managed constraint
# iam.managed.disableServiceAccountKeyCreation (docs give the generic managed template: name + spec.rules.enforce).
# `gcloud services api-keys get-key-string` and `list --filter` were not re-fetched; they are standard gcloud usage.
set -uo pipefail

SA_NAME="ys-bus"
KEY_NAME="ys-bus-key"
APIS="iam.googleapis.com apikeys.googleapis.com cloudresourcemanager.googleapis.com routeoptimization.googleapis.com places.googleapis.com routes.googleapis.com static-maps-backend.googleapis.com"
ROLE="roles/routeoptimization.editor"

say()  { printf '%s\n' "$*"; }
tech() { printf 'Technical: %s\n' "$*"; }
stop() { say "$1"; [ -n "${2:-}" ] && tech "$2"; exit 1; }

# 1. Project
PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  say "No project is selected. These are your projects:"
  gcloud projects list --format="value(projectId)"
  read -r -p "Paste the Project ID. Then use the Enter key: " PROJECT
  [ -z "$PROJECT" ] && stop "No Project ID was typed. Run this command again."
  gcloud config set project "$PROJECT" >/dev/null 2>&1 || stop "Cannot use that project. Check the Project ID. Then run this command again."
fi
say "Project: $PROJECT"

# 2. Billing
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)"
if [ $? -ne 0 ] || [ -z "$BILLING" ]; then
  say "Cannot check billing. Confirm it at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
elif [ "$BILLING" != "True" ]; then
  { say "Billing is off. Turn on billing at the link below. Then run this command again."; say "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"; exit 1; }
fi

# 3. APIs
say "Turning on the Google services. This takes about 1 minute."
gcloud services enable $APIS --project "$PROJECT" >/dev/null 2>&1 || stop "Cannot turn on the Google services. Run this command again." "gcloud services enable $APIS"

# 4. Service account + role
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="YS Connection Bus" --project "$PROJECT" >/dev/null 2>&1 \
  || stop "Cannot make the service account. Run this command again."
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --condition=None >/dev/null 2>&1 \
  || stop "Cannot give the service account its role. Run this command again." "add-iam-policy-binding $ROLE"

# 5. Key file
KEYFILE="$(mktemp)"
if ! ERR="$(gcloud iam service-accounts keys create "$KEYFILE" --iam-account="$SA_EMAIL" --project "$PROJECT" 2>&1)"; then
  rm -f "$KEYFILE"
  if printf '%s' "$ERR" | grep -q 'constraints/iam'; then
    stop "Your organisation blocks key files. Ask an organisation admin to allow key files for this project, or create the project under a personal Gmail account. Then run this command again." \
         "an admin with role orgpolicy.policyAdmin runs this for project $PROJECT, then waits up to 15 minutes: for C in iam.disableServiceAccountKeyCreation iam.managed.disableServiceAccountKeyCreation; do printf 'name: projects/$PROJECT/policies/%s\nspec:\n  rules:\n  - enforce: false\n' \"\$C\" > /tmp/\$C.yaml; gcloud org-policies set-policy /tmp/\$C.yaml; done (to undo: gcloud org-policies delete <constraint> --project=$PROJECT)"
  fi
  stop "Cannot make a key file. Run this command again."
fi

# 6. API key
KEY_ID="$(gcloud services api-keys list --project "$PROJECT" --filter="displayName=$KEY_NAME" --format='value(name)' 2>/dev/null | head -n1)"
if [ -z "$KEY_ID" ]; then
  gcloud services api-keys create --project "$PROJECT" --display-name="$KEY_NAME" \
    --api-target=service=places.googleapis.com --api-target=service=routes.googleapis.com \
    --api-target=service=static-maps-backend.googleapis.com >/dev/null 2>&1 || { shred -u "$KEYFILE"; stop "Cannot make the API key. Run this command again."; }
  KEY_ID="$(gcloud services api-keys list --project "$PROJECT" --filter="displayName=$KEY_NAME" --format='value(name)' | head -n1)"
fi
API_KEY="$(gcloud services api-keys get-key-string "$KEY_ID" --format='value(keyString)')"

# 7. Output
SA_JSON="$(python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin),separators=(",",":")))' < "$KEYFILE")"
shred -u "$KEYFILE"
say ""
say "=============== COPY FROM HERE ==============="
say "GOOGLE_SA_JSON"
say "$SA_JSON"
say ""
say "GOOGLE_MAPS_API_KEY"
say "$API_KEY"
say "================ COPY TO HERE ================"
say "Copy the two values between the lines. Save them in your password manager. Then paste them in Vercel."

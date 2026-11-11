# GLDD change log

Changes are tracked here and in GitHub commits. Dates use Indianapolis time. Customer records and personal profile values do not belong in this log.

## 2026-11-11 — Driver handoff with food acceptance

- Add selected-stop handoffs to an active, email-confirmed replacement driver. Drivers transfer their claimed/reserved stops; Business Admins can also include unclaimed stops and arrange transfers for another driver.
- Require a collection location and reason. Pause selected stops until the recipient accepts, declines or the sender cancels. Acceptance requires confirmation that the food was received.
- After acceptance, reserve the stops for the replacement. They start and complete each delivery separately; previous drivers cannot claim or complete them.
- Share an account-protected link through Share, WhatsApp or SMS. Links never grant staff access. Refresh handoff state while the dashboard is open and record each decision in day activity.
- Preserve completed deliveries, item prices and payments. Include rollback-only database verification and eight handoff UI checks; all 21 available automated checks pass.
- Also stop the delivery list from stretching below the kitchen return row.
- No real handoffs were created and no invitation/test messages were sent during development. Recipient email testing remains pending user selection.

## 2026-11-11 — Staff access controls and email confirmation

- Add explicit Revoke access and Restore access actions, with confirmation, per workspace. Keep the Super Admin protected and preserve delivery/payment history.
- Add Resend invitation for unconfirmed staff and Send sign-in code for verified accounts. Neither action deletes or recreates an existing account.
- Record staff name, role and active-status changes with actor, time and before/after values; show recent access history to the Super Admin. Recheck membership while the app is open.
- Add a thank-you page that verifies the invitation token with Supabase; invalid or expired links offer sign-in. Strip the token from the URL and disable referrers/caching on the callback.
- Correct Supabase Site URL from localhost to the live domain, and use an explicit live confirmation callback for invitations.
- Verification: 13 focused automated checks pass; database rollback checks cover revoke/restore, owner protection, stale updates, live membership and audit privacy. No real staff access or delivery records changed during testing; no test emails sent.

## 2026-11-07 — Workspace header, first-name onboarding and general business copy

- Replace family-specific sign-in wording with general delivery-workspace copy.
- Move the business selector beside the GLDD brand; show it even with one available business.
- Put workspace update time and Refresh underneath the selector. Keep the alert banner for save errors.
- Show the person's first name in the greeting and account button, with their role beneath it.
- After sign-in, prompt for a first name when none has been saved. Require saving the name or signing out; a role label or email is not treated as a name.
- Keep name edits separate from authorization. Existing server checks still protect memberships and sole-owner access.
- Handle invalid or unchanged business selections without clearing the current workspace.
- Verification: 53 automated checks pass; the affected sign-in/workspace suites were rerun after wording changes (40 passed). Live desktop and 390 × 844 phone views reviewed. Saved first name loaded into the greeting and account button.
- Deployment: live on granlakou.app.
- Commit: 9fbdd313e13ab2629aeccfcf02764e84f2a9281f.
- Deployment ID: bbaca995-83d4-4987-bc83-1cbea5ce053d.

## 2026-11-07 — Remove sample link

- Remove Explore the sample dashboard from the sign-in screens and remove its click handler.
- Commit: 569953e5785531242b2776dce9549dcb262f5ca9.
- Deployment: bd7c3974-739d-4a9e-8b6b-7332590283d3, successful on granlakou.app.
- Verification: 4 sign-in checks passed; live sign-in page reviewed.

## 2026-11-07 — Initial Cloudflare launch

- Publish GLDD to granlakou.app through GitHub and Cloudflare Pages.
- Deploy only the allowlisted public browser files; exclude database scripts, screenshots and private records.
- Connect the granlakou.app custom domain with HTTPS.
- Commit: f55fb1be67b153afb0e0e5be65f4172a941d9569.
- Deployment: 448eabb9-751d-4ee7-ad35-fd0d45a18877.
- Verification: 51 automated checks passed and hosted sign-in reviewed on desktop and phone.
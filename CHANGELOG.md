# GLDD change log

Changes are tracked here and in GitHub commits. Dates use Indianapolis time. Customer records and personal profile values do not belong in this log.

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

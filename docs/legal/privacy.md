# Privacy Policy

**Effective date:** April 28, 2026
**Last updated:** April 28, 2026

## 1. Introduction

This Privacy Policy describes how Remarks ("**Remarks**," "**we**,"
"**our**," or "**us**") collects, uses, discloses, and protects information
when you use our browser extension, web application, hosted API, and
related services (collectively, the "**Service**"). By using the Service
you agree to the collection and use of information in accordance with this
Policy.

This Policy applies to all users of the Service, including users in the
European Economic Area ("**EEA**"), the United Kingdom ("**UK**"),
Switzerland, and the United States. We comply with the General Data
Protection Regulation ("**GDPR**"), the UK GDPR, the California Consumer
Privacy Act as amended by the California Privacy Rights Act
("**CCPA/CPRA**"), and other applicable privacy laws.

## 2. Scope

This Policy covers all components of the Remarks Service:

- The Remarks browser extension (Chrome, and where available, Firefox);
- The Remarks web application at `https://app.remarks.online`;
- The Remarks public website at `https://remarks.online`;
- The Remarks API at `https://api.remarks.online`;
- The Remarks Model Context Protocol (MCP) server at
  `https://mcp.remarks.online`.

This Policy does not apply to third-party websites, applications, or
services that you may access through the Service. Those third parties
operate under their own privacy policies.

## 3. Information We Collect

### 3.1 Account information

When you create an account, we collect:

- **Identity:** name, email address, profile photo (if you provide one),
  and any additional identifiers you authenticate with through OAuth (e.g.,
  Google `sub` claim).
- **Organization data:** the organization(s) you belong to within Remarks,
  your role(s) within those organizations, and any organization metadata
  you provide.
- **Authentication credentials:** managed by our authentication
  subprocessor (Clerk; see §6). We do not store passwords directly.

### 3.2 User content (annotations, projects, comments)

When you use the Service to create annotations, projects, or related
content, we collect and store:

- The **URL** of the page on which you create the annotation;
- The **selector** identifying the DOM element you annotated (CSS selector,
  bounding rectangle, or both);
- The **comment text**, status, and metadata you attach to the annotation;
- Any **screenshot** you explicitly capture (cropped to the region you
  selected; never the full page or background tab);
- Replies, status changes, and other activity on the annotation thread.

We collect this content only when you explicitly take an action that
produces it. The browser extension does not capture page content in the
background.

### 3.3 Technical data

When you interact with the Service, we automatically collect:

- **Device and connection information:** IP address, user-agent string,
  browser type and version, operating system, screen resolution, language
  preference, time zone;
- **Request logs:** timestamp, HTTP method, path, response status, latency,
  trace identifier;
- **Diagnostic information:** error reports, stack traces, and crash logs
  when the Service experiences an error.

### 3.4 Cookies and similar technologies

The Service uses cookies and similar technologies for authentication,
session management, and security. Specifically:

- **Clerk session cookie** — required for authentication. Set by our
  authentication subprocessor on `app.remarks.online` and
  `clerk.remarks.online`.
- **`chrome.storage`** in the browser extension — stores session state,
  user preferences (sidebar layout, selected project), and an offline
  outbox of pending annotations.

The Service does **not** use cookies or storage for advertising,
retargeting, or third-party analytics tracking.

### 3.5 Information we do not collect

To be explicit about what is **not** collected:

- We do **not** record your general browsing history. URLs are stored only
  when you create an annotation on a given page.
- We do **not** read or capture the content of pages you visit unless you
  explicitly invoke the element picker or rectangle picker.
- We do **not** record keystrokes, mouse movements, scroll behavior, or
  other session-replay-style telemetry.
- We do **not** collect financial or payment information directly. If we
  add paid plans, payment processing will be performed by a PCI-compliant
  payment processor under a separate disclosure.
- We do **not** collect health data, biometric data, or precise geolocation.

## 4. How We Use Information

We use the information we collect for the following purposes:

| Purpose                                | Categories used                                            |
| -------------------------------------- | ---------------------------------------------------------- |
| Provide, maintain, and operate the Service | Account, user content, technical data, cookies         |
| Authenticate users and manage sessions | Account, cookies                                           |
| Synchronize annotations between the browser extension and the dashboard | Account, user content, cookies |
| Detect, investigate, and prevent abuse, fraud, or security incidents | Account, technical data, request logs |
| Provide customer support                | Account, user content (when shared by the user)           |
| Improve the Service (aggregate analytics, debugging) | Technical data, request logs, anonymized usage events |
| Comply with legal obligations and enforce [our agreements](/terms) | All categories as required      |
| Communicate with you about the Service (transactional notices, security alerts) | Account |

We do **not** use your information to serve advertising, retarget you on
other websites, or build profiles about you for sale to third parties. See
§9 (Limited Use Disclosure).

## 5. Legal Bases for Processing (EEA, UK, Switzerland)

If you are in the EEA, UK, or Switzerland, we process your personal data
under the following GDPR Article 6 legal bases:

- **Contract** (Art. 6(1)(b)) — to provide the Service you signed up for,
  including authenticating you, storing your annotations, and synchronizing
  state between the extension and the dashboard.
- **Legitimate interests** (Art. 6(1)(f)) — to operate, secure, and improve
  the Service; to prevent abuse; and to communicate with you about the
  Service. We balance our legitimate interests against your rights and
  freedoms; you may object as described in §10.
- **Consent** (Art. 6(1)(a)) — where required by law, e.g., for optional
  analytics in jurisdictions that require opt-in. You may withdraw consent
  at any time.
- **Legal obligation** (Art. 6(1)(c)) — to comply with applicable law,
  legal process, or governmental requests.

## 6. Sharing and Disclosure

We share information only as described below.

### 6.1 Service providers and subprocessors

We engage third-party service providers ("**subprocessors**") to operate
the Service. Each subprocessor is bound by a written agreement
([Data Processing Addendum, or "DPA"](/dpa)) that requires them to process
personal data only on our instructions and to safeguard it appropriately.

Current subprocessors:

| Subprocessor       | Purpose                                  | Location          |
| ------------------ | ---------------------------------------- | ----------------- |
| Clerk, Inc.        | Authentication and identity management   | United States     |
| Cloudflare, Inc.   | Object storage (R2) for screenshots; CDN | Global            |
| Neon Inc.          | Managed Postgres database                | United States, EU |
| Fly.io, Inc.       | Hosting (API, MCP server)                | Global edge       |
| Vercel Inc.        | Hosting (web dashboard, marketing site)  | Global edge       |
| Resend, Inc.       | Transactional email delivery             | United States     |
| Inngest, Inc.      | Background job orchestration             | United States     |
| PostHog Inc.       | Product analytics (optional, opt-out)    | United States, EU |

We will update this list when we add or remove subprocessors. Material
changes will be notified at least 30 days in advance for organization
administrators on paid plans, where applicable.

### 6.2 Other disclosures

We may disclose information:

- **To organization members.** If you are a member of an organization and
  create an annotation in a project belonging to that organization, the
  annotation, your name, and your email address are visible to other
  members of that organization.
- **For legal reasons.** When required by law, regulation, legal process,
  or governmental request, including to comply with subpoenas, court
  orders, or other lawful demands. Where permitted, we will notify you
  before disclosure.
- **To protect rights, property, and safety.** To investigate, prevent, or
  take action regarding suspected fraud, security incidents, violations of
  our [Terms of Service](/terms), or harm to others.
- **In a corporate transaction.** If Remarks is involved in a merger,
  acquisition, financing, reorganization, bankruptcy, or sale of assets,
  information may be transferred to the successor entity. We will notify
  you of any change in ownership or use of your information.

We do **not** sell your personal information for monetary consideration,
and we do **not** "share" it for cross-context behavioral advertising as
those terms are defined under the CCPA/CPRA.

## 7. International Data Transfers

Remarks is operated from the United States. When you use the Service from
outside the United States, your information will be transferred to,
processed in, and stored in the United States and other countries where we
or our subprocessors operate.

For transfers from the EEA, UK, and Switzerland to countries that do not
provide an adequate level of data protection under applicable law, we rely
on:

- the European Commission's Standard Contractual Clauses (SCCs);
- the UK International Data Transfer Addendum;
- the Swiss Federal Data Protection and Information Commissioner's
  recognition of the SCCs;
- supplementary technical, organizational, and contractual measures.

Copies of the SCCs and information about supplementary measures are
available on request — see §13.

## 8. Data Retention

We retain information only as long as necessary for the purposes described
in this Policy:

- **Account data** is retained for as long as your account is active. If
  you delete your account, we delete or anonymize your account data within
  **30 days**, except where we are required to retain it longer (e.g., for
  tax, accounting, or legal compliance).
- **User content (annotations, comments, screenshots)** is retained for as
  long as the owning organization or personal account exists. When an
  organization or account is deleted, associated user content is deleted
  within 30 days.
- **Server logs** (request logs, error logs) are retained for **90 days**
  on a rolling basis, then permanently deleted.
- **Backups** are retained on a rolling basis for up to **30 days** for
  disaster recovery.

You can delete individual annotations and projects from the Service at any
time. Deleting from the user interface initiates immediate deletion from
our primary storage; backup retention applies as described above.

## 9. Your Rights

### 9.1 EEA, UK, and Switzerland (GDPR / UK GDPR)

If you are in the EEA, UK, or Switzerland, you have the following rights
with respect to your personal data:

- **Access** — confirmation of whether we process your data and a copy of
  it (Art. 15);
- **Rectification** — correction of inaccurate or incomplete data
  (Art. 16);
- **Erasure** — deletion of your data in specified circumstances
  ("right to be forgotten," Art. 17);
- **Restriction of processing** — limitation of how we use your data in
  specified circumstances (Art. 18);
- **Data portability** — receipt of your data in a structured, commonly
  used, machine-readable format, and the right to transmit it to another
  controller (Art. 20);
- **Object to processing** — objection to processing based on our
  legitimate interests, including profiling (Art. 21);
- **Withdraw consent** — where processing is based on consent, you may
  withdraw it at any time without affecting prior lawful processing
  (Art. 7(3));
- **Lodge a complaint** with a supervisory authority. The lead
  supervisory authority depends on your habitual residence or place of
  work; a list is available at
  https://edpb.europa.eu/about-edpb/about-edpb/members_en.

### 9.2 California (CCPA/CPRA)

If you are a California resident, you have the right to:

- **Know** what personal information we collect, use, disclose, and (if
  applicable) sell or share, including the categories and specific pieces
  of personal information;
- **Delete** the personal information we have collected from you, subject
  to certain exceptions;
- **Correct** inaccurate personal information we maintain about you;
- **Opt out of sale or sharing** — Remarks does not sell personal
  information for monetary consideration and does not share it for
  cross-context behavioral advertising. There is nothing to opt out of,
  but the right exists if our practices change;
- **Limit use of sensitive personal information** — Remarks does not
  collect "sensitive personal information" as defined in the CPRA beyond
  authentication credentials, which are processed only to provide and
  secure the Service;
- **Non-discrimination** — we will not discriminate against you for
  exercising any of these rights.

### 9.3 How to exercise your rights

To exercise any of the rights above, contact us at
`privacy@remarks.online`. We will respond within the time required by
applicable law (typically 30 days for GDPR, 45 days for CCPA, extendable
as the law allows). We may need to verify your identity before responding;
authenticated requests submitted through your Remarks account satisfy our
verification requirements in most cases.

You may authorize an agent to make a request on your behalf, subject to
verification of the agent's authority.

## 10. Cookies and Tracking Technologies

We use only the cookies and storage strictly necessary to operate the
Service:

- **Authentication cookies** set by our authentication subprocessor
  (Clerk) on `app.remarks.online` and `clerk.remarks.online`;
- **Browser extension storage** (`chrome.storage` and IndexedDB) for
  user preferences, the active organization, the selected project, and
  the offline annotation outbox.

We do **not** use third-party advertising cookies, retargeting pixels, or
session-replay tools. If we add product analytics in the future, we will
update this Policy and provide an opt-out mechanism for users in
jurisdictions that require it.

## 11. Children's Privacy

The Service is not directed to children under 16, and we do not knowingly
collect personal information from children under 16. If we learn that we
have collected personal information from a child under 16 without verified
parental consent, we will delete it promptly. If you believe we may have
collected information from a child, contact us at `privacy@remarks.online`.

The Service is not subject to the Children's Online Privacy Protection
Act ("COPPA") because it is not directed to children under 13.

## 12. Security

We implement administrative, technical, and physical safeguards designed
to protect personal information against unauthorized access, alteration,
disclosure, or destruction. These include:

- **Encryption in transit** — TLS 1.2+ for all client–server traffic and
  inter-service communication;
- **Encryption at rest** — at-rest encryption for databases (Neon),
  object storage (Cloudflare R2), and backups;
- **Access controls** — role-based access, multi-factor authentication
  for production access, and least-privilege principles for our team;
- **Audit logging** — production access and sensitive operations are
  logged;
- **Subprocessor diligence** — we evaluate the security posture of our
  subprocessors and require contractual security commitments.

No system is perfectly secure. If you become aware of a security issue,
contact us at `security@remarks.online`.

## 13. Changes to This Policy

We may update this Policy from time to time. When we do, we will revise
the "Last updated" date at the top and, if the change is material, notify
you by email or in-product notice before it takes effect. Continued use
of the Service after the effective date of the change constitutes
acceptance of the updated Policy.

## 14. Contact

If you have questions about this Policy or our privacy practices, contact:

- **Email:** `privacy@remarks.online`
- **Postal:** Remarks, Attn: Privacy, [address pending]

If you are in the EEA or UK and prefer to contact a representative within
the EEA or UK, our representative information will be added here once
appointed.

## 15. Chrome Web Store Limited Use Disclosure

The Remarks browser extension's use of information received from Google
APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. Specifically:

1. We use information received from Google APIs only to provide and
   improve user-facing features of the Remarks extension that are
   prominent in the requesting extension's user interface.
2. We do not transfer this information to others except as necessary to
   provide or improve user-facing features, to comply with applicable law,
   or as part of a merger, acquisition, or sale of assets with notice to
   users.
3. We do not use or transfer this information for serving ads, including
   retargeted, personalized, or interest-based advertising.
4. We do not use or transfer this information to determine creditworthiness
   or for lending purposes.
5. We do not allow humans to read this information unless we have obtained
   the user's affirmative consent for specific data, it is necessary for
   security or to comply with applicable law, or the data is aggregated and
   used for internal operations in accordance with applicable law.

## 16. Definitions

- **"Personal information"** / **"personal data"** means information that
  identifies, relates to, describes, or could reasonably be linked,
  directly or indirectly, with a particular individual or household.
- **"Sensitive personal information"** has the meaning given in the
  CCPA/CPRA and applicable law.
- **"Subprocessor"** means a third party engaged by Remarks to process
  personal information on our behalf.
- **"Service"** has the meaning given in §1.
- **"User content"** has the meaning given in §3.2.

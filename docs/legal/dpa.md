# Data Processing Addendum

> **Draft — engineering working copy, pending legal review.**

**Effective date:** April 30, 2026
**Last updated:** April 30, 2026

## 1. Introduction

This Data Processing Addendum ("**DPA**") supplements the [Terms of
Service](/terms) (the "**Agreement**") between Remarks ("**Remarks**,"
"**we**," "**our**," or "**us**") and the customer ("**Customer**" or
"**you**") that uses the Remarks Service. It applies to Remarks'
processing of Personal Data on behalf of Customer in connection with the
Service to the extent that such processing is subject to:

- the EU General Data Protection Regulation 2016/679 ("**GDPR**");
- the United Kingdom General Data Protection Regulation and the UK Data
  Protection Act 2018 ("**UK GDPR**");
- the Swiss Federal Act on Data Protection ("**FADP**"); or
- the California Consumer Privacy Act, as amended by the California
  Privacy Rights Act ("**CCPA/CPRA**"),

(collectively, "**Data Protection Laws**"). In the event of any conflict
between this DPA and the Agreement with respect to the processing of
Personal Data, this DPA controls.

## 2. Definitions

Capitalized terms not defined here have the meanings given in the
Agreement or in the Data Protection Laws. For convenience:

- **"Personal Data"** means information relating to an identified or
  identifiable natural person that Customer (acting as Controller)
  submits to the Service and that Remarks processes on Customer's
  behalf.
- **"Data Subject"** means the individual to whom Personal Data relates.
- **"Controller"**, **"Processor"**, **"processing"**, and
  **"supervisory authority"** have the meanings given in the GDPR.
- **"Service Provider"** has the meaning given in the CCPA/CPRA.
- **"Subprocessor"** means any third party that processes Personal Data
  on behalf of Remarks in connection with the Service.
- **"Standard Contractual Clauses"** or **"SCCs"** means the European
  Commission's Standard Contractual Clauses approved under Commission
  Implementing Decision (EU) 2021/914 of 4 June 2021, as amended.
- **"UK IDTA"** means the UK International Data Transfer Addendum to the
  EU SCCs, issued under Section 119A of the UK Data Protection Act 2018.

## 3. Roles and scope

- **Customer is the Controller** of Personal Data submitted to the
  Service. Where the CCPA/CPRA applies, Customer is the **Business**.
- **Remarks is the Processor** acting on Customer's behalf. Where the
  CCPA/CPRA applies, Remarks is the **Service Provider**.
- **Subject matter:** Remarks' provision of the Service to Customer
  under the Agreement.
- **Nature and purpose:** Hosting, transmission, display, and storage of
  Personal Data submitted by Customer's authorized users, in order to
  provide in-context website annotation and feedback functionality.
- **Duration:** the term of the Agreement, plus the deletion windows in
  §12.
- **Categories of Data Subjects:** Customer's authorized users, members
  of Customer's Organization, individuals identifiable in User Content
  Customer chooses to upload (e.g., names visible in screenshots).
- **Categories of Personal Data:** as further described in the [Privacy
  Policy](/privacy) §3 — account information (name, email, profile
  photo, OAuth identifiers), user content (URLs, selectors, comments,
  screenshots), technical data (IP, user-agent, request logs).

## 4. Customer instructions

Remarks processes Personal Data only on Customer's documented
instructions. The Agreement, this DPA, and Customer's use of the Service
through its features and configurations together constitute Customer's
documented instructions. Remarks will inform Customer if, in its opinion,
an instruction infringes Data Protection Laws.

If Remarks is required by applicable law to process Personal Data
otherwise than on Customer's documented instructions (e.g., to comply
with a legal obligation), Remarks will, where permitted by that law,
inform Customer of that legal requirement before processing.

## 5. Confidentiality

Remarks ensures that personnel authorized to process Personal Data are
bound by appropriate obligations of confidentiality and have received
appropriate training on the protection of Personal Data.

## 6. Security measures

Remarks implements and maintains appropriate technical and organizational
measures to protect Personal Data against accidental or unlawful
destruction, loss, alteration, unauthorized disclosure, or access. These
measures include:

- **Encryption in transit** — TLS 1.2 or higher for all client–server
  traffic and inter-service communication;
- **Encryption at rest** — at-rest encryption for databases (Neon),
  object storage (Cloudflare R2), and backups;
- **Access controls** — role-based access, multi-factor authentication
  for production access, and least-privilege principles;
- **Audit logging** — production access and sensitive operations are
  logged;
- **Subprocessor diligence** — security review of subprocessors and
  contractual security commitments.

A more detailed description appears in **Annex 2**. Remarks may update
the security measures from time to time, provided that the overall level
of security is not materially diminished.

## 7. Subprocessors

### 7.1 General authorization

Customer provides general authorization for Remarks to engage
Subprocessors to process Personal Data, subject to this §7. The list of
current Subprocessors appears in **Annex 3** and in the [Privacy
Policy](/privacy) §6.1.

### 7.2 New Subprocessors

Before engaging a new Subprocessor that processes Personal Data, Remarks
will give Customer at least **30 days' prior notice** by updating the
Subprocessor list and, for organization administrators, by email or
in-product notification. Customer may object to a new Subprocessor in
writing during the notice period on reasonable grounds relating to data
protection. If the parties cannot resolve the objection, Customer may
terminate the affected portion of the Service for convenience and
receive a pro-rata refund of any prepaid fees.

### 7.3 Subprocessor obligations

Remarks will impose data protection terms on each Subprocessor that are
substantially the same as those in this DPA, including obligations to
implement appropriate security measures and to process Personal Data
only on Remarks' instructions. Remarks remains liable to Customer for
the acts and omissions of its Subprocessors.

## 8. International transfers

Remarks is operated from the United States. To the extent Remarks
transfers Personal Data subject to GDPR, UK GDPR, or FADP to a country
that does not benefit from an adequacy decision, Remarks relies on
appropriate safeguards under Data Protection Laws, including:

- the **EU SCCs** for transfers from the EEA, on Module Two
  (Controller-to-Processor) or Module Three (Processor-to-Processor) as
  applicable;
- the **UK IDTA** for transfers from the United Kingdom;
- the **Swiss FDPIC** recognition of the EU SCCs (with adaptations) for
  transfers from Switzerland.

The SCCs are deemed incorporated into this DPA by reference, with the
following selections:

- **Clause 7 (docking clause):** included.
- **Clause 9 (subprocessors):** Option 2 (general authorization) with
  the 30-day notice period in §7.2.
- **Clause 11 (redress):** the optional language regarding independent
  dispute resolution is **not** selected.
- **Clause 17 (governing law):** Ireland.
- **Clause 18 (forum and jurisdiction):** Ireland.
- **Annex I.A (parties):** Customer (data exporter) and Remarks (data
  importer); contact details as in the Agreement and §15 of this DPA.
- **Annex I.B (description of transfer):** as set out in **Annex 1** of
  this DPA.
- **Annex I.C (competent supervisory authority):** the Irish Data
  Protection Commission (or, where Customer's lead supervisory authority
  differs under GDPR Art. 56, that authority).
- **Annex II (technical and organizational measures):** as set out in
  **Annex 2** of this DPA.
- **Annex III (subprocessors):** as set out in **Annex 3** of this DPA.

Remarks supplements the SCCs with appropriate technical, organizational,
and contractual measures consistent with the EDPB recommendations on
supplementary measures.

## 9. Data subject rights assistance

Taking into account the nature of the processing, Remarks will assist
Customer through appropriate technical and organizational measures
(insofar as possible) to fulfill Customer's obligation to respond to
requests from Data Subjects exercising their rights under Data
Protection Laws (access, rectification, erasure, restriction,
portability, objection, and similar rights).

If Remarks receives a Data Subject request directly, it will, without
undue delay:

- forward the request to Customer; and
- not respond to the Data Subject directly except to confirm receipt and
  to direct the Data Subject to Customer, unless legally required to
  respond.

## 10. Personal data breaches

Remarks will notify Customer **without undue delay**, and in any event
within **72 hours** of becoming aware of a Personal Data breach
affecting Customer's Personal Data. The notice will include, to the
extent known at the time and supplemented as further information becomes
available:

- a description of the nature of the breach, including the categories
  and approximate number of Data Subjects and records affected;
- the likely consequences of the breach;
- the measures taken or proposed to address the breach and mitigate
  adverse effects; and
- the contact point for further information.

Remarks will reasonably cooperate with Customer in investigating and
remediating the breach.

## 11. Audits

Remarks will make available to Customer information reasonably necessary
to demonstrate compliance with this DPA, including:

- summaries of Remarks' annual third-party security assessments (e.g.,
  SOC 2 reports, penetration test summaries) on Customer's request,
  subject to confidentiality obligations; and
- written responses to a reasonable number of security questionnaires
  per year.

If documentary evidence is insufficient to demonstrate compliance,
Customer (or a qualified independent auditor mandated by Customer and
acceptable to Remarks) may, on **reasonable prior written notice** (at
least 30 days, except in cases of demonstrated regulatory urgency),
conduct an on-site audit during normal business hours, no more than once
per 12-month period, scoped to systems processing Customer's Personal
Data. Customer bears its own audit costs unless the audit reveals
material non-compliance, in which case Remarks bears the reasonable
costs of remediation.

## 12. Return or deletion of Personal Data

On termination or expiration of the Agreement, or earlier on Customer's
written request, Remarks will, at Customer's option, **delete** or
**return** Personal Data, and delete existing copies, within **30 days**.
Backup copies are deleted on the rolling backup retention schedule
described in the [Privacy Policy](/privacy) §8.

Remarks may retain Personal Data to the extent required by applicable
law, in which case it will continue to protect the Personal Data in
accordance with this DPA and use it only for the purpose required by
that law.

Customer may export its Personal Data through the Service's export
features at any time during the term.

## 13. CCPA / CPRA service-provider terms

Where Remarks processes Personal Information (as defined under the
CCPA/CPRA) on behalf of Customer:

- Remarks acts as a **Service Provider**.
- Remarks does not **sell** or **share** Personal Information for
  cross-context behavioral advertising as those terms are defined under
  the CCPA/CPRA.
- Remarks processes Personal Information **only for the business
  purposes** specified in the Agreement and this DPA, and not for any
  other purpose, including its own commercial purposes.
- Remarks does not combine Personal Information received from Customer
  with Personal Information received from another source, except as
  permitted under 11 CCR §7050(b).
- Remarks notifies Customer if it determines that it can no longer meet
  its obligations as a Service Provider.
- Remarks grants Customer the right to take reasonable and appropriate
  steps to ensure the Personal Information is used in a manner
  consistent with Customer's obligations under the CCPA/CPRA, and to
  stop and remediate unauthorized use of Personal Information.

## 14. Liability and miscellaneous

- **Precedence.** This DPA prevails over conflicting terms in the
  Agreement with respect to data protection. The SCCs prevail over this
  DPA with respect to transfers governed by them.
- **Limitation of liability.** Each party's liability under or in
  connection with this DPA is subject to the limitations and exclusions
  of liability in the Agreement, treated as one cap shared across the
  Agreement and this DPA. Nothing in this DPA limits liability that
  cannot be limited under applicable law (e.g., liability of a Data
  Subject under SCC Clause 12).
- **Modifications.** Remarks may amend this DPA from time to time as
  reasonably required to reflect changes in Data Protection Laws or
  Subprocessor arrangements, with reasonable notice to Customer.
- **Survival.** §§5, 6, 8, 10, 11, 12, 13, and 14 survive termination of
  the Agreement to the extent and for the duration necessary to
  protect Personal Data still held by Remarks or to comply with Data
  Protection Laws.

## 15. Contact

For questions about this DPA or to make data protection requests,
contact:

- **Email:** `privacy@remarks.online`
- **Data protection contact:** `dpo@remarks.online` (placeholder; the
  formal Data Protection Officer or representative information will be
  added once appointed)

---

## Annex 1 — Description of processing

| Item                                  | Description                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Categories of Data Subjects           | Customer's authorized users; Organization members; individuals identifiable in User Content uploaded by Customer                     |
| Categories of Personal Data           | Account data (name, email, profile photo, OAuth identifiers); user content (URLs, selectors, comments, screenshots); technical data (IP, user-agent, logs) |
| Sensitive data                        | None routinely processed. Authentication credentials are managed by Clerk (subprocessor) and not stored by Remarks                   |
| Frequency of transfer                 | Continuous, for the duration of the Agreement                                                                                        |
| Nature of processing                  | Hosting, transmission, display, storage, and operational maintenance of the Service                                                  |
| Purpose                               | Provision of the Remarks in-context annotation Service to Customer and its Organization                                              |
| Duration                              | Term of the Agreement plus the deletion windows in §12                                                                               |
| For Subprocessors: subject matter and duration | As described in Annex 3                                                                                                     |

## Annex 2 — Technical and organizational measures

Remarks implements the following measures, consistent with the [Privacy
Policy](/privacy) §12:

- **Pseudonymization and encryption.** Encryption in transit (TLS 1.2+);
  at-rest encryption for databases, object storage, and backups.
- **Confidentiality, integrity, availability, and resilience of
  processing systems.** Production environments segregated from
  development; redundant infrastructure across hosting providers (Fly.io,
  Vercel) and managed databases (Neon).
- **Restoration of availability and access.** Daily backups with up to
  30-day retention; documented restore procedures.
- **Process for regularly testing, assessing, and evaluating the
  effectiveness of measures.** Periodic security review of providers
  and configurations; intent to obtain a SOC 2 Type II report once
  organizational maturity supports it.
- **User identification and authorization.** Role-based access; MFA for
  production access; least-privilege principles.
- **Protection of data during transmission and storage.** TLS for all
  network paths; restricted network policies on private services.
- **Physical security.** Provided by hosting subprocessors (Cloudflare,
  Fly.io, Vercel, Neon) under their published security programs.
- **Event logging.** Production access and sensitive operations are
  logged; logs retained 90 days on a rolling basis.
- **System configuration.** Infrastructure-as-code; staged rollout for
  changes affecting production.
- **Internal IT and security governance.** Documented security
  expectations for personnel; mandatory training on data handling.
- **Certification / quality assurance of processes and products.**
  Regular code review; pre-merge testing; structured incident response.
- **Data minimization.** The Service collects only the data required to
  operate annotation features (see [Privacy Policy](/privacy) §3.5).
- **Data quality.** Customer controls accuracy of its User Content
  through the Service's editing features.
- **Limited retention.** Data is retained only as long as necessary —
  see [Privacy Policy](/privacy) §8.
- **Accountability.** This DPA, the Privacy Policy, and the Subprocessor
  list are publicly available; changes are communicated as described in
  §7.2 and the Privacy Policy §13.
- **Allowing data portability and ensuring erasure.** Export and
  deletion are available through the Service's account-management
  features.

## Annex 3 — Approved subprocessors

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

This list is also published in the [Privacy Policy](/privacy) §6.1 and
will be updated in accordance with §7.2.

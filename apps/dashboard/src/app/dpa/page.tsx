import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data Processing Addendum — Remarks",
  description:
    "How Remarks processes personal data on behalf of customers under GDPR, UK GDPR, FADP, and CCPA/CPRA, including subprocessors, security measures, and international transfers.",
};

export default function DpaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 leading-relaxed text-slate-800 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-slate-950 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
      <article>
        <h1>Data Processing Addendum</h1>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Draft.</strong> Engineering working copy, pending legal review.
        </p>
        <p>
          <strong>Effective date:</strong> April 30, 2026
          <br />
          <strong>Last updated:</strong> April 30, 2026
        </p>

        <h2>1. Introduction</h2>
        <p>
          This Data Processing Addendum (&ldquo;<strong>DPA</strong>&rdquo;) supplements the{" "}
          <Link href="/terms">Terms of Service</Link> (the &ldquo;<strong>Agreement</strong>&rdquo;)
          between Remarks (&ldquo;<strong>Remarks</strong>,&rdquo; &ldquo;<strong>we</strong>
          ,&rdquo; &ldquo;<strong>our</strong>,&rdquo; or &ldquo;<strong>us</strong>&rdquo;) and the
          customer (&ldquo;<strong>Customer</strong>&rdquo; or &ldquo;<strong>you</strong>&rdquo;)
          that uses the Remarks Service. It applies to Remarks&rsquo; processing of Personal Data on
          behalf of Customer in connection with the Service to the extent that such processing is
          subject to:
        </p>
        <ul>
          <li>
            the EU General Data Protection Regulation 2016/679 (&ldquo;<strong>GDPR</strong>
            &rdquo;);
          </li>
          <li>
            the United Kingdom General Data Protection Regulation and the UK Data Protection Act
            2018 (&ldquo;<strong>UK GDPR</strong>&rdquo;);
          </li>
          <li>
            the Swiss Federal Act on Data Protection (&ldquo;<strong>FADP</strong>&rdquo;); or
          </li>
          <li>
            the California Consumer Privacy Act, as amended by the California Privacy Rights Act
            (&ldquo;<strong>CCPA/CPRA</strong>&rdquo;),
          </li>
        </ul>
        <p>
          (collectively, &ldquo;<strong>Data Protection Laws</strong>&rdquo;). In the event of any
          conflict between this DPA and the Agreement with respect to the processing of Personal
          Data, this DPA controls.
        </p>

        <h2>2. Definitions</h2>
        <p>
          Capitalized terms not defined here have the meanings given in the Agreement or in the Data
          Protection Laws. For convenience:
        </p>
        <ul>
          <li>
            <strong>&ldquo;Personal Data&rdquo;</strong> means information relating to an identified
            or identifiable natural person that Customer (acting as Controller) submits to the
            Service and that Remarks processes on Customer&rsquo;s behalf.
          </li>
          <li>
            <strong>&ldquo;Data Subject&rdquo;</strong> means the individual to whom Personal Data
            relates.
          </li>
          <li>
            <strong>&ldquo;Controller&rdquo;</strong>, <strong>&ldquo;Processor&rdquo;</strong>,{" "}
            <strong>&ldquo;processing&rdquo;</strong>, and{" "}
            <strong>&ldquo;supervisory authority&rdquo;</strong> have the meanings given in the
            GDPR.
          </li>
          <li>
            <strong>&ldquo;Service Provider&rdquo;</strong> has the meaning given in the CCPA/CPRA.
          </li>
          <li>
            <strong>&ldquo;Subprocessor&rdquo;</strong> means any third party that processes
            Personal Data on behalf of Remarks in connection with the Service.
          </li>
          <li>
            <strong>&ldquo;Standard Contractual Clauses&rdquo;</strong> or{" "}
            <strong>&ldquo;SCCs&rdquo;</strong> means the European Commission&rsquo;s Standard
            Contractual Clauses approved under Commission Implementing Decision (EU) 2021/914 of 4
            June 2021, as amended.
          </li>
          <li>
            <strong>&ldquo;UK IDTA&rdquo;</strong> means the UK International Data Transfer Addendum
            to the EU SCCs, issued under Section 119A of the UK Data Protection Act 2018.
          </li>
        </ul>

        <h2>3. Roles and scope</h2>
        <ul>
          <li>
            <strong>Customer is the Controller</strong> of Personal Data submitted to the Service.
            Where the CCPA/CPRA applies, Customer is the <strong>Business</strong>.
          </li>
          <li>
            <strong>Remarks is the Processor</strong> acting on Customer&rsquo;s behalf. Where the
            CCPA/CPRA applies, Remarks is the <strong>Service Provider</strong>.
          </li>
          <li>
            <strong>Subject matter:</strong> Remarks&rsquo; provision of the Service to Customer
            under the Agreement.
          </li>
          <li>
            <strong>Nature and purpose:</strong> Hosting, transmission, display, and storage of
            Personal Data submitted by Customer&rsquo;s authorized users, in order to provide
            in-context website annotation and feedback functionality.
          </li>
          <li>
            <strong>Duration:</strong> the term of the Agreement, plus the deletion windows in §12.
          </li>
          <li>
            <strong>Categories of Data Subjects:</strong> Customer&rsquo;s authorized users, members
            of Customer&rsquo;s Organization, individuals identifiable in User Content Customer
            chooses to upload (e.g., names visible in screenshots).
          </li>
          <li>
            <strong>Categories of Personal Data:</strong> as further described in the{" "}
            <Link href="/privacy">Privacy Policy</Link> §3 — account information (name, email,
            profile photo, OAuth identifiers), user content (URLs, selectors, comments,
            screenshots), technical data (IP, user-agent, request logs).
          </li>
        </ul>

        <h2>4. Customer instructions</h2>
        <p>
          Remarks processes Personal Data only on Customer&rsquo;s documented instructions. The
          Agreement, this DPA, and Customer&rsquo;s use of the Service through its features and
          configurations together constitute Customer&rsquo;s documented instructions. Remarks will
          inform Customer if, in its opinion, an instruction infringes Data Protection Laws.
        </p>
        <p>
          If Remarks is required by applicable law to process Personal Data otherwise than on
          Customer&rsquo;s documented instructions (e.g., to comply with a legal obligation),
          Remarks will, where permitted by that law, inform Customer of that legal requirement
          before processing.
        </p>

        <h2>5. Confidentiality</h2>
        <p>
          Remarks ensures that personnel authorized to process Personal Data are bound by
          appropriate obligations of confidentiality and have received appropriate training on the
          protection of Personal Data.
        </p>

        <h2>6. Security measures</h2>
        <p>
          Remarks implements and maintains appropriate technical and organizational measures to
          protect Personal Data against accidental or unlawful destruction, loss, alteration,
          unauthorized disclosure, or access. These measures include:
        </p>
        <ul>
          <li>
            <strong>Encryption in transit</strong> — TLS 1.2 or higher for all client–server traffic
            and inter-service communication;
          </li>
          <li>
            <strong>Encryption at rest</strong> — at-rest encryption for databases (Neon), object
            storage (Cloudflare R2), and backups;
          </li>
          <li>
            <strong>Access controls</strong> — role-based access, multi-factor authentication for
            production access, and least-privilege principles;
          </li>
          <li>
            <strong>Audit logging</strong> — production access and sensitive operations are logged;
          </li>
          <li>
            <strong>Subprocessor diligence</strong> — security review of subprocessors and
            contractual security commitments.
          </li>
        </ul>
        <p>
          A more detailed description appears in <strong>Annex 2</strong>. Remarks may update the
          security measures from time to time, provided that the overall level of security is not
          materially diminished.
        </p>

        <h2>7. Subprocessors</h2>

        <h3>7.1 General authorization</h3>
        <p>
          Customer provides general authorization for Remarks to engage Subprocessors to process
          Personal Data, subject to this §7. The list of current Subprocessors appears in{" "}
          <strong>Annex 3</strong> and in the <Link href="/privacy">Privacy Policy</Link> §6.1.
        </p>

        <h3>7.2 New Subprocessors</h3>
        <p>
          Before engaging a new Subprocessor that processes Personal Data, Remarks will give
          Customer at least <strong>30 days&rsquo; prior notice</strong> by updating the
          Subprocessor list and, for organization administrators, by email or in-product
          notification. Customer may object to a new Subprocessor in writing during the notice
          period on reasonable grounds relating to data protection. If the parties cannot resolve
          the objection, Customer may terminate the affected portion of the Service for convenience
          and receive a pro-rata refund of any prepaid fees.
        </p>

        <h3>7.3 Subprocessor obligations</h3>
        <p>
          Remarks will impose data protection terms on each Subprocessor that are substantially the
          same as those in this DPA, including obligations to implement appropriate security
          measures and to process Personal Data only on Remarks&rsquo; instructions. Remarks remains
          liable to Customer for the acts and omissions of its Subprocessors.
        </p>

        <h2>8. International transfers</h2>
        <p>
          Remarks is operated from the United States. To the extent Remarks transfers Personal Data
          subject to GDPR, UK GDPR, or FADP to a country that does not benefit from an adequacy
          decision, Remarks relies on appropriate safeguards under Data Protection Laws, including:
        </p>
        <ul>
          <li>
            the <strong>EU SCCs</strong> for transfers from the EEA, on Module Two
            (Controller-to-Processor) or Module Three (Processor-to-Processor) as applicable;
          </li>
          <li>
            the <strong>UK IDTA</strong> for transfers from the United Kingdom;
          </li>
          <li>
            the <strong>Swiss FDPIC</strong> recognition of the EU SCCs (with adaptations) for
            transfers from Switzerland.
          </li>
        </ul>
        <p>
          The SCCs are deemed incorporated into this DPA by reference, with the following
          selections:
        </p>
        <ul>
          <li>
            <strong>Clause 7 (docking clause):</strong> included.
          </li>
          <li>
            <strong>Clause 9 (subprocessors):</strong> Option 2 (general authorization) with the
            30-day notice period in §7.2.
          </li>
          <li>
            <strong>Clause 11 (redress):</strong> the optional language regarding independent
            dispute resolution is <strong>not</strong> selected.
          </li>
          <li>
            <strong>Clause 17 (governing law):</strong> Ireland.
          </li>
          <li>
            <strong>Clause 18 (forum and jurisdiction):</strong> Ireland.
          </li>
          <li>
            <strong>Annex I.A (parties):</strong> Customer (data exporter) and Remarks (data
            importer); contact details as in the Agreement and §15 of this DPA.
          </li>
          <li>
            <strong>Annex I.B (description of transfer):</strong> as set out in{" "}
            <strong>Annex 1</strong> of this DPA.
          </li>
          <li>
            <strong>Annex I.C (competent supervisory authority):</strong> the Irish Data Protection
            Commission (or, where Customer&rsquo;s lead supervisory authority differs under GDPR
            Art. 56, that authority).
          </li>
          <li>
            <strong>Annex II (technical and organizational measures):</strong> as set out in{" "}
            <strong>Annex 2</strong> of this DPA.
          </li>
          <li>
            <strong>Annex III (subprocessors):</strong> as set out in <strong>Annex 3</strong> of
            this DPA.
          </li>
        </ul>
        <p>
          Remarks supplements the SCCs with appropriate technical, organizational, and contractual
          measures consistent with the EDPB recommendations on supplementary measures.
        </p>

        <h2>9. Data subject rights assistance</h2>
        <p>
          Taking into account the nature of the processing, Remarks will assist Customer through
          appropriate technical and organizational measures (insofar as possible) to fulfill
          Customer&rsquo;s obligation to respond to requests from Data Subjects exercising their
          rights under Data Protection Laws (access, rectification, erasure, restriction,
          portability, objection, and similar rights).
        </p>
        <p>If Remarks receives a Data Subject request directly, it will, without undue delay:</p>
        <ul>
          <li>forward the request to Customer; and</li>
          <li>
            not respond to the Data Subject directly except to confirm receipt and to direct the
            Data Subject to Customer, unless legally required to respond.
          </li>
        </ul>

        <h2>10. Personal data breaches</h2>
        <p>
          Remarks will notify Customer <strong>without undue delay</strong>, and in any event within{" "}
          <strong>72 hours</strong> of becoming aware of a Personal Data breach affecting
          Customer&rsquo;s Personal Data. The notice will include, to the extent known at the time
          and supplemented as further information becomes available:
        </p>
        <ul>
          <li>
            a description of the nature of the breach, including the categories and approximate
            number of Data Subjects and records affected;
          </li>
          <li>the likely consequences of the breach;</li>
          <li>
            the measures taken or proposed to address the breach and mitigate adverse effects; and
          </li>
          <li>the contact point for further information.</li>
        </ul>
        <p>
          Remarks will reasonably cooperate with Customer in investigating and remediating the
          breach.
        </p>

        <h2>11. Audits</h2>
        <p>
          Remarks will make available to Customer information reasonably necessary to demonstrate
          compliance with this DPA, including:
        </p>
        <ul>
          <li>
            summaries of Remarks&rsquo; annual third-party security assessments (e.g., SOC 2
            reports, penetration test summaries) on Customer&rsquo;s request, subject to
            confidentiality obligations; and
          </li>
          <li>written responses to a reasonable number of security questionnaires per year.</li>
        </ul>
        <p>
          If documentary evidence is insufficient to demonstrate compliance, Customer (or a
          qualified independent auditor mandated by Customer and acceptable to Remarks) may, on{" "}
          <strong>reasonable prior written notice</strong> (at least 30 days, except in cases of
          demonstrated regulatory urgency), conduct an on-site audit during normal business hours,
          no more than once per 12-month period, scoped to systems processing Customer&rsquo;s
          Personal Data. Customer bears its own audit costs unless the audit reveals material
          non-compliance, in which case Remarks bears the reasonable costs of remediation.
        </p>

        <h2>12. Return or deletion of Personal Data</h2>
        <p>
          On termination or expiration of the Agreement, or earlier on Customer&rsquo;s written
          request, Remarks will, at Customer&rsquo;s option, <strong>delete</strong> or{" "}
          <strong>return</strong> Personal Data, and delete existing copies, within{" "}
          <strong>30 days</strong>. Backup copies are deleted on the rolling backup retention
          schedule described in the <Link href="/privacy">Privacy Policy</Link> §8.
        </p>
        <p>
          Remarks may retain Personal Data to the extent required by applicable law, in which case
          it will continue to protect the Personal Data in accordance with this DPA and use it only
          for the purpose required by that law.
        </p>
        <p>
          Customer may export its Personal Data through the Service&rsquo;s export features at any
          time during the term.
        </p>

        <h2>13. CCPA / CPRA service-provider terms</h2>
        <p>
          Where Remarks processes Personal Information (as defined under the CCPA/CPRA) on behalf of
          Customer:
        </p>
        <ul>
          <li>
            Remarks acts as a <strong>Service Provider</strong>.
          </li>
          <li>
            Remarks does not <strong>sell</strong> or <strong>share</strong> Personal Information
            for cross-context behavioral advertising as those terms are defined under the CCPA/CPRA.
          </li>
          <li>
            Remarks processes Personal Information <strong>only for the business purposes</strong>{" "}
            specified in the Agreement and this DPA, and not for any other purpose, including its
            own commercial purposes.
          </li>
          <li>
            Remarks does not combine Personal Information received from Customer with Personal
            Information received from another source, except as permitted under 11 CCR §7050(b).
          </li>
          <li>
            Remarks notifies Customer if it determines that it can no longer meet its obligations as
            a Service Provider.
          </li>
          <li>
            Remarks grants Customer the right to take reasonable and appropriate steps to ensure the
            Personal Information is used in a manner consistent with Customer&rsquo;s obligations
            under the CCPA/CPRA, and to stop and remediate unauthorized use of Personal Information.
          </li>
        </ul>

        <h2>14. Liability and miscellaneous</h2>
        <ul>
          <li>
            <strong>Precedence.</strong> This DPA prevails over conflicting terms in the Agreement
            with respect to data protection. The SCCs prevail over this DPA with respect to
            transfers governed by them.
          </li>
          <li>
            <strong>Limitation of liability.</strong> Each party&rsquo;s liability under or in
            connection with this DPA is subject to the limitations and exclusions of liability in
            the Agreement, treated as one cap shared across the Agreement and this DPA. Nothing in
            this DPA limits liability that cannot be limited under applicable law (e.g., liability
            of a Data Subject under SCC Clause 12).
          </li>
          <li>
            <strong>Modifications.</strong> Remarks may amend this DPA from time to time as
            reasonably required to reflect changes in Data Protection Laws or Subprocessor
            arrangements, with reasonable notice to Customer.
          </li>
          <li>
            <strong>Survival.</strong> §§5, 6, 8, 10, 11, 12, 13, and 14 survive termination of the
            Agreement to the extent and for the duration necessary to protect Personal Data still
            held by Remarks or to comply with Data Protection Laws.
          </li>
        </ul>

        <h2>15. Contact</h2>
        <p>For questions about this DPA or to make data protection requests, contact:</p>
        <ul>
          <li>
            <strong>Email:</strong>{" "}
            <a href="mailto:privacy@remarks.online">privacy@remarks.online</a>
          </li>
          <li>
            <strong>Data protection contact:</strong>{" "}
            <a href="mailto:dpo@remarks.online">dpo@remarks.online</a> (placeholder; the formal Data
            Protection Officer or representative information will be added once appointed)
          </li>
        </ul>

        <hr />

        <h2>Annex 1 — Description of processing</h2>
        <ul>
          <li>
            <strong>Categories of Data Subjects:</strong> Customer&rsquo;s authorized users;
            Organization members; individuals identifiable in User Content uploaded by Customer.
          </li>
          <li>
            <strong>Categories of Personal Data:</strong> account data (name, email, profile photo,
            OAuth identifiers); user content (URLs, selectors, comments, screenshots); technical
            data (IP, user-agent, logs).
          </li>
          <li>
            <strong>Sensitive data:</strong> none routinely processed. Authentication credentials
            are managed by Clerk (subprocessor) and not stored by Remarks.
          </li>
          <li>
            <strong>Frequency of transfer:</strong> continuous, for the duration of the Agreement.
          </li>
          <li>
            <strong>Nature of processing:</strong> hosting, transmission, display, storage, and
            operational maintenance of the Service.
          </li>
          <li>
            <strong>Purpose:</strong> provision of the Remarks in-context annotation Service to
            Customer and its Organization.
          </li>
          <li>
            <strong>Duration:</strong> term of the Agreement plus the deletion windows in §12.
          </li>
          <li>
            <strong>For Subprocessors (subject matter and duration):</strong> as described in Annex
            3.
          </li>
        </ul>

        <h2>Annex 2 — Technical and organizational measures</h2>
        <p>
          Remarks implements the following measures, consistent with the{" "}
          <Link href="/privacy">Privacy Policy</Link> §12:
        </p>
        <ul>
          <li>
            <strong>Pseudonymization and encryption.</strong> Encryption in transit (TLS 1.2+);
            at-rest encryption for databases, object storage, and backups.
          </li>
          <li>
            <strong>
              Confidentiality, integrity, availability, and resilience of processing systems.
            </strong>{" "}
            Production environments segregated from development; redundant infrastructure across
            hosting providers (Fly.io, Vercel) and managed databases (Neon).
          </li>
          <li>
            <strong>Restoration of availability and access.</strong> Daily backups with up to 30-day
            retention; documented restore procedures.
          </li>
          <li>
            <strong>
              Process for regularly testing, assessing, and evaluating the effectiveness of
              measures.
            </strong>{" "}
            Periodic security review of providers and configurations; intent to obtain a SOC 2 Type
            II report once organizational maturity supports it.
          </li>
          <li>
            <strong>User identification and authorization.</strong> Role-based access; MFA for
            production access; least-privilege principles.
          </li>
          <li>
            <strong>Protection of data during transmission and storage.</strong> TLS for all network
            paths; restricted network policies on private services.
          </li>
          <li>
            <strong>Physical security.</strong> Provided by hosting subprocessors (Cloudflare,
            Fly.io, Vercel, Neon) under their published security programs.
          </li>
          <li>
            <strong>Event logging.</strong> Production access and sensitive operations are logged;
            logs retained 90 days on a rolling basis.
          </li>
          <li>
            <strong>System configuration.</strong> Infrastructure-as-code; staged rollout for
            changes affecting production.
          </li>
          <li>
            <strong>Internal IT and security governance.</strong> Documented security expectations
            for personnel; mandatory training on data handling.
          </li>
          <li>
            <strong>Certification / quality assurance of processes and products.</strong> Regular
            code review; pre-merge testing; structured incident response.
          </li>
          <li>
            <strong>Data minimization.</strong> The Service collects only the data required to
            operate annotation features (see <Link href="/privacy">Privacy Policy</Link> §3.5).
          </li>
          <li>
            <strong>Data quality.</strong> Customer controls accuracy of its User Content through
            the Service&rsquo;s editing features.
          </li>
          <li>
            <strong>Limited retention.</strong> Data is retained only as long as necessary — see{" "}
            <Link href="/privacy">Privacy Policy</Link> §8.
          </li>
          <li>
            <strong>Accountability.</strong> This DPA, the Privacy Policy, and the Subprocessor list
            are publicly available; changes are communicated as described in §7.2 and the Privacy
            Policy §13.
          </li>
          <li>
            <strong>Allowing data portability and ensuring erasure.</strong> Export and deletion are
            available through the Service&rsquo;s account-management features.
          </li>
        </ul>

        <h2>Annex 3 — Approved subprocessors</h2>
        <ul>
          <li>
            <strong>Clerk, Inc.</strong> — authentication and identity management (United States)
          </li>
          <li>
            <strong>Cloudflare, Inc.</strong> — object storage (R2) for screenshots; CDN (Global)
          </li>
          <li>
            <strong>Neon Inc.</strong> — managed Postgres database (United States, EU)
          </li>
          <li>
            <strong>Fly.io, Inc.</strong> — hosting (API, MCP server) (Global edge)
          </li>
          <li>
            <strong>Vercel Inc.</strong> — hosting (web dashboard, marketing site) (Global edge)
          </li>
          <li>
            <strong>Resend, Inc.</strong> — transactional email delivery (United States)
          </li>
          <li>
            <strong>Inngest, Inc.</strong> — background job orchestration (United States)
          </li>
          <li>
            <strong>PostHog Inc.</strong> — product analytics, optional and opt-out (United States,
            EU)
          </li>
        </ul>
        <p>
          This list is also published in the <Link href="/privacy">Privacy Policy</Link> §6.1 and
          will be updated in accordance with §7.2.
        </p>

        <hr />
        <p className="text-sm text-slate-500">
          <Link href="/">← Back to Remarks</Link>
        </p>
      </article>
    </main>
  );
}

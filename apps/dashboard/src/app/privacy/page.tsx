import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Remarks",
  description:
    "How Remarks collects, uses, and protects information when you use the browser extension, web application, and API.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 leading-relaxed text-slate-800 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-slate-950 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
      <article>
        <h1>Privacy Policy</h1>
        <p>
          <strong>Effective date:</strong> April 28, 2026
          <br />
          <strong>Last updated:</strong> April 28, 2026
        </p>

        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy describes how Remarks (&ldquo;<strong>Remarks</strong>
          ,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>our</strong>
          ,&rdquo; or &ldquo;<strong>us</strong>&rdquo;) collects, uses, discloses, and protects
          information when you use our browser extension, web application, hosted API, and related
          services (collectively, the &ldquo;<strong>Service</strong>&rdquo;). By using the Service
          you agree to the collection and use of information in accordance with this Policy.
        </p>
        <p>
          This Policy applies to all users of the Service, including users in the European Economic
          Area (&ldquo;<strong>EEA</strong>&rdquo;), the United Kingdom (&ldquo;<strong>UK</strong>
          &rdquo;), Switzerland, and the United States. We comply with the General Data Protection
          Regulation (&ldquo;<strong>GDPR</strong>&rdquo;), the UK GDPR, the California Consumer
          Privacy Act as amended by the California Privacy Rights Act (&ldquo;
          <strong>CCPA/CPRA</strong>&rdquo;), and other applicable privacy laws.
        </p>

        <h2>2. Scope</h2>
        <p>This Policy covers all components of the Remarks Service:</p>
        <ul>
          <li>The Remarks browser extension (Chrome, and where available, Firefox);</li>
          <li>
            The Remarks web application at <code>https://app.remarks.online</code>
          </li>
          <li>
            The Remarks public website at <code>https://remarks.online</code>
          </li>
          <li>
            The Remarks API at <code>https://api.remarks.online</code>
          </li>
          <li>
            The Remarks Model Context Protocol (MCP) server at{" "}
            <code>https://mcp.remarks.online</code>
          </li>
        </ul>
        <p>
          This Policy does not apply to third-party websites, applications, or services that you may
          access through the Service. Those third parties operate under their own privacy policies.
        </p>

        <h2>3. Information We Collect</h2>

        <h3>3.1 Account information</h3>
        <p>When you create an account, we collect:</p>
        <ul>
          <li>
            <strong>Identity:</strong> name, email address, profile photo (if you provide one), and
            any additional identifiers you authenticate with through OAuth (e.g., Google{" "}
            <code>sub</code> claim).
          </li>
          <li>
            <strong>Organization data:</strong> the organization(s) you belong to within Remarks,
            your role(s) within those organizations, and any organization metadata you provide.
          </li>
          <li>
            <strong>Authentication credentials:</strong> managed by our authentication subprocessor
            (Clerk; see §6). We do not store passwords directly.
          </li>
        </ul>

        <h3>3.2 User content (annotations, projects, comments)</h3>
        <p>
          When you use the Service to create annotations, projects, or related content, we collect
          and store:
        </p>
        <ul>
          <li>
            The <strong>URL</strong> of the page on which you create the annotation;
          </li>
          <li>
            The <strong>selector</strong> identifying the DOM element you annotated (CSS selector,
            bounding rectangle, or both);
          </li>
          <li>
            The <strong>comment text</strong>, status, and metadata you attach to the annotation;
          </li>
          <li>
            Any <strong>screenshot</strong> you explicitly capture (cropped to the region you
            selected; never the full page or background tab);
          </li>
          <li>Replies, status changes, and other activity on the annotation thread.</li>
        </ul>
        <p>
          We collect this content only when you explicitly take an action that produces it. The
          browser extension does not capture page content in the background.
        </p>

        <h3>3.3 Technical data</h3>
        <p>When you interact with the Service, we automatically collect:</p>
        <ul>
          <li>
            <strong>Device and connection information:</strong> IP address, user-agent string,
            browser type and version, operating system, screen resolution, language preference, time
            zone;
          </li>
          <li>
            <strong>Request logs:</strong> timestamp, HTTP method, path, response status, latency,
            trace identifier;
          </li>
          <li>
            <strong>Diagnostic information:</strong> error reports, stack traces, and crash logs
            when the Service experiences an error.
          </li>
        </ul>

        <h3>3.4 Cookies and similar technologies</h3>
        <p>
          The Service uses cookies and similar technologies for authentication, session management,
          and security. Specifically:
        </p>
        <ul>
          <li>
            <strong>Clerk session cookie</strong> — required for authentication. Set by our
            authentication subprocessor on <code>app.remarks.online</code> and{" "}
            <code>clerk.remarks.online</code>.
          </li>
          <li>
            <strong>
              <code>chrome.storage</code>
            </strong>{" "}
            in the browser extension — stores session state, user preferences (sidebar layout,
            selected project), and an offline outbox of pending annotations.
          </li>
        </ul>
        <p>
          The Service does <strong>not</strong> use cookies or storage for advertising, retargeting,
          or third-party analytics tracking.
        </p>

        <h3>3.5 Information we do not collect</h3>
        <p>
          To be explicit about what is <strong>not</strong> collected:
        </p>
        <ul>
          <li>
            We do <strong>not</strong> record your general browsing history. URLs are stored only
            when you create an annotation on a given page.
          </li>
          <li>
            We do <strong>not</strong> read or capture the content of pages you visit unless you
            explicitly invoke the element picker or rectangle picker.
          </li>
          <li>
            We do <strong>not</strong> record keystrokes, mouse movements, scroll behavior, or other
            session-replay-style telemetry.
          </li>
          <li>
            We do <strong>not</strong> collect financial or payment information directly. If we add
            paid plans, payment processing will be performed by a PCI-compliant payment processor
            under a separate disclosure.
          </li>
          <li>
            We do <strong>not</strong> collect health data, biometric data, or precise geolocation.
          </li>
        </ul>

        <h2>4. How We Use Information</h2>
        <p>We use the information we collect for the following purposes:</p>
        <ul>
          <li>Provide, maintain, and operate the Service.</li>
          <li>Authenticate users and manage sessions.</li>
          <li>Synchronize annotations between the browser extension and the dashboard.</li>
          <li>Detect, investigate, and prevent abuse, fraud, or security incidents.</li>
          <li>Provide customer support.</li>
          <li>Improve the Service through aggregate analytics and debugging.</li>
          <li>Comply with legal obligations and enforce our agreements.</li>
          <li>Communicate with you about the Service (transactional notices, security alerts).</li>
        </ul>
        <p>
          We do <strong>not</strong> use your information to serve advertising, retarget you on
          other websites, or build profiles about you for sale to third parties. See §15 (Chrome Web
          Store Limited Use Disclosure).
        </p>

        <h2>5. Legal Bases for Processing (EEA, UK, Switzerland)</h2>
        <p>
          If you are in the EEA, UK, or Switzerland, we process your personal data under the
          following GDPR Article 6 legal bases:
        </p>
        <ul>
          <li>
            <strong>Contract</strong> (Art. 6(1)(b)) — to provide the Service you signed up for,
            including authenticating you, storing your annotations, and synchronizing state between
            the extension and the dashboard.
          </li>
          <li>
            <strong>Legitimate interests</strong> (Art. 6(1)(f)) — to operate, secure, and improve
            the Service; to prevent abuse; and to communicate with you about the Service. We balance
            our legitimate interests against your rights and freedoms; you may object as described
            in §9.
          </li>
          <li>
            <strong>Consent</strong> (Art. 6(1)(a)) — where required by law, e.g., for optional
            analytics in jurisdictions that require opt-in. You may withdraw consent at any time.
          </li>
          <li>
            <strong>Legal obligation</strong> (Art. 6(1)(c)) — to comply with applicable law, legal
            process, or governmental requests.
          </li>
        </ul>

        <h2>6. Sharing and Disclosure</h2>

        <h3>6.1 Service providers and subprocessors</h3>
        <p>
          We engage third-party service providers (&ldquo;
          <strong>subprocessors</strong>&rdquo;) to operate the Service. Each subprocessor is bound
          by a written agreement (Data Processing Addendum, or &ldquo;DPA&rdquo;) that requires them
          to process personal data only on our instructions and to safeguard it appropriately.
        </p>
        <p>Current subprocessors:</p>
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

        <h3>6.2 Other disclosures</h3>
        <ul>
          <li>
            <strong>To organization members.</strong> If you are a member of an organization and
            create an annotation in a project belonging to that organization, the annotation, your
            name, and your email address are visible to other members of that organization.
          </li>
          <li>
            <strong>For legal reasons.</strong> When required by law, regulation, legal process, or
            governmental request.
          </li>
          <li>
            <strong>To protect rights, property, and safety.</strong>
          </li>
          <li>
            <strong>In a corporate transaction.</strong> If Remarks is involved in a merger,
            acquisition, financing, reorganization, bankruptcy, or sale of assets, information may
            be transferred to the successor entity.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal information for monetary consideration, and
          we do <strong>not</strong> &ldquo;share&rdquo; it for cross-context behavioral advertising
          as those terms are defined under the CCPA/CPRA.
        </p>

        <h2>7. International Data Transfers</h2>
        <p>
          Remarks is operated from the United States. When you use the Service from outside the
          United States, your information will be transferred to, processed in, and stored in the
          United States and other countries where we or our subprocessors operate.
        </p>
        <p>
          For transfers from the EEA, UK, and Switzerland to countries that do not provide an
          adequate level of data protection under applicable law, we rely on the European
          Commission&rsquo;s Standard Contractual Clauses (SCCs), the UK International Data Transfer
          Addendum, and the Swiss Federal Data Protection and Information Commissioner&rsquo;s
          recognition of the SCCs, supplemented by appropriate technical, organizational, and
          contractual measures.
        </p>

        <h2>8. Data Retention</h2>
        <ul>
          <li>
            <strong>Account data</strong> — retained while your account is active. On account
            deletion, we delete or anonymize account data within 30 days, except where retention is
            legally required.
          </li>
          <li>
            <strong>User content (annotations, comments, screenshots)</strong> — retained while the
            owning organization or personal account exists. Deleted within 30 days of the parent
            account&rsquo;s deletion.
          </li>
          <li>
            <strong>Server logs</strong> — retained 90 days on a rolling basis.
          </li>
          <li>
            <strong>Backups</strong> — retained up to 30 days for disaster recovery.
          </li>
        </ul>

        <h2>9. Your Rights</h2>

        <h3>9.1 EEA, UK, and Switzerland (GDPR / UK GDPR)</h3>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data and receive a copy (Art. 15);</li>
          <li>Rectify inaccurate or incomplete data (Art. 16);</li>
          <li>Erase your data in specified circumstances (right to be forgotten, Art. 17);</li>
          <li>Restrict processing in specified circumstances (Art. 18);</li>
          <li>
            Receive your data in a structured, machine-readable format and transmit it to another
            controller (Art. 20);
          </li>
          <li>
            Object to processing based on our legitimate interests, including profiling (Art. 21);
          </li>
          <li>Withdraw consent at any time, where processing is based on consent (Art. 7(3));</li>
          <li>
            Lodge a complaint with a supervisory authority. A list is available at{" "}
            <a
              href="https://edpb.europa.eu/about-edpb/about-edpb/members_en"
              target="_blank"
              rel="noopener noreferrer"
            >
              edpb.europa.eu
            </a>
            .
          </li>
        </ul>

        <h3>9.2 California (CCPA/CPRA)</h3>
        <p>If you are a California resident, you have the right to:</p>
        <ul>
          <li>
            Know what personal information we collect, use, disclose, and (if applicable) sell or
            share;
          </li>
          <li>
            Delete the personal information we have collected from you, subject to certain
            exceptions;
          </li>
          <li>Correct inaccurate personal information we maintain about you;</li>
          <li>
            Opt out of sale or sharing — Remarks does not sell personal information for monetary
            consideration and does not share it for cross-context behavioral advertising;
          </li>
          <li>
            Limit the use of sensitive personal information beyond what is strictly necessary;
          </li>
          <li>Be free from discrimination for exercising any of these rights.</li>
        </ul>

        <h3>9.3 How to exercise your rights</h3>
        <p>
          Email <a href="mailto:privacy@remarks.online">privacy@remarks.online</a>. We will respond
          within the time required by applicable law. We may need to verify your identity before
          responding; authenticated requests submitted through your Remarks account satisfy our
          verification requirements in most cases.
        </p>

        <h2>10. Cookies and Tracking Technologies</h2>
        <p>
          We use only the cookies and storage strictly necessary to operate the Service:
          authentication cookies set by our authentication subprocessor (Clerk) and
          browser-extension storage (<code>chrome.storage</code> and IndexedDB) for user preferences
          and offline state.
        </p>
        <p>
          We do <strong>not</strong> use third-party advertising cookies, retargeting pixels, or
          session-replay tools.
        </p>

        <h2>11. Children&rsquo;s Privacy</h2>
        <p>
          The Service is not directed to children under 16, and we do not knowingly collect personal
          information from children under 16. If you believe we may have collected information from
          a child, contact us at <a href="mailto:privacy@remarks.online">privacy@remarks.online</a>.
        </p>

        <h2>12. Security</h2>
        <p>
          We implement administrative, technical, and physical safeguards designed to protect
          personal information, including TLS 1.2+ in transit, at-rest encryption for databases and
          object storage, role-based access controls, multi-factor authentication for production
          access, audit logging, and subprocessor diligence. No system is perfectly secure. If you
          become aware of a security issue, contact{" "}
          <a href="mailto:security@remarks.online">security@remarks.online</a>.
        </p>

        <h2>13. Changes to This Policy</h2>
        <p>
          We may update this Policy from time to time. When we do, we will revise the &ldquo;Last
          updated&rdquo; date at the top and, if the change is material, notify you by email or
          in-product notice before it takes effect. Continued use of the Service after the effective
          date constitutes acceptance of the updated Policy.
        </p>

        <h2>14. Contact</h2>
        <p>
          Questions about this Policy or our privacy practices:{" "}
          <a href="mailto:privacy@remarks.online">privacy@remarks.online</a>.
        </p>

        <h2>15. Chrome Web Store Limited Use Disclosure</h2>
        <p>
          The Remarks browser extension&rsquo;s use of information received from Google APIs adheres
          to the{" "}
          <a
            href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq"
            target="_blank"
            rel="noopener noreferrer"
          >
            Chrome Web Store User Data Policy
          </a>
          , including the Limited Use requirements. Specifically:
        </p>
        <ol>
          <li>
            We use information received from Google APIs only to provide and improve user-facing
            features of the Remarks extension that are prominent in the requesting extension&rsquo;s
            user interface.
          </li>
          <li>
            We do not transfer this information to others except as necessary to provide or improve
            user-facing features, to comply with applicable law, or as part of a merger,
            acquisition, or sale of assets with notice to users.
          </li>
          <li>
            We do not use or transfer this information for serving ads, including retargeted,
            personalized, or interest-based advertising.
          </li>
          <li>
            We do not use or transfer this information to determine creditworthiness or for lending
            purposes.
          </li>
          <li>
            We do not allow humans to read this information unless we have obtained the user&rsquo;s
            affirmative consent for specific data, it is necessary for security or to comply with
            applicable law, or the data is aggregated and used for internal operations in accordance
            with applicable law.
          </li>
        </ol>

        <hr />
        <p className="text-sm text-slate-500">
          <Link href="/">← Back to Remarks</Link>
        </p>
      </article>
    </main>
  );
}

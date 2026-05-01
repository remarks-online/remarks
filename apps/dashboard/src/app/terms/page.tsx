import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Remarks",
  description:
    "The terms governing your use of the Remarks browser extension, web application, hosted API, and related services.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 leading-relaxed text-slate-800 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-slate-950 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
      <article>
        <h1>Terms of Service</h1>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Draft.</strong> Engineering working copy, pending legal review.
        </p>
        <p>
          <strong>Effective date:</strong> April 30, 2026
          <br />
          <strong>Last updated:</strong> April 30, 2026
        </p>

        <h2>1. Introduction and acceptance</h2>
        <p>
          These Terms of Service (&ldquo;<strong>Terms</strong>&rdquo;) govern your access to and
          use of the Remarks browser extension, web application, hosted API, MCP server, and related
          services (collectively, the &ldquo;<strong>Service</strong>&rdquo;) operated by Remarks
          (&ldquo;<strong>Remarks</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;
          <strong>our</strong>,&rdquo; or &ldquo;<strong>us</strong>&rdquo;). By creating an
          account, installing the browser extension, or otherwise using the Service, you agree to
          these Terms. If you do not agree, do not use the Service.
        </p>
        <p>
          These Terms incorporate by reference the <Link href="/privacy">Privacy Policy</Link> and,
          where applicable to your processing of personal data, the{" "}
          <Link href="/dpa">Data Processing Addendum</Link>.
        </p>

        <h2>2. Definitions</h2>
        <ul>
          <li>
            <strong>&ldquo;Account&rdquo;</strong> means the user account created when you register
            with the Service.
          </li>
          <li>
            <strong>&ldquo;Organization&rdquo;</strong> means a workspace within the Service that
            may have multiple members and to which projects, annotations, and other content may
            belong.
          </li>
          <li>
            <strong>&ldquo;Personal Account&rdquo;</strong> means an account that is not part of an
            Organization and to which content belongs solely to the individual user.
          </li>
          <li>
            <strong>&ldquo;User Content&rdquo;</strong> has the meaning given in §6.
          </li>
          <li>
            <strong>&ldquo;Service&rdquo;</strong> has the meaning given in §1.
          </li>
          <li>
            <strong>&ldquo;You&rdquo;</strong> and <strong>&ldquo;your&rdquo;</strong> refer to the
            individual or entity using the Service. Where the user is acting on behalf of an entity
            (e.g., an employer), &ldquo;you&rdquo; includes that entity, and the individual
            represents they have authority to bind the entity.
          </li>
        </ul>

        <h2>3. Eligibility</h2>
        <p>To use the Service you must:</p>
        <ul>
          <li>
            be at least <strong>16 years old</strong> (or the age of digital consent in your
            jurisdiction, whichever is higher);
          </li>
          <li>have the legal capacity to enter into a binding contract;</li>
          <li>
            not be barred from using the Service under applicable law (including U.S. export
            controls or sanctions programs); and
          </li>
          <li>not have been previously suspended or removed from the Service.</li>
        </ul>
        <p>
          The Service is not directed to children under 16. See the{" "}
          <Link href="/privacy">Privacy Policy</Link> §11.
        </p>

        <h2>4. Account registration</h2>
        <ul>
          <li>
            <strong>One account per person.</strong> You may not create multiple accounts to evade
            limits, suspensions, or to impersonate others.
          </li>
          <li>
            <strong>Authentication.</strong> Account registration and authentication are managed by
            our authentication subprocessor (Clerk). You are responsible for maintaining the
            confidentiality of your authentication credentials.
          </li>
          <li>
            <strong>Accuracy.</strong> You agree to provide accurate, current, and complete
            information when registering and to keep it up to date.
          </li>
          <li>
            <strong>Security.</strong> You are responsible for activity that occurs under your
            Account. Notify us promptly at{" "}
            <a href="mailto:security@remarks.online">security@remarks.online</a> if you become aware
            of any unauthorized use of your Account or other security breach.
          </li>
        </ul>

        <h2>5. The Service</h2>
        <p>
          The Service provides in-context feedback tools for websites — including annotations,
          projects, screenshots, comments, and integrations.
        </p>
        <p>
          We may add, modify, or discontinue features of the Service at any time. For material
          removals affecting paid features, we will give reasonable prior notice (typically 30
          days). For free-tier features and the public beta, removals may occur without notice. We
          will not delete your User Content as a consequence of feature changes; we will provide an
          export path or grace period.
        </p>

        <h2>6. User Content</h2>

        <h3>6.1 Ownership</h3>
        <p>
          You retain all rights, title, and interest in and to the content you submit to or create
          through the Service (&ldquo;<strong>User Content</strong>&rdquo;). User Content includes,
          without limitation, annotations, comments, screenshots, project metadata, and any other
          content you upload or create.
        </p>

        <h3>6.2 License to Remarks</h3>
        <p>
          You grant Remarks a worldwide, non-exclusive, royalty-free license to host, store,
          transmit, display, reproduce, modify (only as necessary to adapt for display or storage),
          and make derivative works of your User Content <strong>solely</strong> to operate,
          provide, and improve the Service for you and your Organization. This license is limited to
          what is necessary to run the Service. The license terminates when you delete the User
          Content or your Account, subject to backup retention as described in the{" "}
          <Link href="/privacy">Privacy Policy</Link> §8.
        </p>

        <h3>6.3 Your responsibilities</h3>
        <p>You represent and warrant that:</p>
        <ul>
          <li>you own or have the necessary rights to your User Content;</li>
          <li>
            your User Content does not infringe any third party&rsquo;s intellectual property,
            privacy, publicity, or other rights;
          </li>
          <li>
            you have obtained any necessary consents to capture screenshots or annotations of pages
            containing third-party content; and
          </li>
          <li>your use of the Service complies with applicable law.</li>
        </ul>
        <p>
          You are solely responsible for your User Content and for ensuring that sharing it with
          your Organization is appropriate.
        </p>

        <h3>6.4 Removal</h3>
        <p>
          We may remove or restrict access to User Content that we reasonably believe violates these
          Terms, infringes a third party&rsquo;s rights, or is otherwise unlawful. Where feasible,
          we will notify the affected user.
        </p>

        <h2>7. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            access the Service through automated means except via the documented API or MCP
            interfaces, and only within their published rate limits;
          </li>
          <li>
            scrape, crawl, or harvest data from the Service beyond what your Account is authorized
            to access;
          </li>
          <li>
            upload viruses, malware, or any code intended to damage or disrupt the Service or
            another user&rsquo;s system;
          </li>
          <li>
            reverse engineer, decompile, or attempt to extract source code from the Service, except
            to the extent expressly permitted by applicable law;
          </li>
          <li>circumvent rate limits, access controls, or other technical measures;</li>
          <li>
            impersonate another person or entity, or misrepresent your affiliation with any person
            or entity;
          </li>
          <li>
            use the Service to harass, threaten, defame, or discriminate against any person or
            group;
          </li>
          <li>
            upload content that is unlawful, infringing, defamatory, obscene, or that solicits or
            facilitates unlawful activity;
          </li>
          <li>
            use the Service to develop a competing product, including by training models on outputs
            of the Service in a way that would substitute for the Service;
          </li>
          <li>
            resell, sublicense, or commercially exploit the Service except as expressly permitted in
            these Terms.
          </li>
        </ul>
        <p>
          We may suspend or terminate Accounts that violate this section, with or without notice
          depending on the severity of the violation.
        </p>

        <h2>8. Intellectual property</h2>
        <p>
          Remarks owns and retains all rights, title, and interest in and to the Service, including
          the software, design, marks, branding, and any documentation we provide. Subject to your
          compliance with these Terms, we grant you a limited, non-exclusive, non-transferable,
          revocable license to use the Service for its intended purposes during the term of your
          Account.
        </p>
        <p>
          The &ldquo;Remarks&rdquo; name and logo are our trademarks. You may not use them without
          our prior written consent, except for nominative uses (e.g., to truthfully describe an
          integration with the Service).
        </p>
        <p>
          Feedback you provide about the Service is non-confidential, and we may use it for any
          purpose without obligation to you.
        </p>

        <h2>9. Third-party services</h2>
        <p>
          The Service relies on or integrates with third-party services, including those listed as
          subprocessors in the <Link href="/privacy">Privacy Policy</Link> §6.1 (Clerk, Cloudflare,
          Neon, Fly.io, Vercel, Resend, Inngest, PostHog). When you use those integrations, the
          third party&rsquo;s terms and privacy policies apply in addition to ours. We are not
          responsible for third-party services and do not endorse them.
        </p>
        <p>
          The browser extension may render annotations on third-party websites. Those websites are
          operated by their owners and have their own terms; we do not control them.
        </p>

        <h2>10. Subscriptions and billing</h2>
        <p>
          Paid plans are not currently offered. When we introduce paid plans, the terms governing
          fees, billing cycles, taxes, refunds, automatic renewal, cancellation, and free trials
          will be posted before charge and will form part of these Terms for affected users. We will
          give existing users prior notice and the opportunity to consent before any charge.
        </p>

        <h2>11. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED <strong>&ldquo;AS IS&rdquo;</strong> AND{" "}
          <strong>&ldquo;AS AVAILABLE&rdquo;</strong> WITHOUT WARRANTIES OF ANY KIND, WHETHER
          EXPRESS, IMPLIED, OR STATUTORY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, REMARKS DISCLAIMS
          ALL WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          NON-INFRINGEMENT, AND ANY WARRANTIES ARISING FROM A COURSE OF DEALING OR USAGE OF TRADE.
          WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF
          VIRUSES OR OTHER HARMFUL COMPONENTS.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of certain warranties, so some of the above
          exclusions may not apply to you. In that case, the disclaimed warranties are limited to
          the minimum scope and duration permitted by applicable law.
        </p>

        <h2>12. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL REMARKS, ITS AFFILIATES,
          OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST REVENUE, LOST DATA, OR
          BUSINESS INTERRUPTION, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR THE SERVICE,
          REGARDLESS OF THE THEORY OF LIABILITY, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF
          SUCH DAMAGES.
        </p>
        <p>
          OUR TOTAL CUMULATIVE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE
          WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID TO US FOR THE SERVICE IN THE 12
          MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY, OR (B) ONE HUNDRED U.S. DOLLARS
          ($100).
        </p>
        <p>
          Some jurisdictions do not allow the exclusion or limitation of certain damages, so some of
          the above limitations may not apply to you. Nothing in these Terms limits liability for
          fraud, willful misconduct, or any liability that cannot be excluded under applicable law.
        </p>

        <h2>13. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless Remarks and its affiliates, officers,
          directors, employees, and agents from and against any third-party claims, damages, losses,
          liabilities, costs, and expenses (including reasonable attorneys&rsquo; fees) arising out
          of or relating to:
        </p>
        <ul>
          <li>your User Content;</li>
          <li>your use of the Service in violation of these Terms or applicable law; or</li>
          <li>your infringement of any third party&rsquo;s rights.</li>
        </ul>
        <p>
          We will promptly notify you of any such claim and reasonably cooperate in the defense at
          your expense. You may not settle any claim that imposes obligations on us without our
          prior written consent.
        </p>

        <h2>14. Termination</h2>

        <h3>14.1 By you</h3>
        <p>
          You may stop using the Service and delete your Account at any time from the dashboard.
          Account deletion initiates the data deletion process described in the{" "}
          <Link href="/privacy">Privacy Policy</Link> §8.
        </p>

        <h3>14.2 By us</h3>
        <p>We may suspend or terminate your access to the Service, with or without notice, if:</p>
        <ul>
          <li>you materially breach these Terms;</li>
          <li>we are required to do so by law;</li>
          <li>
            prolonged inactivity (typically more than 12 months) leads us to reasonably believe the
            Account has been abandoned, after notice; or
          </li>
          <li>
            continued provision of the Service to you would expose us or other users to material
            risk of harm or liability.
          </li>
        </ul>

        <h3>14.3 Effect of termination</h3>
        <p>Upon termination:</p>
        <ul>
          <li>your right to access the Service ends;</li>
          <li>
            User Content is deleted as described in the <Link href="/privacy">Privacy Policy</Link>{" "}
            §8 (subject to backups for up to 30 days and any legally required retention);
          </li>
          <li>
            §§6.2 (license back), 8 (intellectual property), 11–13 (disclaimers, limitation of
            liability, indemnification), 16 (governing law and disputes), and 17 (miscellaneous)
            survive.
          </li>
        </ul>

        <h2>15. Modifications to these Terms</h2>
        <p>
          We may revise these Terms from time to time. When we do, we will revise the &ldquo;Last
          updated&rdquo; date above and, if the change is material, notify you by email or
          in-product notice before it takes effect. Continued use of the Service after the effective
          date of a change constitutes your acceptance of the revised Terms. If you do not agree,
          stop using the Service and delete your Account.
        </p>

        <h2>16. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of the State of Delaware, U.S.A., without regard to
          conflict-of-laws principles. The exclusive venue for any dispute arising out of or
          relating to these Terms or the Service, where permitted, is the state and federal courts
          located in Delaware, and each party consents to personal jurisdiction there.
        </p>
        <p>
          Before initiating a formal dispute, you agree to first contact us at{" "}
          <a href="mailto:legal@remarks.online">legal@remarks.online</a> and attempt informal
          resolution in good faith for at least 30 days.
        </p>
        <p>
          To the extent permitted by applicable law, you and Remarks waive the right to participate
          in a class action, collective action, or representative proceeding. Some jurisdictions do
          not enforce class action waivers; in those jurisdictions, this waiver does not apply to
          you.
        </p>
        <p>
          If you reside in the European Union, the United Kingdom, or another jurisdiction whose
          mandatory consumer protection laws override the choice of law or venue above, those
          mandatory provisions apply notwithstanding this section.
        </p>

        <h2>17. Miscellaneous</h2>
        <ul>
          <li>
            <strong>Entire agreement.</strong> These Terms, together with the{" "}
            <Link href="/privacy">Privacy Policy</Link> and the <Link href="/dpa">DPA</Link> (where
            applicable), constitute the entire agreement between you and Remarks regarding the
            Service.
          </li>
          <li>
            <strong>Severability.</strong> If any provision of these Terms is held unenforceable,
            the remaining provisions remain in full force and effect.
          </li>
          <li>
            <strong>No waiver.</strong> Our failure to enforce a provision is not a waiver of our
            right to enforce it later.
          </li>
          <li>
            <strong>Assignment.</strong> You may not assign these Terms without our prior written
            consent. We may assign these Terms in connection with a merger, acquisition, financing,
            or sale of assets, with notice to you.
          </li>
          <li>
            <strong>Force majeure.</strong> Neither party is liable for delays or failures caused by
            events beyond its reasonable control.
          </li>
          <li>
            <strong>Notices.</strong> We may give notices via email to the address associated with
            your Account or through in-product notifications. Notices to us must be sent to{" "}
            <a href="mailto:legal@remarks.online">legal@remarks.online</a>.
          </li>
          <li>
            <strong>Independent contractors.</strong> Nothing in these Terms creates a partnership,
            joint venture, agency, or employment relationship.
          </li>
          <li>
            <strong>Headings.</strong> Section headings are for convenience only and do not affect
            interpretation.
          </li>
        </ul>

        <h2>18. Contact</h2>
        <p>
          Questions about these Terms:{" "}
          <a href="mailto:legal@remarks.online">legal@remarks.online</a>.
        </p>

        <hr />
        <p className="text-sm text-slate-500">
          <Link href="/">← Back to Remarks</Link>
        </p>
      </article>
    </main>
  );
}

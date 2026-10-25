import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

const CONTACT_EMAIL = "nagasatwik145@gmail.com";
const EFFECTIVE_DATE = "October 25, 2026";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "LORD AI Privacy Policy" },
      {
        name: "description",
        content: "How LORD AI collects, uses, stores, and shares information.",
      },
    ],
  }),
  component: PrivacyPolicyPage,
});

export function PrivacyPolicyPage() {
  return (
    <main className="relative z-10 px-4 py-10 sm:px-6 sm:py-16">
      <article className="mx-auto w-full max-w-4xl rounded-2xl border border-primary/20 bg-card/80 p-5 shadow-[var(--shadow-panel)] backdrop-blur-xl sm:p-8 md:p-12">
        <header className="border-b border-border/70 pb-8">
          <a
            href="/"
            className="font-mono text-xs uppercase tracking-[0.22em] text-primary transition hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            LORD AI
          </a>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            LORD AI Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">Effective date: {EFFECTIVE_DATE}</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-foreground/80">
            This policy explains how LORD AI handles information when you use the LORD AI website,
            application, and related features. It is written to describe the current implementation
            as accurately as possible; some features are optional and only process information when
            you use them.
          </p>
        </header>

        <nav
          aria-label="Privacy policy sections"
          className="mt-8 rounded-xl border border-border/60 bg-background/40 p-4"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
            On this page
          </p>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {[
              ["operator", "1. Operator and contact"],
              ["information", "2. Information we collect"],
              ["use", "3. How we use information"],
              ["storage", "4. Saved content and retention"],
              ["providers", "5. AI and service providers"],
              ["sharing", "6. Sharing and disclosure"],
              ["choices", "7. Choices and requests"],
              ["security", "8. Security"],
              ["technologies", "9. Cookies and local storage"],
              ["children", "10. Children's privacy"],
              ["international", "11. International processing"],
              ["updates", "12. Updates and contact"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        <div className="mt-10 space-y-10 text-[15px] leading-7 text-foreground/85 sm:text-base">
          <PolicySection id="operator" title="1. Operator and contact">
            <p>
              LORD AI is operated by Karnala Naga Satwik. No separate company or legal entity is
              identified in the current application materials. For privacy questions, access or
              deletion requests, contact <EmailLink />.
            </p>
          </PolicySection>

          <PolicySection id="information" title="2. Information we collect">
            <p>Depending on the features you use, LORD AI may process:</p>
            <ul>
              <li>
                Account identifiers, email address, authentication records, and profile details such
                as your name or avatar.
              </li>
              <li>
                Chat messages, prompts, voice transcripts or audio submitted to a voice feature,
                generated responses, and conversation metadata.
              </li>
              <li>
                Files, documents, images, OCR inputs, project files, and other content you upload or
                create.
              </li>
              <li>
                Saved content such as memories, projects, games, study plans, notes, tasks, calendar
                items, research records, and learning progress.
              </li>
              <li>
                Purchase and subscription status. Payment credentials are handled by the payment
                provider rather than stored by LORD AI in the application code.
              </li>
              <li>
                Technical and diagnostic information, including request identifiers, error and
                performance information, feature usage events, and server logs. The server may log
                request paths and limited chat-text previews when chat debug logging is explicitly
                enabled.
              </li>
            </ul>
            <p>
              LORD AI does not request access to your Google Drive, contacts, calendar, or other
              unrelated Google services through Google Sign-In.
            </p>
            <p>
              When you choose Google Sign-In, Supabase Auth redirects you to Google and receives the
              basic OpenID Connect identity information made available for sign-in, such as your
              Google account identifier, email address, and basic profile information. The current
              LORD AI code does not add custom Google scopes; it uses the provider's configured
              default sign-in scopes. Google and Supabase may retain authentication records under
              their own policies.
            </p>
          </PolicySection>

          <PolicySection id="use" title="3. How we use information">
            <p>We use information to:</p>
            <ul>
              <li>
                create and authenticate your account, maintain sessions, and provide account-scoped
                features;
              </li>
              <li>
                respond to prompts, generate or transform content, perform search, OCR, voice,
                image, study, and productivity features you request;
              </li>
              <li>
                save, retrieve, synchronize, and protect your conversations and other user-created
                content;
              </li>
              <li>process payments and maintain subscription or entitlement status;</li>
              <li>
                diagnose failures, improve reliability, prevent abuse, and operate the service; and
              </li>
              <li>
                measure product usage only where the account has enabled the implemented analytics
                consent.
              </li>
            </ul>
            <p>
              We do not use Google account information for advertising based on the current
              implementation. LORD AI does not make a blanket promise that user content is never
              retained or never processed by an AI provider; provider handling depends on the
              provider and feature involved.
            </p>
          </PolicySection>

          <PolicySection id="storage" title="4. Saved content and retention">
            <p>
              Supabase is used for authentication, a PostgreSQL database, realtime synchronization,
              and file storage. The code includes user-scoped tables and storage buckets for
              conversations and messages, memories, projects and project files, generated images,
              learning records, games, research, tasks, and other application features. Some records
              use database cascade rules when a parent account or record is removed, but the
              application does not currently provide a single, universal account-deletion workflow.
            </p>
            <p>
              You can delete content where the relevant feature exposes a delete action. To request
              account or data deletion, email <EmailLink /> and identify the account email and the
              content you want removed. We will review the request and may need to retain limited
              information for security, fraud prevention, dispute resolution, or legal reasons.
              Deletion may not be instantaneous and copies held by independent providers may be
              governed by their own retention policies.
            </p>
            <p>
              The implemented product analytics schema is designed to retain analytics events for 13
              months through a scheduled purge, but that scheduler is an operational dependency. The
              repository does not establish a single retention period for all content, backups, or
              operational logs.
            </p>
          </PolicySection>

          <PolicySection id="providers" title="5. AI and service providers">
            <p>
              Depending on server configuration and the feature or model selected, user inputs and
              uploaded content may be sent to OpenRouter, OpenAI, Google Gemini, Cloudflare Workers
              AI, and Tavily for model inference, image generation, embeddings, web search, or
              related processing. OpenRouter may in turn route a request to the model provider
              selected by the application. LORD AI also relies on Supabase for account, database,
              realtime, and storage services; Google for Google Sign-In; Vercel or another
              configured deployment host for application delivery; and Razorpay or PhonePe for
              payment flows when enabled.
            </p>
            <p>
              These providers may process information under their own terms and privacy policies.
              The application does not expose provider API keys in the browser; however, no online
              service can guarantee that transmission or storage is risk-free. Review the relevant
              provider terms before submitting confidential or regulated information.
            </p>
          </PolicySection>

          <PolicySection id="sharing" title="6. Sharing and disclosure">
            <p>
              We share information with the service providers described above only as needed to
              operate the requested feature, secure the service, or process a payment. You may also
              choose to publish a community creation or create a conversation share link; content
              you deliberately make public can be viewed by people who receive the link or visit the
              public feature. We may disclose information when required by law, to protect rights
              and safety, or as part of a transfer or restructuring of the service. We do not sell
              personal information or use it for third-party advertising in the current code.
            </p>
          </PolicySection>

          <PolicySection id="choices" title="7. Choices and requests">
            <ul>
              <li>
                You may stop using a feature, revoke Google access through your Google account
                settings, or sign out to end the active session.
              </li>
              <li>
                You may update some profile and saved content through the application and may
                disable the implemented product analytics consent in the relevant settings or by
                contacting us.
              </li>
              <li>
                You may request access, correction, portability where feasible, or deletion by
                emailing <EmailLink />. We may ask for verification before fulfilling a request.
              </li>
            </ul>
            <p>
              Because the application currently lacks a complete automated account-deletion flow, do
              not assume that signing out or deleting a local browser session deletes server-side
              content.
            </p>
          </PolicySection>

          <PolicySection id="security" title="8. Security">
            <p>
              The implementation uses authenticated requests, Supabase row-level access policies,
              server-side provider secrets, HTTPS deployment configuration for native API access,
              and secure native session storage where supported. These measures reduce risk but do
              not eliminate it. You are responsible for protecting your credentials and for choosing
              carefully what you submit to an AI service.
            </p>
          </PolicySection>

          <PolicySection id="technologies" title="9. Cookies and local storage">
            <p>
              The web app stores Supabase authentication sessions in browser local storage. It also
              uses local storage for settings such as theme, voice output, navigation preferences,
              offline caches, and other feature state. A sidebar preference is stored in a browser
              cookie. The native application can store authentication sessions in secure device
              storage. We do not currently use a third-party advertising cookie system.
            </p>
          </PolicySection>

          <PolicySection id="children" title="10. Children's privacy">
            <p>
              LORD AI is not directed to children under 13, and we do not knowingly collect personal
              information from a child under 13 without legally required parental involvement. If
              you believe a child has provided personal information, contact <EmailLink /> so we can
              review and remove it where appropriate. If local law sets a higher age or additional
              requirements, those requirements apply.
            </p>
          </PolicySection>

          <PolicySection id="international" title="11. International processing">
            <p>
              LORD AI and its providers may process information in countries other than the country
              where you live, including where the hosting, authentication, database, AI, search, or
              payment provider operates. Those providers may apply their own transfer safeguards and
              contractual terms. The repository does not identify a single processing location for
              every provider or feature.
            </p>
          </PolicySection>

          <PolicySection id="updates" title="12. Updates and contact">
            <p>
              We may update this policy when the service or its data practices change. We will post
              the revised policy at this URL and update the effective date. For privacy questions,
              data requests, or concerns about this policy, email <EmailLink />.
            </p>
          </PolicySection>
        </div>

        <footer className="mt-12 border-t border-border/70 pt-6 text-sm text-muted-foreground">
          Last updated: {EFFECTIVE_DATE}.{" "}
          <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </footer>
      </article>
    </main>
  );
}

function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-primary sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-4 [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:max-w-3xl [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function EmailLink() {
  return (
    <a
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      href={`mailto:${CONTACT_EMAIL}`}
    >
      {CONTACT_EMAIL}
    </a>
  );
}

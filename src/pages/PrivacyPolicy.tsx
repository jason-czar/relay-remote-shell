import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="border-b border-border/40">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
            <img src={logo} alt="PrivaClaw" className="h-6 w-6 rounded" />
            <span className="text-sm font-bold tracking-tight">PrivaClaw</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground mt-1 text-sm">Last updated: February 2026</p>
        </div>

        <Section title="1. Introduction">
          PrivaClaw ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your personal information when you use our Service.
        </Section>

        <Section title="2. Information We Collect">
          We collect the following types of information:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li><strong className="text-foreground">Account data:</strong> Email address and display name provided at registration</li>
            <li><strong className="text-foreground">Usage data:</strong> Chat messages, terminal session metadata, and device connection records</li>
            <li><strong className="text-foreground">Technical data:</strong> IP addresses, browser type, and access timestamps for security and rate limiting</li>
            <li><strong className="text-foreground">Profile data:</strong> Optional avatar image and display name you choose to provide</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Information">
          We use your information to:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Provide, operate, and maintain the Service</li>
            <li>Authenticate your identity and secure your account</li>
            <li>Store and retrieve your chat conversations and session history</li>
            <li>Improve the Service through aggregate, anonymized analytics</li>
            <li>Communicate with you about important account or service updates</li>
          </ul>
        </Section>

        <Section title="4. Data Storage and Security">
          Your data is stored securely using industry-standard encryption at rest and in transit. We use managed infrastructure with strict access controls. Terminal session recordings are stored encrypted and accessible only to you and authorized project members.
        </Section>

        <Section title="5. Data Sharing">
          We do not sell, rent, or share your personal data with third parties for marketing purposes. We may share data only in the following limited circumstances:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>With service providers necessary to operate the platform (e.g., infrastructure providers)</li>
            <li>When required by law or to protect the rights and safety of users</li>
            <li>In the event of a merger or acquisition, with appropriate notice</li>
          </ul>
        </Section>

        <Section title="6. AI Processing">
          When you use AI agent features, your messages may be processed by third-party AI providers (such as Anthropic) to generate responses. These providers have their own privacy policies and data handling practices. We do not use your conversations to train AI models without your consent.
        </Section>

        <Section title="7. Data Retention">
          We retain your account data for as long as your account is active. Chat history and session recordings are stored until you delete them or close your account. Upon account deletion, your personal data is removed within 30 days, except where required by law.
        </Section>

        <Section title="8. Your Rights">
          You have the right to:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Access and download your personal data</li>
            <li>Correct inaccurate information in your profile</li>
            <li>Delete your account and associated data</li>
            <li>Object to or restrict certain processing of your data</li>
          </ul>
          To exercise these rights, contact us or use the account settings page.
        </Section>

        <Section title="9. Cookies">
          We use minimal, essential cookies for session management and authentication. We do not use tracking or advertising cookies.
        </Section>

        <Section title="10. Changes to This Policy">
          We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page with a revised date.
        </Section>

        <Section title="11. Contact Us">
          If you have questions about this Privacy Policy or how we handle your data, please contact us at{" "}
          <a href="mailto:privacy@privaclaw.com" className="text-primary hover:underline">
            privacy@privaclaw.com
          </a>.
        </Section>
      </main>

      <footer className="border-t border-border/40 py-6">
        <div className="max-w-2xl mx-auto px-4 flex gap-4 text-xs text-muted-foreground/50">
          <button onClick={() => navigate("/terms")} className="hover:text-muted-foreground transition-colors">Terms</button>
          <button onClick={() => navigate("/privacy")} className="hover:text-muted-foreground transition-colors">Privacy</button>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

export default function TermsOfService() {
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
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-muted-foreground mt-1 text-sm">Last updated: February 2026</p>
        </div>

        <Section title="1. Acceptance of Terms">
          By accessing or using PrivaClaw ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
        </Section>

        <Section title="2. Description of Service">
          PrivaClaw is a remote shell and AI agent management platform that allows users to connect to devices, run terminal sessions, and interact with AI coding assistants. The Service is provided "as is" and may change over time without notice.
        </Section>

        <Section title="3. Account Registration">
          You must create an account to use the Service. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. You agree to provide accurate information and to notify us immediately of any unauthorized use.
        </Section>

        <Section title="4. Acceptable Use">
          You agree not to use the Service to:
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Violate any applicable laws or regulations</li>
            <li>Interfere with or disrupt the integrity or performance of the Service</li>
            <li>Attempt to gain unauthorized access to any systems or networks</li>
            <li>Transmit any malware, viruses, or other harmful code</li>
            <li>Use the Service to harm others or facilitate illegal activities</li>
          </ul>
        </Section>

        <Section title="5. Data and Privacy">
          Your use of the Service is also governed by our Privacy Policy. By using the Service, you consent to the collection and use of your data as described therein. We do not sell your personal data to third parties.
        </Section>

        <Section title="6. Intellectual Property">
          The Service, including its software, design, and content, is owned by PrivaClaw and protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works without prior written permission.
        </Section>

        <Section title="7. Limitation of Liability">
          To the fullest extent permitted by law, PrivaClaw shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits or data, arising from your use of the Service.
        </Section>

        <Section title="8. Termination">
          We reserve the right to suspend or terminate your account at any time if you violate these Terms or for any other reason at our discretion. You may also delete your account at any time through the settings page.
        </Section>

        <Section title="9. Changes to Terms">
          We may update these Terms from time to time. Continued use of the Service after changes constitutes your acceptance of the new Terms. We will make reasonable efforts to notify users of material changes.
        </Section>

        <Section title="10. Contact">
          If you have any questions about these Terms, please contact us at{" "}
          <a href="mailto:hello@privaclaw.com" className="text-primary hover:underline">
            hello@privaclaw.com
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

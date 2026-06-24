import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listAccounts,
  addOauthAccount,
  addImapAccount,
  validateImapConnection,
  getAiConfig,
  setAiConfig,
  validateAiEndpoint,
  triggerSync,
} from "@/lib/api";
import { AI_OUTPUT_LANGUAGES } from "@/lib/aiUi";
import type { Account, AiTone, AiOutputLanguage, EncryptionType } from "@/types";
import { Mail, Sparkles, ArrowRight, ArrowLeft, Check, Loader2, ChevronDown } from "lucide-react";

const AI_TONES: AiTone[] = ["Professional", "Friendly", "Concise"];

const STEPS = ["Welcome", "Account", "AI", "Ready"] as const;
type Step = (typeof STEPS)[number];

function detectLanguage(): AiOutputLanguage {
  const lang = navigator.language.split("-")[0];
  if (lang === "de") return "de";
  if (lang === "no" || lang === "nb" || lang === "nn") return "no";
  return "en";
}

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current
              ? "w-6 bg-foreground"
              : i < current
                ? "w-1.5 bg-foreground/40"
                : "w-1.5 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6 animate-fade-in">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-ai/10 flex items-center justify-center">
        <Mail className="h-8 w-8 text-ai" strokeWidth={1.5} />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to p0mail</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
          A calm, AI-powered email client. Let's get you set up in two quick steps.
        </p>
      </div>
      <Button onClick={onNext} size="lg" className="gap-2">
        Get Started
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function AccountStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showImap, setShowImap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await listAccounts();
      setAccounts(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const handleOAuth = async (provider: "gmail_oauth" | "microsoft_oauth") => {
    setLoading(true);
    setError(null);
    try {
      const account = await addOauthAccount(provider);
      await triggerSync(account.id).catch(() => {});
      await refreshAccounts();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">Connect your email</h2>
        <p className="text-sm text-muted-foreground">
          Choose a provider or use IMAP for custom domains.
        </p>
      </div>

      {accounts.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/30 px-3 py-2">
          <Check className="h-4 w-4 text-ai" />
          <span className="text-sm font-medium">{accounts[0].email_address}</span>
          {accounts.length > 1 && (
            <span className="text-xs text-muted-foreground">+{accounts.length - 1} more</span>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => handleOAuth("gmail_oauth")}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Google"}
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => handleOAuth("microsoft_oauth")}
          disabled={loading}
        >
          Microsoft
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setShowImap(!showImap)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${showImap ? "rotate-180" : ""}`} />
        Use IMAP instead
      </button>

      {showImap && (
        <ImapForm
          onAdded={async () => {
            await refreshAccounts();
            setShowImap(false);
          }}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs">
          Skip for now
        </Button>
        <Button
          onClick={onNext}
          disabled={accounts.length === 0}
          className="gap-2"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ImapForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({
    displayName: "",
    emailAddress: "",
    imapHost: "",
    imapPort: "993",
    imapEncryption: "SSL" as EncryptionType,
    smtpHost: "",
    smtpPort: "587",
    smtpEncryption: "STARTTLS" as EncryptionType,
    username: "",
    password: "",
  });
  const [validating, setValidating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    setValidated(false);
    try {
      await validateImapConnection({
        ...form,
        imapPort: parseInt(form.imapPort),
        smtpPort: parseInt(form.smtpPort),
      });
      setValidated(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await addImapAccount({
        ...form,
        imapPort: parseInt(form.imapPort),
        smtpPort: parseInt(form.smtpPort),
      });
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border p-3 animate-slide-up">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
          <Input value={form.displayName} onChange={(e) => update("displayName", e.target.value)} placeholder="My Email" className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Email</label>
          <Input value={form.emailAddress} onChange={(e) => update("emailAddress", e.target.value)} placeholder="me@example.com" className="h-8 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">IMAP Host</label>
          <Input value={form.imapHost} onChange={(e) => update("imapHost", e.target.value)} placeholder="imap.example.com" className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Port</label>
          <Input value={form.imapPort} onChange={(e) => update("imapPort", e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">SMTP Host</label>
          <Input value={form.smtpHost} onChange={(e) => update("smtpHost", e.target.value)} placeholder="smtp.example.com" className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Port</label>
          <Input value={form.smtpPort} onChange={(e) => update("smtpPort", e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Username</label>
          <Input value={form.username} onChange={(e) => update("username", e.target.value)} placeholder="me@example.com" className="h-8 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Password</label>
          <Input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {validated && <p className="text-xs text-ai">Connection verified.</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleValidate} disabled={validating}>
          {validating ? "Testing…" : "Test"}
        </Button>
        <Button type="submit" size="sm" disabled={adding}>
          {adding ? "Adding…" : "Add Account"}
        </Button>
      </div>
    </form>
  );
}

function AiStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [tone, setTone] = useState<AiTone>("Professional");
  const [language, setLanguage] = useState<AiOutputLanguage>(detectLanguage());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getAiConfig().then((c) => {
      if (c) {
        setBaseUrl(c.base_url || "https://api.openai.com");
        setModel(c.model || "gpt-4o");
        setTone(c.default_tone || "Professional");
        setLanguage(c.output_language || detectLanguage());
        if (c.api_key) setApiKey(c.api_key);
      }
    }).catch(() => {});
  }, []);

  const handleSaveAndContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      await setAiConfig({
        base_url: baseUrl,
        api_key: apiKey,
        model,
        default_tone: tone,
        output_language: language,
        custom_instructions: "",
      });
      onNext();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(false);
    try {
      await setAiConfig({
        base_url: baseUrl,
        api_key: apiKey,
        model,
        default_tone: tone,
        output_language: language,
        custom_instructions: "",
      });
      const valid = await validateAiEndpoint();
      setSuccess(valid);
      if (!valid) setError("Endpoint validation failed.");
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ai" />
          <h2 className="text-xl font-semibold tracking-tight">Configure AI</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          OpenAI-compatible endpoint for summaries, drafts, and inline transforms.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Base URL</label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Default tone</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {AI_TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  tone === t
                    ? "border-ai/40 bg-ai/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-ai/20 hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Output language</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {AI_OUTPUT_LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLanguage(l.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  language === l.id
                    ? "border-ai/40 bg-ai/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-ai/20 hover:text-foreground"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-ai">Endpoint verified.</p>}

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs">
            Skip
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !apiKey}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
        <Button onClick={handleSaveAndContinue} disabled={saving || !baseUrl || !apiKey || !model} className="gap-2">
          {saving ? "Saving…" : "Save & Continue"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="text-center space-y-6 animate-fade-in">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-ai/10 flex items-center justify-center">
        <Check className="h-8 w-8 text-ai" strokeWidth={1.5} />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">You're all set</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
          Your inbox is ready. Try summarizing a thread, drafting a reply with AI, or selecting text to transform it inline.
        </p>
      </div>
      <Button onClick={onFinish} size="lg" className="gap-2">
        Open Inbox
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("Welcome");
  const stepIndex = STEPS.indexOf(step);

  const finish = () => {
    localStorage.setItem("p0mail:onboarded", "true");
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <StepDots current={stepIndex} />
        </div>

        {step === "Welcome" && <WelcomeStep onNext={() => setStep("Account")} />}
        {step === "Account" && (
          <AccountStep
            onNext={() => setStep("AI")}
            onSkip={() => setStep("AI")}
          />
        )}
        {step === "AI" && (
          <AiStep
            onNext={() => setStep("Ready")}
            onSkip={() => setStep("Ready")}
          />
        )}
        {step === "Ready" && <DoneStep onFinish={finish} />}
      </div>

      {stepIndex > 0 && step !== "Ready" && (
        <button
          onClick={() => setStep(STEPS[stepIndex - 1])}
          className="absolute top-6 left-6 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
      )}
    </div>
  );
}

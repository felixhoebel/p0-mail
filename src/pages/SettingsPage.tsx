import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  listAccounts,
  addOauthAccount,
  addImapAccount,
  removeAccount,
  validateImapConnection,
  getAiConfig,
  setAiConfig,
  validateAiEndpoint,
  triggerSync,
} from "@/lib/api";
import type { Account, AiConfig, EncryptionType } from "@/types";

function AccountList({
  accounts,
  onRemove,
}: {
  accounts: Account[];
  onRemove: (id: number) => void;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No accounts configured.</p>
    );
  }
  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <div>
            <span className="text-sm font-medium">{account.email_address}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({account.display_name})
            </span>
            {account.needs_reauth && (
              <p className="text-xs text-amber-600 mt-1">
                Session expired — remove and connect Google again.
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(account.id)}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

function AddAccountSection({ onAccountAdded }: { onAccountAdded: () => void }) {
  const [showImap, setShowImap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOAuth = async (provider: "gmail_oauth" | "microsoft_oauth") => {
    setLoading(true);
    setError(null);
    try {
      const account = await addOauthAccount(provider);
      await triggerSync(account.id).catch(() => {});
      onAccountAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => handleOAuth("gmail_oauth")}
          disabled={loading}
        >
          Google
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => handleOAuth("microsoft_oauth")}
          disabled={loading}
        >
          Microsoft
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setShowImap(!showImap)}
          disabled={loading}
        >
          IMAP
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {showImap && (
        <ImapForm
          onAccountAdded={() => {
            setShowImap(false);
            onAccountAdded();
          }}
        />
      )}
    </div>
  );
}

function ImapForm({ onAccountAdded }: { onAccountAdded: () => void }) {
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
  const [error, setError] = useState<string | null>(null);

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    try {
      await validateImapConnection({
        ...form,
        imapPort: parseInt(form.imapPort),
        smtpPort: parseInt(form.smtpPort),
      });
    } catch (e) {
      setError(String(e));
      setValidating(false);
      return;
    }
    setValidating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await addImapAccount({
        ...form,
        imapPort: parseInt(form.imapPort),
        smtpPort: parseInt(form.smtpPort),
      });
      onAccountAdded();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border rounded-md p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">Display Name</label>
          <Input
            value={form.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            placeholder="My Email"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Email Address</label>
          <Input
            value={form.emailAddress}
            onChange={(e) => update("emailAddress", e.target.value)}
            placeholder="me@example.com"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium">IMAP Host</label>
          <Input
            value={form.imapHost}
            onChange={(e) => update("imapHost", e.target.value)}
            placeholder="imap.example.com"
          />
        </div>
        <div>
          <label className="text-xs font-medium">IMAP Port</label>
          <Input
            value={form.imapPort}
            onChange={(e) => update("imapPort", e.target.value)}
            placeholder="993"
          />
        </div>
        <div>
          <label className="text-xs font-medium">IMAP Encryption</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={form.imapEncryption}
            onChange={(e) => update("imapEncryption", e.target.value)}
          >
            <option value="SSL">SSL/TLS</option>
            <option value="STARTTLS">STARTTLS</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium">SMTP Host</label>
          <Input
            value={form.smtpHost}
            onChange={(e) => update("smtpHost", e.target.value)}
            placeholder="smtp.example.com"
          />
        </div>
        <div>
          <label className="text-xs font-medium">SMTP Port</label>
          <Input
            value={form.smtpPort}
            onChange={(e) => update("smtpPort", e.target.value)}
            placeholder="587"
          />
        </div>
        <div>
          <label className="text-xs font-medium">SMTP Encryption</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={form.smtpEncryption}
            onChange={(e) => update("smtpEncryption", e.target.value)}
          >
            <option value="SSL">SSL/TLS</option>
            <option value="STARTTLS">STARTTLS</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">Username</label>
          <Input
            value={form.username}
            onChange={(e) => update("username", e.target.value)}
            placeholder="me@example.com"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Password</label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="Password"
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={validating}>
          Add Account
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleValidate}
          disabled={validating}
        >
          {validating ? "Testing..." : "Test Connection"}
        </Button>
      </div>
    </form>
  );
}

function AiConfigSection() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyStored, setApiKeyStored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const applyConfig = (c: AiConfig | null) => {
    if (!c) return;
    setConfig(c);
    setBaseUrl(c.base_url);
    setModel(c.model);
    if (c.api_key) {
      setApiKey(c.api_key);
      setApiKeyStored(true);
    } else {
      setApiKey("");
      setApiKeyStored(false);
    }
  };

  useEffect(() => {
    getAiConfig().then(applyConfig).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await setAiConfig({
        base_url: baseUrl,
        api_key: apiKey,
        model,
        default_tone: config?.default_tone || "Professional",
      });
      const saved = await getAiConfig();
      applyConfig(saved);
      setMessage("AI settings saved.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setMessage(null);
    try {
      await handleSave();
      const valid = await validateAiEndpoint();
      setMessage(valid ? "Endpoint is valid." : "Endpoint validation failed.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Base URL</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com"
        />
      </div>
      <div>
        <label className="text-sm font-medium">API Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setApiKeyStored(false);
          }}
          placeholder={apiKeyStored ? "API key saved in keychain" : "sk-..."}
        />
      </div>
      <div>
        <label className="text-sm font-medium">Model</label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o"
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          Save AI Settings
        </Button>
        <Button
          variant="outline"
          onClick={handleValidate}
          disabled={validating}
        >
          {validating ? "Validating..." : "Test Endpoint"}
        </Button>
      </div>
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  const loadAccounts = () => {
    listAccounts().then(setAccounts).catch(console.error);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleRemove = async (id: number) => {
    try {
      await removeAccount(id);
      loadAccounts();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-6">Settings</h2>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AccountList accounts={accounts} onRemove={handleRemove} />
          <AddAccountSection onAccountAdded={loadAccounts} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <AiConfigSection />
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Download,
  FileCode2,
  FileUp,
  FlaskConical,
  Globe2,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  developerApiError,
  formatApiResponse,
  formatDeveloperOutput,
  requiresRequestConfirmation,
  redactApiUrl,
  validateBrowserApiUrl,
} from "@/lib/developer-lab";

type Action = "explain" | "debug" | "refactor" | "tests" | "security" | "document";
type Session = {
  id: string;
  title: string;
  action: Action;
  language: string;
  at: string;
  code: string;
  output: string;
};
type ApiRun = {
  id: string;
  at: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  body: string;
};
const ACTIONS: Array<{ id: Action; label: string; icon: typeof Sparkles }> = [
  { id: "explain", label: "Explain code", icon: CircleHelp },
  { id: "debug", label: "Debug", icon: Activity },
  { id: "refactor", label: "Refactor", icon: WandSparkles },
  { id: "tests", label: "Generate tests", icon: FlaskConical },
  { id: "security", label: "Security review", icon: ShieldCheck },
  { id: "document", label: "Document", icon: FileCode2 },
];
const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "sql",
  "html",
  "css",
  "json",
  "bash",
];
const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sql: "sql",
  html: "html",
  css: "css",
  json: "json",
  sh: "bash",
};
const INITIAL_CODE = `function findUser(users, id) {\n  return users.find((user) => user.id === id);\n}\n`;
const requestKey = (userId: string) => `lord-dev-lab-api:${userId}`;
function readStorage<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
function saveBlob(name: string, content: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function findingsFor(code: string) {
  const matches: Array<{ label: string; line: number }> = [];
  const patterns: Array<[RegExp, string]> = [
    [
      /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/gi,
      "Possible hardcoded credential",
    ],
    [/\beval\s*\(/g, "Dynamic code evaluation"],
    [/\binnerHTML\s*=/g, "HTML inserted without visible sanitization"],
    [
      /\b(?:SELECT|UPDATE|DELETE|INSERT)[\s\S]{0,100}\+\s*\w+/gi,
      "Possible SQL string concatenation",
    ],
  ];
  for (const [pattern, label] of patterns) {
    for (const match of code.matchAll(pattern))
      matches.push({ label, line: code.slice(0, match.index ?? 0).split("\n").length });
  }
  return matches;
}

export const Route = createFileRoute("/_authenticated/developer-lab")({ component: DeveloperLab });

function DeveloperLab() {
  const { user } = useCurrentUser();
  const [code, setCode] = useState(INITIAL_CODE);
  const [language, setLanguage] = useState("typescript");
  const [fileName, setFileName] = useState("untitled.ts");
  const [action, setAction] = useState<Action>("explain");
  const [tab, setTab] = useState<"workspace" | "api">("workspace");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorMessageInput, setErrorMessageInput] = useState("");
  const [environment, setEnvironment] = useState("");
  const [framework, setFramework] = useState("");
  const [history, setHistory] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const [apiMethod, setApiMethod] = useState("GET");
  const [apiUrl, setApiUrl] = useState("");
  const [apiBody, setApiBody] = useState("");
  const [apiResult, setApiResult] = useState<ApiRun | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiHistory, setApiHistory] = useState<ApiRun[]>([]);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; description: string | null }>
  >([]);
  const [projectName, setProjectName] = useState("");
  const [projectLoading, setProjectLoading] = useState(true);
  const [copyDone, setCopyDone] = useState(false);
  const findings = useMemo(() => findingsFor(code), [code]);
  const filteredHistory = history.filter((entry) =>
    `${entry.title} ${entry.action} ${entry.language}`.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!user?.id) return;
    setApiHistory(readStorage<ApiRun>(requestKey(user.id)));
    void authenticatedFetch("/api/developer-lab/history")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load session history.");
        const payload = (await response.json()) as Array<{
          id: string;
          title: string;
          action: Action;
          language: string;
          created_at: string;
          code: string;
          output: string;
        }>;
        if (Array.isArray(payload)) {
          setHistory(payload.map((entry) => ({ ...entry, at: entry.created_at })));
        }
      })
      .catch(() =>
        setError("Session history could not be loaded. You can still use the workspace."),
      );
    void authenticatedFetch("/api/projects/")
      .then(async (response) => {
        if (response.ok) {
          const payload = await response.json();
          const list = Array.isArray(payload)
            ? payload
            : ((payload as { data?: unknown[] }).data ?? []);
          setProjects(list as typeof projects);
        }
      })
      .catch(() => undefined)
      .finally(() => setProjectLoading(false));
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    if (!code.trim() || !LANGUAGES.includes(language)) {
      setHighlighted("");
      return;
    }
    void import("shiki")
      .then(({ codeToHtml }) => codeToHtml(code, { lang: language, theme: "github-dark" }))
      .then((html) => {
        if (active) setHighlighted(html);
      })
      .catch(() => {
        if (active) setHighlighted("");
      });
    return () => {
      active = false;
    };
  }, [code, language]);

  const runAction = async (nextAction = action) => {
    if (!code.trim()) {
      setError("Add code to the editor before requesting an analysis.");
      return;
    }
    if (nextAction === "debug" && !errorMessageInput.trim()) {
      setAction("debug");
      setError(
        "Add the error message or describe the unexpected behavior. You can also include environment details.",
      );
      return;
    }
    setAction(nextAction);
    setBusy(true);
    setError("");
    setOutput("");
    try {
      const response = await authenticatedFetch("/api/developer-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: nextAction,
          code,
          language,
          errorMessage: errorMessageInput || undefined,
          environment: environment || undefined,
          framework: framework || undefined,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(developerApiError(payload));
      const result = formatDeveloperOutput(payload);
      if (!result) throw new Error("LORD returned an empty analysis.");
      setOutput(result.content);
      const historyResponse = await authenticatedFetch("/api/developer-lab/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fileName,
          action: nextAction,
          language,
          code,
          output: result.content,
        }),
      });
      if (!historyResponse.ok)
        throw new Error(
          "Analysis completed, but this session could not be saved to your account history.",
        );
      const entry = (await historyResponse.json()) as Omit<Session, "at"> & {
        created_at: string;
      };
      setHistory((old) => [{ ...entry, at: entry.created_at }, ...old].slice(0, 100));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 200_000) {
      setError("Files must be 200 KB or smaller.");
      return;
    }
    const text = await file.text();
    setCode(text);
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    setLanguage(EXTENSIONS[ext] ?? "plaintext");
    setError("");
    setOutput("");
  };
  const runApiRequest = async () => {
    setApiResult(null);
    const validatedUrl = validateBrowserApiUrl(apiUrl);
    if (!validatedUrl) {
      setError("Enter a valid public HTTP or HTTPS URL without embedded credentials.");
      return;
    }
    const url = validatedUrl;
    if (
      requiresRequestConfirmation(apiMethod) &&
      !window.confirm(
        `Send this DELETE request to ${redactApiUrl(url.toString())}? This may permanently change remote data.`,
      )
    ) {
      return;
    }
    if (!["GET", "HEAD"].includes(apiMethod) && apiBody.trim()) {
      try {
        JSON.parse(apiBody);
      } catch {
        setError("The request body is not valid JSON.");
        return;
      }
    }
    setApiBusy(true);
    setError("");
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: apiMethod,
        ...(apiMethod !== "GET" && apiMethod !== "HEAD"
          ? { headers: { "Content-Type": "application/json" }, body: apiBody || undefined }
          : {}),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const text = formatApiResponse(await response.text());
      const run: ApiRun = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        method: apiMethod,
        url: redactApiUrl(url.toString()),
        status: response.status,
        duration: Math.round(performance.now() - started),
        body: text,
      };
      setApiResult(run);
      const next = [run, ...apiHistory].slice(0, 30);
      setApiHistory(next);
      if (user?.id) localStorage.setItem(requestKey(user.id), JSON.stringify(next));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Network request failed";
      const run: ApiRun = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        method: apiMethod,
        url: redactApiUrl(url.toString()),
        status: 0,
        duration: Math.round(performance.now() - started),
        body: `${message}. The endpoint may reject browser requests because of CORS.`,
      };
      setApiResult(run);
      const next = [run, ...apiHistory].slice(0, 30);
      setApiHistory(next);
      if (user?.id) localStorage.setItem(requestKey(user.id), JSON.stringify(next));
    } finally {
      setApiBusy(false);
    }
  };
  const createProject = async () => {
    if (!projectName.trim()) return;
    const response = await authenticatedFetch("/api/projects/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName.trim(),
        description: "Created in Developer Lab",
        icon: "code",
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(developerApiError(payload));
      return;
    }
    const project =
      (payload as { data?: (typeof projects)[number] }).data ??
      (payload as (typeof projects)[number]);
    setProjects((old) => [project, ...old]);
    setProjectName("");
  };
  const restore = (entry: Session) => {
    setCode(entry.code);
    setLanguage(entry.language);
    setFileName(entry.title);
    setAction(entry.action);
    setOutput(entry.output);
    setTab("workspace");
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              <Code2 className="h-4 w-4" />
              LORD WORKSPACE
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Developer Lab</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Understand, debug, review, and document code with evidence you can trust.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={tab === "workspace" ? "default" : "outline"}
              onClick={() => setTab("workspace")}
            >
              <Braces className="mr-2 h-4 w-4" />
              Code workspace
            </Button>
            <Button variant={tab === "api" ? "default" : "outline"} onClick={() => setTab("api")}>
              <Globe2 className="mr-2 h-4 w-4" />
              API client
            </Button>
          </div>
        </header>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0 space-y-5">
            {tab === "workspace" ? (
              <>
                <Card className="overflow-hidden border-border/70 bg-card/75">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileCode2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="max-w-48 truncate text-sm font-medium">{fileName}</span>
                      <select
                        aria-label="Language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                      >
                        {LANGUAGES.map((lang) => (
                          <option key={lang}>{lang}</option>
                        ))}
                        <option value="plaintext">plaintext (highlighting unavailable)</option>
                      </select>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      <FileUp className="h-3.5 w-3.5" />
                      Import file
                      <input
                        type="file"
                        className="sr-only"
                        accept=".ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.c,.h,.cpp,.cs,.php,.rb,.sql,.html,.css,.json,.sh,.txt"
                        onChange={(e) => void importFile(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <div className="grid min-h-[320px] grid-cols-[42px_minmax(0,1fr)] bg-[#0c111b] font-mono text-[13px] leading-6">
                    <div
                      aria-hidden
                      className="select-none border-r border-white/5 px-2 py-4 text-right text-slate-600"
                    >
                      {code.split("\n").map((_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    <Textarea
                      aria-label="Code input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      spellCheck={false}
                      className="min-h-[320px] resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-100 shadow-none focus-visible:ring-0"
                      placeholder="Paste code or import a source file"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/70 p-3">
                    {ACTIONS.map((item) => (
                      <Button
                        key={item.id}
                        size="sm"
                        variant={action === item.id ? "default" : "outline"}
                        onClick={() => void runAction(item.id)}
                        disabled={busy}
                        className="text-xs"
                      >
                        <item.icon className="mr-1.5 h-3.5 w-3.5" />
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </Card>
                {action === "debug" && (
                  <Card className="grid gap-3 border-amber-500/30 bg-amber-500/5 p-4 sm:grid-cols-2">
                    <label className="text-xs font-medium text-foreground">
                      Error message or unexpected behavior
                      <Textarea
                        value={errorMessageInput}
                        onChange={(e) => setErrorMessageInput(e.target.value)}
                        placeholder="Paste the error and relevant stack trace"
                        className="mt-2 min-h-20 text-sm"
                      />
                    </label>
                    <label className="text-xs font-medium text-foreground">
                      Environment details
                      <Textarea
                        value={environment}
                        onChange={(e) => setEnvironment(e.target.value)}
                        placeholder="Runtime, version, expected behavior…"
                        className="mt-2 min-h-20 text-sm"
                      />
                    </label>
                  </Card>
                )}
                {action === "tests" && (
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-muted-foreground">
                      Test framework{" "}
                      <Input
                        value={framework}
                        onChange={(e) => setFramework(e.target.value)}
                        placeholder="Auto-detect unavailable; e.g. Vitest, pytest"
                        className="mt-1 h-9 w-64 text-sm"
                      />
                    </label>
                    <p className="pt-4 text-xs text-muted-foreground">
                      Name the framework for tests that match your project.
                    </p>
                  </div>
                )}
                {findings.length > 0 && (
                  <Card className="border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      Static code signals{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        (pattern checks, not a security scanner)
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {findings.map((item, i) => (
                        <li key={`${item.label}-${i}`} className="text-sm text-amber-100">
                          Line {item.line}: {item.label}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                {busy && (
                  <Card
                    role="status"
                    className="flex items-center gap-3 p-5 text-sm text-muted-foreground"
                  >
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                    Analyzing with LORD AI… code is not being executed.
                  </Card>
                )}
                {error && (
                  <Card
                    role="alert"
                    className="flex items-start justify-between gap-3 border-destructive/40 p-4 text-sm text-destructive"
                  >
                    <span>{error}</span>
                    <button aria-label="Dismiss error" onClick={() => setError("")}>
                      <X className="h-4 w-4" />
                    </button>
                  </Card>
                )}
                {output && (
                  <Card className="overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
                      <div>
                        <h2 className="font-semibold">
                          {ACTIONS.find((item) => item.id === action)?.label} result
                        </h2>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                          <Sparkles className="h-3.5 w-3.5" />
                          AI suggestion · No code executed
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard.writeText(output);
                            setCopyDone(true);
                            setTimeout(() => setCopyDone(false), 1500);
                          }}
                        >
                          {copyDone ? (
                            <Check className="mr-1.5 h-4 w-4" />
                          ) : (
                            <Copy className="mr-1.5 h-4 w-4" />
                          )}
                          {copyDone ? "Copied" : "Copy"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            saveBlob(`${action}-suggestion.md`, output, "text/markdown")
                          }
                        >
                          <Download className="mr-1.5 h-4 w-4" />
                          Export
                        </Button>
                      </div>
                    </div>
                    <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 text-sm leading-6 text-foreground">
                      {output}
                    </pre>
                  </Card>
                )}
                {!output && !busy && (
                  <Card className="flex min-h-36 flex-col items-center justify-center p-6 text-center">
                    <Sparkles className="mb-2 h-6 w-6 text-primary" />
                    <h2 className="text-sm font-semibold">Choose a code action to get started</h2>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">
                      AI results are suggestions. Test, type-check, lint, build, and execution
                      results are not run from this workspace.
                    </p>
                  </Card>
                )}
                {highlighted && (
                  <details className="rounded-lg border border-border/70 bg-card/50">
                    <summary className="cursor-pointer px-4 py-3 text-xs text-muted-foreground">
                      Syntax-highlighted preview · {language}
                    </summary>
                    <div
                      className="max-h-80 overflow-auto p-4 text-xs"
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  </details>
                )}
              </>
            ) : (
              <ApiClient
                method={apiMethod}
                setMethod={setApiMethod}
                url={apiUrl}
                setUrl={setApiUrl}
                body={apiBody}
                setBody={setApiBody}
                result={apiResult}
                busy={apiBusy}
                run={runApiRequest}
                history={apiHistory}
                restore={setApiResult}
                error={error}
              />
            )}
          </section>
          <aside className="space-y-5">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Projects</h2>
                  <p className="text-xs text-muted-foreground">Your LORD workspace projects</p>
                </div>
                <Code2 className="h-4 w-4 text-primary" />
              </div>
              <form
                className="mb-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createProject();
                }}
              >
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="New project name"
                  className="h-9 text-sm"
                />
                <Button size="icon" aria-label="Create project" disabled={!projectName.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </form>
              {projectLoading ? (
                <p className="text-xs text-muted-foreground">Loading projects…</p>
              ) : projects.length ? (
                <div className="space-y-1">
                  {projects.slice(0, 5).map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
                    >
                      <Code2 className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{project.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">
                  Create a project to start organizing your development work.
                </p>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Recent sessions</h2>
                  <p className="text-xs text-muted-foreground">
                    Saved in this browser for your account
                  </p>
                </div>
                <Clock3 className="h-4 w-4 text-primary" />
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search history"
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <div className="max-h-[320px] space-y-1 overflow-auto">
                {filteredHistory.length ? (
                  filteredHistory.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => restore(entry)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{entry.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {entry.action} · {entry.language}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                ) : (
                  <p className="py-5 text-center text-xs text-muted-foreground">
                    {query ? "No matching sessions" : "Your completed analyses appear here."}
                  </p>
                )}
              </div>
            </Card>
            <Card className="border-primary/20 bg-primary/[0.035] p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Execution & checks
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                No code is executed here. This workspace has no audited sandbox. AI output and local
                pattern signals are labeled separately; project test, type-check, lint, and build
                commands are not run.
              </p>
            </Card>
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <Activity className="h-4 w-4 text-primary" />
                Project health
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Health checks need an authorized repository connection, which is not configured in
                this workspace. Import a file for analysis; test and build status remains
                unverified.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Tests", "Type check", "Lint", "Build"].map((name) => (
                  <span
                    key={name}
                    className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"
                  >
                    Not run · {name}
                  </span>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

function ApiClient({
  method,
  setMethod,
  url,
  setUrl,
  body,
  setBody,
  result,
  busy,
  run,
  history,
  restore,
  error,
}: {
  method: string;
  setMethod: (value: string) => void;
  url: string;
  setUrl: (value: string) => void;
  body: string;
  setBody: (value: string) => void;
  result: ApiRun | null;
  busy: boolean;
  run: () => void;
  history: ApiRun[];
  restore: (run: ApiRun) => void;
  error: string;
}) {
  return (
    <div className="space-y-5">
      {error && (
        <Card
          role="alert"
          className="flex items-start justify-between gap-3 border-destructive/40 p-4 text-sm text-destructive"
        >
          <span>{error}</span>
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="border-b border-border/70 p-4">
          <h2 className="font-semibold">HTTP request builder</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Requests run from your browser. Target availability and CORS policy are controlled by
            the endpoint.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="HTTP method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm sm:w-32"
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/v1/resource"
              aria-label="Request URL"
              className="h-10 flex-1 font-mono text-sm"
            />
            <Button onClick={run} disabled={busy}>
              {busy ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Globe2 className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </div>
          {!["GET", "HEAD"].includes(method) && (
            <label className="block text-xs font-medium">
              JSON request body
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'{\n  "key": "value"\n}'}
                className="mt-2 min-h-36 font-mono text-xs"
              />
            </label>
          )}
        </div>
      </Card>
      {result && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-4">
            <h2 className="font-semibold">Response</h2>
            <div className="flex items-center gap-3 text-xs">
              <span
                className={
                  result.status >= 200 && result.status < 400
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                {result.status || "Network error"}
              </span>
              <span className="text-muted-foreground">{result.duration} ms</span>
              <span className="text-muted-foreground">{result.method}</span>
            </div>
          </div>
          <p className="break-all px-4 pt-3 font-mono text-xs text-muted-foreground">
            {result.url}
          </p>
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap p-4 text-xs leading-5">
            {result.body || "(empty response)"}
          </pre>
        </Card>
      )}
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Request history</h2>
        {history.length ? (
          <div className="space-y-1">
            {history.slice(0, 10).map((entry) => (
              <button
                key={entry.id}
                onClick={() => restore(entry)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
              >
                <span className="w-14 shrink-0 text-xs font-semibold">{entry.status || "ERR"}</span>
                <span className="w-14 shrink-0 text-[10px] text-muted-foreground">
                  {entry.method}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.url}</span>
                <span className="text-[10px] text-muted-foreground">{entry.duration}ms</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Requests you send will be listed here.
          </p>
        )}
      </Card>
      <Card className="flex gap-3 border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-5 text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        Browser requests may fail when an API blocks cross-origin requests. This client does not
        forward your API keys, add authorization headers, or proxy requests through LORD servers.
      </Card>
    </div>
  );
}

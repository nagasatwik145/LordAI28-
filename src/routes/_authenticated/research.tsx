import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Search, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/lord/AppShell";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Source = {
  id: string;
  title: string;
  url: string;
  domain?: string;
  publishedDate?: string;
  retrievedAt: string;
  verification?: string;
  content: string;
};
type Result = {
  id: string;
  status: string;
  report: string;
  queries: string[];
  sources: Source[];
  searchFailures: number;
};
type Project = { id: string; name: string };

export const Route = createFileRoute("/_authenticated/research")({
  head: () => ({ meta: [{ title: "LORD — Deep Research" }] }),
  component: DeepResearchPage,
});

function DeepResearchPage() {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [preferences, setPreferences] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [methodology, setMethodology] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void authenticatedFetch("/api/projects")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: unknown) => {
        if (active && Array.isArray(data))
          setProjects(
            data.filter((item): item is Project =>
              Boolean(item && typeof item === "object" && "id" in item && "name" in item),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function research(query = question) {
    setBusy(true);
    setError("");
    setResult(null);
    setStatus("Planning focused research questions…");
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 75_000);
    try {
      setStatus("Searching the web and retrieving accessible source pages…");
      const response = await authenticatedFetch("/api/research", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: query,
          scope,
          dateRange,
          ...(projectId ? { projectId } : {}),
          sourcePreferences: preferences
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Research could not be completed.");
      setStatus("Comparing evidence and preparing the report…");
      setResult(data as Result);
      setStatus(
        data.status === "complete" ? "Research report ready" : "Partial research report ready",
      );
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "AbortError"
          ? "Research timed out or was cancelled. Try a narrower question."
          : cause instanceof Error
            ? cause.message
            : "Research failed.",
      );
      setStatus("");
    } finally {
      window.clearTimeout(timeout);
      activeRequest.current = null;
      setBusy(false);
    }
  }

  function exportMarkdown() {
    if (!result) return;
    const sources = result.sources
      .map(
        (source) =>
          `- [${source.title}](${source.url}) — ${source.domain ?? ""}${source.publishedDate ? ` · Published ${source.publishedDate}` : ""} · ${source.verification === "page" ? "page accessed" : "snippet only; page unavailable"}`,
      )
      .join("\n");
    const blob = new Blob(
      [`${linkCitations(result.report, result.sources)}\n\n## Sources\n${sources}\n`],
      {
        type: "text/markdown",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lord-deep-research.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function linkCitations(report: string, sources: Source[]) {
    return report.replace(/\[S(\d+)\]/g, (citation, index: string) => {
      const source = sources[Number(index) - 1];
      return source?.verification === "page" ? `[${citation}](<${source.url}>)` : "";
    });
  }

  function verifyClaim() {
    const claim = window.prompt("Which finding should LORD verify?");
    if (claim?.trim()) void research(`Verify this claim: ${claim.trim()}`);
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <header>
          <div className="flex items-center gap-3">
            <Search className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">LORD Deep Research</h1>
              <p className="text-sm text-muted-foreground">
                Evidence-backed reports with source access and uncertainty disclosed.
              </p>
            </div>
          </div>
        </header>
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <label className="block text-sm font-medium" htmlFor="research-question">
            Research question
          </label>
          <textarea
            id="research-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="What would you like LORD to investigate?"
            className="w-full rounded-md border bg-background p-3"
          />
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="Scope (optional)"
              className="rounded-md border bg-background p-2"
            />
            <input
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value)}
              placeholder="Date range (optional)"
              className="rounded-md border bg-background p-2"
            />
            <input
              value={preferences}
              onChange={(event) => setPreferences(event.target.value)}
              placeholder="Preferred sources/domains, comma separated"
              className="rounded-md border bg-background p-2"
            />
            {projects.length > 0 && (
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="rounded-md border bg-background p-2"
              >
                <option value="">Save to private research only</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            disabled={busy || question.trim().length < 5}
            onClick={() => void research()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "Researching…" : "Start research"}
          </button>
          {busy && (
            <button
              onClick={() => activeRequest.current?.abort()}
              className="ml-3 text-sm underline"
            >
              Cancel
            </button>
          )}
          {status && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />{" "}
                {result.status === "complete"
                  ? "Evidence retrieved"
                  : "Partial research — some evidence was inaccessible or unavailable"}{" "}
                · {result.sources.filter((source) => source.verification === "page").length}/
                {result.sources.length} pages accessed
              </span>
              <button
                onClick={exportMarkdown}
                className="inline-flex items-center gap-2 rounded border px-3 py-1.5"
              >
                <Download className="h-4 w-4" />
                Export Markdown
              </button>
            </div>
            <article className="prose prose-sm max-w-none rounded-xl border bg-card p-5 dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  ),
                }}
              >
                {linkCitations(result.report, result.sources)}
              </ReactMarkdown>
            </article>
            <details
              open={methodology}
              onToggle={(event) => setMethodology(event.currentTarget.open)}
              className="rounded-xl border bg-card p-4"
            >
              <summary className="cursor-pointer font-medium">Methodology and evidence</summary>
              <p className="mt-3 text-sm text-muted-foreground">
                Queries were bounded to three and results to five per query. Retrieved page text was
                treated as untrusted evidence. Snippets and inaccessible pages were excluded from
                factual support. Research may be incomplete.
              </p>
              <p className="text-sm">
                <strong>Search queries:</strong> {result.queries.join(" · ") || "Question only"}
              </p>
              <div className="mt-3 space-y-3">
                {result.sources.map((source) => (
                  <div key={source.id} className="rounded-lg border p-3">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline"
                    >
                      [{source.id}] {source.title}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {source.domain} ·{" "}
                      {source.publishedDate
                        ? `Published ${source.publishedDate} · `
                        : "Publication date unavailable · "}
                      {source.verification === "page"
                        ? "Page accessed"
                        : "Page unavailable; snippet only"}{" "}
                      · Retrieved {new Date(source.retrievedAt).toLocaleString()}
                    </p>
                    <button onClick={verifyClaim} className="mt-2 text-xs underline">
                      Verify this claim
                    </button>
                    {source.verification === "page" && (
                      <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">
                        {source.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </main>
    </AppShell>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Workflow,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { loadStudioJson } from "@/lib/anything-studio-client";
import {
  buildSandboxedWebsitePreview,
  STUDIO_DELIVERABLES,
  STUDIO_DELIVERABLE_DEFINITIONS,
  StudioSpecSchema,
  type StudioDeliverableType,
  type StudioValidation,
} from "@/lib/anything-studio";
import { createGameZip } from "@/lib/games/game-export";
import { validateGameSpec } from "@/lib/games/game-runtime";
import { cn } from "@/lib/utils";

const SearchSchema = z.object({ projectId: z.string().optional() }).catch({});
const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().optional(),
  icon: z.string().optional(),
});
const VersionSchema = z.object({
  id: z.string(),
  revision: z.number(),
  content: z.string(),
  validation: z.unknown(),
  created_at: z.string(),
});
const ArtifactSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: z.enum(STUDIO_DELIVERABLES),
  title: z.string(),
  file_name: z.string(),
  mime_type: z.string(),
  status: z.enum(["pending", "generating", "completed", "failed", "stale"]),
  content: z.string(),
  dependencies: z.array(z.string()),
  validation: z.unknown(),
  revision: z.number(),
  generation_model: z.string().nullable(),
  versions: z.array(VersionSchema),
});
const BundleSchema = z.object({
  project: ProjectSchema,
  studio: z.object({
    project_id: z.string(),
    goal: z.string(),
    spec: StudioSpecSchema,
    status: z.string(),
  }),
  artifacts: z.array(ArtifactSchema),
});
const StudioListSchema = z.object({
  projects: z.array(
    z.object({
      project_id: z.string(),
      goal: z.string(),
      status: z.string(),
      project: ProjectSchema.nullable(),
      updated_at: z.string(),
    }),
  ),
});

type StudioBundle = z.infer<typeof BundleSchema>;
type StudioArtifact = StudioBundle["artifacts"][number];
type StudioListItem = z.infer<typeof StudioListSchema>["projects"][number];
async function requestJson<T>(body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await authenticatedFetch("/api/anything-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ message: z.string().optional() }).optional() })
      .safeParse(payload);
    throw new Error(
      (error.success ? error.data.error?.message : undefined) ?? "Studio request failed.",
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error("LORD returned an invalid Studio response.");
  return parsed.data;
}

function validationOf(value: unknown): StudioValidation {
  const parsed = z
    .object({
      valid: z.boolean(),
      checks: z.array(z.object({ name: z.string(), passed: z.boolean(), message: z.string() })),
    })
    .safeParse(value);
  return parsed.success ? parsed.data : { valid: false, checks: [] };
}

function statusLabel(status: StudioArtifact["status"]) {
  return status === "stale" ? "Needs refresh" : status;
}

function saveBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function downloadArtifact(artifact: StudioArtifact, projectGoal: string) {
  if (artifact.kind === "game") {
    let spec: unknown;
    try {
      spec = JSON.parse(artifact.content);
    } catch {
      throw new Error("The game specification is not valid JSON.");
    }
    if (!validateGameSpec(spec))
      throw new Error("This game spec is not supported by the LORD exporter.");
    const archive = await createGameZip(spec, projectGoal);
    saveBlob(`${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`, archive);
    return;
  }
  if (artifact.kind === "image") {
    const response = await fetch(artifact.content);
    if (!response.ok) throw new Error("Could not download this image asset.");
    const blob = await response.blob();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    saveBlob(artifact.file_name.replace(/\.[^.]+$/, `.${extension}`), blob);
    return;
  }
  saveBlob(
    artifact.file_name,
    new Blob([artifact.content], { type: `${artifact.mime_type};charset=utf-8` }),
  );
}

export const Route = createFileRoute("/_authenticated/anything-studio")({
  validateSearch: SearchSchema,
  head: () => ({
    meta: [
      { title: "LORD — Anything Studio" },
      { name: "description", content: "Create related project deliverables from one shared spec." },
    ],
  }),
  component: AnythingStudioPage,
});

function AnythingStudioPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const projectId = search.projectId ?? "";
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<StudioDeliverableType[]>([
    "website",
    "project_plan",
    "source_code",
    "test_cases",
    "launch_checklist",
    "user_documentation",
  ]);
  const [editContent, setEditContent] = useState("");
  const [renamedProject, setRenamedProject] = useState("");
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const projectListQuery = useQuery({
    queryKey: ["anything-studio", "projects"],
    queryFn: ({ signal }) => loadStudioJson("/api/anything-studio", StudioListSchema, signal),
    retry: false,
  });
  const bundleQuery = useQuery({
    queryKey: ["anything-studio", projectId],
    enabled: !!projectId,
    queryFn: ({ signal }) =>
      loadStudioJson(
        `/api/anything-studio?projectId=${encodeURIComponent(projectId)}`,
        BundleSchema,
        signal,
      ),
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: () =>
      requestJson(
        { action: "create", name: name.trim(), goal: goal.trim(), deliverables: selectedTypes },
        BundleSchema,
      ),
    onSuccess: async (bundle) => {
      await queryClient.invalidateQueries({ queryKey: ["anything-studio", "projects"] });
      setGoal("");
      setName("");
      await navigate({ search: { projectId: bundle.project.id } });
    },
    onError: (error) =>
      toast.error("Could not create the project specification", {
        description: error instanceof Error ? error.message : "Please retry.",
      }),
  });

  const projects = useMemo(
    () => projectListQuery.data?.projects ?? [],
    [projectListQuery.data?.projects],
  );
  const bundle = bundleQuery.data;
  const artifacts = useMemo(() => bundle?.artifacts ?? [], [bundle?.artifacts]);
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === activePreview) ?? artifacts[0];
  const completedCount = artifacts.filter((artifact) => artifact.status === "completed").length;
  const selectedArtifactIds = useMemo(
    () => new Set(artifacts.map((artifact) => artifact.id)),
    [artifacts],
  );

  useEffect(() => {
    if (!search.projectId && projects[0]?.project_id) {
      void navigate({ search: { projectId: projects[0].project_id }, replace: true });
    }
  }, [navigate, projects, search.projectId]);

  useEffect(() => {
    setRenamedProject(bundle?.project.name ?? "");
  }, [bundle?.project.id, bundle?.project.name]);

  useEffect(() => {
    setEditContent(selectedArtifact?.content ?? "");
  }, [selectedArtifact?.content, selectedArtifact?.id, selectedArtifact?.revision]);

  const refreshBundle = async (next: StudioBundle) => {
    queryClient.setQueryData(["anything-studio", next.project.id], next);
    await queryClient.invalidateQueries({ queryKey: ["anything-studio", "projects"] });
  };

  const generateOne = async (artifact: StudioArtifact) => {
    setBusy(artifact.id);
    try {
      const next = await requestJson(
        { action: "generate", projectId, artifactId: artifact.id },
        BundleSchema,
      );
      await refreshBundle(next);
      toast.success(`${artifact.title} is ready`);
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ["anything-studio", projectId] });
      toast.error(`Could not generate ${artifact.title}`, {
        description: error instanceof Error ? error.message : "Review the deliverable and retry.",
      });
    } finally {
      setBusy(null);
    }
  };

  const generateAll = async () => {
    if (!bundle) return;
    setBusy("all");
    let current = bundle;
    const remaining = new Set(
      current.artifacts
        .filter((artifact) => artifact.status !== "completed")
        .map((artifact) => artifact.id),
    );
    try {
      while (remaining.size) {
        const ready = current.artifacts.find(
          (artifact) =>
            remaining.has(artifact.id) &&
            artifact.dependencies.every(
              (dependencyId) =>
                !selectedArtifactIds.has(dependencyId) ||
                current.artifacts.find((dependency) => dependency.id === dependencyId)?.status ===
                  "completed",
            ),
        );
        if (!ready) {
          throw new Error("No remaining deliverable is ready. Check dependency statuses.");
        }
        current = await requestJson(
          { action: "generate", projectId, artifactId: ready.id },
          BundleSchema,
        );
        remaining.delete(ready.id);
        queryClient.setQueryData(["anything-studio", projectId], current);
        await queryClient.invalidateQueries({ queryKey: ["anything-studio", "projects"] });
        if (
          current.artifacts.find((artifact) => artifact.id === ready.id)?.status !== "completed"
        ) {
          throw new Error(`${ready.title} did not pass validation.`);
        }
      }
      toast.success("All selected deliverables are validated");
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ["anything-studio", projectId] });
      toast.error("Generation stopped", {
        description: error instanceof Error ? error.message : "Retry the failed deliverable.",
      });
    } finally {
      setBusy(null);
    }
  };

  const saveArtifact = async () => {
    if (!bundle || !selectedArtifact) return;
    setBusy("save");
    try {
      const next = await requestJson(
        {
          action: "update-artifact",
          projectId,
          artifactId: selectedArtifact.id,
          content: editContent,
        },
        BundleSchema,
      );
      await refreshBundle(next);
      toast.success("Deliverable saved as a new revision");
    } catch (error) {
      toast.error("Could not save this revision", {
        description: error instanceof Error ? error.message : "Check the validation rules.",
      });
    } finally {
      setBusy(null);
    }
  };

  const runProjectAction = async (action: "rename" | "duplicate") => {
    if (!bundle) return;
    setBusy(action);
    try {
      if (action === "rename") {
        await requestJson(
          { action, projectId, name: renamedProject },
          z.object({ project: ProjectSchema }),
        );
        await queryClient.invalidateQueries({ queryKey: ["anything-studio"] });
        toast.success("Project renamed");
      } else {
        const copy = await requestJson({ action, projectId }, BundleSchema);
        await queryClient.invalidateQueries({ queryKey: ["anything-studio", "projects"] });
        await navigate({ search: { projectId: copy.project.id } });
        toast.success("Project duplicated");
      }
    } catch (error) {
      toast.error("Could not update this project", {
        description: error instanceof Error ? error.message : "Please retry.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (artifact: StudioArtifact) => {
    try {
      await downloadArtifact(artifact, bundle?.studio.goal ?? "");
    } catch (error) {
      toast.error("Download failed", {
        description: error instanceof Error ? error.message : "Could not prepare this file.",
      });
    }
  };

  const toggleDeliverable = (kind: StudioDeliverableType) => {
    setSelectedTypes((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6 px-1 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-primary">
              <Sparkles className="h-4 w-4" /> LORD Anything Studio
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              One spec. Related outputs.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Describe a project, review its shared specification, then generate and revise only the
              deliverables you need.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/mind-graph">
                <Workflow className="mr-2 h-4 w-4" /> Mind Graph
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.7fr)]">
          <aside className="space-y-6">
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-white">
                  <Plus className="h-4 w-4" /> Start a project
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  LORD writes and saves the project spec first. Deliverables stay pending until you
                  generate them.
                </p>
              </div>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="Project name"
                aria-label="Project name"
              />
              <Textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                maxLength={4000}
                placeholder="Describe what you want to create, who it is for, and any important constraints."
                aria-label="Project description"
                className="min-h-28"
              />
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Choose deliverables</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {STUDIO_DELIVERABLES.map((kind) => {
                    const definition = STUDIO_DELIVERABLE_DEFINITIONS[kind];
                    const selected = selectedTypes.includes(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleDeliverable(kind)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          selected
                            ? "border-primary/60 bg-primary/10"
                            : "border-border/70 hover:border-primary/40",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                          {definition.label}
                          {selected && <Check className="h-4 w-4 text-primary" />}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {definition.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Image generation requires the configured image provider. Game exports use the
                  compatible LORD game engine; no APK or deployment is produced.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => createMutation.mutate()}
                disabled={
                  createMutation.isPending ||
                  !name.trim() ||
                  goal.trim().length < 3 ||
                  selectedTypes.length === 0
                }
              >
                {createMutation.isPending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Generate project specification
              </Button>
            </Card>

            <Card className="space-y-3 p-5">
              <h2 className="font-semibold text-white">Saved Studio projects</h2>
              {projectListQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading projects…</p>
              ) : projectListQuery.isError ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{projectListQuery.error.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void projectListQuery.refetch()}
                    disabled={projectListQuery.isFetching}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${projectListQuery.isFetching ? "animate-spin" : ""}`}
                    />
                    {projectListQuery.isFetching ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              ) : projects.length ? (
                <div className="space-y-2">
                  {projects.map((item: StudioListItem) => (
                    <button
                      key={item.project_id}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left",
                        item.project_id === projectId
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/70 hover:bg-muted/40",
                      )}
                      onClick={() => void navigate({ search: { projectId: item.project_id } })}
                    >
                      <span className="block truncate text-sm font-medium text-white">
                        {item.project?.name ?? "Untitled project"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {item.goal}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your saved projects will appear here.
                </p>
              )}
            </Card>
          </aside>

          <section className="min-w-0 space-y-6">
            {bundleQuery.isLoading ? (
              <Card className="flex min-h-64 items-center justify-center">
                <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
              </Card>
            ) : bundleQuery.isError ? (
              <Card className="space-y-3 p-6 text-sm text-destructive">
                <p>{bundleQuery.error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void bundleQuery.refetch()}
                  disabled={bundleQuery.isFetching}
                  className="text-foreground"
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${bundleQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  {bundleQuery.isFetching ? "Retrying…" : "Retry"}
                </Button>
              </Card>
            ) : bundle ? (
              <>
                <Card className="space-y-5 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                        <span className="rounded-full bg-primary/15 px-2 py-1 text-primary">
                          Specification ready
                        </span>
                        {completedCount}/{artifacts.length} deliverables validated
                      </div>
                      <h2 className="text-2xl font-semibold text-white">{bundle.project.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {bundle.studio.spec.summary}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={generateAll}
                      disabled={
                        busy !== null || artifacts.every((item) => item.status === "completed")
                      }
                    >
                      {busy === "all" ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Generate ready items
                    </Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <SpecList title="Audience" items={[bundle.studio.spec.audience]} />
                    <SpecList title="Goals" items={bundle.studio.spec.goals} />
                    <SpecList title="Features" items={bundle.studio.spec.features} />
                    <SpecList
                      title="Design & architecture"
                      items={[bundle.studio.spec.design, bundle.studio.spec.architecture]}
                    />
                  </div>

                  <div className="flex flex-wrap items-end gap-2 border-t border-border/70 pt-4">
                    <div className="min-w-48 flex-1">
                      <label
                        htmlFor="studio-project-name"
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Project name
                      </label>
                      <Input
                        id="studio-project-name"
                        value={renamedProject}
                        onChange={(event) => setRenamedProject(event.target.value)}
                        maxLength={120}
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => runProjectAction("rename")}
                      disabled={
                        busy !== null ||
                        !renamedProject.trim() ||
                        renamedProject === bundle.project.name
                      }
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => runProjectAction("duplicate")}
                      disabled={busy !== null}
                    >
                      <Copy className="mr-2 h-4 w-4" /> Duplicate
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This project is also available in{" "}
                    <Link to="/projects" className="underline">
                      Projects
                    </Link>{" "}
                    and
                    <Link to="/mind-graph" className="ml-1 underline">
                      Mind Graph
                    </Link>
                    .
                  </p>
                </Card>

                <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
                  <Card className="min-w-0 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-white">Deliverables</h3>
                      <span className="text-xs text-muted-foreground">
                        {artifacts.length} selected
                      </span>
                    </div>
                    <div className="space-y-2">
                      {artifacts.map((artifact) => {
                        const ready = artifact.dependencies.every(
                          (dependencyId) =>
                            !selectedArtifactIds.has(dependencyId) ||
                            artifacts.find((dependency) => dependency.id === dependencyId)
                              ?.status === "completed",
                        );
                        return (
                          <div
                            key={artifact.id}
                            className={cn(
                              "rounded-lg border p-3",
                              selectedArtifact?.id === artifact.id
                                ? "border-primary/50 bg-primary/5"
                                : "border-border/70",
                            )}
                          >
                            <button
                              className="w-full text-left"
                              onClick={() => setActivePreview(artifact.id)}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium text-white">
                                  {artifact.title}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] capitalize",
                                    artifact.status === "completed"
                                      ? "bg-emerald-500/15 text-emerald-300"
                                      : artifact.status === "failed"
                                        ? "bg-destructive/15 text-destructive"
                                        : artifact.status === "stale"
                                          ? "bg-amber-500/15 text-amber-200"
                                          : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {statusLabel(artifact.status)}
                                </span>
                              </span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">
                                {artifact.file_name} · revision {artifact.revision}
                              </span>
                            </button>
                            {artifact.dependencies.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {artifact.dependencies.map((id) => {
                                  const dependency = artifacts.find((item) => item.id === id);
                                  return (
                                    <span
                                      key={id}
                                      className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                                    >
                                      Depends on {dependency?.title ?? "another deliverable"}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <div className="mt-3 flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void generateOne(artifact)}
                                disabled={
                                  busy !== null || !ready || artifact.status === "generating"
                                }
                              >
                                {busy === artifact.id ? (
                                  <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : artifact.status === "completed" ? (
                                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                ) : (
                                  <Play className="mr-1 h-3.5 w-3.5" />
                                )}
                                {artifact.status === "completed" ? "Regenerate" : "Generate"}
                              </Button>
                              {artifact.status === "completed" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void handleDownload(artifact)}
                                >
                                  <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Download
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  <Card className="min-w-0 space-y-4 p-4">
                    {selectedArtifact ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-white">{selectedArtifact.title}</h3>
                            <p className="text-xs text-muted-foreground">
                              {selectedArtifact.file_name} · {selectedArtifact.mime_type}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={saveArtifact}
                              disabled={busy !== null || editContent === selectedArtifact.content}
                            >
                              {busy === "save" ? (
                                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-1 h-4 w-4" />
                              )}
                              Save revision
                            </Button>
                            {selectedArtifact.status === "completed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleDownload(selectedArtifact)}
                              >
                                <ArrowDownToLine className="mr-1 h-4 w-4" /> Download
                              </Button>
                            )}
                          </div>
                        </div>

                        {selectedArtifact.kind === "website" && selectedArtifact.content ? (
                          <div className="overflow-hidden rounded-lg border border-border">
                            <iframe
                              title={`${selectedArtifact.title} preview`}
                              srcDoc={buildSandboxedWebsitePreview(selectedArtifact.content)}
                              sandbox=""
                              className="h-80 w-full bg-white"
                            />
                          </div>
                        ) : selectedArtifact.kind === "image" && selectedArtifact.content ? (
                          <div className="flex min-h-48 items-center justify-center rounded-lg border border-border bg-black/20 p-3">
                            <img
                              src={selectedArtifact.content}
                              alt={bundle.studio.spec.name}
                              className="max-h-80 max-w-full rounded object-contain"
                            />
                          </div>
                        ) : selectedArtifact.kind === "game" && selectedArtifact.content ? (
                          <div className="rounded-lg border border-border bg-muted/30 p-4">
                            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
                              <FileCode2 className="h-4 w-4" /> Compatible game specification
                            </p>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                              {selectedArtifact.content}
                            </pre>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Download the ZIP to run the compatible game locally. It has not been
                              deployed.
                            </p>
                          </div>
                        ) : (
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-black/20 p-4 text-xs text-muted-foreground">
                            {selectedArtifact.content || "Generate this deliverable to preview it."}
                          </pre>
                        )}

                        {selectedArtifact.content && selectedArtifact.kind !== "image" && (
                          <details className="rounded-lg border border-border/70">
                            <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-white">
                              <Pencil className="h-4 w-4" /> Edit deliverable
                              <ChevronDown className="ml-auto h-4 w-4" />
                            </summary>
                            <div className="space-y-3 border-t border-border/70 p-3">
                              <Textarea
                                aria-label={`Edit ${selectedArtifact.title}`}
                                className="min-h-52 font-mono text-xs"
                                value={editContent}
                                onChange={(event) => setEditContent(event.target.value)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Saving validates this file, creates a revision, and marks dependent
                                deliverables as needing refresh without regenerating them.
                              </p>
                            </div>
                          </details>
                        )}

                        <div className="rounded-lg border border-border/70 p-3">
                          <h4 className="mb-2 text-sm font-medium text-white">Validation</h4>
                          {validationOf(selectedArtifact.validation).checks.length ? (
                            <ul className="space-y-1">
                              {validationOf(selectedArtifact.validation).checks.map((check) => (
                                <li key={check.name} className="flex items-start gap-2 text-xs">
                                  {check.passed ? (
                                    <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
                                  ) : (
                                    <span className="mt-0.5 text-destructive">!</span>
                                  )}
                                  <span
                                    className={
                                      check.passed ? "text-muted-foreground" : "text-destructive"
                                    }
                                  >
                                    {check.message}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Validation runs before a deliverable is marked complete.
                            </p>
                          )}
                        </div>

                        {selectedArtifact.versions.length > 0 && (
                          <details className="rounded-lg border border-border/70">
                            <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-white">
                              Revision history ({selectedArtifact.versions.length})
                              <ChevronUp className="ml-auto h-4 w-4" />
                            </summary>
                            <div className="space-y-2 border-t border-border/70 p-3">
                              {selectedArtifact.versions.map((version) => (
                                <div
                                  key={version.id}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="text-xs text-muted-foreground">
                                    Revision {version.revision} ·{" "}
                                    {new Date(version.created_at).toLocaleString()}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditContent(version.content)}
                                  >
                                    Restore to editor
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </>
                    ) : (
                      <div className="grid min-h-64 place-items-center text-center text-sm text-muted-foreground">
                        Choose a deliverable to preview and revise it.
                      </div>
                    )}
                  </Card>
                </div>
              </>
            ) : (
              <Card className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                <Sparkles className="h-8 w-8 text-primary" />
                <h2 className="text-lg font-semibold text-white">Your workspace is ready</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  Create a project to generate a shared specification before any output is made.
                </p>
              </Card>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function SpecList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm text-white">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

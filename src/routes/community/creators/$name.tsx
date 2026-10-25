import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";

type PublicWork = { slug: string; creator_slug: string; title: string; description: string; category: string; tags: string[]; helpful_count: number };
export const Route = createFileRoute("/community/creators/$name")({ component: CreatorPage });
function CreatorPage() {
  const { name } = Route.useParams();
  const query = useQuery({ queryKey: ["community-creator", name], queryFn: async () => { const res = await fetch(`/api/community/creators/${encodeURIComponent(name)}`); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "Creator unavailable."); return data as {creator:string; creations:PublicWork[]}; }, retry: false });
  return <main className="min-h-screen bg-background px-4 py-10 text-foreground"><div className="mx-auto max-w-5xl"><Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16}/> LORD AI</Link>{query.isLoading ? <Card className="p-10 text-center text-muted-foreground">Loading creator…</Card> : query.isError ? <Card className="p-10 text-center text-muted-foreground">This creator profile is unavailable.</Card> : <><div className="mb-8"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-cyan-300"><Sparkles size={15}/> CREATOR PROFILE</p><h1 className="text-4xl font-bold">{query.data?.creator}</h1><p className="mt-2 text-sm text-muted-foreground">Published creations · {query.data?.creations.length ?? 0}</p></div>{!query.data?.creations.length ? <Card className="p-10 text-center text-muted-foreground">No published creations are available.</Card> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{query.data.creations.map(item => <Link key={item.slug} to="/community/$slug" params={{slug:item.slug}}><Card className="h-full p-5 transition-colors hover:border-cyan-300/30"><span className="text-xs capitalize text-cyan-200">{item.category}</span><h2 className="mt-2 text-xl font-semibold">{item.title}</h2><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.description}</p><p className="mt-4 text-xs text-muted-foreground">{item.helpful_count} helpful</p></Card></Link>)}</div>}</>}</div></main>;
}

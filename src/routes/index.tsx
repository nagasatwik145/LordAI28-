import { createFileRoute } from "@tanstack/react-router";
import { ExperiencePage } from "./experience";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Experience LORD AI — Intelligence Beyond Assistance" },
      {
        name: "description",
        content:
          "Explore LORD AI's chat, voice, learning, planning, creation, and productivity spaces.",
      },
    ],
  }),
  component: ExperiencePage,
});

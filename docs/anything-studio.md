# LORD Anything Studio

Anything Studio creates a LORD project from one saved specification, then generates selected deliverables against that specification. Project and artifact operations go through authenticated server routes and are scoped to the current user's existing `projects` records.

## Supported outputs

- Static HTML website prototype with a sandboxed preview.
- Markdown project plan, launch checklist, and user guide.
- TypeScript starter source and Markdown test scenarios.
- Game specification validated by LORD's game schemas and exported with the existing game ZIP exporter.
- Image asset generated and persisted with the configured LORD image provider.

Deliverables are validated before being marked complete. Code and test-case files receive structural checks but are not executed automatically. Revisions are saved independently; editing or regenerating an upstream deliverable marks only its dependents as needing refresh. Generation does not deploy a website or build an APK.

## Configuration and rollout

1. Apply `supabase/migrations/20261024030000_anything_studio.sql` to the LORD Supabase project. The migration adds the project specification, deliverable, and revision tables with owner policies. The application's typed Supabase schema includes the new tables.
2. Configure the existing server-side LORD text-model routing for specification and text deliverable generation. Model availability depends on the existing LORD/OpenRouter server configuration.
3. Configure the existing LORD image provider for image assets. Anything Studio uses the selected model and storage setup already configured for the Images feature; it does not add a separate image provider.
4. The game export uses LORD's existing compatible game runtime and bundles its Three.js runtime for supported 3D games. It does not package a native Android application.
5. Mind Graph receives new projects through the shared `projects` table. LORD Autopilot is a separate authenticated mission workspace in chat; it runs only its registered server-side tools and does not currently create or deploy Anything Studio projects.

## File isolation

Generation receives only the user's project description, the saved project specification, and completed deliverables declared as dependencies. It does not read local files, application configuration, environment variables, or LORD's internal data. The website preview is sandboxed without script or same-origin permissions.

-- Per ADR 0010 and issue #32: project_files holds a Project's manually
-- edited source, mutated directly by its owner (the signed-in user editing
-- through apps/api's file handlers) — unlike `approvals`, there is no
-- append-only requirement here, so aione_app keeps full CRUD, matching the
-- grant shape 0001_sharp_scalphunter.sql already uses for
-- workspaces/projects/sessions/runs/deployments.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_files TO aione_app;

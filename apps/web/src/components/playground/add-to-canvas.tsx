"use client";

import type { PlaygroundRun } from "@kousa/generation/playground-service";
import { Button } from "@kousa/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kousa/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@kousa/ui/components/field";
import { Input } from "@kousa/ui/components/input";
import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { client, orpc } from "@/utils/orpc";
import { OptionField } from "./option-field";

export function AddToCanvas({
	userId,
	run,
	onClose,
}: {
	userId: string;
	run: PlaygroundRun;
	onClose: () => void;
}) {
	const router = useRouter();
	const cache = useQueryClient();
	const [projectId, setProjectId] = useState("new");
	const [canvasId, setCanvasId] = useState("");
	const [name, setName] = useState("Playground ideas");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const lock = useRef(false);
	const projects = useInfiniteQuery({
		queryKey: ["projects", userId, "playground-destinations"],
		queryFn: ({ pageParam }) => client.projects.list({ offset: pageParam }),
		initialPageParam: 0,
		getNextPageParam: (page, _, last) => (page.hasMore ? last + 20 : undefined),
	});
	const canvases = useQuery({
		...orpc.projects.listCanvases.queryOptions({ input: { projectId } }),
		queryKey: ["projects", userId, projectId, "canvases"],
		enabled: projectId !== "new",
	});
	const selectedCanvas = canvasId || canvases.data?.[0]?.id;
	async function add() {
		if (lock.current) return;
		lock.current = true;
		setPending(true);
		setError(null);
		try {
			let targetProject = projectId;
			let targetCanvas = selectedCanvas;
			if (projectId === "new") {
				const created = await client.projects.create({ name: name.trim() });
				targetProject = created.id;
				targetCanvas = created.id;
				setProjectId(created.id);
				setCanvasId(created.id);
				await cache.invalidateQueries({ queryKey: ["projects", userId] });
			}
			if (!targetCanvas) throw new Error("Choose a canvas.");
			// Import inside the target canvas so its shared-document editor owns the insertion.
			router.push(
				`/projects/${targetProject}/canvas?canvas=${targetCanvas}&playground=${run.id}`,
			);
			onClose();
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Could not open the canvas.",
			);
		} finally {
			setPending(false);
			lock.current = false;
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add to canvas</DialogTitle>
					<DialogDescription>
						Keep this result and its generation settings in a project. No
						generation credits are used.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<OptionField
						id="destination-project"
						label="Project"
						value={projectId}
						disabled={pending}
						items={[
							{ value: "new", label: "Create a new project" },
							...(projects.data?.pages
								.flatMap((p) => p.items)
								.filter((p) => p.role !== "viewer")
								.map((p) => ({ value: p.id, label: p.name })) ?? []),
						]}
						onChange={(value) => {
							setProjectId(value);
							setCanvasId("");
						}}
					/>
					{projects.hasNextPage ? (
						<Button
							variant="ghost"
							disabled={projects.isFetchingNextPage}
							onClick={() => void projects.fetchNextPage()}
						>
							Load more projects
						</Button>
					) : null}
					{projects.isError ? (
						<p role="alert">
							Could not load projects.{" "}
							<Button variant="link" onClick={() => void projects.refetch()}>
								Retry
							</Button>
						</p>
					) : null}
					{projectId === "new" ? (
						<Field>
							<FieldLabel htmlFor="destination-name">Project name</FieldLabel>
							<Input
								id="destination-name"
								value={name}
								maxLength={80}
								disabled={pending}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
					) : (
						<OptionField
							id="destination-canvas"
							label="Canvas"
							value={selectedCanvas ?? ""}
							items={
								canvases.data?.map((c) => ({ value: c.id, label: c.name })) ??
								[]
							}
							onChange={setCanvasId}
							disabled={pending || canvases.isPending}
						/>
					)}
					{canvases.isError && projectId !== "new" ? (
						<p role="alert">
							Could not load canvases.{" "}
							<Button variant="link" onClick={() => void canvases.refetch()}>
								Retry
							</Button>
						</p>
					) : null}
					{error ? (
						<p role="alert" className="text-destructive text-sm">
							{error}
						</p>
					) : null}
				</FieldGroup>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={pending}>
						Cancel
					</Button>
					<Button
						onClick={() => void add()}
						disabled={
							pending ||
							(projectId === "new"
								? !name.trim()
								: !selectedCanvas || canvases.isError)
						}
					>
						{pending ? "Opening…" : "Add to canvas"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

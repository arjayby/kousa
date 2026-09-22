"use client";

import {
	defaultImageModel,
	defaultSpeechModel,
	defaultSpeechVoice,
	defaultTextModel,
	defaultVideoModel,
	speechVoices,
} from "@kousa/generation/contracts";
import type { AuthoredSettings } from "@kousa/generation/history";
import {
	playgroundCost,
	playgroundGenerateInput,
	playgroundModels,
	playgroundSettings,
} from "@kousa/generation/playground-contracts";
import type {
	PlaygroundRun,
	PlaygroundService,
} from "@kousa/generation/playground-service";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Badge } from "@kousa/ui/components/badge";
import { Button, buttonVariants } from "@kousa/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kousa/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@kousa/ui/components/field";
import { Textarea } from "@kousa/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@kousa/ui/components/toggle-group";
import { ORPCError } from "@orpc/client";
import {
	type InfiniteData,
	useInfiniteQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	ArrowUpRightIcon,
	AudioLinesIcon,
	ImageIcon,
	LoaderCircleIcon,
	SparklesIcon,
	TypeIcon,
	VideoIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { AddToCanvas } from "./add-to-canvas";
import { GenerationCard } from "./generation-card";
import { OptionField } from "./option-field";

const kinds = [
	{ id: "image", label: "Image", icon: ImageIcon },
	{ id: "video", label: "Video", icon: VideoIcon },
	{ id: "text", label: "Text", icon: TypeIcon },
	{ id: "speech", label: "Audio", icon: AudioLinesIcon },
] as const;
const draftSchema = z.object({
	kind: z.enum(["image", "text", "video", "speech"]),
	content: z.string().max(20_000),
	models: z.object({
		image: z.string(),
		text: z.string(),
		video: z.string(),
		speech: z.string(),
	}),
	aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]),
	duration: z.union([z.literal(5), z.literal(10)]),
	voiceId: z.string(),
	voiceDirection: z.string().max(500),
});
const defaults: z.infer<typeof draftSchema> = {
	kind: "image",
	content: "",
	models: {
		image: defaultImageModel,
		text: defaultTextModel,
		video: defaultVideoModel,
		speech: defaultSpeechModel,
	},
	aspectRatio: "1:1",
	duration: 5,
	voiceId: defaultSpeechVoice,
	voiceDirection: "",
};

type History = Awaited<ReturnType<PlaygroundService["history"]>>;
type HistoryPages = InfiniteData<History, History["nextCursor"] | undefined>;
type Submission = z.infer<typeof playgroundGenerateInput>;
export function Playground({
	userId,
	initial,
}: {
	userId: string;
	initial: History;
}) {
	const [draft, setDraft] = useState(defaults);
	const [ready, setReady] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [uncertain, setUncertain] = useState<Submission | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<PlaygroundRun | null>(null);
	const submissionLock = useRef(false);
	const prompt = useRef<HTMLTextAreaElement>(null);
	const session = authClient.useSession();
	const cache = useQueryClient();
	const draftKey = `kousa:playground:v1:${userId}`;
	const requestKey = `${draftKey}:request`;
	const history = useInfiniteQuery({
		queryKey: ["playground", userId, "history"],
		queryFn: ({ pageParam }) =>
			client.playground.history({ cursor: pageParam ?? undefined }),
		initialPageParam: undefined as History["nextCursor"] | undefined,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		initialData: { pages: [initial], pageParams: [undefined] },
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		refetchInterval: (query) =>
			query.state.data?.pages[0]?.busy ? 3_000 : false,
	});
	const latest = history.data.pages[0] ?? initial;
	const runs = history.data.pages.flatMap((page) => page.runs);
	const accountChanged = !session.isPending && session.data?.user.id !== userId;
	useEffect(() => {
		if (history.hasNextPage && !history.isFetching && !history.isError)
			void history.fetchNextPage();
	}, [
		history.hasNextPage,
		history.isFetching,
		history.isError,
		history.fetchNextPage,
	]);
	useEffect(() => {
		try {
			const parsed = draftSchema.safeParse(
				JSON.parse(localStorage.getItem(draftKey) ?? "null"),
			);
			if (parsed.success) {
				const next = parsed.data;
				for (const { id } of kinds)
					if (!playgroundModels[id].some((m) => m.id === next.models[id]))
						next.models[id] = defaults.models[id];
				if (!speechVoices.some((v) => v.id === next.voiceId))
					next.voiceId = defaultSpeechVoice;
				setDraft(next);
			}
			const pending = playgroundGenerateInput.safeParse(
				JSON.parse(localStorage.getItem(requestKey) ?? "null"),
			);
			if (pending.success) setUncertain(pending.data);
		} catch {
			/* Storage can be unavailable. The server still saves every accepted run. */
		}
		setReady(true);
	}, [draftKey, requestKey]);
	useEffect(() => {
		if (!ready) return;
		try {
			localStorage.setItem(draftKey, JSON.stringify(draft));
		} catch {
			/* Draft persistence is optional. */
		}
	}, [draft, ready, draftKey]);
	function forgetRequest() {
		setUncertain(null);
		try {
			localStorage.removeItem(requestKey);
		} catch {
			/* In-memory recovery remains available. */
		}
	}
	const settings: AuthoredSettings =
		draft.kind === "speech"
			? {
					kind: draft.kind,
					content: draft.content,
					modelId: draft.models.speech,
					voiceId: draft.voiceId,
					voiceDirection: draft.voiceDirection,
				}
			: draft.kind === "video"
				? {
						kind: draft.kind,
						content: draft.content,
						modelId: draft.models.video,
						aspectRatio: draft.aspectRatio,
						duration: draft.duration,
					}
				: draft.kind === "image"
					? {
							kind: draft.kind,
							content: draft.content,
							modelId: draft.models.image,
							aspectRatio: draft.aspectRatio,
						}
					: {
							kind: draft.kind,
							content: draft.content,
							modelId: draft.models.text,
						};
	const validation = playgroundSettings.safeParse(settings);
	const cost = playgroundCost(settings);
	const unavailable = !latest.configured[draft.kind];
	const blocked =
		!ready ||
		submitting ||
		accountChanged ||
		(!uncertain &&
			(!validation.success ||
				unavailable ||
				latest.busy ||
				latest.balance < cost ||
				history.isError));
	async function generate() {
		if (submissionLock.current || blocked) return;
		submissionLock.current = true;
		setSubmitting(true);
		setError(null);
		const request = uncertain ?? { id: crypto.randomUUID(), settings };
		setUncertain(request);
		try {
			localStorage.setItem(requestKey, JSON.stringify(request));
		} catch {
			/* Request IDs still protect retries in this tab. */
		}
		try {
			const run = await client.playground.generate(request);
			const queryKey = ["playground", userId, "history"];
			await cache.cancelQueries({ queryKey });
			cache.setQueryData<HistoryPages>(queryKey, (current) => {
				const pages = current?.pages ?? [initial];
				const known = pages.some((page) =>
					page.runs.some((saved) => saved.id === run.id),
				);
				return {
					pageParams: current?.pageParams ?? [undefined],
					pages: pages.map((page, index) => ({
						...page,
						...(index === 0
							? {
									// Reconcile the reservation and final status on the next poll.
									busy: true,
									balance:
										known || uncertain
											? page.balance
											: Math.max(0, page.balance - run.credits),
								}
							: {}),
						runs: [
							...(index === 0 ? [run] : []),
							...page.runs.filter((saved) => saved.id !== run.id),
						],
					})),
				};
			});
			forgetRequest();
			await cache.invalidateQueries({ queryKey: ["credits", userId] });
		} catch (failure) {
			if (
				failure instanceof ORPCError &&
				[
					"BAD_REQUEST",
					"FORBIDDEN",
					"NOT_FOUND",
					"CONFLICT",
					"PAYMENT_REQUIRED",
					"UNAUTHORIZED",
				].includes(failure.code)
			) {
				forgetRequest();
				setError(failure.message);
			} else
				setError(
					"We could not confirm the request. Check generation to recover it without starting another run.",
				);
		} finally {
			setSubmitting(false);
			submissionLock.current = false;
		}
	}
	function reuse(run: PlaygroundRun) {
		const saved = run.settings;
		setDraft((current) => ({
			...current,
			kind: saved.kind,
			content: saved.content,
			models: { ...current.models, [saved.kind]: saved.modelId },
			...("aspectRatio" in saved ? { aspectRatio: saved.aspectRatio } : {}),
			...("duration" in saved ? { duration: saved.duration } : {}),
			...("voiceId" in saved
				? { voiceId: saved.voiceId, voiceDirection: saved.voiceDirection }
				: {}),
		}));
		setError(null);
		prompt.current?.focus();
		prompt.current?.scrollIntoView({ behavior: "smooth", block: "center" });
	}
	if (accountChanged)
		return (
			<main className="container mx-auto p-8">
				<Alert>
					<AlertTitle>Your account changed</AlertTitle>
					<AlertDescription>Reload to open your Playground.</AlertDescription>
				</Alert>
				<Button onClick={() => window.location.reload()}>Reload</Button>
			</main>
		);
	return (
		<main className="container mx-auto flex min-w-0 flex-col gap-8 px-4 py-8 md:px-6">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-2">
					<h1 className="font-semibold text-3xl tracking-tight">Playground</h1>
					<p className="text-muted-foreground">
						Try models and create without setting up a project.
					</p>
				</div>
				<Link
					href="/dashboard"
					className={buttonVariants({ variant: "outline" })}
				>
					Projects
					<ArrowUpRightIcon data-icon="inline-end" />
				</Link>
			</header>
			<div className="grid items-start gap-8 md:grid-cols-[20rem_minmax(0,1fr)]">
				<Card className="md:sticky md:top-6">
					<CardHeader>
						<CardTitle>Create something</CardTitle>
						<CardDescription>
							Your generations are saved privately.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							id="playground-form"
							onSubmit={(event) => {
								event.preventDefault();
								void generate();
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel>Output type</FieldLabel>
									<ToggleGroup
										aria-label="Output type"
										value={[draft.kind]}
										onValueChange={(values) => {
											const kind = kinds.find((k) => k.id === values[0])?.id;
											if (kind) {
												setDraft((d) => ({ ...d, kind }));
												setError(null);
											}
										}}
										variant="outline"
										spacing={0}
									>
										{kinds.map(({ id, label, icon: Icon }) => (
											<ToggleGroupItem key={id} value={id} aria-label={label}>
												<Icon data-icon="inline-start" />
												{label}
											</ToggleGroupItem>
										))}
									</ToggleGroup>
									{draft.kind === "speech" ? (
										<FieldDescription>
											Audio generation currently supports speech.
										</FieldDescription>
									) : null}
								</Field>
								<OptionField
									id="playground-model"
									label="Model"
									value={draft.models[draft.kind]}
									items={playgroundModels[draft.kind].map((m) => ({
										value: m.id,
										label: m.name,
									}))}
									onChange={(value) =>
										setDraft((d) => ({
											...d,
											models: { ...d.models, [d.kind]: value },
										}))
									}
								/>
								<Field
									data-invalid={draft.content.length > 0 && !validation.success}
								>
									<FieldLabel htmlFor="playground-prompt">
										{draft.kind === "speech" ? "Script" : "Prompt"}
									</FieldLabel>
									<Textarea
										ref={prompt}
										id="playground-prompt"
										placeholder={
											draft.kind === "speech"
												? "Write what you want the voice to say…"
												: "Describe what you want to create…"
										}
										value={draft.content}
										onChange={(e) =>
											setDraft((d) => ({ ...d, content: e.target.value }))
										}
										maxLength={20_000}
										aria-invalid={
											draft.content.length > 0 && !validation.success
										}
										className="min-h-44 resize-y"
									/>
									<FieldDescription>
										{draft.content && !validation.success
											? validation.error.issues[0]?.message
											: draft.kind === "speech"
												? "Up to 1,000 characters."
												: "Switch models to try this same prompt again."}
									</FieldDescription>
								</Field>
								{draft.kind === "image" || draft.kind === "video" ? (
									<OptionField
										id="playground-ratio"
										label="Aspect ratio"
										value={draft.aspectRatio}
										items={["1:1", "16:9", "9:16", "4:3"].map((value) => ({
											value,
											label: value,
										}))}
										onChange={(value) => {
											const ratio = draftSchema.shape.aspectRatio.parse(value);
											setDraft((d) => ({ ...d, aspectRatio: ratio }));
										}}
									/>
								) : null}
								{draft.kind === "video" ? (
									<OptionField
										id="playground-duration"
										label="Duration"
										value={String(draft.duration)}
										items={[
											{ value: "5", label: "5 seconds" },
											{ value: "10", label: "10 seconds" },
										]}
										onChange={(value) =>
											setDraft((d) => ({
												...d,
												duration: value === "10" ? 10 : 5,
											}))
										}
									/>
								) : null}
								{draft.kind === "speech" ? (
									<>
										<OptionField
											id="playground-voice"
											label="Voice"
											value={draft.voiceId}
											items={speechVoices.map((v) => ({
												value: v.id,
												label: v.name,
											}))}
											onChange={(voiceId) =>
												setDraft((d) => ({ ...d, voiceId }))
											}
										/>
										<Field>
											<FieldLabel htmlFor="playground-direction">
												Voice direction
											</FieldLabel>
											<Textarea
												id="playground-direction"
												value={draft.voiceDirection}
												placeholder="Calm and conversational"
												maxLength={500}
												onChange={(e) =>
													setDraft((d) => ({
														...d,
														voiceDirection: e.target.value,
													}))
												}
											/>
										</Field>
									</>
								) : null}
							</FieldGroup>
						</form>
					</CardContent>
					<CardFooter className="flex flex-col items-stretch gap-3">
						<div className="flex items-center justify-between gap-2 text-sm">
							<span>
								{cost} {cost === 1 ? "credit" : "credits"} per generation
							</span>
							<span className="text-muted-foreground">
								{latest.balance} available
							</span>
						</div>
						<Button type="submit" form="playground-form" disabled={blocked}>
							{submitting ? (
								<LoaderCircleIcon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<SparklesIcon data-icon="inline-start" />
							)}
							{submitting
								? "Checking…"
								: uncertain
									? "Check generation"
									: "Generate"}
						</Button>
						<p className="text-muted-foreground text-xs">
							Credits are reserved when you start and charged on success.
						</p>
						{unavailable ? (
							<p role="status" className="text-muted-foreground text-sm">
								Generation is currently unavailable.
							</p>
						) : latest.busy ? (
							<p role="status" className="text-muted-foreground text-sm">
								Your generation is running. You can leave this page and return
								to the result.
							</p>
						) : latest.balance < cost ? (
							<Link href="/dashboard" className="text-sm underline">
								Get credits to generate
							</Link>
						) : null}
						{uncertain && !submitting ? (
							<p role="status" className="text-sm">
								A previous request needs checking. Its original prompt and model
								will be used.
							</p>
						) : null}
						{error ? (
							<Alert variant="destructive">
								<AlertTitle>Could not start generation</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
					</CardFooter>
				</Card>
				<section
					aria-labelledby="recent-generations"
					className="flex min-w-0 flex-col gap-5"
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<h2 id="recent-generations" className="font-semibold text-xl">
								Recent generations
							</h2>
							<Badge variant="secondary">Only you</Badge>
						</div>
					</div>
					{history.isError ? (
						<Alert variant="destructive">
							<AlertTitle>Could not load generations</AlertTitle>
							<AlertDescription>
								Your saved results are still available. Check your connection
								and reload the page to try again.
							</AlertDescription>
						</Alert>
					) : null}
					{!runs.length ? (
						<Empty className="min-h-80 border border-dashed">
							<EmptyHeader>
								<SparklesIcon className="mx-auto size-8 text-muted-foreground" />
								<EmptyTitle>Your next idea starts here</EmptyTitle>
								<EmptyDescription>
									Write a prompt and choose a model. Each result will appear
									here, ready to download or add to a canvas.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="grid items-start gap-4 xl:grid-cols-2">
							{runs.map((run) => (
								<GenerationCard
									key={run.id}
									run={run}
									onReuse={() => reuse(run)}
									onAdd={() => setSelected(run)}
								/>
							))}
						</div>
					)}
					{history.hasNextPage && !history.isError ? (
						<p role="status" className="text-muted-foreground text-sm">
							Loading earlier generations…
						</p>
					) : null}
				</section>
			</div>
			{selected ? (
				<AddToCanvas
					userId={userId}
					run={selected}
					onClose={() => setSelected(null)}
				/>
			) : null}
		</main>
	);
}

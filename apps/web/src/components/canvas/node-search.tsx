"use client";

import { type CanvasNode, nodeLabels } from "@kousa/projects/canvas";
import { searchCanvasNodes } from "@kousa/projects/canvas-search";
import { Button } from "@kousa/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kousa/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kousa/ui/components/dialog";
import { SearchIcon } from "lucide-react";
import { type RefObject, useMemo, useRef, useState } from "react";
import { nodeIcons } from "./media-node";

function SearchResults({
	nodes,
	onSelect,
	input,
}: {
	nodes: CanvasNode[];
	onSelect: (id: string) => void;
	input: RefObject<HTMLInputElement | null>;
}) {
	const [query, setQuery] = useState("");
	const results = useMemo(
		() => searchCanvasNodes(nodes, query),
		[nodes, query],
	);
	return (
		<Command shouldFilter={false} loop label="Search names, types, or prompts">
			<CommandInput
				ref={input}
				value={query}
				onValueChange={setQuery}
				placeholder="Search names, types, or prompts…"
			/>
			<CommandList label="Matching nodes" className="max-h-[min(24rem,50dvh)]">
				<CommandEmpty>
					{nodes.length
						? "No matching nodes. Try another name, type, or prompt."
						: "No nodes on this canvas yet."}
				</CommandEmpty>
				<CommandGroup heading={`${results.length} of ${nodes.length} nodes`}>
					{results.map(({ node, excerpt }) => {
						const Icon = nodeIcons[node.type];
						return (
							<CommandItem
								key={node.id}
								value={node.id}
								onSelect={() => onSelect(node.id)}
							>
								<Icon aria-hidden="true" />
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex items-baseline gap-2">
										<span className="truncate font-medium">
											{node.data.label || nodeLabels[node.type]}
										</span>
										<span className="shrink-0 text-muted-foreground">
											{nodeLabels[node.type]}
										</span>
									</div>
									<p className="line-clamp-2 break-words text-muted-foreground">
										{excerpt || "No prompt yet"}
									</p>
								</div>
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}

export function NodeSearch({
	nodes,
	open,
	onOpenChange,
	onFocus,
	loaded,
}: {
	nodes: CanvasNode[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onFocus: (id: string) => void;
	loaded: boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger
				ref={trigger}
				render={<Button variant="outline" disabled={!loaded} />}
				title="Search nodes · ⌘/Ctrl K"
				aria-keyshortcuts="Meta+K Control+K"
			>
				<SearchIcon data-icon="inline-start" />
				Search nodes
				<kbd className="hidden text-[10px] text-muted-foreground sm:inline">
					⌘/Ctrl K
				</kbd>
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-lg"
				initialFocus={input}
				finalFocus={trigger}
			>
				<DialogHeader>
					<DialogTitle>Find a node</DialogTitle>
					<DialogDescription>
						Search this canvas, then select a result to focus and zoom to it.
					</DialogDescription>
				</DialogHeader>
				<SearchResults
					nodes={nodes}
					input={input}
					onSelect={(id) => {
						onFocus(id);
						onOpenChange(false);
					}}
				/>
				<p className="text-muted-foreground">
					↑ ↓ to browse · Enter to focus · Esc to close
				</p>
			</DialogContent>
		</Dialog>
	);
}

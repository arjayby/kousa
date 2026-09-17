"use client";
import {
	type createCanvasDocumentModel,
	replaceSharedText,
} from "@kousa/projects/canvas-document";
import { Input } from "@kousa/ui/components/input";
import { Textarea } from "@kousa/ui/components/textarea";
import { useLayoutEffect, useRef } from "react";
import * as Y from "yjs";

type Model = ReturnType<typeof createCanvasDocumentModel>;
// Keep the caret anchored to shared text, including incoming edits during IME.
export function SharedTextField({
	model,
	nodeId,
	field,
	multiline,
	readOnly,
	...props
}: {
	model: Model;
	nodeId: string;
	field: "label" | "content" | "voiceDirection";
	multiline?: boolean;
	readOnly: boolean;
	id: string;
	maxLength: number;
	placeholder?: string;
	className?: string;
	onBlur: () => void;
}) {
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const composition = useRef<{
		value: string;
		positions: Y.RelativePosition[];
	} | null>(null);
	const text = model.getText(nodeId, field);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!text || !element) return;
		element.value = text.toString();
		let selection: {
			start: Y.RelativePosition;
			end: Y.RelativePosition;
			direction: "forward" | "backward" | "none";
		} | null = null;
		const before = (transaction: Y.Transaction) => {
			selection =
				!transaction.local &&
				!composition.current &&
				document.activeElement === element
					? {
							start: Y.createRelativePositionFromTypeIndex(
								text,
								element.selectionStart ?? 0,
							),
							end: Y.createRelativePositionFromTypeIndex(
								text,
								element.selectionEnd ?? 0,
							),
							direction: element.selectionDirection ?? "none",
						}
					: null;
		};
		const changed = () => {
			if (composition.current) return;
			if (element.value !== text.toString()) element.value = text.toString();
			if (selection) {
				const start = Y.createAbsolutePositionFromRelativePosition(
					selection.start,
					model.doc,
				);
				const end = Y.createAbsolutePositionFromRelativePosition(
					selection.end,
					model.doc,
				);
				if (start && end)
					element.setSelectionRange(
						start.index,
						end.index,
						selection.direction,
					);
			}
		};
		model.doc.on("beforeTransaction", before);
		text.observe(changed);
		return () => {
			model.doc.off("beforeTransaction", before);
			text.unobserve(changed);
		};
	}, [model, text]);
	const Component = multiline ? Textarea : Input;
	return (
		<Component
			{...props}
			ref={ref}
			readOnly={readOnly || !text}
			defaultValue={text?.toString() ?? ""}
			onChange={(event) => {
				if (readOnly || composition.current) return;
				model.editText(nodeId, field, (shared) =>
					replaceSharedText(shared, event.target.value),
				);
			}}
			onCompositionStart={() => {
				if (!text || readOnly) return;
				composition.current = {
					value: text.toString(),
					positions: Array.from({ length: text.length + 1 }, (_, index) =>
						Y.createRelativePositionFromTypeIndex(text, index),
					),
				};
			}}
			onCompositionEnd={(event) => {
				const pending = composition.current;
				composition.current = null;
				if (!pending || !text || readOnly) {
					if (text) event.currentTarget.value = text.toString();
					return;
				}
				const next = event.currentTarget.value;
				let start = 0;
				let end = 0;
				while (
					start < pending.value.length &&
					start < next.length &&
					pending.value[start] === next[start]
				)
					start++;
				while (
					end < pending.value.length - start &&
					end < next.length - start &&
					pending.value[pending.value.length - end - 1] ===
						next[next.length - end - 1]
				)
					end++;
				const from = Y.createAbsolutePositionFromRelativePosition(
					pending.positions[start],
					model.doc,
				);
				const to = Y.createAbsolutePositionFromRelativePosition(
					pending.positions[pending.value.length - end],
					model.doc,
				);
				if (from && to)
					model.editText(nodeId, field, (shared) => {
						if (to.index > from.index)
							shared.delete(from.index, to.index - from.index);
						const insert = next.slice(start, next.length - end);
						if (insert) shared.insert(from.index, insert);
					});
				event.currentTarget.value = text.toString();
			}}
		/>
	);
}

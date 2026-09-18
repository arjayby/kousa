"use client";

import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kousa/ui/components/alert";
import { Button } from "@kousa/ui/components/button";

export default function MediaError({ retry }: { retry: () => void }) {
	return (
		<main className="container mx-auto flex flex-col items-start gap-4 px-4 py-8">
			<h1 className="font-semibold text-2xl">Media</h1>
			<Alert variant="destructive">
				<AlertTitle>Could not load your media</AlertTitle>
				<AlertDescription>Please try again.</AlertDescription>
			</Alert>
			<Button onClick={retry}>Try again</Button>
		</main>
	);
}

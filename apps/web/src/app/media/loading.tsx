import { Skeleton } from "@kousa/ui/components/skeleton";

export default function MediaLoading() {
	return (
		<main
			className="container mx-auto flex flex-col gap-6 px-4 py-8"
			aria-label="Loading media"
			aria-busy="true"
		>
			<h1 className="font-semibold text-2xl">Media</h1>
			<Skeleton className="h-10 w-full max-w-md" />
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{[1, 2, 3, 4].map((id) => (
					<Skeleton key={id} className="aspect-square w-full" />
				))}
			</div>
		</main>
	);
}

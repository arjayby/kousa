import { buttonVariants } from "@kousa/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@kousa/ui/components/empty";
import Link from "next/link";

export default function ProjectNotFound() {
	return (
		<main className="container mx-auto px-4 py-12">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>
						<h1>Project unavailable</h1>
					</EmptyTitle>
					<EmptyDescription>
						This project does not exist, or you no longer have access.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Link
						href="/dashboard"
						className={buttonVariants({ variant: "outline" })}
					>
						Back to projects
					</Link>
				</EmptyContent>
			</Empty>
		</main>
	);
}

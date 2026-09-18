"use client";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	const links = [
		{ to: "/", label: "Home" },
		{ to: "/playground", label: "Playground" },
		{ to: "/media", label: "Media" },
		{ to: "/dashboard", label: "Projects" },
	] as const;

	return (
		<div>
			<div className="flex flex-row flex-wrap items-center justify-between gap-2 px-2 py-1">
				<nav className="flex flex-wrap gap-x-4 gap-y-1 text-lg">
					{links.map(({ to, label }) => {
						return (
							<Link key={to} href={to}>
								{label}
							</Link>
						);
					})}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
			<hr />
		</div>
	);
}

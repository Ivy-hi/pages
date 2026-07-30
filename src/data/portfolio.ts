export interface PortfolioPhoto {
	file: string;
	alt: string;
	caption?: string;
}

export const portfolio = {
	name: "Yi Han",
	title: "Yi Han | Photography",
	description: "Selected photographs and visual notes by Yi Han.",
};

// Replace these files and descriptions with your own work. The order here is
// the order shown on the homepage.
export const photos: PortfolioPhoto[] = [
	{
		file: "digital-01.jpg",
		alt: "A dense riverside city skyline glowing in late-afternoon light",
		caption: "City at dusk",
	},
	{
		file: "digital-02.jpg",
		alt: "A gold-toned high-rise rising behind weathered residential buildings",
		caption: "Old and new",
	},
	{
		file: "digital-03.jpg",
		alt: "An old harbor seen across still water",
		caption: "Old harbor",
	},
	{
		file: "digital-04.jpg",
		alt: "Pine trees fading into distant mist",
		caption: "Pine forest",
	},
	{ file: "digital-05.jpg", alt: "A minimal landscape study" },
	{ file: "digital-06.jpg", alt: "A quiet study of light and distance" },
	{ file: "digital-07.jpg", alt: "A muted landscape composition" },
	{ file: "digital-08.jpg", alt: "A study in atmosphere and form" },
];

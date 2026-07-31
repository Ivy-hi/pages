import photosData from "./photos.json";

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

// The order in photos.json is the order shown on the homepage.
export const photos: PortfolioPhoto[] = photosData;

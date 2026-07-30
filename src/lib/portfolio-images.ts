import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

const WIDTHS = [640, 960, 1280, 1800];

export interface RenderedPortfolioPhoto {
	src: string;
	srcset: string;
	full: string;
	width: number;
	height: number;
}

export async function renderPortfolioPhoto(
	source: ImageMetadata,
): Promise<RenderedPortfolioPhoto> {
	const cap = Math.min(source.width, WIDTHS[WIDTHS.length - 1]);
	const widths = WIDTHS.filter((width) => width <= cap);

	if (!widths.includes(cap)) {
		widths.push(cap);
	}

	const renditions = await Promise.all(
		widths.map((width) =>
			getImage({
				src: source,
				width,
				format: "webp",
				quality: 82,
			}),
		),
	);
	const largest = renditions[renditions.length - 1];

	return {
		src: largest.src,
		srcset: renditions
			.map((image) => `${image.src} ${image.attributes.width}w`)
			.join(", "),
		full: largest.src,
		width: source.width,
		height: source.height,
	};
}

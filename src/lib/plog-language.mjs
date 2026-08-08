const copyByLanguage = {
	en: {
		back: "All entries",
		read: "Read note",
		readAria: (title) => `Read ${title}`,
	},
	"zh-CN": {
		back: "全部文章",
		read: "阅读",
		readAria: (title) => `阅读《${title}》`,
	},
};

export function getPlogCopy(language = "en") {
	return copyByLanguage[language] ?? copyByLanguage.en;
}

export function formatPlogDate(date, language = "en") {
	return new Intl.DateTimeFormat(language, {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
}

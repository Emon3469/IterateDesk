export function withCitationLinks(text: string) {
  return text
    .replace(/【\s*(\d{1,2})[^】]*】/g, "[$1]")
    .replace(/\[(\d{1,2})((?:\s*,\s*\d{1,2})+)\]/g, (_, first: string, rest: string) =>
      [first, ...rest.split(",").map((n) => n.trim()).filter(Boolean)].map((n) => `[${n}]`).join(""),
    )
    .replace(/\[(\d{1,2})\](?!\()/g, "[$1](#cite-$1)");
}

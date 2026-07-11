// Compose file names in a project almost always share a long prefix
// (docker-compose / compose), so truncating each one from the end (or even
// the middle) tends to show "docker-compo..." for every row - useless for
// telling an override apart from a profile file. Stripping what's common
// across the whole set leaves just the part that actually differs.
export function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) {
      i += 1;
    }
    prefix = prefix.slice(0, i);
    if (!prefix) {
      break;
    }
  }

  // Back off any trailing separator so the remainder keeps its own leading
  // "." or "-" (".override.yml" reads better than "override.yml").
  return prefix.replace(/[.-]+$/, "");
}

export function distinguishingFileLabel(fileName: string, commonPrefix: string): string {
  if (commonPrefix.length < 4 || fileName.length <= commonPrefix.length) {
    return fileName;
  }

  const remainder = fileName.slice(commonPrefix.length);
  return remainder.length > 0 ? remainder : fileName;
}

function scrubLua(code: string, stripStrings: boolean): string {
  let output = "";
  let index = 0;
  const blank = (character: string) =>
    character === "\n" || character === "\r" ? character : " ";
  const scrubRange = (start: number, stop: number) =>
    code.slice(start, stop).split("").map(blank).join("");

  while (index < code.length) {
    const current = code[index]!;
    const next = code[index + 1];

    if (current === "-" && next === "-") {
      const longComment = code.slice(index + 2).match(/^\[(=*)\[/);
      if (longComment) {
        const closer = `]${longComment[1]}]`;
        const contentStart = index + 2 + longComment[0].length;
        const end = code.indexOf(closer, contentStart);
        const stop = end < 0 ? code.length : end + closer.length;
        output += scrubRange(index, stop);
        index = stop;
        continue;
      }
      const end = code.indexOf("\n", index + 2);
      const stop = end < 0 ? code.length : end;
      output += " ".repeat(stop - index);
      index = stop;
      continue;
    }

    const longString = code.slice(index).match(/^\[(=*)\[/);
    if (longString) {
      const closer = `]${longString[1]}]`;
      const contentStart = index + longString[0].length;
      const end = code.indexOf(closer, contentStart);
      const stop = end < 0 ? code.length : end + closer.length;
      output += stripStrings
        ? scrubRange(index, stop)
        : code.slice(index, stop);
      index = stop;
      continue;
    }

    if (current === '"' || current === "'") {
      const quote = current;
      let stop = index + 1;
      while (stop < code.length) {
        if (code[stop] === "\\") {
          stop += 2;
          continue;
        }
        if (code[stop] === quote) {
          stop += 1;
          break;
        }
        stop += 1;
      }
      output += stripStrings
        ? scrubRange(index, stop)
        : code.slice(index, stop);
      index = stop;
      continue;
    }

    output += current;
    index += 1;
  }
  return output;
}

/** Remove comments while preserving string literals and line offsets. */
export function stripLuaComments(code: string): string {
  return scrubLua(code, false);
}

/** Remove both comments and string contents so API-name decoys cannot satisfy scorers. */
export function stripLuaCommentsAndStrings(code: string): string {
  return scrubLua(code, true);
}

export function countCalls(code: string, pattern: RegExp): number {
  return code.match(pattern)?.length ?? 0;
}

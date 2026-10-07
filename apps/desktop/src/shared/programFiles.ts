/** UI eligibility only. Main process verifies the file's actual format and size. */
export function isProgramFileName(name: string): boolean {
  return /\.(?:exe|dll|sys|elf|so|dylib|bin)$/iu.test(name);
}

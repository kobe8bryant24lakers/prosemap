/** Relative image references are resolved by the desktop against the document. */
export function isRelativeImageSource(source: string): boolean {
  return Boolean(source) && !/^(?:[a-z][a-z\d+.-]*:|[/\\]{1,2}|#)/i.test(source);
}

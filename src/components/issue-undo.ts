export function inverseIssuePatch<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  return Object.keys(patch).reduce<Partial<T>>((inverse, key) => {
    const field = key as keyof T;
    inverse[field] = source[field];
    return inverse;
  }, {});
}
